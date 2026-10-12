import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { planProcessStop, stopProcess } from '../src/process-control.js';

async function disposableChild(t, { ignoreTermination = false } = {}) {
  const script = (ignoreTermination ? "process.on('SIGTERM', () => {});" : '') +
    "process.stdout.write('READY\\n'); setInterval(() => {}, 1000);";
  const child = spawn(process.execPath, ['-e', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    // Only this test's own freshly spawned child can be killed by fixture cleanup.
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
  });
  const ready = await once(child.stdout, 'data');
  assert.match(String(ready[0]), /READY/);
  return child;
}

test('rejects invalid PIDs, cancellation, self and the parent process before any mutation', { timeout: 30_000 }, async () => {
  for (const pid of [null, '123', -100, 0, 1, 1.2, NaN, Infinity, 2_147_483_648]) {
    await assert.rejects(planProcessStop(pid), error => error.code === 'INVALID_PID');
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(planProcessStop(42, { signal: controller.signal }), error => error.code === 'ABORT_ERR');
  await assert.rejects(planProcessStop(process.pid), error => error.code === 'PROCESS_PROTECTED');
  if (process.ppid > 1) {
    await assert.rejects(planProcessStop(process.ppid), error => ['PROCESS_PROTECTED', 'PROCESS_OTHER_USER', 'PROCESS_METADATA'].includes(error.code));
  }
});

test('reviews and stops only a disposable child after explicit confirmation; a plan cannot be forged or reused', { timeout: 40_000 }, async t => {
  const child = await disposableChild(t);
  const plan = await planProcessStop(child.pid);
  assert.equal(plan.pid, child.pid);
  assert.ok(Object.isFrozen(plan));
  assert.ok(plan.name);
  assert.ok(plan.owner);
  assert.ok(plan.startedAt);
  assert.match(plan.warning, /Unsaved|unsaved/);
  await assert.rejects(stopProcess({ ...plan }, { confirmed: true }), error => error.code === 'INVALID_PROCESS_PLAN');
  await assert.rejects(stopProcess(plan), error => error.code === 'CONFIRMATION_REQUIRED');
  await assert.rejects(stopProcess(plan, { confirmed: 'true' }), error => error.code === 'CONFIRMATION_REQUIRED');
  assert.equal(child.exitCode, null);
  assert.equal(child.signalCode, null);
  const output = [];
  const result = await stopProcess(plan, { confirmed: true, onOutput: text => output.push(text) });
  assert.equal(result.status, 'stopped');
  assert.equal(result.pid, child.pid);
  assert.ok(output.length > 0);
  await assert.rejects(stopProcess(plan, { confirmed: true }), error => error.code === 'INVALID_PROCESS_PLAN');
});

test('expired review never stops the disposable process', { timeout: 30_000 }, async t => {
  const child = await disposableChild(t);
  const plan = await planProcessStop(child.pid);
  const actualNow = Date.now;
  const future = actualNow() + 61_000;
  t.mock.method(Date, 'now', () => future);
  try {
    await assert.rejects(stopProcess(plan, { confirmed: true }), error => error.code === 'PROCESS_PLAN_EXPIRED');
    assert.equal(child.exitCode, null);
    assert.equal(child.signalCode, null);
  } finally { t.mock.restoreAll(); }
});

test('a reviewed child that exits on its own is reported as already exited', { timeout: 40_000 }, async t => {
  const child = await disposableChild(t);
  const plan = await planProcessStop(child.pid);
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
  const result = await stopProcess(plan, { confirmed: true });
  assert.equal(result.status, 'already-exited');
});

test('POSIX SIGTERM is never automatically escalated when a child ignores it', {
  skip: process.platform === 'win32', timeout: 15_000,
}, async t => {
  const child = await disposableChild(t, { ignoreTermination: true });
  const plan = await planProcessStop(child.pid);
  const result = await stopProcess(plan, { confirmed: true });
  assert.equal(result.status, 'requested');
  assert.match(result.message, /did not force/);
  assert.equal(child.exitCode, null);
  assert.equal(child.signalCode, null);
});

test('cancelled confirmation leaves the reviewed child alive', { timeout: 30_000 }, async t => {
  const child = await disposableChild(t);
  const plan = await planProcessStop(child.pid);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(stopProcess(plan, { confirmed: true, signal: controller.signal }), error => error.code === 'ABORT_ERR');
  assert.equal(child.exitCode, null);
  assert.equal(child.signalCode, null);
});

test('Windows verifies creation identity again before terminating its captured handle', {
  skip: process.platform !== 'win32', timeout: 30_000,
}, async t => {
  const child = await disposableChild(t);
  const plan = await planProcessStop(child.pid);
  const { run } = await import('../src/run.js');
  const { fileURLToPath } = await import('node:url');
  const helper = fileURLToPath(new URL('../src/process-control.ps1', import.meta.url));
  const result = await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive',
    '-ExecutionPolicy', 'Bypass', '-File', helper, '-TargetPid', String(child.pid), '-CallerPid', String(process.pid),
    '-Mode', 'stop', '-ExpectedStart', '0', '-ExpectedOwner', plan.owner, '-ExpectedName', plan.name]);
  assert.equal(JSON.parse(result.stdout).error, 'PROCESS_CHANGED');
  assert.equal(child.exitCode, null);
  assert.equal(child.signalCode, null);
});
