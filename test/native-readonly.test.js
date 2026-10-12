import test from 'node:test';
import assert from 'node:assert/strict';
import { getNetworkStatus } from '../src/network.js';
import { getAudioStatus } from '../src/audio.js';
import { getSecurityStatus } from '../src/security.js';
import { getSystemSettings } from '../src/settings.js';

// This integration smoke only reads Windows status. No profiles, passwords, scans,
// or settings are changed. CI machines may have no audio device or Defender access.
test('Windows native status adapters return bounded typed data or actionable unavailability', { skip: process.platform !== 'win32', timeout: 90_000 }, async () => {
  const network = await getNetworkStatus();
  assert.equal(typeof network.available, 'boolean');
  assert.ok(Array.isArray(network.adapters));
  assert.ok(Array.isArray(network.profiles));
  if (!network.available) assert.ok(network.warning);
  assert.ok(network.adapters.length <= 1024);
  assert.ok(network.profiles.length <= 4096);

  const audio = await getAudioStatus();
  assert.equal(typeof audio.available, 'boolean');
  assert.ok(Array.isArray(audio.devices));
  if (audio.available) {
    assert.ok(audio.volume >= 0 && audio.volume <= 100);
    assert.equal(typeof audio.muted, 'boolean');
    assert.equal(typeof audio.defaultDeviceId, 'string');
  } else assert.ok(audio.warning);

  const security = await getSecurityStatus();
  assert.equal(typeof security.available, 'boolean');
  assert.equal(typeof security.canScan, 'boolean');
  assert.ok(Array.isArray(security.detections));
  if (!security.available) assert.ok(security.reason);

  const settings = await getSystemSettings();
  assert.equal(settings.available, true);
  assert.ok(Array.isArray(settings.pages));
  assert.ok(Array.isArray(settings.powerPlans));
  if (settings.activePowerPlanId) assert.ok(settings.powerPlans.some(item => item.id === settings.activePowerPlanId));
  else assert.ok(settings.powerPlanError);
});
