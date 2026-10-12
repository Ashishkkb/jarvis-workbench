import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { run, ToolError } from './run.js';

const issuedPlans = new WeakMap();
const powershell = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const helper = fileURLToPath(new URL('./process-control.ps1', import.meta.url));
const criticalNames = new Set(['init', 'systemd', 'launchd', 'kernel_task', 'kthreadd', 'system', 'registry', 'smss', 'csrss', 'wininit', 'winlogon', 'services', 'lsass', 'lsaiso', 'secure system', 'memory compression']);
const failure = (message, code = 'PROCESS_UNSAFE') => new ToolError(message, { code });

function checkAbort(signal) {
  if (signal?.aborted) throw failure('Operation cancelled.', 'ABORT_ERR');
}

function validPid(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid > 2_147_483_647) {
    throw failure('Choose an individual process with a PID greater than 1.', 'INVALID_PID');
  }
}

function protectName(name) {
  const base = path.basename(name).toLowerCase().replace(/\.exe$/, '');
  if (criticalNames.has(base)) throw failure('This operating-system process is protected.');
}

async function windowsProcess(pid, mode, expected, signal) {
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper,
    '-TargetPid', String(pid), '-CallerPid', String(process.pid), '-Mode', mode];
  if (expected) args.push('-ExpectedStart', expected.startedAt, '-ExpectedOwner', expected.owner, '-ExpectedName', expected.name);
  const result = await run(powershell, args, { cwd: path.win32.dirname(powershell), signal, timeout: 20_000, maxOutput: 64 * 1024 });
  let data;
  try { data = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim()); }
  catch { throw failure('Windows could not verify this process. No process was stopped.', 'PROCESS_METADATA'); }
  if (data.error) throw failure(data.message, data.error);
  return data;
}

async function linuxProcess(pid) {
  try {
    const [stat, status] = await Promise.all([
      readFile('/proc/' + pid + '/stat', 'utf8'), readFile('/proc/' + pid + '/status', 'utf8'),
    ]);
    const end = stat.lastIndexOf(')');
    if (end < 0) throw failure('Cannot verify process identity.', 'PROCESS_METADATA');
    const fields = stat.slice(end + 2).trim().split(/\s+/);
    const ids = /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m.exec(status);
    if (!ids || !/^\d+$/.test(fields[19] || '') || !/^\d+$/.test(fields[1] || '')) {
      throw failure('Cannot verify process identity or owner.', 'PROCESS_METADATA');
    }
    if (fields[0] === 'Z' || fields[0] === 'X') return null;
    if ((Number(fields[6]) & 0x00200000) !== 0) throw failure('Operating-system kernel threads are protected.', 'PROCESS_PROTECTED');
    return { pid, ppid: Number(fields[1]), name: stat.slice(stat.indexOf('(') + 1, end),
      startedAt: fields[19], owner: ids[1], ownerIds: ids.slice(1).map(Number) };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return null;
    if (error instanceof ToolError) throw error;
    throw failure('Cannot verify this process. Check your operating-system permissions.', 'PROCESS_METADATA');
  }
}

async function macProcess(pid, signal) {
  const result = await run('/bin/ps', ['-p', String(pid), '-o', 'pid=', '-o', 'ppid=', '-o', 'ruid=', '-o', 'uid=', '-o', 'lstart=', '-o', 'comm='],
    { signal, allowFailure: true, timeout: 5000, maxOutput: 64 * 1024, env: { LC_ALL: 'C' } });
  if (result.code === 1 && !result.stdout.trim()) return null;
  const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(.+?)\s*$/.exec(result.stdout);
  if (result.code !== 0 || !match || Number(match[1]) !== pid) {
    throw failure('Cannot verify process identity or owner.', 'PROCESS_METADATA');
  }
  return { pid, ppid: Number(match[2]), owner: match[3], ownerIds: [Number(match[3]), Number(match[4])],
    startedAt: match[5].replace(/\s+/g, ' '), name: path.basename(match[6]) };
}

async function posixProcess(pid, signal) {
  checkAbort(signal);
  if (process.platform === 'linux') return linuxProcess(pid);
  if (process.platform === 'darwin') return macProcess(pid, signal);
  throw failure('Stopping processes is supported on Windows, Linux and macOS.', 'PROCESS_UNSUPPORTED');
}

async function verifyPosix(pid, signal) {
  const uid = process.getuid?.();
  if (!Number.isInteger(uid) || process.geteuid?.() !== uid) {
    throw failure('Process control is unavailable with an unverified or elevated user identity.');
  }
  const info = await posixProcess(pid, signal);
  if (!info) return null;
  if (info.ownerIds.some(owner => owner !== uid)) throw failure('Only processes owned by your current user can be stopped.', 'PROCESS_OTHER_USER');
  protectName(info.name);
  let ancestor = process.pid;
  const seen = new Set();
  while (ancestor > 1) {
    if (ancestor === pid) throw failure('Jarvis and the processes that started it are protected.', 'PROCESS_PROTECTED');
    if (seen.has(ancestor) || seen.size >= 128) throw failure('Cannot safely verify the process ancestry.', 'PROCESS_METADATA');
    seen.add(ancestor);
    const parent = await posixProcess(ancestor, signal);
    if (!parent) {
      if (ancestor === process.pid) throw failure('Cannot verify Jarvis process ancestry.', 'PROCESS_METADATA');
      break;
    }
    ancestor = parent.ppid;
  }
  return info;
}

function sameProcess(a, b) {
  return a.pid === b.pid && a.startedAt === b.startedAt && a.owner === b.owner && a.name === b.name &&
    JSON.stringify(a.ownerIds ?? null) === JSON.stringify(b.ownerIds ?? null);
}

/** Read-only review. Only this exact frozen, short-lived object can authorize a stop. */
export async function planProcessStop(pid, { signal } = {}) {
  validPid(pid);
  checkAbort(signal);
  if (pid === process.pid) throw failure('Jarvis cannot stop itself.', 'PROCESS_PROTECTED');
  const info = process.platform === 'win32'
    ? await windowsProcess(pid, 'inspect', null, signal)
    : await verifyPosix(pid, signal);
  if (!info || info.status === 'already-exited') throw failure('This process has already exited. Refresh the process list.', 'PROCESS_EXITED');
  protectName(info.name);
  const plan = Object.freeze({ id: randomUUID(), pid, name: info.name, startedAt: info.startedAt, owner: info.owner,
    platform: process.platform, method: process.platform === 'win32' ? 'Windows termination' : 'SIGTERM',
    warning: process.platform === 'win32'
      ? 'Windows ends this process immediately. Unsaved work may be lost. Child processes are not automatically stopped.'
      : 'Sends a termination request (SIGTERM). The app may close and unsaved work may be lost. There is no automatic force kill.',
    expiresAt: new Date(Date.now() + 60_000).toISOString() });
  issuedPlans.set(plan, { info, expiresAt: Date.now() + 60_000 });
  return plan;
}

/** Stop only a previously reviewed same-user process. Never escalates or kills a tree. */
export async function stopProcess(plan, { confirmed = false, signal, onOutput } = {}) {
  const issued = plan && typeof plan === 'object' ? issuedPlans.get(plan) : null;
  if (!issued) throw failure('Review this process again before stopping it.', 'INVALID_PROCESS_PLAN');
  if (confirmed !== true) throw failure('Explicit confirmation is required to stop a process.', 'CONFIRMATION_REQUIRED');
  if (Date.now() > issued.expiresAt) {
    issuedPlans.delete(plan);
    throw failure('The process review expired. Review it again before stopping.', 'PROCESS_PLAN_EXPIRED');
  }
  checkAbort(signal);
  // Consume before execution so retries or concurrent calls cannot repeat a mutation.
  issuedPlans.delete(plan);
  const output = message => { try { onOutput?.(message + '\n', 'stdout'); } catch { /* Display failures must not change an already-issued stop. */ } };
  if (process.platform === 'win32') {
    const result = await windowsProcess(plan.pid, 'stop', issued.info, signal);
    const message = result.status === 'already-exited' ? 'The process had already exited.' : result.status === 'requested'
      ? 'Windows received the stop request; the process has not exited yet.' : 'The selected process was stopped.';
    output(message);
    return { pid: plan.pid, name: plan.name, status: result.status, message };
  }
  const current = await verifyPosix(plan.pid, signal);
  if (!current) return { pid: plan.pid, name: plan.name, status: 'already-exited', message: 'The process had already exited.' };
  if (!sameProcess(issued.info, current)) throw failure('The process changed since review. Refresh and review it again.', 'PROCESS_CHANGED');
  checkAbort(signal);
  // Read identity once more immediately before signaling this positive, individual PID.
  const latest = await posixProcess(plan.pid, signal);
  if (!latest) return { pid: plan.pid, name: plan.name, status: 'already-exited', message: 'The process had already exited.' };
  if (!sameProcess(issued.info, latest)) throw failure('The process changed since review. No signal was sent.', 'PROCESS_CHANGED');
  try { process.kill(plan.pid, 'SIGTERM'); }
  catch (error) {
    if (error.code === 'ESRCH') return { pid: plan.pid, name: plan.name, status: 'already-exited', message: 'The process had already exited.' };
    throw failure('The operating system refused to stop this process.', error.code || 'PROCESS_STOP_FAILED');
  }
  output('Sent SIGTERM to PID ' + plan.pid + '. Waiting for the application to exit.');
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && !signal?.aborted) {
    const remaining = await posixProcess(plan.pid);
    if (!remaining || !sameProcess(issued.info, remaining)) {
      return { pid: plan.pid, name: plan.name, status: 'stopped', message: 'The selected process exited.' };
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return { pid: plan.pid, name: plan.name, status: 'requested',
    message: 'Termination was requested, but the process is still running. Jarvis did not force it to close.' };
}
