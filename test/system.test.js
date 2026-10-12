import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  parseWindowsProcesses,
  parsePosixProcesses,
  parseWindowsPorts,
  parseSsPorts,
  parseLsofPorts,
  parseNetstatPorts,
  getProjectScripts,
} from '../src/system.js';
import { RECIPES } from '../src/recipes.js';

test('Windows processes accept arrays, a single object, BOM and unavailable CPU fields', () => {
  assert.deepEqual(parseWindowsProcesses('\uFEFF[{"Id":42,"ProcessName":"node","CPU":null,"WorkingSet64":2048},{"Id":0,"ProcessName":"Idle","CPU":40,"WorkingSet64":0}]'), [
    { pid: 42, name: 'node', cpu: 0, memory: 2048 },
    { pid: 0, name: 'Idle', cpu: 40, memory: 0 },
  ]);
  assert.deepEqual(parseWindowsProcesses('{"Id":7,"ProcessName":"editor","CPU":1.25,"WorkingSet64":4096}'), [
    { pid: 7, name: 'editor', cpu: 1.25, memory: 4096 },
  ]);
  assert.deepEqual(parseWindowsProcesses('[null,{"Id":null,"ProcessName":"invalid"},{"Id":"bad","ProcessName":"invalid"}]'), []);
  assert.deepEqual(parseWindowsProcesses('null'), []);
});

test('POSIX processes preserve names with spaces and convert RSS KiB to bytes', () => {
  const output = '  123 /usr/bin/node 12.5 2048\n 456 /Applications/My Editor 0,2 100\n bad data\n';
  assert.deepEqual(parsePosixProcesses(output), [
    { pid: 123, name: 'node', cpu: 12.5, memory: 2097152 },
    { pid: 456, name: 'My Editor', cpu: 0.2, memory: 102400 },
  ]);
});

test('Windows ports reject malformed ports and deduplicate listeners', () => {
  const rows = [
    { Protocol: 'TCP', LocalAddress: '::', LocalPort: 3000, OwningProcess: 41 },
    { Protocol: 'TCP', LocalAddress: '::', LocalPort: 3000, OwningProcess: 41 },
    { Protocol: 'UDP', LocalAddress: '0.0.0.0', LocalPort: 53, OwningProcess: null },
    { Protocol: 'TCP', LocalAddress: '0.0.0.0', LocalPort: null, OwningProcess: 3 },
    { Protocol: 'TCP', LocalAddress: '0.0.0.0', LocalPort: 70000, OwningProcess: 3 },
  ];
  assert.deepEqual(parseWindowsPorts(JSON.stringify(rows)), [
    { protocol: 'UDP', address: '0.0.0.0', port: 53, pid: null },
    { protocol: 'TCP', address: '::', port: 3000, pid: 41 },
  ]);
});

test('ss ports handle IPv6, zones, hidden owners and shared socket owners', () => {
  const output = [
    'udp UNCONN 0 0 127.0.0.53%lo:53 0.0.0.0:*',
    'tcp LISTEN 0 511 [::1]:3000 [::]:* users:(("node",pid=41,fd=12),("node",pid=42,fd=12))',
    'tcp ESTAB 0 0 127.0.0.1:4444 127.0.0.1:5000 users:(("other",pid=70,fd=4))',
  ].join('\n');
  assert.deepEqual(parseSsPorts(output), [
    { protocol: 'UDP', address: '127.0.0.53%lo', port: 53, pid: null },
    { protocol: 'TCP', address: '::1', port: 3000, pid: 41, process: 'node' },
    { protocol: 'TCP', address: '::1', port: 3000, pid: 42, process: 'node' },
  ]);
});

test('lsof machine output associates sockets with their owners and filters connected TCP', () => {
  const output = [
    'p41', 'cnode', 'f10', 'PTCP', 'n[::1]:3000', 'TST=LISTEN',
    'f11', 'PTCP', 'n127.0.0.1:49000->127.0.0.1:3000', 'TST=ESTABLISHED',
    'p52', 'cdiscovery', 'f7', 'PUDP', 'n*:5353',
    'f8', 'PUDP', 'n127.0.0.1:7000->127.0.0.1:8000',
  ].join('\n');
  assert.deepEqual(parseLsofPorts(output), [
    { protocol: 'TCP', address: '::1', port: 3000, pid: 41, process: 'node' },
    { protocol: 'UDP', address: '*', port: 5353, pid: 52, process: 'discovery' },
    { protocol: 'UDP', address: '127.0.0.1', port: 7000, pid: 52, process: 'discovery' },
  ]);
});

test('netstat fallback parses Windows and Linux without exposing active TCP connections', () => {
  assert.deepEqual(parseNetstatPorts([
    '  Proto Local Address Foreign Address State PID',
    '  TCP [::]:3000 [::]:0 LISTENING 41',
    '  TCP 127.0.0.1:50000 127.0.0.1:3000 ESTABLISHED 42',
    '  UDP 0.0.0.0:5353 *:* 52',
  ].join('\n')), [
    { protocol: 'TCP', address: '::', port: 3000, pid: 41 },
    { protocol: 'UDP', address: '0.0.0.0', port: 5353, pid: 52 },
  ]);
  assert.deepEqual(parseNetstatPorts([
    'tcp6 0 0 :::3000 :::* LISTEN 41/node',
    'udp 0 0 0.0.0.0:5353 0.0.0.0:* -',
  ].join('\n')), [
    { protocol: 'TCP', address: '::', port: 3000, pid: 41, process: 'node' },
    { protocol: 'UDP', address: '0.0.0.0', port: 5353, pid: null },
  ]);
});

test('script discovery reads only the selected folder and never executes commands', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jarvis-scripts-'));
  t.after(async () => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(root).startsWith('jarvis-scripts-'));
    await rm(root, { recursive: true, force: true });
  });
  const child = path.join(root, 'child');
  const marker = path.join(root, 'must-not-exist');
  await mkdir(child);
  const malicious = `node -e "require('fs').writeFileSync(${JSON.stringify(marker)},'executed')"`;
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: malicious, build: 'node build.js', invalid: 12 } }));
  assert.deepEqual(await getProjectScripts(root), [
    { name: 'build', command: 'node build.js' },
    { name: 'test', command: malicious },
  ]);
  assert.deepEqual(await getProjectScripts(child), []);
  await assert.rejects(access(marker));
  await writeFile(path.join(child, 'package.json'), '{broken json');
  assert.deepEqual(await getProjectScripts(child), []);
  await writeFile(path.join(child, 'package.json'), '{"scripts":["echo no"]}');
  assert.deepEqual(await getProjectScripts(child), []);
});

test('recipes link to implemented screens and contain explanations, not executable handlers', () => {
  const screens = new Set(['overview', 'files', 'search', 'git', 'processes', 'ports', 'disk', 'recipes', 'scripts']);
  assert.equal(new Set(RECIPES.map(recipe => recipe.id)).size, RECIPES.length);
  assert.ok(RECIPES.length >= 10);
  for (const recipe of RECIPES) {
    assert.ok(screens.has(recipe.screen), recipe.id);
    assert.ok(recipe.explanation.length > 30, recipe.id);
    assert.ok(recipe.examples.length > 0, recipe.id);
    assert.equal(Object.values(recipe).some(value => typeof value === 'function'), false);
  }
});
