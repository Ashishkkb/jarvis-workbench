import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '../src/index.js';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/jarvis.js', import.meta.url));
async function fixture(t) {
  const base = await mkdtemp(path.join(tmpdir(), 'jarvis-cli-test-'));
  const root = path.join(base, 'project with spaces');
  await mkdir(path.join(root, 'nested'), { recursive: true });
  await writeFile(path.join(root, 'hello space.txt'), 'needle; echo $(owned)\n--dash\nlast line\n');
  await writeFile(path.join(root, 'nested', 'source.js'), 'const needle = 42;\n');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { 'fixture-task': 'echo SHOULD_NOT_EXECUTE' } }));
  t.after(() => rm(base, { recursive: true, force: true, maxRetries: 5 }));
  return { root, base };
}
const invoke = (root, args) => execute(process.execPath, [cli, ...args], { cwd: root, windowsHide: true, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
async function contents(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await contents(root, relative));
    else result.push([relative, createHash('sha256').update(await readFile(path.join(root, relative))).digest('hex')]);
  }
  return result.sort((a, b) => a[0].localeCompare(b[0]));
}

test('public library imports expose all documented backends without startup side effects', () => {
  for (const name of ['searchContent', 'listDirectory', 'readPreview', 'analyzeDisk', 'getGitStatus', 'getGitDiff', 'commitAll', 'pushCurrent',
    'getProjectScripts', 'runProjectScript', 'scanStorage', 'listScanLocations', 'planCleanup', 'executeCleanup', 'restoreCleanup', 'purgeCleanup',
    'listCleanupHistory', 'startServer', 'ActivityLog', 'getAbout', 'getNetworkStatus', 'planNetworkChange', 'applyNetworkChange', 'getWifiPassword', 'getAudioStatus', 'setAudioSettings', 'getSecurityStatus', 'planSecurityScan', 'runSecurityScan', 'getSystemSettings', 'planSettingChange', 'applySettingChange', 'openSettingsPage', 'planFileAction', 'executeFileAction', 'listFileRecovery', 'planProcessStop', 'stopProcess']) assert.equal(typeof api[name], 'function', name);
  assert.ok(Array.isArray(api.RECIPES));
});

test('CLI JSON commands search, list, inspect status and scan only their fixture', async t => {
  const { root } = await fixture(t);
  const before = await contents(root);
  const files = JSON.parse((await invoke(root, ['files', '--json'])).stdout);
  assert.ok(files.entries.some(item => item.path === 'hello space.txt'));
  const search = JSON.parse((await invoke(root, ['search', 'needle; echo $(owned)', '--json', '--path', root])).stdout);
  assert.deepEqual(search.matches.map(match => [match.path, match.line, match.text]), [['hello space.txt', 1, 'needle; echo $(owned)']]);
  const literalDash = JSON.parse((await invoke(root, ['search', '--json', '--', '--dash'])).stdout);
  assert.equal(literalDash.matches.length, 1);
  assert.equal(literalDash.matches[0].line, 2);
  const filtered = JSON.parse((await invoke(root, ['search', 'needle', '--json', '--glob', '*.js', '--case-sensitive'])).stdout);
  assert.deepEqual(filtered.matches.map(match => match.path), ['nested/source.js']);
  const status = JSON.parse((await invoke(root, ['status', '--json'])).stdout);
  assert.equal(status.isRepo, false);
  const scan = JSON.parse((await invoke(root, ['scan', '--json', '--path', root])).stdout);
  assert.equal(scan.totalFiles, 3);
  assert.equal(scan.truncated, false);
  assert.equal(scan.cancelled, false);
  assert.deepEqual(scan.cleanupCandidates, []);
  assert.equal(path.basename(scan.root), 'project with spaces');
  assert.deepEqual(await contents(root), before, 'read-only commands must not create or change fixture files');
});

test('CLI rejects malformed commands with helpful errors and no workspace writes', async t => {
  const { root } = await fixture(t);
  const before = await contents(root);
  const cases = [
    [['search'], /Provide text to search/],
    [['search', '[invalid', '--regex'], /regular expression is invalid/],
    [['--unknown'], /Unknown option/],
    [['--path'], /needs a value/],
    [['--width', '10'], /width must/],
    [['--width', 'many'], /width must/],
    [['--port', '65536'], /port must/],
    [['--screen', 'unknown'], /Unknown screen/],
    [['files', 'unexpected'], /Use --path/],
    [['--json'], /Choose a command/],
    [['files', '--path', path.join(root, 'hello space.txt')], /workspace must be a directory/],
  ];
  for (const [args, expected] of cases) {
    await assert.rejects(invoke(root, args), error => error.code === 1 && expected.test(error.stderr), args.join(' '));
  }
  assert.deepEqual(await contents(root), before);
});

test('CLI help, version, and script snapshots require no interactive terminal or execution', async t => {
  const { root } = await fixture(t);
  const before = await contents(root);
  assert.match((await invoke(root, ['--help'])).stdout, /jarvis --web/);
  assert.equal((await invoke(root, ['--version'])).stdout.trim(), api.getAbout().version);
  const snapshot = await invoke(root, ['--snapshot', '--screen', 'scripts', '--width', '80', '--ascii']);
  assert.match(snapshot.stdout, /fixture-task/);
  assert.ok(!snapshot.stdout.includes('\x1b'));
  const demo = await invoke(root, ['--demo', '--snapshot', '--screen', 'git']);
  assert.match(demo.stdout, /DEMO/);
  assert.deepEqual(await contents(root), before);
});


test('hardware CLI exposes explicit demo JSON and a complete text report without workspace writes', async t => {
  const { root } = await fixture(t);
  const before = await contents(root);
  const result = JSON.parse((await invoke(root, ['hardware', '--demo', '--json'])).stdout);
  assert.equal(result.demo, true);
  assert.deepEqual(result.components.map(item => item.id).sort(), ['cpu', 'memory', 'motherboard', 'gpu', 'storage', 'battery', 'network', 'ports', 'cooling'].sort());
  assert.ok(result.components.some(item => item.status === 'unknown'));
  const report = (await invoke(root, ['hardware', '--demo'])).stdout;
  assert.match(report, /INSIDE YOUR PC \/ DEMO DATA/);
  assert.match(report, /WHAT WAS REPORTED/);
  assert.match(report, /REPORT LIMITATIONS/);
  assert.doesNotMatch(report, /\bnull\b|\bundefined\b|\[object Object\]/);
  const screen = (await invoke(root, ['--demo', '--snapshot', '--screen', 'hardware', '--width', '80'])).stdout;
  assert.match(screen, /INSIDE YOUR PC/);
  assert.match(screen, /DEMO SESSION/);
  assert.match(screen, /Details/);
  assert.deepEqual(await contents(root), before);
});
