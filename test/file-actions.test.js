import { writeFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, readdir, lstat, symlink, link } from 'node:fs/promises';
import { planFileAction, executeFileAction, listFileRecovery } from '../src/file-actions.js';

async function fixture(t) {
  const temp = await realpath(os.tmpdir());
  const base = await realpath(await mkdtemp(path.join(temp, 'jarvis-file-actions-')));
  const root = path.join(base, 'workspace'), recoveryDir = path.join(base, 'recovery');
  await mkdir(root);
  t.after(async () => {
    const relative = path.relative(temp, base);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    assert.ok(path.basename(base).startsWith('jarvis-file-actions-'));
    await rm(base, { recursive: true, force: true });
  });
  const plan = input => planFileAction(root, input, { recoveryDir });
  const execute = async input => executeFileAction(await plan(input), { confirmed: true });
  return { root, base, recoveryDir, plan, execute };
}
async function missing(target) { await assert.rejects(lstat(target), error => error.code === 'ENOENT'); }

test('mkdir, file copy, rename and move work in a disposable workspace without overwrites', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'original.txt'), 'fixture content');
  await f.execute({ action: 'mkdir', path: '', name: 'folder' });
  await f.execute({ action: 'copy', path: 'original.txt', destination: 'folder/copy.txt' });
  assert.equal(await readFile(path.join(f.root, 'folder/copy.txt'), 'utf8'), 'fixture content');
  await f.execute({ action: 'rename', path: 'folder/copy.txt', name: 'renamed.txt' });
  await f.execute({ action: 'move', path: 'folder/renamed.txt', destination: 'moved.txt' });
  await missing(path.join(f.root, 'folder/renamed.txt'));
  assert.equal(await readFile(path.join(f.root, 'moved.txt'), 'utf8'), 'fixture content');
  assert.equal(await readFile(path.join(f.root, 'original.txt'), 'utf8'), 'fixture content');
  await assert.rejects(f.plan({ action: 'copy', path: 'original.txt', destination: 'moved.txt' }), /already exists/);
});

test('copying a nested directory keeps its files and empty folders', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.root, 'source', 'nested', 'empty'), { recursive: true });
  await writeFile(path.join(f.root, 'source', 'nested', 'value.txt'), 'value');
  await f.execute({ action: 'copy', path: 'source', destination: 'copy' });
  assert.equal(await readFile(path.join(f.root, 'copy', 'nested', 'value.txt'), 'utf8'), 'value');
  assert.ok((await lstat(path.join(f.root, 'copy', 'nested', 'empty'))).isDirectory());
  assert.equal(await readFile(path.join(f.root, 'source', 'nested', 'value.txt'), 'utf8'), 'value');
});

test('file reviews require exact confirmation, cannot be forged or reused, and expire', async t => {
  const f = await fixture(t);
  const plan = await f.plan({ action: 'mkdir', path: 'new' });
  assert.ok(Object.isFrozen(plan));
  await assert.rejects(executeFileAction(plan, { confirmed: 'true' }), /confirm/);
  await assert.rejects(executeFileAction({ ...plan }, { confirmed: true }), /review|Review/);
  await executeFileAction(plan, { confirmed: true });
  await assert.rejects(executeFileAction(plan, { confirmed: true }), /review|Review/);
  const stale = await f.plan({ action: 'mkdir', path: 'stale' });
  const future = Date.now() + 61_000;
  t.mock.method(Date, 'now', () => future);
  try { await assert.rejects(executeFileAction(stale, { confirmed: true }), /expired/); }
  finally { t.mock.restoreAll(); }
  await missing(path.join(f.root, 'stale'));
});

test('changed source and newly occupied destination are refused after review', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'source.txt'), 'before');
  const sourcePlan = await f.plan({ action: 'move', path: 'source.txt', destination: 'dest.txt' });
  await writeFile(path.join(f.root, 'source.txt'), 'changed');
  await assert.rejects(executeFileAction(sourcePlan, { confirmed: true }), /changed/);
  await missing(path.join(f.root, 'dest.txt'));
  const destPlan = await f.plan({ action: 'copy', path: 'source.txt', destination: 'dest.txt' });
  await writeFile(path.join(f.root, 'dest.txt'), 'existing');
  await assert.rejects(executeFileAction(destPlan, { confirmed: true }), /already exists/);
  assert.equal(await readFile(path.join(f.root, 'dest.txt'), 'utf8'), 'existing');
});

test('a file destination created while copying is never overwritten', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'source.txt'), 'source');
  const plan = await f.plan({ action: 'copy', path: 'source.txt', destination: 'dest.txt' });
  let occupied;
  await assert.rejects(executeFileAction(plan, { confirmed: true, onOutput() {
    // Schedule destination creation before final publication.
    occupied = writeFileSync(path.join(f.root, 'dest.txt'), 'keep this', { flag: 'wx' });
  } }), /already exists/);
  await occupied;
  assert.equal(await readFile(path.join(f.root, 'dest.txt'), 'utf8'), 'keep this');
  assert.equal(await readFile(path.join(f.root, 'source.txt'), 'utf8'), 'source');
  assert.ok(!(await readdir(f.root)).some(name => name.startsWith('.jarvis-copy-')));
});

test('copy cancellation removes only its own newly created entries', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.root, 'source'));
  await writeFile(path.join(f.root, 'source', 'a.txt'), 'a');
  await writeFile(path.join(f.root, 'source', 'b.txt'), 'b');
  const controller = new AbortController();
  const plan = await f.plan({ action: 'copy', path: 'source', destination: 'destination' });
  await assert.rejects(executeFileAction(plan, { confirmed: true, signal: controller.signal,
    onOutput() { controller.abort(); } }), /cancelled/);
  await missing(path.join(f.root, 'destination'));
  assert.deepEqual((await readdir(path.join(f.root, 'source'))).sort(), ['a.txt', 'b.txt']);
});

test('copy interruption preserves unexpected destination content and reports partial outcome', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.root, 'source'));
  await writeFile(path.join(f.root, 'source', 'a.txt'), 'a');
  await writeFile(path.join(f.root, 'source', 'b.txt'), 'b');
  const controller = new AbortController();
  const plan = await f.plan({ action: 'copy', path: 'source', destination: 'destination' });
  let external;
  const result = await executeFileAction(plan, { confirmed: true, signal: controller.signal, onOutput() {
    external = writeFileSync(path.join(f.root, 'destination', 'external.txt'), 'external content', { flag: 'wx' });
    controller.abort();
  } });
  await external;
  assert.equal(result.status, 'partial');
  assert.ok(result.errors.length);
  assert.equal(await readFile(path.join(f.root, 'destination', 'external.txt'), 'utf8'), 'external content');
  assert.deepEqual((await readdir(path.join(f.root, 'source'))).sort(), ['a.txt', 'b.txt']);
});

test('file recovery survives process-independent listing and restores without overwriting', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'value.txt'), 'recover me');
  const removed = await f.execute({ action: 'trash', path: 'value.txt' });
  await missing(path.join(f.root, 'value.txt'));
  const history = await listFileRecovery(f.root, { recoveryDir: f.recoveryDir });
  assert.equal(history[0].id, removed.recoveryId);
  assert.equal(history[0].available, true);
  assert.equal(history[0].originalPath, 'value.txt');
  await writeFile(path.join(f.root, 'value.txt'), 'new content');
  await assert.rejects(f.plan({ action: 'restore', recoveryId: removed.recoveryId }), /already exists/);
  assert.equal(await readFile(path.join(f.root, 'value.txt'), 'utf8'), 'new content');
  await rm(path.join(f.root, 'value.txt'));
  await f.execute({ action: 'restore', recoveryId: removed.recoveryId });
  assert.equal(await readFile(path.join(f.root, 'value.txt'), 'utf8'), 'recover me');
  assert.equal((await listFileRecovery(f.root, { recoveryDir: f.recoveryDir }))[0].status, 'restored');
});

test('tampered recovery metadata cannot restore outside the workspace', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'value.txt'), 'recover me');
  const removed = await f.execute({ action: 'trash', path: 'value.txt' });
  const manifest = path.join(f.recoveryDir, removed.recoveryId, 'manifest.json');
  const data = JSON.parse(await readFile(manifest, 'utf8'));
  await writeFile(manifest, JSON.stringify({ ...data, original: '../outside.txt' }));
  await assert.rejects(f.plan({ action: 'restore', recoveryId: removed.recoveryId }), /outside|root/);
  await missing(path.join(f.base, 'outside.txt'));
  assert.equal(await readFile(path.join(f.recoveryDir, removed.recoveryId, 'item'), 'utf8'), 'recover me');
});

test('roots, traversal, runtime state, nested Git metadata and recovery paths are protected', async t => {
  const f = await fixture(t);
  for (const input of ['.', '..', '../escape', path.join(f.base, 'absolute'), '.git/config']) {
    await assert.rejects(f.plan({ action: 'mkdir', path: input }));
  }
  await mkdir(path.join(f.root, 'repo', '.git'), { recursive: true });
  await writeFile(path.join(f.root, 'repo', '.git', 'config'), 'fixture');
  await assert.rejects(f.plan({ action: 'copy', path: 'repo', destination: 'repo-copy' }), /Git metadata/);
  await mkdir(path.join(f.root, 'folder'));
  await assert.rejects(f.plan({ action: 'copy', path: 'folder', destination: 'folder/nested' }), /itself/);
  const runtime = fileURLToPath(new URL('..', import.meta.url));
  await assert.rejects(planFileAction(runtime, { action: 'mkdir', path: 'unsafe-test-folder' }), /protected/);
  await writeFile(path.join(f.root, 'value'), 'value');
  await assert.rejects(planFileAction(f.root, { action: 'trash', path: 'value' }, { recoveryDir: path.join(f.root, 'recovery') }), /outside this workspace/);
});

test('source hard links and symlinked destination parents are rejected', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'one.txt'), 'one');
  await link(path.join(f.root, 'one.txt'), path.join(f.root, 'two.txt'));
  await assert.rejects(f.plan({ action: 'trash', path: 'one.txt' }), /hard links/);
  await writeFile(path.join(f.root, 'regular.txt'), 'regular');
  await mkdir(path.join(f.base, 'outside'));
  try { await symlink(path.join(f.base, 'outside'), path.join(f.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('Symlink creation is not permitted.'); throw error; }
  await assert.rejects(f.plan({ action: 'copy', path: 'regular.txt', destination: 'linked/new.txt' }), /symbolic links|junctions/);
  await assert.rejects(f.plan({ action: 'trash', path: 'linked' }), /symbolic links|junctions/);
  await missing(path.join(f.base, 'outside', 'new.txt'));
});

test('Windows rejects stream, device and trailing-character path aliases', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'safe.txt'), 'safe');
  for (const value of ['safe.txt:stream', 'safe.txt::$DATA', 'safe.txt.', 'safe.txt ', 'CON', 'NUL.txt', 'COM1.log', 'LPT9', '\\\\server\\share\\file']) {
    await assert.rejects(f.plan({ action: 'copy', path: value, destination: 'copy.txt' }));
    await assert.rejects(f.plan({ action: 'copy', path: 'safe.txt', destination: value }));
  }
  assert.equal(await readFile(path.join(f.root, 'safe.txt'), 'utf8'), 'safe');
});

test('folder moves and recovery are atomic on Windows and refused safely on other platforms', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.root, 'folder'));
  await writeFile(path.join(f.root, 'folder', 'value.txt'), 'folder content');
  if (process.platform !== 'win32') {
    for (const action of ['move', 'rename', 'trash']) {
      await assert.rejects(f.plan({ action, path: 'folder', destination: 'moved', name: 'renamed' }), /not supported/);
    }
    assert.equal(await readFile(path.join(f.root, 'folder', 'value.txt'), 'utf8'), 'folder content');
    return;
  }
  await f.execute({ action: 'move', path: 'folder', destination: 'moved' });
  const removed = await f.execute({ action: 'trash', path: 'moved' });
  await missing(path.join(f.root, 'moved'));
  await f.execute({ action: 'restore', recoveryId: removed.recoveryId });
  assert.equal(await readFile(path.join(f.root, 'moved', 'value.txt'), 'utf8'), 'folder content');
});

test('pre-cancelled reviews and execution never create a destination', async t => {
  const f = await fixture(t);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(planFileAction(f.root, { action: 'mkdir', path: 'new' }, { signal: controller.signal }), /cancelled/);
  const plan = await f.plan({ action: 'mkdir', path: 'new' });
  await assert.rejects(executeFileAction(plan, { confirmed: true, signal: controller.signal }), /cancelled/);
  await missing(path.join(f.root, 'new'));
});
