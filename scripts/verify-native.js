#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, realpath } from 'node:fs/promises';

// This script never calls a mutation, scan, profile reveal, or Settings launcher.
// An optional extracted npm package directory tests helpers as shipped to users.
if (process.platform !== 'win32') {
  console.log('Native Windows integration: skipped on this platform.');
  process.exit(0);
}
const root = path.resolve(process.argv[2] || fileURLToPath(new URL('..', import.meta.url)));
const api = await import(pathToFileURL(path.join(root, 'src', 'index.js')).href);
const powershell = path.win32.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const execute = promisify(execFile);
for (const helper of ['network.ps1', 'audio.ps1', 'security-status.ps1']) {
  // Add-Type is outside helper error handlers: execute/JSON failure catches broken native builds.
  const result = await execute(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'src', helper), '-Mode', 'status'],
    { cwd: path.win32.dirname(powershell), timeout: 30_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, encoding: 'utf8' });
  const data = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim());
  assert.ok(data && typeof data === 'object' && !Array.isArray(data), `${helper} must return typed JSON`);
  if (helper === 'audio.ps1' && data.error) {
    assert.equal(data.error, 'AUDIO_FAILED', 'Only an explicit device/service unavailable result is expected from an audio status probe');
  } else {
    assert.equal(typeof data.available, 'boolean', `${helper} returned an invalid availability flag`);
    if (helper === 'network.ps1') assert.ok(Array.isArray(data.adapters) && Array.isArray(data.profiles));
    if (helper === 'audio.ps1') {
      assert.ok(Array.isArray(data.devices));
      if (data.available) assert.ok(Number.isFinite(data.volume) && typeof data.muted === 'boolean');
    }
    if (helper === 'security-status.ps1' && !data.available) assert.equal(typeof data.reason, 'string');
  }
}
const network = await api.getNetworkStatus();
if (!network.available) {
  // Status-only diagnostics: no reveal method is called, and native error buffers are bounded.
  const { createNetworkController } = await import(pathToFileURL(path.join(root, 'src/network.js')).href);
  const { run } = await import(pathToFileURL(path.join(root, 'src/run.js')).href);
  const diagnostic = createNetworkController({ execute: async (command, args, options) => {
    assert.equal(args[args.indexOf('-Mode') + 1], 'status');
    const helperPath = args[args.indexOf('-File') + 1];
    try { await access(helperPath); console.error(JSON.stringify({ helperAccessible: true, helperPath: await realpath(helperPath) })); }
    catch (error) { console.error(JSON.stringify({ helperAccessible: false, helperPath, code: error.code })); }
    try { return await run(command, args, options); }
    catch (error) {
      console.error(JSON.stringify({ nativeStatusFailure: true, code: error.code, cwd: options.cwd,
        detail: String(error.stderr || error.message || '').slice(0, 2000) }));
      throw error;
    }
  } });
  const retried = await diagnostic.getNetworkStatus();
  console.error(JSON.stringify({ nativeDiagnosticAvailable: retried.available, reason: retried.warning }));
}
assert.equal(network.available, true, `Windows network inventory should work even with no Wi-Fi adapter: ${network.warning || 'no reason supplied'}`);
assert.ok(Array.isArray(network.adapters) && network.adapters.length <= 1024);
assert.ok(Array.isArray(network.profiles) && network.profiles.length <= 4096);
console.log(JSON.stringify({ control: 'network', available: network.available, adapters: network.adapters.length, savedProfiles: network.profiles.length }));

const audio = await api.getAudioStatus();
assert.equal(typeof audio.available, 'boolean');
assert.ok(Array.isArray(audio.devices));
if (audio.available) {
  assert.ok(audio.volume >= 0 && audio.volume <= 100);
  assert.equal(typeof audio.muted, 'boolean');
  assert.equal(typeof audio.defaultDeviceId, 'string');
} else assert.ok(audio.warning);
console.log(JSON.stringify({ control: 'audio', available: audio.available, devices: audio.devices.length, reason: audio.available ? undefined : audio.warning }));

const security = await api.getSecurityStatus();
assert.equal(typeof security.available, 'boolean');
assert.equal(typeof security.canScan, 'boolean');
assert.ok(Array.isArray(security.detections));
if (!security.available) assert.ok(security.reason);
console.log(JSON.stringify({ control: 'security', available: security.available, canScan: security.canScan, reason: security.available ? security.scanUnavailableReason || undefined : security.reason }));

const settings = await api.getSystemSettings();
assert.equal(settings.available, true);
assert.ok(Array.isArray(settings.pages) && settings.pages.length > 0);
assert.ok(Array.isArray(settings.powerPlans));
if (settings.activePowerPlanId) assert.ok(settings.powerPlans.some(item => item.id === settings.activePowerPlanId));
else assert.ok(settings.powerPlanError);
console.log(JSON.stringify({ control: 'settings', available: settings.available, powerPlans: settings.powerPlans.length, reason: settings.powerPlanError }));
console.log('Native status integration passed. Read-only coverage; OS mutation qualification requires a disposable Windows test machine.');
