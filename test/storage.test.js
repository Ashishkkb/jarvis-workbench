import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, utimes, lstat, symlink, rename, link, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { scanStorage, planCleanup, executeCleanup, restoreCleanup, purgeCleanup, listCleanupHistory } from '../src/storage.js';

const DAY = 86400000;

async function fixture(t) {
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'jarvis-storage-test-')));
  const root = path.join(base, 'temporary');
  const quarantineDir = path.join(base, 'recovery');
  await mkdir(root);
  t.after(async () => {
    const relative = path.relative(await realpath(os.tmpdir()), path.resolve(base));
    assert.ok(relative.startsWith('jarvis-storage-test-') && !relative.includes(path.sep));
    await rm(base, { recursive: true, force: true });
  });
  const file = async (relative, contents = 'old temporary file', ageDays = 30) => {
    const absolute = path.join(root, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, contents);
    const modified = new Date(Date.now() - ageDays * DAY);
    await utimes(absolute, modified, modified);
    return absolute;
  };
  const plan = paths => planCleanup(paths, { baseRoot: root, tempRoot: root, quarantineDir });
  return { base, root, quarantineDir, file, plan };
}

async function readManifest(quarantineDir, id) {
  return JSON.parse(await readFile(path.join(quarantineDir, id, 'manifest.json'), 'utf8'));
}

async function writeManifest(quarantineDir, manifest) {
  await writeFile(path.join(quarantineDir, manifest.id, 'manifest.json'), JSON.stringify(manifest));
}

test('storage scan measures all folders and only proposes old temporary regular files', async t => {
  const { root, quarantineDir, file } = await fixture(t);
  await file('.git/object', 'git');
  const old = await file('node_modules/large', '12345678');
  const recent = await file('today', 'new', 0);
  const active = await file('runtime/app', 'keep');
  const result = await scanStorage(root, { tempRoot: root, quarantineDir, activePaths: [path.dirname(active)] });
  assert.equal(result.totalBytes, 18);
  assert.equal(result.totalFiles, 4);
  assert.equal(result.totalDirectories, 3);
  assert.equal(result.truncated, false);
  assert.equal(result.entries[0].name, 'node_modules');
  assert.equal(result.largestFiles[0].path, old);
  assert.ok(result.cleanupCandidates.some(item => item.path === old));
  assert.ok(!result.cleanupCandidates.some(item => item.path === recent || item.path === active));
  assert.ok(result.entries.every(item => path.isAbsolute(item.path)));
});

test('storage scan returns bounded and cancelled partial results with progress', async t => {
  const { root, file } = await fixture(t);
  for (let index = 0; index < 8; index++) await file(`file-${index}`, 'content');
  const bounded = await scanStorage(root, { maxEntries: 2 });
  assert.equal(bounded.totalFiles, 2);
  assert.equal(bounded.truncated, true);
  const controller = new AbortController();
  let updates = 0;
  const result = await scanStorage(root, { signal: controller.signal, onProgress: () => { updates++; controller.abort(); } });
  assert.ok(updates >= 1);
  assert.equal(result.cancelled, true);
  assert.equal(result.truncated, true);
  assert.ok(result.totalFiles < 8);
});

test('cleanup plan is frozen, deduplicated and confined to old files in the temp scan', async t => {
  const { root, file, plan } = await fixture(t);
  const old = await file('old', 'hello');
  const planned = await plan([old, old]);
  assert.equal(planned.mode, 'quarantine');
  assert.equal(planned.entries.length, 1);
  assert.equal(planned.totalBytes, 5);
  assert.ok(Object.isFrozen(planned) && Object.isFrozen(planned.entries) && Object.isFrozen(planned.entries[0].identity));
  await assert.rejects(plan([await file('young', 'hello', 0)]), /too recently/i);
  await assert.rejects(plan([root]), /regular temporary files/i);
  await assert.rejects(plan(['relative.txt']), /absolute file path/i);
  await assert.rejects(planCleanup([path.join(process.cwd(), 'package.json')]), /restricted to temporary files/i);
  await assert.rejects(planCleanup([old], { baseRoot: root, retentionDays: 0 }), /at least 7 days/i);
  await assert.rejects(planCleanup([old], { tempRoot: process.cwd() }), /operating system temporary folder/i);
});

test('cleanup requires explicit confirmation, a process-issued plan and an unexpired review', async t => {
  const { root, quarantineDir, file, plan } = await fixture(t);
  const old = await file('old');
  const planned = await plan([old]);
  await assert.rejects(executeCleanup(planned, { quarantineDir }), /explicitly confirm/i);
  await assert.rejects(executeCleanup({ ...planned }, { confirmed: true, quarantineDir }), /fresh cleanup plan/i);
  const expired = await planCleanup([old], { baseRoot: root, now: Date.now() - 16 * 60000 });
  await assert.rejects(executeCleanup(expired, { confirmed: true, quarantineDir }), /expired/i);
  assert.ok((await lstat(old)).isFile());
});

test('quarantine persists a private manifest and restore returns original bytes without reclaim claims', async t => {
  const { quarantineDir, file, plan } = await fixture(t);
  const old = await file('nested/old', 'recover this');
  const planned = await plan([old]);
  const result = await executeCleanup(planned, { confirmed: true, quarantineDir });
  assert.equal(result.movedBytes, 12);
  assert.equal(result.reclaimedBytes, 0);
  assert.equal(result.status, 'quarantined');
  await assert.rejects(lstat(old), { code: 'ENOENT' });
  const manifest = await readManifest(quarantineDir, planned.id);
  const recoveredPath = path.join(quarantineDir, planned.id, 'files', manifest.entries[0].quarantineName);
  assert.equal(await readFile(recoveredPath, 'utf8'), 'recover this');
  if (process.platform !== 'win32') assert.equal((await lstat(path.join(quarantineDir, planned.id, 'manifest.json'))).mode & 0o777, 0o600);
  const history = await listCleanupHistory({ quarantineDir });
  assert.equal(history[0].files, 1);
  assert.equal(history[0].bytes, 12);
  const restored = await restoreCleanup(planned.id, { quarantineDir });
  assert.equal(restored.restoredBytes, 12);
  assert.equal(restored.reclaimedBytes, 0);
  assert.equal(await readFile(old, 'utf8'), 'recover this');
  assert.equal((await listCleanupHistory({ quarantineDir }))[0].files, 0);
  await assert.rejects(lstat(recoveredPath), { code: 'ENOENT' });
});

test('changed files are left in place when their reviewed plan is executed', async t => {
  const { quarantineDir, file, plan } = await fixture(t);
  const old = await file('old', 'first');
  const planned = await plan([old]);
  await writeFile(old, 'second');
  const result = await executeCleanup(planned, { confirmed: true, quarantineDir });
  assert.equal(result.movedBytes, 0);
  assert.equal(result.status, 'partial');
  assert.match(result.errors[0].message, /changed after review/i);
  assert.equal(await readFile(old, 'utf8'), 'second');
});

test('cancelled cleanup retains a durable manifest for every moved and pending file', async t => {
  const { quarantineDir, file, plan } = await fixture(t);
  const first = await file('first', 'first');
  const second = await file('second', 'second');
  const planned = await plan([first, second]);
  const controller = new AbortController();
  const result = await executeCleanup(planned, { confirmed: true, quarantineDir, signal: controller.signal, onProgress: () => controller.abort() });
  assert.equal(result.cancelled, true);
  assert.equal(result.movedBytes, 5);
  const manifest = await readManifest(quarantineDir, planned.id);
  assert.deepEqual(manifest.entries.map(entry => entry.state), ['quarantined', 'pending']);
  assert.equal(await readFile(second, 'utf8'), 'second');
  const restored = await restoreCleanup(planned.id, { quarantineDir });
  assert.equal(restored.restoredBytes, 5);
  assert.equal(await readFile(first, 'utf8'), 'first');
});

test('restore never overwrites an existing destination and purge needs separate confirmation', async t => {
  const { quarantineDir, file, plan } = await fixture(t);
  const old = await file('old', 'original');
  const planned = await plan([old]);
  await executeCleanup(planned, { confirmed: true, quarantineDir });
  await writeFile(old, 'new user work');
  const restored = await restoreCleanup(planned.id, { quarantineDir });
  assert.equal(restored.restoredBytes, 0);
  assert.match(restored.errors[0].message, /already exists/i);
  assert.equal(await readFile(old, 'utf8'), 'new user work');
  await assert.rejects(purgeCleanup(planned.id, { quarantineDir }), /explicitly confirm/i);
  const purged = await purgeCleanup(planned.id, { quarantineDir, confirmed: true });
  assert.equal(purged.reclaimedBytes, 8);
  assert.equal(purged.status, 'purged');
  assert.equal(await readFile(old, 'utf8'), 'new user work');
  assert.equal((await listCleanupHistory({ quarantineDir }))[0].files, 0);
});

test('purge refuses a changed quarantined file', async t => {
  const { quarantineDir, file, plan } = await fixture(t);
  const planned = await plan([await file('old', 'original')]);
  await executeCleanup(planned, { confirmed: true, quarantineDir });
  const manifest = await readManifest(quarantineDir, planned.id);
  const held = path.join(quarantineDir, planned.id, 'files', manifest.entries[0].quarantineName);
  await writeFile(held, 'changed bytes');
  const result = await purgeCleanup(planned.id, { quarantineDir, confirmed: true });
  assert.equal(result.reclaimedBytes, 0);
  assert.match(result.errors[0].message, /changed/i);
  assert.equal(await readFile(held, 'utf8'), 'changed bytes');
});

test('tampered recovery paths and invalid IDs cannot reach outside their transaction', async t => {
  const { base, quarantineDir, file, plan } = await fixture(t);
  const planned = await plan([await file('old', 'original')]);
  await executeCleanup(planned, { confirmed: true, quarantineDir });
  const outside = path.join(base, 'never-delete');
  await writeFile(outside, 'important');
  const manifest = await readManifest(quarantineDir, planned.id);
  manifest.entries[0].quarantineName = '../../../never-delete';
  await writeManifest(quarantineDir, manifest);
  await assert.rejects(purgeCleanup(planned.id, { quarantineDir, confirmed: true }), /unsafe file entry/i);
  await assert.rejects(purgeCleanup('../outside', { quarantineDir, confirmed: true }), /valid cleanup recovery ID/i);
  assert.equal(await readFile(outside, 'utf8'), 'important');
});

test('scanner and cleanup reject linked directories, including a link swapped in after review', async t => {
  const { base, root, quarantineDir, file, plan } = await fixture(t);
  const old = await file('folder/old', 'safe');
  const outside = path.join(base, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'old'), 'outside');
  const linked = path.join(root, 'linked');
  try { await symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Links unavailable.'); return; } throw error; }
  const scan = await scanStorage(root);
  assert.equal(scan.totalFiles, 1);
  assert.equal(scan.skipped, 1);
  await assert.rejects(scanStorage(linked), /real scan folder|symbolic link|junction/i);
  await assert.rejects(plan([path.join(linked, 'old')]), /symbolic links|junctions/i);
  const planned = await plan([old]);
  await rename(path.join(root, 'folder'), path.join(root, 'saved-folder'));
  await symlink(outside, path.join(root, 'folder'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await executeCleanup(planned, { confirmed: true, quarantineDir });
  assert.equal(result.movedBytes, 0);
  assert.match(result.errors[0].message, /symbolic links|junctions/i);
  assert.equal(await readFile(path.join(outside, 'old'), 'utf8'), 'outside');
});

test('recovery reconciles a crash after quarantine rename but before completion was recorded', async t => {
  const { quarantineDir, file, plan } = await fixture(t);
  const old = await file('old', 'recover');
  const planned = await plan([old]);
  await executeCleanup(planned, { confirmed: true, quarantineDir });
  const manifest = await readManifest(quarantineDir, planned.id);
  manifest.entries[0].state = 'moving';
  delete manifest.entries[0].quarantinedIdentity;
  await writeManifest(quarantineDir, manifest);
  const result = await restoreCleanup(planned.id, { quarantineDir });
  assert.equal(result.restoredBytes, 7);
  assert.equal(await readFile(old, 'utf8'), 'recover');
});

test('recovery reconciles a crash during an exclusive no-overwrite restore', async t => {
  const { quarantineDir, file, plan } = await fixture(t);
  const old = await file('old', 'recover');
  const planned = await plan([old]);
  await executeCleanup(planned, { confirmed: true, quarantineDir });
  const manifest = await readManifest(quarantineDir, planned.id);
  manifest.entries[0].state = 'restoring';
  await writeManifest(quarantineDir, manifest);
  const held = path.join(quarantineDir, planned.id, 'files', manifest.entries[0].quarantineName);
  await link(held, old);
  const purged = await purgeCleanup(planned.id, { quarantineDir, confirmed: true });
  assert.equal(purged.reclaimedBytes, 0);
  assert.match(purged.errors[0].message, /another hard link/i);
  assert.equal(await readFile(held, 'utf8'), 'recover');
  const result = await restoreCleanup(planned.id, { quarantineDir });
  assert.equal(result.restoredBytes, 7);
  assert.equal(await readFile(old, 'utf8'), 'recover');
  await assert.rejects(lstat(held), { code: 'ENOENT' });
});

test('OS temporary-directory aliases work without permitting links below that prefix', async t => {
  const { base, root, quarantineDir, file } = await fixture(t);
  const old = await file('old', 'alias');
  // macOS often supplies /var while realpath returns /private/var; Windows may use 8.3 names.
  const lexicalBase = path.join(os.tmpdir(), path.basename(base));
  const lexicalRoot = path.join(lexicalBase, 'temporary');
  const lexicalFile = path.join(lexicalRoot, 'old');
  const lexicalQuarantine = path.join(lexicalBase, 'recovery');
  const scanned = await scanStorage(lexicalRoot, { tempRoot: lexicalRoot });
  assert.equal(scanned.root, root);
  assert.equal(scanned.cleanupCandidates[0].path, old);
  const planned = await planCleanup([lexicalFile], { tempRoot: lexicalRoot, baseRoot: lexicalRoot, quarantineDir: lexicalQuarantine });
  const result = await executeCleanup(planned, { confirmed: true, quarantineDir: lexicalQuarantine });
  assert.equal(result.movedBytes, 5);
  assert.equal((await listCleanupHistory({ quarantineDir: lexicalQuarantine }))[0].id, planned.id);
  assert.equal((await restoreCleanup(planned.id, { quarantineDir } )).restoredBytes, 5);
});
