import test from 'node:test';
import assert from 'node:assert/strict';
import { createNetworkController } from '../src/network.js';
import { createAudioController } from '../src/audio.js';

const adapterId = '17c33543-1564-41f6-8ce8-4c2c903e4eed';
const profile = 'Home & $(this-is-literal) Wi-Fi';
const status = () => ({ available: true, adapters: [{ id: adapterId, name: 'Wi-Fi', mac: 'AABBCCDDEEFF',
  wifi: true, status: 'Up', dns: ['192.0.2.1'], profile, addresses: ['192.0.2.2'], gateway: ['192.0.2.1'], dhcp: true }],
profiles: [{ name: profile, adapterId, interfaceName: 'Wi-Fi' }] });
function networkFixture() {
  const calls = [];
  let data = status();
  let time = Date.now();
  const api = createNetworkController({ platform: 'win32', now: () => time,
    execute: async (command, args, options) => {
      calls.push({ command, args, options });
      const mode = args[args.indexOf('-Mode') + 1];
      const result = mode === 'status' ? data : mode === 'password' ? { password: 'FIXTURE-ONLY-NOT-A-REAL-SECRET' }
        : { status: mode.startsWith('dns') ? 'applied' : 'requested' };
      return { code: 0, stderr: '', stdout: JSON.stringify(result) };
    } });
  return { api, calls, advance: milliseconds => { time += milliseconds; }, change: next => { data = next; } };
}
const mode = call => call.args[call.args.indexOf('-Mode') + 1];
const mutations = calls => calls.filter(call => mode(call) !== 'status');

test('network review is read-only, frozen, explicit, one-use, and exact-adapter bound', async () => {
  const { api, calls } = networkFixture();
  const plan = await api.planNetworkChange({ action: 'connect', adapterId, profile });
  assert.ok(Object.isFrozen(plan) && Object.isFrozen(plan.before.dns));
  assert.equal(mutations(calls).length, 0);
  await assert.rejects(api.applyNetworkChange(plan), error => error.code === 'CONFIRMATION_REQUIRED');
  await assert.rejects(api.applyNetworkChange({ ...plan }, { confirmed: true }), error => error.code === 'INVALID_NETWORK_PLAN');
  const result = await api.applyNetworkChange(plan, { confirmed: true });
  assert.equal(result.status, 'requested');
  assert.equal(mutations(calls).length, 1);
  const request = mutations(calls)[0];
  assert.match(request.command, /\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
  assert.ok(request.args.includes('-File'));
  assert.ok(!request.args.includes('-Command'));
  assert.equal(request.args[request.args.indexOf('-AdapterId') + 1], adapterId);
  assert.equal(Buffer.from(request.args[request.args.indexOf('-ProfileBase64') + 1], 'base64').toString('utf8'), profile);
  await assert.rejects(api.applyNetworkChange(plan, { confirmed: true }), error => error.code === 'INVALID_NETWORK_PLAN');
});

test('adapter changes, missing saved profiles and expired plans prevent network changes', async () => {
  const fixture = networkFixture();
  const plan = await fixture.api.planNetworkChange({ action: 'disconnect', adapterId });
  const changed = status(); changed.adapters[0].profile = 'Different current connection';
  fixture.change(changed);
  await assert.rejects(fixture.api.applyNetworkChange(plan, { confirmed: true }), error => error.code === 'NETWORK_CHANGED');
  assert.equal(mutations(fixture.calls).length, 0);
  fixture.change(status());
  const expired = await fixture.api.planNetworkChange({ action: 'disconnect', adapterId });
  fixture.advance(61_000);
  await assert.rejects(fixture.api.applyNetworkChange(expired, { confirmed: true }), error => error.code === 'NETWORK_PLAN_EXPIRED');
  await assert.rejects(fixture.api.planNetworkChange({ action: 'connect', adapterId, profile: 'Not saved' }), error => error.code === 'NETWORK_PROFILE_MISSING');
  assert.equal(mutations(fixture.calls).length, 0);
});

test('DNS supports literal IPv4 server lists or automatic mode and rejects executable or malformed data', async () => {
  const { api, calls } = networkFixture();
  for (const dns of [[], ['8.8.8.8; evil'], ['example.com'], ['::1'], [123], '8.8.8.8', ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4', '5.5.5.5']]) {
    await assert.rejects(api.planNetworkChange({ action: 'dns', adapterId, dns }), error => error.code === 'NETWORK_INVALID');
  }
  for (const request of [{ action: 'ipv4', adapterId }, { action: 'disconnect', adapterId: '-Command' },
    { action: 'connect', adapterId, profile: 'bad\nprofile' }, { action: 'disconnect', adapterId, command: 'anything' }]) {
    await assert.rejects(api.planNetworkChange(request));
  }
  const manual = await api.planNetworkChange({ action: 'dns', adapterId, dns: ['1.1.1.1', '8.8.8.8'] });
  await api.applyNetworkChange(manual, { confirmed: true });
  const automatic = await api.planNetworkChange({ action: 'dns', adapterId, dns: null });
  await api.applyNetworkChange(automatic, { confirmed: true });
  assert.deepEqual(mutations(calls).map(mode), ['dns', 'dns-auto']);
  const args = mutations(calls)[0].args;
  assert.equal(args[args.indexOf('-DnsServers') + 1], '1.1.1.1,8.8.8.8');
});

test('password reveal requires explicit one-profile consent and never emits output callbacks', async () => {
  const { api, calls } = networkFixture();
  await assert.rejects(api.getWifiPassword({ adapterId, profile }), error => error.code === 'CONFIRMATION_REQUIRED');
  assert.equal(calls.length, 0);
  const output = [];
  const result = await api.getWifiPassword({ adapterId, profile, confirmed: true }, { onOutput: text => output.push(text) });
  assert.equal(result.password, 'FIXTURE-ONLY-NOT-A-REAL-SECRET');
  assert.equal(output.length, 0);
  assert.deepEqual(mutations(calls).map(mode), ['password']);
  assert.ok(!mutations(calls)[0].options.onOutput);
  await assert.rejects(api.getWifiPassword({ adapterId, profile: '*', confirmed: true }), error => error.code === 'NETWORK_PROFILE_MISSING');
});

test('failed password helpers cannot leak stdout, stderr or native error content', async () => {
  const api = createNetworkController({ platform: 'win32', execute: async (_command, args) => {
    if (args[args.indexOf('-Mode') + 1] === 'status') return { stdout: JSON.stringify(status()) };
    throw Object.assign(new Error('SECRET-IN-MESSAGE'), { stdout: 'SECRET-IN-STDOUT', stderr: 'SECRET-IN-STDERR' });
  } });
  await assert.rejects(api.getWifiPassword({ adapterId, profile, confirmed: true }), error => {
    assert.ok(!JSON.stringify(error).includes('SECRET'));
    assert.ok(!error.message.includes('SECRET'));
    assert.equal(error.stdout, undefined);
    assert.equal(error.stderr, undefined);
    return error.code === 'NETWORK_FAILED';
  });
});

test('network and audio return clear unavailable states without invoking Windows on other platforms', async () => {
  let calls = 0;
  const execute = async () => { calls++; throw new Error(); };
  assert.equal((await createNetworkController({ platform: 'linux', execute }).getNetworkStatus()).available, false);
  assert.equal((await createAudioController({ platform: 'darwin', execute }).getAudioStatus()).available, false);
  assert.equal(calls, 0);
  assert.equal((await createNetworkController({ platform: 'win32', execute }).getNetworkStatus()).available, false);
  assert.equal((await createAudioController({ platform: 'win32', execute }).getAudioStatus()).available, false);
});

test('audio validates consent and 0–100 volume, invokes fixed helper arguments, and returns observed state', async () => {
  const calls = [];
  const api = createAudioController({ platform: 'win32', execute: async (command, args) => {
    calls.push({ command, args });
    return { stdout: JSON.stringify({ available: true, volume: 37.5, muted: false, devices: [
      { id: 'fixture-output', name: 'Fixture speakers', kind: 'output', isDefault: true }], canSelectDevice: false }) };
  } });
  await assert.rejects(api.setAudioSettings({ volume: 20 }), error => error.code === 'CONFIRMATION_REQUIRED');
  for (const settings of [{ volume: -1 }, { volume: 101 }, { volume: '50' }, { volume: NaN },
    { muted: 'true' }, {}, { volume: 40, deviceId: 'unreviewed' }]) {
    await assert.rejects(api.setAudioSettings({ ...settings, confirmed: true }), error => error.code === 'AUDIO_INVALID');
  }
  assert.equal(calls.length, 0);
  const result = await api.setAudioSettings({ volume: 37.5, muted: false, confirmed: true });
  assert.equal(result.volume, 37.5);
  assert.equal(result.muted, false);
  assert.equal(result.canSelectDevice, false);
  assert.match(calls[0].command, /\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
  assert.ok(calls[0].args.includes('-File'));
  assert.ok(!calls[0].args.includes('-Command'));
  assert.equal(calls[0].args[calls[0].args.indexOf('-Volume') + 1], '37.5');
  assert.equal(calls[0].args[calls[0].args.indexOf('-Mute') + 1], '0');
});

test('cancelled network and audio requests do not invoke operating-system tools', async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  const execute = async () => { calls++; return { stdout: '{}' }; };
  const network = createNetworkController({ platform: 'win32', execute });
  const audio = createAudioController({ platform: 'win32', execute });
  await assert.rejects(network.getNetworkStatus({ signal: controller.signal }), error => error.code === 'ABORT_ERR');
  await assert.rejects(audio.setAudioSettings({ volume: 10, confirmed: true }, { signal: controller.signal }), error => error.code === 'ABORT_ERR');
  assert.equal(calls, 0);
});
