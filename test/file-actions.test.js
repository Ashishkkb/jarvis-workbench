import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { privateRecoveryDirectory, lockRecovery } from '../src/recovery-safety.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, readdir, lstat, symlink, link, chmod } from 'node:fs/promises';
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


async function interruptedProcess(f, request, checkpoint) {
  const moduleUrl = new URL('../src/file-actions.js', import.meta.url).href;
  const script = `import { planFileAction, executeFileAction } from ${JSON.stringify(moduleUrl)};
    const [root,recoveryDir,request,checkpoint] = JSON.parse(process.argv[1]);
    const plan = await planFileAction(root,request,{recoveryDir});
    await executeFileAction(plan,{confirmed:true,onOutput(message){if(message.trim()===checkpoint)process.exit(77);}});
    process.exit(78);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, JSON.stringify([f.root, f.recoveryDir, request, checkpoint])], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.equal(code, 77, stderr || 'Fixture child did not reach its selected crash boundary.');
}

test('a fresh process restores after crashes on either side of the recovery move', async t => {
  for (const checkpoint of ['Exclusive recovery destination created.', 'Selection moved to recovery.']) {
    const f = await fixture(t);
    await writeFile(path.join(f.root, 'recover.txt'), 'complete original bytes');
    await interruptedProcess(f, { action: 'trash', path: 'recover.txt' }, checkpoint);
    const [history] = await listFileRecovery(f.root, { recoveryDir: f.recoveryDir });
    assert.equal(history.available, true);
    assert.equal(history.status, 'held');
    await f.execute({ action: 'restore', recoveryId: history.id });
    assert.equal(await readFile(path.join(f.root, 'recover.txt'), 'utf8'), 'complete original bytes');
    assert.equal((await lstat(path.join(f.root, 'recover.txt'))).nlink, 1);
    await missing(path.join(f.recoveryDir, history.id, 'item'));
    assert.equal((await listFileRecovery(f.root, { recoveryDir: f.recoveryDir }))[0].status, 'restored');
  }
});

test('crashed restores reconcile a duplicate link and recognize a completed restore after restart', async t => {
  for (const checkpoint of ['Exclusive recovery destination created.', 'Selection restored to its original location.']) {
    const f = await fixture(t);
    await writeFile(path.join(f.root, 'recover.txt'), 'restore survives restart');
    const { recoveryId } = await f.execute({ action: 'trash', path: 'recover.txt' });
    await interruptedProcess(f, { action: 'restore', recoveryId }, checkpoint);
    const [history] = await listFileRecovery(f.root, { recoveryDir: f.recoveryDir });
    if (history.available) await f.execute({ action: 'restore', recoveryId });
    else assert.equal(history.status, 'restored');
    assert.equal(await readFile(path.join(f.root, 'recover.txt'), 'utf8'), 'restore survives restart');
    assert.equal((await lstat(path.join(f.root, 'recover.txt'))).nlink, 1);
    await missing(path.join(f.recoveryDir, recoveryId, 'item'));
  }
});

test('concurrent restores serialize and stale reviews cannot replace recovery metadata', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'value'), 'original');
  const { recoveryId } = await f.execute({ action: 'trash', path: 'value' });
  const first = await f.plan({ action: 'restore', recoveryId });
  const second = await f.plan({ action: 'restore', recoveryId });
  const results = await Promise.allSettled([executeFileAction(first, { confirmed: true }), executeFileAction(second, { confirmed: true })]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.filter(item => item.status === 'rejected').length, 1);
  assert.equal(await readFile(path.join(f.root, 'value'), 'utf8'), 'original');
  assert.equal((await listFileRecovery(f.root, { recoveryDir: f.recoveryDir }))[0].status, 'restored');

  const again = await f.execute({ action: 'trash', path: 'value' });
  const stale = await f.plan({ action: 'restore', recoveryId: again.recoveryId });
  const filename = path.join(f.recoveryDir, again.recoveryId, 'manifest.json');
  const changed = JSON.parse(await readFile(filename, 'utf8'));
  changed.original = 'another-location';
  await writeFile(filename, JSON.stringify(changed));
  await assert.rejects(executeFileAction(stale, { confirmed: true }), /changed after review/);
  await missing(path.join(f.root, 'value'));
  await missing(path.join(f.root, 'another-location'));
  assert.equal(await readFile(path.join(f.recoveryDir, again.recoveryId, 'item'), 'utf8'), 'original');
});

test('an interrupted move with changed bytes is never reconciled as the reviewed original', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'value'), 'original');
  await interruptedProcess(f, { action: 'trash', path: 'value' }, 'Exclusive recovery destination created.');
  await writeFile(path.join(f.root, 'value'), 'edited after crash');
  const [history] = await listFileRecovery(f.root, { recoveryDir: f.recoveryDir });
  assert.equal(history.available, false);
  assert.equal(history.status, 'needs-review');
  await assert.rejects(f.plan({ action: 'restore', recoveryId: history.id }), /hard links/);
  assert.equal(await readFile(path.join(f.root, 'value'), 'utf8'), 'edited after crash');
  assert.equal(await readFile(path.join(f.recoveryDir, history.id, 'item'), 'utf8'), 'edited after crash');
});

test('recovery locks reject concurrent access and release only their own lock', async t => {
  const f = await fixture(t);
  await privateRecoveryDirectory(f.recoveryDir);
  const release = await lockRecovery(f.recoveryDir);
  await assert.rejects(lockRecovery(f.recoveryDir), error => error.code === 'RECOVERY_BUSY');
  await release();
  const next = await lockRecovery(f.recoveryDir);
  await next();
});

test('new recovery directories are private and permissive existing folders are left untouched', async t => {
  const f = await fixture(t);
  await privateRecoveryDirectory(f.recoveryDir);
  if (process.platform !== 'win32') assert.equal((await lstat(f.recoveryDir)).mode & 0o077, 0);
  else {
    const script = `$target=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(f.recoveryDir).toString('base64')}')); $acl=[IO.DirectoryInfo]::new($target).GetAccessControl(); [Console]::WriteLine([bool]$acl.AreAccessRulesProtected)`;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
    let output = ''; child.stdout.on('data', data => { output += data; });
    assert.equal(await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); }), 0);
    assert.equal(output.trim(), 'True');
  }
  const permissive = path.join(f.base, 'permissive');
  await mkdir(permissive, { mode: 0o755 });
  if (process.platform !== 'win32') await chmod(permissive, 0o755);
  const before = (await lstat(permissive)).mode;
  await assert.rejects(privateRecoveryDirectory(permissive), /private|inherit|recovery storage|recovery directory/i);
  assert.equal((await lstat(permissive)).mode, before);
});


test('simultaneous restarted processes reclaim one dead lease without overlapping transactions', async t => {
  const f = await fixture(t);
  await privateRecoveryDirectory(f.recoveryDir);
  const moduleUrl = new URL('../src/recovery-safety.js', import.meta.url).href;
  async function child(script) {
    const proc = spawn(process.execPath, ['--input-type=module', '-e', script, f.recoveryDir], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stderr = ''; proc.stderr.on('data', data => { stderr += data; });
    const code = await new Promise((resolve, reject) => { proc.on('error', reject); proc.on('exit', resolve); });
    return { code, stderr };
  }
  const abandoned = await child(`import {lockRecovery} from ${JSON.stringify(moduleUrl)}; await lockRecovery(process.argv[1]); process.exit(77);`);
  assert.equal(abandoned.code, 77, abandoned.stderr);
  const worker = `import {lockRecovery} from ${JSON.stringify(moduleUrl)};
    import {open,unlink} from 'node:fs/promises'; import path from 'node:path';
    let release; const until=Date.now()+5000;
    while(!release){try{release=await lockRecovery(process.argv[1]);}catch(e){if(e.code!=='RECOVERY_BUSY'||Date.now()>until)throw e;await new Promise(r=>setTimeout(r,10));}}
    const marker=path.join(process.argv[1],'.active-test-only');
    const handle=await open(marker,'wx');
    await new Promise(r=>setTimeout(r,40)); await handle.close(); await unlink(marker); await release();`;
  const results = await Promise.all(Array.from({ length: 6 }, () => child(worker)));
  for (const result of results) assert.equal(result.code, 0, result.stderr);
  await missing(path.join(f.recoveryDir, '.lock'));
  await missing(path.join(f.recoveryDir, '.active-test-only'));
});

test('a newly created empty lease is busy and is never deleted by a contender', async t => {
  const f = await fixture(t);
  await privateRecoveryDirectory(f.recoveryDir);
  await writeFile(path.join(f.recoveryDir, '.lock'), '');
  await assert.rejects(lockRecovery(f.recoveryDir), error => error.code === 'RECOVERY_BUSY');
  assert.equal(await readFile(path.join(f.recoveryDir, '.lock'), 'utf8'), '');
});


test('Windows recovery ACL enforcement works with incompatible inherited PowerShell module paths', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t);
  const modules = path.join(f.base, 'incompatible-modules');
  for (const name of ['Microsoft.PowerShell.Security', 'Microsoft.PowerShell.Utility']) {
    const folder = path.join(modules, name);
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, name + '.psd1'), `@{ModuleVersion='99.0.0';PowerShellVersion='7.0';RootModule='fake.psm1';FunctionsToExport=@('Get-Acl','ConvertTo-Json','New-Object');CmdletsToExport=@()}`);
    await writeFile(path.join(folder, 'fake.psm1'), "throw 'This incompatible module must not be loaded.'");
  }
  const executable = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const helper = fileURLToPath(new URL('../src/file-recovery.ps1', import.meta.url));
  const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper,
    '-PathBase64', Buffer.from(f.recoveryDir).toString('base64')], { cwd: path.dirname(executable), windowsHide: true,
    env: { ...process.env, PSModulePath: modules }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { errors += data; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.equal(code, 0, errors);
  assert.deepEqual(JSON.parse(output.trim()), { private: true });
  // Revalidating the same directory proves an existing DACL is checked, not merely reported.
  await privateRecoveryDirectory(f.recoveryDir);
  await writeFile(path.join(f.root, 'value'), 'recover using module-independent ACL enforcement');
  const removed = await f.execute({ action: 'trash', path: 'value' });
  await f.execute({ action: 'restore', recoveryId: removed.recoveryId });
  assert.equal(await readFile(path.join(f.root, 'value'), 'utf8'), 'recover using module-independent ACL enforcement');
});
