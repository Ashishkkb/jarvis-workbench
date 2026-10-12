import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createPortInspector, WINDOWS_PORT_SCRIPT, WINDOWS_PORT_OWNER_SCRIPT } from '../src/system.js';

const response = value => ({ stdout: typeof value === 'string' ? value : JSON.stringify(value), stderr: '', code: 0 });
const listener = (port, pid) => ({ Protocol: 'TCP', LocalAddress: '127.0.0.1', LocalPort: port, OwningProcess: pid });

test('Windows port names are joined in one bounded query, including PID zero and duplicate rows', async () => {
  const calls = [];
  const inspect = createPortInspector({ platform: 'win32', execute: async (command, args, options) => {
    calls.push({ command, args, options });
    if (args.includes(WINDOWS_PORT_SCRIPT)) return response([
      listener(3000, 41), listener(3000, 41), listener(3001, 41),
      listener(4000, 42), listener(5000, null), listener(6000, 0),
    ]);
    assert.ok(args.includes(WINDOWS_PORT_OWNER_SCRIPT));
    return response([
      { Id: 41, ProcessName: 'node', CommandLine: 'do-not-expose-this-secret', Path: 'private-path' },
      { Id: 41, ProcessName: 'node' },
      { Id: 0, ProcessName: 'Idle' },
      { Id: 99, ProcessName: 'Unrelated' },
    ]);
  } });
  const result = await inspect();
  assert.equal(calls.length, 2, 'one port inventory and one process-name inventory, regardless of listener count');
  assert.ok(path.win32.isAbsolute(calls[1].command));
  assert.equal(calls[1].options.cwd, path.win32.dirname(calls[1].command));
  assert.equal(calls[1].options.timeout, 5000);
  assert.equal(calls[1].options.maxOutput, 1024 * 1024);
  assert.deepEqual(result.ports.map(item => [item.port, item.pid, item.process]), [
    [3000, 41, 'node'], [3001, 41, 'node'], [4000, 42, undefined], [5000, null, undefined], [6000, 0, 'Idle'],
  ]);
  assert.match(result.warning, /names are unavailable/);
  assert.match(result.warning, /owners are hidden/);
  assert.doesNotMatch(JSON.stringify(result), /do-not-expose|private-path|Unrelated|CommandLine/);
  assert.doesNotMatch(WINDOWS_PORT_OWNER_SCRIPT, /CommandLine|Path|CPU|WorkingSet/);
});

test('invalid or ambiguous process identities stay unresolved while safe names are sanitized', async () => {
  const inspect = createPortInspector({ platform: 'win32', execute: async (command, args) => {
    if (args.includes(WINDOWS_PORT_SCRIPT)) return response([
      listener(1, 0), listener(2, null), listener(3, ''), listener(4, false),
      listener(5, -1), listener(6, 1.5), listener(7, 41), listener(8, '7'),
    ]);
    return response([
      { Id: null, ProcessName: 'Wrong zero' }, { Id: false, ProcessName: 'Wrong boolean' },
      { Id: '', ProcessName: 'Wrong blank' }, { Id: -1, ProcessName: 'Wrong negative' },
      { Id: 0, ProcessName: 'Idle' }, { Id: 41, ProcessName: 'node' }, { Id: 41, ProcessName: 'other' },
      { Id: 41, ProcessName: 'node' }, { Id: 7, ProcessName: '\u001b[31mworker\u001b[0m' },
    ]);
  } });
  const result = await inspect();
  assert.equal(result.ports[0].process, 'Idle');
  for (const item of result.ports.slice(1, 6)) {
    assert.equal(item.pid, null);
    assert.equal(item.process, undefined);
  }
  assert.equal(result.ports[6].pid, 41);
  assert.equal(result.ports[6].process, undefined, 'conflicting names must not invent a process identity');
  assert.equal(result.ports[7].process, 'worker');
  assert.doesNotMatch(JSON.stringify(result), /Wrong|\\u001b/);
});

test('Windows netstat fallback also resolves names once without changing listening endpoints', async () => {
  const calls = [];
  const inspect = createPortInspector({ platform: 'win32', execute: async (command, args) => {
    calls.push(args);
    if (args.includes(WINDOWS_PORT_SCRIPT)) return { code: 1, stdout: '', stderr: 'Unavailable provider' };
    if (args[0] === '-ano') return response('TCP [::]:3000 [::]:0 LISTENING 41\nUDP 0.0.0.0:5353 *:* 52\n');
    assert.ok(args.includes(WINDOWS_PORT_OWNER_SCRIPT));
    return response([{ Id: 41, ProcessName: 'node' }, { Id: 52, ProcessName: 'discovery' }]);
  } });
  const result = await inspect();
  assert.equal(calls.length, 3);
  assert.equal(calls.filter(args => args.includes(WINDOWS_PORT_OWNER_SCRIPT)).length, 1);
  assert.deepEqual(result.ports, [
    { protocol: 'TCP', address: '::', port: 3000, pid: 41, process: 'node' },
    { protocol: 'UDP', address: '0.0.0.0', port: 5353, pid: 52, process: 'discovery' },
  ]);
  assert.equal(result.warning, undefined);
});

test('failed, unavailable and malformed name queries preserve port rows and PIDs', async () => {
  for (const failure of ['throw', 'exit', 'json']) {
    let calls = 0;
    const inspect = createPortInspector({ platform: 'win32', execute: async (command, args) => {
      calls++;
      if (args.includes(WINDOWS_PORT_SCRIPT)) return response([listener(3000, 41)]);
      if (failure === 'throw') throw new Error('Access denied; private process details must not be returned');
      if (failure === 'exit') return { code: 1, stdout: '', stderr: 'private provider details' };
      return response('{malformed');
    } });
    const result = await inspect();
    assert.equal(calls, 2, 'a name lookup failure must not discard or repeat a successful port inventory');
    assert.deepEqual(result.ports, [{ protocol: 'TCP', address: '127.0.0.1', port: 3000, pid: 41 }]);
    assert.match(result.warning, /process may have exited or access may be restricted/);
    assert.doesNotMatch(JSON.stringify(result), /private/);
  }
});

test('empty and fully hidden Windows listeners do not trigger needless name queries', async () => {
  for (const rows of [[], [listener(3000, null)]]) {
    let calls = 0;
    const inspect = createPortInspector({ platform: 'win32', execute: async () => { calls++; return response(rows); } });
    const result = await inspect();
    assert.equal(calls, 1);
    assert.equal(result.ports.length, rows.length);
  }
});

test('cancelling a Windows name query propagates cancellation without fallback execution', async () => {
  const controller = new AbortController();
  let calls = 0;
  const inspect = createPortInspector({ platform: 'win32', execute: async (command, args, options) => {
    calls++;
    assert.equal(options.signal, controller.signal);
    if (args.includes(WINDOWS_PORT_SCRIPT)) return response([listener(3000, 41)]);
    controller.abort();
    throw new Error('Fixture cancelled');
  } });
  await assert.rejects(inspect({ signal: controller.signal }), /Fixture cancelled/);
  assert.equal(calls, 2);
});

test('Linux process names remain supplied by the native port listing without a Windows query', async () => {
  let calls = 0;
  const inspect = createPortInspector({ platform: 'linux', execute: async (command, args) => {
    calls++;
    assert.equal(command, 'ss');
    return response('tcp LISTEN 0 511 [::1]:3000 [::]:* users:(("node",pid=41,fd=12))');
  } });
  const result = await inspect();
  assert.equal(calls, 1);
  assert.deepEqual(result.ports, [{ protocol: 'TCP', address: '::1', port: 3000, pid: 41, process: 'node' }]);
});
