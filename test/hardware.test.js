import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { hardwareNumber, cpuBusyPercent, parseHardwareOutput, normalizeBatteryCapacity, normalizeHardwareSnapshot, createHardwareCollector, getDemoHardwareSnapshot } from '../src/hardware.js';

const section = data => ({ ok: true, data });
const byId = (snapshot, id) => snapshot.components.find(c => c.id === id);
const metric = (component, label) => component.metrics.find(m => m.label === label)?.value;
const details = (device, label) => device.details.find(m => m.label === label)?.value;
const base = { memoryTotal: 1000, memoryFree: 500, cpuPercent: 20, logicalCores: 4 };

test('numeric readings reject absent, malformed and impossible values rather than displaying zero', () => {
  for (const value of [null, undefined, '', ' ', false, true, {}, [], Infinity, NaN, -1, 101, 'not a number']) assert.equal(hardwareNumber(value, 0, 100), null);
  assert.equal(hardwareNumber(0, 0, 100), 0);
  assert.equal(hardwareNumber('37.5', 0, 100), 37.5);
  const snapshot = normalizeHardwareSnapshot({ cpu: section([null, {}, { Name: 'CPU', NumberOfCores: -99 }]), gpu: section([{ AdapterRAM: 4294967295 }]) }, { cpuPercent: 999, memoryTotal: 100, memoryFree: 999 });
  assert.equal(metric(byId(snapshot, 'cpu'), 'Sampled CPU load'), null);
  assert.equal(metric(byId(snapshot, 'memory'), 'Memory in use'), null);
  assert.equal(metric(byId(snapshot, 'gpu'), 'Dedicated VRAM'), null);
  assert.equal(snapshot.summary.attention, 0);
});

test('CPU busy readings use counter deltas and reject empty, reset and changing topology', () => {
  const before = [{ times: { user: 10, nice: 0, sys: 10, idle: 80, irq: 0 } }];
  const after = [{ times: { user: 30, nice: 0, sys: 10, idle: 160, irq: 0 } }];
  assert.ok(Math.abs(cpuBusyPercent(before, after) - 20) < 0.001);
  assert.equal(cpuBusyPercent(before, before), null);
  assert.equal(cpuBusyPercent(after, before), null);
  assert.equal(cpuBusyPercent([], []), null);
  assert.equal(cpuBusyPercent(before, [...after, ...after]), null);
});

test('partial NDJSON survives provider failures and ignores arbitrary section names or malformed lines', () => {
  const value = parseHardwareOutput('\uFEFF' + JSON.stringify({ section: 'cpu', ok: true, data: [{ Name: 'CPU' }] }) + '\n' + JSON.stringify({ section: 'batteryStatic', ok: false, data: [] }) + '\n' + '{"section":"bios",');
  assert.equal(value.cpu.data[0].Name, 'CPU');
  assert.equal(value.batteryStatic.ok, false);
  assert.equal(value.bios, undefined);
  assert.deepEqual(parseHardwareOutput('{"section":"__proto__","ok":true,"data":[]}\nnot json'), {});
  assert.deepEqual(parseHardwareOutput(' '.repeat(256 * 1024 + 1)), {});
  assert.equal(parseHardwareOutput(JSON.stringify({ section: 'ports', ok: true, data: Array.from({ length: 300 }, () => ({})) })).ports.data.length, 256);
});

test('battery capacities match exact instance and optional tag, preserve units and reject sentinels', () => {
  const stat = { InstanceName: 'battery-one', Tag: 12, DesignedCapacity: 50000, Capabilities: 0x80000000 };
  const full = [{ InstanceName: 'battery-two', Tag: 12, FullChargedCapacity: 9000 }, { InstanceName: 'battery-one', Tag: 12, FullChargedCapacity: 35000 }];
  const result = normalizeBatteryCapacity(stat, full, [{ InstanceName: 'battery-one', Tag: 12, CycleCount: 300 }]);
  assert.equal(result.retainedPercent, 70);
  assert.equal(result.wearPercent, 30);
  assert.equal(result.cycles, 300);
  assert.equal(result.capacityUnit, 'mWh');
  const longInstance = 'a'.repeat(260);
  assert.equal(normalizeBatteryCapacity({ ...stat, InstanceName: longInstance + '1' }, [{ ...full[1], InstanceName: longInstance + '2' }]).retainedPercent, null);
  assert.equal(normalizeBatteryCapacity({ ...stat, InstanceName: ' battery-one' }, full).retainedPercent, null);
  assert.equal(normalizeBatteryCapacity(stat, [{ ...full[1], Tag: 13 }]).retainedPercent, null);
  assert.equal(normalizeBatteryCapacity(stat, [full[1], full[1]]).retainedPercent, null);
  assert.equal(normalizeBatteryCapacity(stat, [full[0]]).retainedPercent, null);
  assert.equal(normalizeBatteryCapacity({ ...stat, DesignedCapacity: 0xffffffff }, full).retainedPercent, null);
  assert.equal(normalizeBatteryCapacity(stat, [{ ...full[1], FullChargedCapacity: 0xffffffff }]).retainedPercent, null);
  assert.equal(normalizeBatteryCapacity({ ...stat, Capabilities: 0x40000000 }, full).capacityUnit, 'relative units');
  assert.equal(normalizeBatteryCapacity({ ...stat, Capabilities: undefined }, full).capacityUnit, 'reported units');
  assert.equal(normalizeBatteryCapacity(stat, full, [{ InstanceName: 'battery-one', Tag: 12, CycleCount: 0 }]).cycles, null);
});

test('battery wear alerts require valid matched capacities; missing data is not zero capacity', () => {
  const raw = { batteries: section([{ EstimatedChargeRemaining: 72, BatteryStatus: 2 }]), batteryStatic: section([{ InstanceName: 'A', DesignedCapacity: 100 }]), batteryFull: section([{ InstanceName: 'B', FullChargedCapacity: 30 }]) };
  let battery = byId(normalizeHardwareSnapshot(raw), 'battery');
  assert.equal(battery.findings.length, 0);
  assert.equal(metric(battery, 'Retained design capacity'), null);
  raw.batteryFull.data[0].InstanceName = 'A';
  battery = byId(normalizeHardwareSnapshot(raw), 'battery');
  assert.equal(battery.status, 'warning');
  assert.match(battery.findings[0].explanation, /30%/);
  assert.equal(byId(normalizeHardwareSnapshot({ batteries: { ok: false, data: [] } }), 'battery').status, 'unknown');
  assert.equal(byId(normalizeHardwareSnapshot({ batteries: section([]) }), 'battery').status, 'absent');
});

test('storage joins counters only to their physical disk and flags measured volume space', () => {
  const snapshot = normalizeHardwareSnapshot({ disks: section([{ DeviceId: '0', FriendlyName: 'Disk A', HealthStatus: 0 }, { DeviceId: '1', FriendlyName: 'Disk B', HealthStatus: 2 }]), reliability: section([{ DeviceId: '0', Temperature: 35, Wear: 10 }]), volumes: section([{ DeviceID: 'C:', Size: 1000, FreeSpace: 20 }, { DeviceID: 'D:', Size: 100, FreeSpace: 999 }]) });
  const storage = byId(snapshot, 'storage');
  assert.equal(storage.status, 'critical');
  assert.equal(details(storage.devices[0], 'Disk temperature'), '35 °C');
  assert.equal(details(storage.devices[1], 'Disk temperature'), null);
  assert.equal(details(storage.devices[3], 'Free space'), null);
  assert.equal(metric(storage, 'Local volumes measured'), '1');
  assert.ok(storage.findings.some(f => f.title.includes('C:')));
  assert.ok(storage.findings.some(f => f.title.includes('Disk B')));
  assert.equal(byId(normalizeHardwareSnapshot({ disks: section([{ HealthStatus: null }]) }), 'storage').status, 'unknown');
});

test('firmware zones remain unidentified and only their own trip points create thermal warnings', () => {
  let snapshot = normalizeHardwareSnapshot({ thermal: section([{ CurrentTemperature: 3731.5, CriticalTripPoint: null, PassiveTripPoint: null }]) });
  assert.equal(byId(snapshot, 'cooling').status, 'unknown');
  assert.equal(byId(snapshot, 'cooling').findings.length, 0);
  assert.equal(metric(byId(snapshot, 'cpu'), 'CPU temperature'), null);
  assert.equal(metric(byId(snapshot, 'gpu'), 'GPU temperature'), null);
  snapshot = normalizeHardwareSnapshot({ thermal: section([{ CurrentTemperature: 3731.5, CriticalTripPoint: 3631.5 }]) });
  assert.equal(byId(snapshot, 'cooling').status, 'critical');
  assert.match(byId(snapshot, 'cooling').devices[0].name, /Firmware thermal zone/);
  assert.equal(metric(byId(normalizeHardwareSnapshot({ thermal: section([{ CurrentTemperature: 0 }, { CurrentTemperature: Infinity }]) }), 'cooling'), 'Highest firmware zone'), null);
});

test('disabled or absent devices and disconnected network links are not diagnosed as hardware damage', () => {
  const snapshot = normalizeHardwareSnapshot({ ports: section([{ Name: 'Off', Present: true, ConfigManagerErrorCode: 22 }, { Name: 'Unplugged', Present: false, ConfigManagerErrorCode: 43 }]), network: section([{ Name: 'Ethernet', NetConnectionStatus: 7, ConfigManagerErrorCode: 0 }]) });
  assert.equal(byId(snapshot, 'ports').findings.length, 0);
  assert.equal(byId(snapshot, 'network').findings.length, 0);
  const gpu = byId(normalizeHardwareSnapshot({ gpu: section([{ ConfigManagerErrorCode: 22 }, { ConfigManagerErrorCode: 24 }]) }), 'gpu');
  assert.deepEqual(gpu.devices.map(d => d.status), ['unknown', 'absent']);
  assert.equal(gpu.findings.length, 0);
  const problem = byId(normalizeHardwareSnapshot({ ports: section([{ Name: 'USB camera', Present: true, ConfigManagerErrorCode: 43 }]) }), 'ports');
  assert.equal(problem.status, 'warning');
  assert.match(problem.findings[0].explanation, /does not identify a physical fault/);
});

test('public snapshots do not include serials, WMI instance identifiers, raw errors or addresses', () => {
  const snapshot = normalizeHardwareSnapshot({ board: section([{ Product: 'Mainboard', SerialNumber: 'SECRET_SERIAL', UUID: 'SECRET_UUID' }]), batteryStatic: section([{ InstanceName: 'SECRET_INSTANCE', DesignedCapacity: 100 }]), network: section([{ Name: 'Wi-Fi', MACAddress: 'SECRET_MAC', IPAddress: 'SECRET_IP' }]), cpu: { ok: false, error: 'SECRET_ERROR', data: [] } });
  assert.doesNotMatch(JSON.stringify(snapshot), /SECRET_/);
});

test('non-Windows collection reads base metrics without spawning native probes', async () => {
  let calls = 0;
  const collect = createHardwareCollector({ platform: 'linux', execute: async () => { calls++; throw Error(); }, sampleBase: async () => base });
  const snapshot = await collect();
  assert.equal(calls, 0);
  assert.equal(snapshot.platform, 'linux');
  assert.equal(metric(byId(snapshot, 'cpu'), 'Sampled CPU load'), '20%');
  assert.equal(byId(snapshot, 'gpu').status, 'unknown');
  assert.match(snapshot.limitations.join(' '), /Windows-only/);
});

test('Windows collection bounds native concurrency and retains completed sections on failure', async () => {
  let active = 0, maximum = 0, calls = 0;
  const collect = createHardwareCollector({ platform: 'win32', sampleBase: async () => base, execute: async (command, args, options) => {
    calls++; active++; maximum = Math.max(maximum, active);
    assert.match(command, /System32.*WindowsPowerShell.*powershell\.exe/i);
    assert.match(options.cwd, /WindowsPowerShell.*v1\.0/i);
    assert.equal(options.timeout, args.at(-1) === 'cpu' ? 8000 : 6000);
    assert.equal(options.maxOutput, 256 * 1024);
    assert.equal(args[args.length - 2], '-Probe');
    await delay(1); active--;
    if (args.at(-1) === 'board') throw Object.assign(Error('timed out'), { stdout: JSON.stringify({ section: 'board', ok: true, data: [{ Product: 'Surviving board reading' }] }) + '\n{"section":' });
    throw Error('provider unavailable');
  } });
  const result = await collect();
  assert.equal(calls, 10);
  assert.equal(maximum, 2);
  assert.equal(metric(byId(result, 'motherboard'), 'Board model'), 'Surviving board reading');
  assert.equal(metric(byId(result, 'memory'), 'Memory in use'), '50%');
});

test('cancellation prevents new probes and rejects without returning partial success', async () => {
  const before = new AbortController(); before.abort();
  let calls = 0;
  const pre = createHardwareCollector({ platform: 'win32', sampleBase: async () => base, execute: async () => { calls++; } });
  await assert.rejects(pre({ signal: before.signal }), { code: 'ABORT_ERR' });
  assert.equal(calls, 0);
  const controller = new AbortController();
  const during = createHardwareCollector({ platform: 'win32', sampleBase: async () => base, execute: async (_command, _args, options) => {
    calls++;
    controller.abort();
    assert.equal(options.signal.aborted, true);
    throw Object.assign(Error('cancelled'), { code: 'ABORT_ERR' });
  } });
  await assert.rejects(during({ signal: controller.signal }), { code: 'ABORT_ERR' });
  assert.equal(calls, 1);
});

test('demonstration remains explicit and every component obeys the public contract', () => {
  const snapshot = getDemoHardwareSnapshot();
  assert.equal(snapshot.demo, true);
  assert.deepEqual(snapshot.components.map(c => c.id), ['cpu', 'memory', 'motherboard', 'gpu', 'storage', 'battery', 'network', 'ports', 'cooling']);
  assert.ok(snapshot.components.some(c => c.status === 'unknown'));
  assert.match(snapshot.limitations[0], /demo data/);
  for (const c of snapshot.components) {
    for (const key of ['metrics', 'details', 'findings', 'devices', 'limitations', 'actions']) assert.ok(Array.isArray(c[key]));
    for (const field of [...c.metrics, ...c.details, ...c.devices.flatMap(d => d.details)]) assert.ok(field.value === null || typeof field.value === 'string');
  }
});

test('explicit battery low and critical states remain alerts without a percentage or while charging', () => {
  for (const [state, expected] of [[4, 'warning'], [5, 'critical'], [8, 'warning'], [9, 'critical']]) {
    for (const charge of [null, 2, 80]) {
      const battery = byId(normalizeHardwareSnapshot({ batteries: section([{ BatteryStatus: state, EstimatedChargeRemaining: charge }]) }), 'battery');
      assert.equal(battery.status, expected, `state ${state}, charge ${charge}`);
      assert.equal(battery.devices[0].status, expected);
      assert.ok(battery.findings.some(f => f.severity === expected));
      if (charge === null) assert.equal(metric(battery, 'Charge'), null);
    }
  }
});

test('reported battery device health cannot be concealed by a normal charge percentage', () => {
  for (const status of ['Error', 'Degraded', 'Pred Fail', 'PredFail', 'Stressed', 'NonRecover']) {
    const battery = byId(normalizeHardwareSnapshot({ batteries: section([{ BatteryStatus: 2, EstimatedChargeRemaining: 80, Status: status }]) }), 'battery');
    assert.equal(battery.status, 'warning', status);
    assert.equal(battery.devices[0].status, 'warning', status);
    assert.match(battery.findings[0].title, /provider health alert/);
  }
  for (const status of ['Unknown', 'Starting', 'Stopping', 'Service', 'No Contact', 'Lost Comm']) {
    const battery = byId(normalizeHardwareSnapshot({ batteries: section([{ BatteryStatus: 2, EstimatedChargeRemaining: 80, Status: status }]) }), 'battery');
    assert.equal(battery.status, 'unknown', status);
    assert.equal(battery.devices[0].status, 'unknown', status);
  }
  const good = byId(normalizeHardwareSnapshot({ batteries: section([{ BatteryStatus: 2, EstimatedChargeRemaining: 80, Status: 'OK' }]) }), 'battery');
  assert.equal(good.status, 'ok');
  assert.equal(good.findings.length, 0);
});
