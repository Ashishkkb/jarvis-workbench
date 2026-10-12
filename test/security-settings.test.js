import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, writeFile, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createSecurityService } from '../src/security.js';
import { createSettingsService, SETTINGS_PAGES } from '../src/settings.js';

const SCANNER = 'C:\\Program Files\\Windows Defender\\MpCmdRun.exe';
const status = () => ({ available: true, administrator: true, serviceEnabled: true, enabled: true, realtimeEnabled: true,
  signatureVersion: '1.2.3', definitionsUpdated: '2026-10-12T08:00:00Z', quickScan: {}, fullScan: {}, detections: [], warnings: [] });
function securityFixture(options = {}) {
  const calls = [];
  let data = status();
  const execute = async (command, args, operation) => {
    calls.push({ command, args, operation });
    if (args.at(-1) === 'status') return { code: 0, stdout: JSON.stringify(data) };
    if (args.at(-1) === 'locate') return { code: 0, stdout: JSON.stringify({ path: SCANNER, sha256: 'a'.repeat(64) }) };
    assert.equal(command, SCANNER);
    return options.scan ? options.scan(command, args, operation) : { code: 0, stdout: 'Scan finished.' };
  };
  return { service: createSecurityService({ platform: 'win32', execute, ...options }), calls, setStatus: value => { data = value; } };
}

test('Windows-only services report unsupported platforms without launching commands', async () => {
  const execute = async () => { throw new Error('Must not execute'); };
  const security = createSecurityService({ platform: 'linux', execute });
  const settings = createSettingsService({ platform: 'darwin', execute });
  assert.equal((await security.getSecurityStatus()).available, false);
  assert.equal((await settings.getSystemSettings()).available, false);
  await assert.rejects(security.planSecurityScan({ type: 'quick' }), /Windows only/);
  await assert.rejects(settings.openSettingsPage('security', { confirmed: true }), /Windows only/);
});

test('Defender status is bounded, sanitized, and preserves unknown dates and protection history', async () => {
  const fixture = securityFixture();
  fixture.setStatus({ ...status(), administrator: false, quickScan: { startedAt: 'bad-date' }, detections: [{ id: 'a', name: '\x1b[31mExample\x00', severity: 'High', resources: ['C:\\example.txt'], active: false, actionSuccess: true, detectedAt: '2026-10-11T08:00:00Z' }], warnings: ['\x1b[31mhistory warning'] });
  const result = await fixture.service.getSecurityStatus();
  assert.equal(result.available, true);
  assert.equal(result.canScan, false);
  assert.match(result.scanUnavailableReason, /administrator/);
  assert.equal(result.quickScan.startedAt, null);
  assert.equal(result.detections[0].name, 'Example');
  assert.equal(result.detections[0].actionSuccess, true);
  assert.equal(result.detections[0].detectedAt, '2026-10-11T08:00:00.000Z');
  assert.doesNotMatch(result.warnings[0], /\x1b/);
  await assert.rejects(fixture.service.planSecurityScan({ type: 'quick' }), /administrator/);
  assert.equal(fixture.calls.some(call => call.args.includes('-Scan')), false);
});

test('scan plans reject arbitrary actions, require exact issued object and confirmation, and cannot replay', async () => {
  const { service, calls } = securityFixture();
  for (const input of [null, [], {}, { type: 'delete' }, { type: 'quick', command: 'shell' }, { type: 'full', path: 'C:\\' }]) await assert.rejects(service.planSecurityScan(input));
  const plan = await service.planSecurityScan({ type: 'quick' });
  assert.ok(Object.isFrozen(plan));
  assert.equal(plan.cancellation, 'monitoring-only');
  assert.match(plan.warning, /quarantine or remove/);
  assert.match(plan.warning, /does not stop/);
  await assert.rejects(service.runSecurityScan({ ...plan }, { confirmed: true }), /Review this scan/);
  await assert.rejects(service.runSecurityScan(plan), /confirmation/);
  const result = await service.runSecurityScan(plan, { confirmed: true });
  assert.equal(result.status, 'completed');
  assert.match(result.message, /no threats or successfully remediated/);
  assert.equal(result.scanMayContinue, false);
  assert.deepEqual(calls.find(call => call.args.includes('-Scan')).args, ['-Scan', '-ScanType', '1']);
  await assert.rejects(service.runSecurityScan(plan, { confirmed: true }), /Review this scan/);
});

test('expired scan plans and targets changed after review do not start a scan', async () => {
  let clock = 1000;
  const fixture = securityFixture({ now: () => clock });
  const expired = await fixture.service.planSecurityScan({ type: 'full' });
  clock += 120_000;
  await assert.rejects(fixture.service.runSecurityScan(expired, { confirmed: true }), /expired/);
  let info = { path: 'C:\\fixture.txt', dev: '1', ino: '2', birthtimeMs: 3, file: true, size: 4, mtimeMs: 5 };
  const custom = securityFixture({ inspectPath: async () => ({ ...info }) });
  const plan = await custom.service.planSecurityScan({ type: 'custom', path: info.path });
  info.mtimeMs++;
  await assert.rejects(custom.service.runSecurityScan(plan, { confirmed: true }), /changed since review/);
  assert.equal(custom.calls.some(call => call.args.includes('-Scan')), false);
});

test('custom scan targets use literal arguments and reject symlinked targets', async t => {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'jarvis-security-test-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const filename = path.join(folder, "data & ' sample.txt");
  await writeFile(filename, 'safe fixture');
  const { service, calls } = securityFixture();
  const plan = await service.planSecurityScan({ type: 'custom', path: filename });
  await service.runSecurityScan(plan, { confirmed: true });
  assert.deepEqual(calls.find(call => call.args.includes('-Scan')).args, ['-Scan', '-ScanType', '3', '-File', plan.path]);
  await assert.rejects(service.planSecurityScan({ type: 'custom', path: 'relative.txt' }), /absolute local/);
  const linked = path.join(folder, 'link.txt');
  try { await symlink(filename, linked); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) return; throw error; }
  await assert.rejects(service.planSecurityScan({ type: 'custom', path: linked }), /symbolic link|junction/);
});

test('Defender return code 2 is attention-required and never a clean result', async () => {
  const fixture = securityFixture({ scan: async () => ({ code: 2, stdout: 'A detection or error requires review.' }) });
  const plan = await fixture.service.planSecurityScan({ type: 'full' });
  const result = await fixture.service.runSecurityScan(plan, { confirmed: true });
  assert.equal(result.status, 'attention-required');
  assert.equal(result.exitCode, 2);
  assert.match(result.message, /requiring attention or a scan error/);
  assert.ok(result.warnings.length);
});

test('cancelling monitoring never sends Defender global cancellation or claims the engine stopped', async () => {
  let started;
  const start = new Promise(resolve => { started = resolve; });
  const fixture = securityFixture({ scan: async (command, args, { signal }) => new Promise((resolve, reject) => {
    started(); signal.addEventListener('abort', () => reject(Object.assign(new Error('Monitor stopped.'), { code: 'ABORT_ERR' })), { once: true });
  }) });
  const plan = await fixture.service.planSecurityScan({ type: 'quick' });
  const controller = new AbortController();
  const running = fixture.service.runSecurityScan(plan, { confirmed: true, signal: controller.signal });
  await start;
  await assert.rejects(fixture.service.planSecurityScan({ type: 'quick' }), /already monitoring/);
  controller.abort();
  const result = await running;
  assert.equal(result.status, 'monitoring-stopped');
  assert.equal(result.cancelled, true);
  assert.equal(result.scanMayContinue, true);
  assert.equal(fixture.calls.some(call => call.args.includes('-Cancel')), false);
  assert.equal(fixture.calls.find(call => call.args.includes('-Scan')).operation.killTree, false);
});

test('monitoring time is bounded and interrupted output leaves an explicit continuation warning', async () => {
  const fixture = securityFixture({ monitorTimeoutMs: 100, scan: async (command, args, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('Stopped'), { code: 'ABORT_ERR' })), { once: true });
  }) });
  const result = await fixture.service.runSecurityScan(await fixture.service.planSecurityScan({ type: 'full' }), { confirmed: true });
  assert.equal(result.scanMayContinue, true);
  assert.match(result.message, /time limit/);
});

const FIRST = '381b4222-f694-41f0-9685-ff5bb260df2e';
const SECOND = 'a1841308-3541-4fab-bc81-f71556f20b4a';
function settingsFixture(options = {}) {
  let active = FIRST, plans = [FIRST, SECOND];
  const calls = [];
  const execute = async (command, args, operation) => {
    calls.push({ command, args, operation });
    if (args[0] === '/list') return { code: 0, stdout: plans.map((id, index) => `Power Scheme GUID: ${id}  (${index ? 'Battery saver' : 'Balanced'})${active === id ? ' *' : ''}`).join('\n') };
    if (args[0] === '/getactivescheme') return { code: 0, stdout: `Power Scheme GUID: ${active}  (Current)` };
    if (args[0] === '/setactive') { assert.ok(plans.includes(args[1])); active = args[1]; return { code: 0, stdout: '' }; }
    assert.equal(args[0], '-NoLogo');
    return { code: 0, stdout: '' };
  };
  return { service: createSettingsService({ platform: 'win32', execute, ...options }), calls, changeActive: id => { active = id; }, removePlan: id => { plans = plans.filter(value => value !== id); } };
}

test('power plans are discovered from Windows, applied literally and verified after confirmation', async () => {
  const { service, calls } = settingsFixture();
  const status = await service.getSystemSettings();
  assert.equal(status.activePowerPlanId, FIRST);
  assert.deepEqual(status.powerPlans.map(item => item.active), [true, false]);
  assert.ok(status.items.some(item => item.id === 'security' && item.available));
  const plan = await service.planSettingChange({ action: 'power-plan', id: SECOND });
  assert.ok(Object.isFrozen(plan));
  await assert.rejects(service.applySettingChange({ ...plan }, { confirmed: true }), /Review this setting/);
  await assert.rejects(service.applySettingChange(plan), /confirmation/);
  const result = await service.applySettingChange(plan, { confirmed: true });
  assert.equal(result.status, 'changed');
  assert.equal(result.previousPlanId, FIRST);
  assert.deepEqual(calls.find(call => call.args[0] === '/setactive').args, ['/setactive', SECOND]);
  await assert.rejects(service.applySettingChange(plan, { confirmed: true }), /Review this setting/);
});

test('power-plan changes refuse stale reviews and unknown or injected scheme IDs', async () => {
  const fixture = settingsFixture();
  for (const input of [{ action: 'power-plan', id: SECOND + '& calc' }, { action: 'power-plan', id: SECOND, command: 'shell' }, { action: 'power-plan', id: '00000000-0000-0000-0000-000000000000' }, { action: 'shell', id: SECOND }]) await assert.rejects(fixture.service.planSettingChange(input));
  const plan = await fixture.service.planSettingChange({ action: 'power-plan', id: SECOND });
  fixture.changeActive(SECOND);
  await assert.rejects(fixture.service.applySettingChange(plan, { confirmed: true }), /changed since review/);
  assert.equal(fixture.calls.some(call => call.args[0] === '/setactive'), false);
});

test('Settings pages require confirmation and accept only compile-time allowlisted IDs', async () => {
  const { service, calls } = settingsFixture();
  await assert.rejects(service.openSettingsPage('security'), /Confirm/);
  for (const id of ['ms-settings:windowsupdate-action', 'https://example.com', 'security; calc', '__proto__']) await assert.rejects(service.openSettingsPage(id, { confirmed: true }), /Choose an available/);
  for (const page of SETTINGS_PAGES) {
    const result = await service.openSettingsPage(page.id, { confirmed: true });
    assert.equal(result.status, 'opened');
  }
  assert.equal(calls.length, SETTINGS_PAGES.length);
  assert.ok(calls.every(call => call.args.at(-1).startsWith("$ErrorActionPreference='Stop'; Start-Process -FilePath 'ms-settings:")));
  assert.equal(calls.some(call => call.args.at(-1).includes('windowsupdate-action')), false);
});


test('unknown Defender protection flags remain unknown and cannot authorize scans', async () => {
  const fixture = securityFixture();
  fixture.setStatus({ ...status(), enabled: null, serviceEnabled: null, realtimeEnabled: null });
  const value = await fixture.service.getSecurityStatus();
  assert.equal(value.enabled, null);
  assert.equal(value.realtimeEnabled, null);
  assert.equal(value.canScan, false);
  assert.match(value.scanUnavailableReason, /incomplete protection status/);
  await assert.rejects(fixture.service.planSecurityScan({ type: 'quick' }), /incomplete protection status/);
});


test('a Defender scanner replaced at the same path invalidates its reviewed plan', async () => {
  let digest = 'a'.repeat(64), scans = 0;
  const service = createSecurityService({ platform: 'win32', execute: async (_command, args) => {
    if (args.at(-1) === 'status') return { stdout: JSON.stringify(status()) };
    if (args.at(-1) === 'locate') return { stdout: JSON.stringify({ path: SCANNER, sha256: digest }) };
    scans++; return { code: 0, stdout: '' };
  } });
  const plan = await service.planSecurityScan({ type: 'quick' });
  digest = 'b'.repeat(64);
  await assert.rejects(service.runSecurityScan(plan, { confirmed: true }), error => error.code === 'SCAN_SCANNER_CHANGED');
  assert.equal(scans, 0);
});

test('Defender requires a verified scanner digest and preserves unknown exit outcomes', async () => {
  const invalid = createSecurityService({ platform: 'win32', execute: async (_command, args) => ({ stdout: JSON.stringify(args.at(-1) === 'status' ? status() : { path: SCANNER }) }) });
  await assert.rejects(invalid.planSecurityScan({ type: 'quick' }), /trusted Microsoft Defender/);
  const fixture = securityFixture({ scan: async () => ({ code: 42, stdout: 'Unexpected result' }) });
  const value = await fixture.service.runSecurityScan(await fixture.service.planSecurityScan({ type: 'quick' }), { confirmed: true });
  assert.equal(value.status, 'attention-required');
  assert.equal(value.exitCode, 42);
  assert.equal(value.scanMayContinue, true);
  assert.match(value.warnings.join(' '), /outcome is unknown/);
});

test('power-plan interruption preserves observed outcome and original plan without automatic rollback', async () => {
  for (const applied of [true, false]) {
    let active = FIRST, writes = 0;
    const controller = new AbortController();
    const service = createSettingsService({ platform: 'win32', execute: async (_command, args, options) => {
      if (args[0] === '/list') return { stdout: [FIRST, SECOND].map(id => `${id} (Fixture plan)`).join('\n') };
      if (args[0] === '/getactivescheme') {
        if (controller.signal.aborted) assert.equal(options.signal, undefined);
        return { stdout: active };
      }
      assert.equal(args[0], '/setactive');
      writes++;
      if (applied) active = SECOND;
      controller.abort();
      throw Object.assign(new Error('Interrupted'), { code: 'ABORT_ERR' });
    } });
    const plan = await service.planSettingChange({ action: 'power-plan', id: SECOND });
    const value = await service.applySettingChange(plan, { confirmed: true, signal: controller.signal });
    assert.equal(value.status, applied ? 'changed' : 'uncertain');
    assert.equal(value.verified, applied);
    assert.equal(value.before.planId, FIRST);
    assert.equal(value.after.planId, applied ? SECOND : FIRST);
    assert.equal(value.cancellationRequested, true);
    assert.match(value.restoreInstruction, /did not roll back/);
    assert.ok(value.warnings.length);
    assert.equal(writes, 1);
  }
});

test('standalone settings service refuses concurrent power-plan mutations', async () => {
  let release, entered, active = FIRST;
  const gate = new Promise(resolve => { release = resolve; });
  const start = new Promise(resolve => { entered = resolve; });
  const service = createSettingsService({ platform: 'win32', execute: async (_command, args) => {
    if (args[0] === '/list') return { stdout: [FIRST, SECOND].map(id => `${id} (Fixture plan)`).join('\n') };
    if (args[0] === '/getactivescheme') return { stdout: active };
    entered(); await gate; active = SECOND; return { stdout: '' };
  } });
  const first = await service.planSettingChange({ action: 'power-plan', id: SECOND });
  const second = await service.planSettingChange({ action: 'power-plan', id: SECOND });
  const pending = service.applySettingChange(first, { confirmed: true });
  await start;
  await assert.rejects(service.applySettingChange(second, { confirmed: true }), error => error.code === 'SETTINGS_BUSY');
  release(); await pending;
  await assert.rejects(service.applySettingChange(second, { confirmed: true }), error => error.code === 'SETTING_CHANGED');
});
