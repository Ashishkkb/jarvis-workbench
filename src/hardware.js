import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { run, ToolError } from './run.js';

const powershell = path.win32.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const helper = fileURLToPath(new URL('./hardware.ps1', import.meta.url));
const PROBES = ['cpu', 'memory', 'board', 'gpu', 'storage', 'battery', 'network', 'ports', 'cooling', 'os'];
const SECTIONS = new Set(['cpu', 'memory', 'memoryArrays', 'board', 'bios', 'gpu', 'volumes', 'disks', 'reliability', 'batteries', 'batteryStatic', 'batteryFull', 'batteryCycles', 'network', 'ports', 'thermal', 'fans', 'os', 'computer']);
const titles = { cpu: 'Processor', memory: 'Memory', motherboard: 'Motherboard & firmware', gpu: 'Graphics', storage: 'Storage', battery: 'Battery & power', network: 'Network adapters', ports: 'USB & connected devices', cooling: 'Cooling & sensors' };
const aborted = signal => { if (signal?.aborted) throw new ToolError('Operation cancelled.', { code: 'ABORT_ERR' }); };
const text = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 240) || null : null;
const list = value => Array.isArray(value) ? value.filter(row => row && typeof row === 'object' && !Array.isArray(row)).slice(0, 256) : [];
export function hardwareNumber(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}
const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => { const n = hardwareNumber(value, min, max); return Number.isInteger(n) ? n : null; };
const numberText = value => value === null ? null : value.toLocaleString('en-US', { maximumFractionDigits: 1 });
const percentage = value => value === null ? null : `${numberText(value)}%`;
const unit = (value, suffix) => value === null ? null : `${numberText(value)} ${suffix}`;
const bytes = value => {
  const n = hardwareNumber(value);
  if (n === null) return null;
  for (const [amount, suffix] of [[2 ** 40, 'TiB'], [2 ** 30, 'GiB'], [2 ** 20, 'MiB'], [2 ** 10, 'KiB']]) if (n >= amount) return unit(n / amount, suffix);
  return unit(n, 'B');
};
const pair = (label, value, note) => ({ label, value: value ?? null, ...(note ? { note } : {}) });
const finding = (severity, title, explanation, recommendation) => ({ severity, title, explanation, recommendation });
function component(id, summary) { return { id, title: titles[id], kind: id, status: 'unknown', summary, metrics: [], details: [], findings: [], devices: [], limitations: [], actions: [] }; }
function assess(item) {
  if (item.findings.some(f => f.severity === 'critical')) item.status = 'critical';
  else if (item.findings.some(f => f.severity === 'warning')) item.status = 'warning';
  return item;
}
const rows = (raw, section) => raw[section]?.ok === true ? list(raw[section].data) : [];
const reported = (raw, section) => raw[section]?.ok === true && Array.isArray(raw[section].data);
const sum = values => values.length && values.every(v => v !== null) ? values.reduce((a, b) => a + b, 0) : null;
const source = (item, label) => item.details.push(pair('Reading source', label));
const problemCode = value => integer(value, 0, 54);
const codeLabel = code => code === null ? null : code === 0 ? 'No device error reported' : code === 22 ? 'Disabled in Windows (code 22)' : code === 24 ? 'Not present / incomplete installation (code 24)' : `Windows device problem (code ${code})`;
function addDeviceProblem(item, name, value) {
  const code = problemCode(value);
  if (code !== null && code !== 0 && code !== 22 && code !== 24) item.findings.push(finding('warning', `${name}: device problem ${code}`, 'Windows reported a device or driver problem. This does not identify a physical fault by itself.', 'Review this device in Windows Device Manager and use the manufacturer’s driver or diagnostics.'));
  return code;
}

/** Retain complete JSON lines after a timeout; reject malformed or unbounded output. */
export function parseHardwareOutput(output) {
  const result = {};
  if (typeof output !== 'string' || Buffer.byteLength(output) > 256 * 1024) return result;
  for (const line of output.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const section = JSON.parse(line);
      if (SECTIONS.has(section?.section) && typeof section.ok === 'boolean' && Array.isArray(section.data)) result[section.section] = { ok: section.ok, data: list(section.data), truncated: section.truncated === true || section.data.length > 256 };
    } catch { /* A killed provider can leave an incomplete final line. */ }
  }
  return result;
}
export function cpuBusyPercent(before, after) {
  if (!Array.isArray(before) || !Array.isArray(after) || !before.length || before.length !== after.length) return null;
  let total = 0, idle = 0;
  for (let i = 0; i < before.length; i++) for (const key of ['user', 'nice', 'sys', 'idle', 'irq']) {
    const a = hardwareNumber(before[i]?.times?.[key]), b = hardwareNumber(after[i]?.times?.[key]);
    if (a === null || b === null || b < a) return null;
    const delta = b - a; total += delta;
    if (key === 'idle') idle += delta;
  }
  return total > 0 && idle <= total ? Math.max(0, Math.min(100, (1 - idle / total) * 100)) : null;
}

/** Exact matching prevents capacities from different battery packs being combined. */
export function normalizeBatteryCapacity(staticRow, fullRows, cycleRows = []) {
  const instanceName = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value) ? value : null;
  const instance = instanceName(staticRow?.InstanceName);
  const match = candidates => {
    if (!instance) return null;
    const matches = list(candidates).filter(row => instanceName(row.InstanceName) === instance);
    if (matches.length !== 1) return null;
    const row = matches[0];
    const firstTag = integer(staticRow.Tag, 0, 0xffffffff), secondTag = integer(row.Tag, 0, 0xffffffff);
    return firstTag !== null && secondTag !== null && firstTag !== secondTag ? null : row;
  };
  const design = hardwareNumber(staticRow?.DesignedCapacity, 1, 0xfffffffe);
  const full = hardwareNumber(match(fullRows)?.FullChargedCapacity, 1, 0xfffffffe);
  const capabilities = integer(staticRow?.Capabilities, 0, 0xffffffff);
  const capacityUnit = capabilities === null ? 'reported units' : (capabilities & 0x40000000) ? 'relative units' : 'mWh';
  const ratio = design !== null && full !== null && full <= design * 1.5 ? full / design * 100 : null;
  // Zero cycles can mean unsupported in the Windows battery contract.
  const cycles = integer(match(cycleRows)?.CycleCount, 1, 1_000_000);
  return { design, full, capacityUnit, retainedPercent: ratio, wearPercent: ratio === null ? null : Math.max(0, 100 - ratio), cycles };
}

/** Allowlisted public fields only. Missing numeric readings are null, never fabricated zero. */
export function normalizeHardwareSnapshot(raw = {}, base = {}, { platform = process.platform, sampledAt = new Date().toISOString(), demo = false } = {}) {
  raw = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  base = base && typeof base === 'object' ? base : {};
  const components = [];
  const cpu = component('cpu', 'Processor readings are unavailable.');
  const processors = rows(raw, 'cpu');
  const load = hardwareNumber(base.cpuPercent, 0, 100);
  const cores = sum(processors.map(p => integer(p.NumberOfCores, 1, 4096)));
  const threads = integer(base.logicalCores, 1, 65536) ?? sum(processors.map(p => integer(p.NumberOfLogicalProcessors, 1, 65536)));
  cpu.metrics = [pair('Sampled CPU load', percentage(load), 'Busy time across all logical processors, sampled briefly.'), pair('Physical cores', numberText(cores)), pair('Logical processors', numberText(threads)), pair('CPU temperature', null, 'A trustworthy CPU sensor is not exposed by this collector.')];
  cpu.details = [pair('Processor', text(processors[0]?.Name) || text(base.cpuModel)), pair('Architecture', text(base.arch)), pair('Sample interval', unit(hardwareNumber(base.cpuSampleMs, 1, 10000), 'ms'))];
  cpu.devices = processors.map((p, i) => ({ name: text(p.Name) || `Processor ${i + 1}`, details: [pair('Manufacturer', text(p.Manufacturer)), pair('Physical cores', numberText(integer(p.NumberOfCores, 1, 4096))), pair('Logical processors', numberText(integer(p.NumberOfLogicalProcessors, 1, 65536))), pair('Reported current clock', unit(hardwareNumber(p.CurrentClockSpeed, 1, 20000), 'MHz')), pair('Reported maximum clock', unit(hardwareNumber(p.MaxClockSpeed, 1, 20000), 'MHz'))] }));
  if (load !== null) { cpu.status = 'ok'; cpu.summary = `${percentage(load)} sampled processor demand.`; }
  if (load !== null && load >= 90) cpu.findings.push(finding('warning', 'High processor demand in this sample', `CPU busy time was ${percentage(load)} during a short sample. A busy processor is not evidence of damaged hardware.`, 'Open Processes to identify busy apps. Refresh later to see whether demand stays high.'));
  source(cpu, platform === 'win32' ? 'Node OS CPU counters; Windows Win32_Processor inventory' : 'Node OS CPU counters');
  cpu.limitations = ['A short sample can miss spikes and cannot diagnose a damaged processor.', 'Clock values are firmware reports, not an accurate live per-core boost reading.'];
  cpu.actions = [{ label: 'Inspect processes', screen: 'processes' }];
  components.push(assess(cpu));

  const memory = component('memory', 'Memory usage could not be measured.');
  const total = hardwareNumber(base.memoryTotal, 1), free = hardwareNumber(base.memoryFree, 0, total ?? 0);
  const used = total !== null && free !== null ? total - free : null;
  const usedPercent = used === null ? null : used / total * 100;
  const modules = rows(raw, 'memory'), arrays = rows(raw, 'memoryArrays');
  const slots = sum(arrays.map(a => integer(a.MemoryDevices, 1, 4096)));
  memory.metrics = [pair('Memory in use', percentage(usedPercent)), pair('Used / usable', used === null ? null : `${bytes(used)} / ${bytes(total)}`), pair('Available to OS', bytes(free)), pair('Reported memory slots', numberText(slots), 'Firmware may describe soldered memory as slots; this is not an upgrade guarantee.')];
  memory.devices = modules.map((m, i) => ({ name: text(m.DeviceLocator) || text(m.BankLabel) || `Memory module ${i + 1}`, details: [pair('Capacity', bytes(hardwareNumber(m.Capacity, 1))), pair('Manufacturer', text(m.Manufacturer)), pair('Configured clock (WMI)', unit(hardwareNumber(m.ConfiguredClockSpeed, 1, 30000), 'MHz')), pair('Memory type', ({ 20: 'DDR', 21: 'DDR2', 24: 'DDR3', 26: 'DDR4', 30: 'LPDDR4', 34: 'DDR5', 35: 'LPDDR5' })[integer(m.SMBIOSMemoryType, 0, 255)] || null)] }));
  memory.details.push(pair('Reported installed modules', reported(raw, 'memory') ? String(modules.length) : null));
  if (usedPercent !== null) { memory.status = 'ok'; memory.summary = `${bytes(free)} available out of ${bytes(total)} usable memory.`; }
  if (usedPercent !== null && usedPercent >= 90) memory.findings.push(finding(usedPercent >= 98 ? 'critical' : 'warning', 'Very little memory is available', `${percentage(usedPercent)} of usable memory is in use. Jarvis flags pressure from 90%, and severe pressure from 98%.`, 'Save your work and inspect memory-heavy processes before closing apps you recognize.'));
  source(memory, platform === 'win32' ? 'Node OS memory counters; Windows physical memory inventory' : 'Node OS memory counters');
  memory.limitations = ['OS memory includes caches and shared use; usage alone is not a memory fault test.', 'Module inventory does not verify compatibility, replaceability, or empty physical sockets.'];
  memory.actions = [{ label: 'Review memory use', screen: 'processes' }];
  components.push(assess(memory));

  const board = component('motherboard', 'Board identity is available only where firmware reports it. Electrical health is unknown.');
  const boards = rows(raw, 'board'), bios = rows(raw, 'bios')[0], computer = rows(raw, 'computer')[0], operatingSystem = rows(raw, 'os')[0];
  board.metrics = [pair('Manufacturer', text(boards[0]?.Manufacturer)), pair('Board model', text(boards[0]?.Product)), pair('BIOS version', text(bios?.SMBIOSBIOSVersion)), pair('Electrical health', null)];
  board.details = [pair('Computer model', [text(computer?.Manufacturer), text(computer?.Model)].filter(Boolean).join(' ') || null), pair('Board revision', text(boards[0]?.Version)), pair('BIOS vendor', text(bios?.Manufacturer)), pair('Operating system', text(operatingSystem?.Caption) || text(base.osName)), pair('OS version', text(operatingSystem?.Version) || text(base.osRelease)), pair('OS build', text(operatingSystem?.BuildNumber)), pair('System uptime', unit(hardwareNumber(base.uptimeSeconds, 0) === null ? null : base.uptimeSeconds / 3600, 'hours'))];
  board.devices = boards.map((b, i) => ({ name: text(b.Product) || `Board ${i + 1}`, details: [pair('Manufacturer', text(b.Manufacturer)), pair('Firmware-reported status', text(b.Status))] }));
  source(board, platform === 'win32' ? 'Windows baseboard, BIOS, computer and OS inventory' : 'Node OS system basics; board inventory unavailable');
  board.limitations = ['Firmware identity is not a motherboard health test. Voltages, capacitors and physical damage cannot be inspected here.', 'Serial numbers, asset identifiers, UUIDs and product keys are not included.'];
  board.actions = [{ label: 'System settings', screen: 'settings' }];
  components.push(board);

  const gpu = component('gpu', 'Graphics inventory is unavailable.');
  const graphics = rows(raw, 'gpu');
  gpu.metrics = [pair('Adapters reported', reported(raw, 'gpu') ? String(graphics.length) : null), pair('GPU temperature', null), pair('Dedicated VRAM', null), pair('Live GPU load', null)];
  gpu.devices = graphics.map((g, i) => {
    const name = text(g.Name) || `Graphics adapter ${i + 1}`, code = addDeviceProblem(gpu, name, g.ConfigManagerErrorCode);
    const width = integer(g.CurrentHorizontalResolution, 1, 32768), height = integer(g.CurrentVerticalResolution, 1, 32768);
    return { name, status: code === 0 ? 'ok' : code === 24 ? 'absent' : code === null || code === 22 ? 'unknown' : 'warning', details: [pair('Driver version', text(g.DriverVersion)), pair('Video processor', text(g.VideoProcessor)), pair('Display mode', width !== null && height !== null ? `${width} × ${height}` : null), pair('Refresh rate', unit(hardwareNumber(g.CurrentRefreshRate, 2, 1000), 'Hz')), pair('Windows device status', codeLabel(code))] };
  });
  if (graphics.length) { gpu.summary = `${graphics.length} graphics adapter${graphics.length === 1 ? '' : 's'} reported by Windows.`; gpu.status = graphics.every(g => problemCode(g.ConfigManagerErrorCode) === 0) ? 'ok' : 'unknown'; }
  source(gpu, 'Windows Win32_VideoController');
  gpu.limitations = ['A working driver does not prove physical GPU health.', 'GPU sensors and reliable dedicated VRAM require a supported vendor interface; the truncated Win32 AdapterRAM value is deliberately not used.'];
  gpu.actions = [{ label: 'Display settings', screen: 'settings' }];
  components.push(assess(gpu));
  const storage = component('storage', 'Disk health and volume capacity are unavailable.');
  const disks = rows(raw, 'disks'), volumes = rows(raw, 'volumes'), reliability = rows(raw, 'reliability');
  let volumeTotal = 0, volumeFree = 0, measuredVolumes = 0;
  const healthNames = { 0: 'Healthy (provider report)', 1: 'Warning (provider report)', 2: 'Unhealthy (provider report)', 5: 'Unknown (provider report)' };
  for (const [i, d] of disks.entries()) {
    const name = text(d.FriendlyName) || `Physical disk ${i + 1}`, health = integer(d.HealthStatus, 0, 5), id = text(d.DeviceId);
    const matches = id ? reliability.filter(r => text(r.DeviceId) === id) : [], r = matches.length === 1 ? matches[0] : {};
    const temp = hardwareNumber(r.Temperature, 1, 125), maxTemp = hardwareNumber(r.TemperatureMax, 1, 125);
    const wear = hardwareNumber(r.Wear, 0, 100), readErrors = integer(r.ReadErrorsUncorrected), writeErrors = integer(r.WriteErrorsUncorrected);
    if (health === 1 || health === 2) storage.findings.push(finding(health === 2 ? 'critical' : 'warning', `${name}: storage health alert`, `The Windows storage provider reports ${health === 2 ? 'unhealthy' : 'warning'} for this disk.`, 'Back up important files promptly and inspect this disk using its manufacturer’s diagnostics.'));
    if (wear !== null && wear >= 90) storage.findings.push(finding(wear === 100 ? 'critical' : 'warning', `${name}: high reported wear`, `The device reports ${percentage(wear)} of its estimated wear limit used. This is the disk’s own estimate.`, 'Keep current backups and plan a replacement; consult the disk manufacturer’s tools for context.'));
    if ((readErrors !== null && readErrors > 0) || (writeErrors !== null && writeErrors > 0)) storage.findings.push(finding('warning', `${name}: uncorrected errors reported`, 'The device reports historical uncorrected read or write errors. Their age and cause are not established by this snapshot.', 'Back up important files and inspect the drive with its manufacturer’s diagnostics.'));
    if (temp !== null && maxTemp !== null && temp >= maxTemp) storage.findings.push(finding('warning', `${name}: reported temperature limit reached`, `The disk reports ${unit(temp, '°C')} against its reported ${unit(maxTemp, '°C')} operating limit.`, 'Reduce sustained disk activity and check ventilation; verify the reading with the manufacturer’s diagnostics.'));
    storage.devices.push({ name, status: health === 0 ? 'ok' : health === 1 ? 'warning' : health === 2 ? 'critical' : 'unknown', details: [pair('Kind', 'Physical disk'), pair('Capacity', bytes(hardwareNumber(d.Size, 1))), pair('Media type', ({ 3: 'HDD', 4: 'SSD', 5: 'Storage-class memory' })[integer(d.MediaType)] || null), pair('Connection', ({ 1: 'SCSI', 3: 'ATA', 7: 'USB', 8: 'RAID', 10: 'SAS', 11: 'SATA', 17: 'NVMe' })[integer(d.BusType)] || null), pair('Reported health', healthNames[health] || null), pair('Disk temperature', unit(temp, '°C')), pair('Reported temperature limit', unit(maxTemp, '°C')), pair('Wear limit used', percentage(wear)), pair('Power-on hours', unit(integer(r.PowerOnHours, 0, 1000000), 'hours')), pair('Uncorrected read errors', numberText(readErrors)), pair('Uncorrected write errors', numberText(writeErrors))] });
  }
  for (const [i, v] of volumes.entries()) {
    const name = text(v.DeviceID) || `Volume ${i + 1}`, size = hardwareNumber(v.Size, 1), available = hardwareNumber(v.FreeSpace, 0, size ?? 0);
    const remaining = size !== null && available !== null ? available / size * 100 : null;
    if (remaining !== null) { volumeTotal += size; volumeFree += available; measuredVolumes++; }
    if (remaining !== null && remaining <= 10) storage.findings.push(finding(remaining <= 3 ? 'critical' : 'warning', `${name} is running low on space`, `${bytes(available)} (${percentage(remaining)}) remains free. Jarvis warns at 10% or less, and at 3% or less for severe pressure.`, 'Open Storage to review large files and cleanup candidates before deciding what to remove.'));
    storage.devices.push({ name: `Volume ${name}`, status: remaining === null ? 'unknown' : remaining <= 3 ? 'critical' : remaining <= 10 ? 'warning' : 'ok', details: [pair('Kind', 'Mounted local volume'), pair('Label', text(v.VolumeName)), pair('File system', text(v.FileSystem)), pair('Capacity', bytes(size)), pair('Free space', bytes(available)), pair('Free percentage', percentage(remaining))] });
  }
  storage.metrics = [pair('Physical disks', reported(raw, 'disks') ? String(disks.length) : null), pair('Local volumes measured', reported(raw, 'volumes') ? String(measuredVolumes) : null), pair('Combined volume free space', measuredVolumes ? bytes(volumeFree) : null), pair('Combined volume capacity', measuredVolumes ? bytes(volumeTotal) : null)];
  if (measuredVolumes || disks.length) storage.summary = `${disks.length} reported physical disks; ${measuredVolumes} local volumes measured.`;
  if (disks.length && disks.every(d => integer(d.HealthStatus, 0, 5) === 0)) storage.status = 'ok';
  source(storage, 'Windows local-volume counters; MSFT_PhysicalDisk and StorageReliabilityCounter');
  storage.limitations = ['Volume free space is separate from physical disk health; mounted volumes are not mapped to disks here.', 'Health and reliability depend on the storage driver. Missing SMART counters remain unknown; a Healthy report cannot predict all failures.', 'No scan, self-test or cleanup is performed. Network drives and unmounted partitions are not included in volume totals.'];
  storage.actions = [{ label: 'Review storage', screen: 'storage' }];
  components.push(assess(storage));

  const battery = component('battery', 'Battery information is unavailable.');
  const batteries = rows(raw, 'batteries'), statics = rows(raw, 'batteryStatic');
  const chargeValues = batteries.map(b => hardwareNumber(b.EstimatedChargeRemaining, 0, 100));
  battery.metrics = [pair('Battery devices', reported(raw, 'batteries') ? String(batteries.length) : null), pair('Charge', chargeValues.length === 1 ? percentage(chargeValues[0]) : null, 'Individual batteries are shown below; charge is not averaged across packs.'), pair('Retained design capacity', null), pair('Charge cycles', null)];
  const stateNames = { 1: 'Discharging', 2: 'AC power available', 3: 'Fully charged', 4: 'Low', 5: 'Critical', 6: 'Charging', 7: 'Charging: high', 8: 'Charging: low', 9: 'Charging: critical', 10: 'Undefined', 11: 'Partially charged' };
  // Explicit provider alerts take precedence over a missing or contradictory percentage.
  // Contract: https://learn.microsoft.com/windows/win32/cimwin32prov/win32-battery
  const providerStatus = value => text(value)?.toLowerCase().replace(/\s+/g, '') ?? null;
  battery.devices = batteries.map((b, i) => {
    const charge = hardwareNumber(b.EstimatedChargeRemaining, 0, 100), state = integer(b.BatteryStatus, 1, 11);
    const health = providerStatus(b.Status);
    const priorFindings = battery.findings.length;
    if ([4, 5, 8, 9].includes(state)) {
      const critical = state === 5 || state === 9;
      battery.findings.push(finding(critical ? 'critical' : 'warning', `Battery ${i + 1}: ${critical ? 'critical' : 'low'} power state reported`, `Windows reports the ${stateNames[state].toLowerCase()} power state.${charge === null ? ' A charge percentage was not supplied.' : ` Its charge estimate is ${percentage(charge)}.`}`, state === 8 || state === 9 ? 'Keep a compatible charger connected, save your work and verify that the charge level rises.' : 'Connect a compatible charger and save your work.'));
    } else if (charge !== null && charge <= 15 && state === 1) battery.findings.push(finding(charge <= 5 ? 'critical' : 'warning', `Battery ${i + 1}: low charge while discharging`, `Windows reports ${percentage(charge)} charge remaining.`, 'Connect a compatible charger and save your work.'));
    if (['error', 'degraded', 'predfail', 'stressed', 'nonrecover'].includes(health)) battery.findings.push(finding('warning', `Battery ${i + 1}: provider health alert`, `Windows reports the battery status as ${text(b.Status)}. A charge percentage does not cancel this device-status warning.`, 'Save your work and inspect the battery using diagnostics from the manufacturer. This report alone does not establish the cause.'));
    const alerts = battery.findings.slice(priorFindings);
    const status = alerts.some(f => f.severity === 'critical') ? 'critical' : alerts.length ? 'warning' : charge !== null && [null, 'ok'].includes(health) && state !== 10 ? 'ok' : 'unknown';
    return { name: text(b.Name) || `Battery ${i + 1}`, status, details: [pair('Charge', percentage(charge)), pair('Power state', stateNames[state] || null), pair('Provider status', text(b.Status))] };
  });
  for (const [i, row] of statics.entries()) {
    const { design, full, capacityUnit, retainedPercent, wearPercent, cycles } = normalizeBatteryCapacity(row, rows(raw, 'batteryFull'), rows(raw, 'batteryCycles'));
    battery.devices.push({ name: `Capacity report ${i + 1}`, details: [pair('Design capacity', unit(design, capacityUnit)), pair('Current full-charge capacity', unit(full, capacityUnit)), pair('Retained design capacity', percentage(retainedPercent)), pair('Estimated capacity loss', percentage(wearPercent)), pair('Charge cycles', numberText(cycles)), pair('Matching', 'Capacities joined by exact WMI battery instance, and tag when both are reported')] });
    if (statics.length === 1) { battery.metrics[2].value = percentage(retainedPercent); battery.metrics[3].value = numberText(cycles); }
    if (retainedPercent !== null && retainedPercent < 80) battery.findings.push(finding('warning', `Capacity report ${i + 1}: reduced battery capacity`, `The matched full-charge capacity is ${percentage(retainedPercent)} of the original design value. The 80% warning is a review threshold, not a physical failure diagnosis.`, 'Compare battery runtime with your needs and review the manufacturer’s battery diagnostics before considering replacement.'));
  }
  if (reported(raw, 'batteries') && batteries.length === 0 && !statics.length) { battery.status = 'absent'; battery.summary = 'Windows reports no system battery; this is normal for many desktops.'; }
  else if (batteries.length || statics.length) { battery.summary = `${batteries.length} battery device${batteries.length === 1 ? '' : 's'} reported; capacity information is shown where available.`; if (batteries.length && battery.devices.slice(0, batteries.length).every(b => b.status === 'ok')) battery.status = 'ok'; }
  source(battery, 'Windows battery status and root/WMI battery capacity providers');
  battery.limitations = ['Charge and capacity reports are kept separate because Win32 names do not reliably identify matching WMI battery instances.', 'Capacity is an estimate and can change after calibration. Relative capacity units are preserved; zero or unsupported cycle counts remain unknown.', 'Charging-port damage, charger wattage, swelling and electrical safety cannot be determined from these readings.'];
  battery.actions = [{ label: 'Power settings', screen: 'settings' }];
  components.push(assess(battery));
  const network = component('network', 'Physical adapter and link measurements are unavailable.');
  const adapters = rows(raw, 'network');
  const states = { 0: 'Disconnected', 1: 'Connecting', 2: 'Connected', 3: 'Disconnecting', 4: 'Hardware not present', 5: 'Hardware disabled', 6: 'Hardware malfunction', 7: 'Media disconnected', 8: 'Authenticating', 9: 'Authentication succeeded', 10: 'Authentication failed', 11: 'Invalid address', 12: 'Credentials required' };
  let connected = 0;
  network.devices = adapters.map((n, i) => {
    const name = text(n.NetConnectionID) || text(n.Name) || `Adapter ${i + 1}`;
    const state = integer(n.NetConnectionStatus, 0, 12), code = addDeviceProblem(network, name, n.ConfigManagerErrorCode);
    if (state === 2) connected++;
    if ([6, 10, 11].includes(state)) network.findings.push(finding('warning', `${name}: ${states[state].toLowerCase()}`, 'Windows reports an adapter or connection problem. Internet reachability has not been tested.', 'Review the adapter in Network and Windows settings.'));
    return { name, status: [6, 10, 11].includes(state) ? 'warning' : state === 2 && code === 0 ? 'ok' : 'unknown', details: [pair('Hardware', text(n.Name)), pair('Link state', states[state] || null), pair('Reported link rate', unit(hardwareNumber(n.Speed, 1, 1e13) === null ? null : Number(n.Speed) / 1e6, 'Mbps')), pair('Enabled', typeof n.NetEnabled === 'boolean' ? n.NetEnabled ? 'Yes' : 'No' : null), pair('Windows device status', codeLabel(code))] };
  });
  if (platform !== 'win32') network.devices = list(base.interfaces).map(n => ({ name: text(n.name) || 'Network interface', details: [pair('Address families present', text(n.families)), pair('Physical link state', null)] }));
  network.metrics = [pair('Physical adapters', reported(raw, 'network') ? String(adapters.length) : null), pair('Connected links', reported(raw, 'network') ? String(connected) : null), pair('Internet reachability', null, 'No external network requests are made.'), pair('Connector health', null)];
  if (adapters.length) { network.summary = `${connected} connected link${connected === 1 ? '' : 's'} across ${adapters.length} physical adapters.`; if (connected && adapters.every(a => problemCode(a.ConfigManagerErrorCode) === 0)) network.status = 'ok'; }
  else if (network.devices.length) network.summary = 'Logical network interfaces are listed; physical link health is unknown.';
  source(network, platform === 'win32' ? 'Windows Win32_NetworkAdapter physical-adapter inventory' : 'Node OS network-interface inventory');
  network.limitations = ['A disconnected or disabled adapter is not automatically faulty. Link rate is not measured internet throughput.', 'RJ45 sockets, antennas, Wi-Fi signal and cabling need additional diagnostics. No addresses, passwords or MAC identifiers are included.'];
  network.actions = [{ label: 'Network controls', screen: 'network' }, { label: 'Network sockets', screen: 'ports' }];
  components.push(assess(network));

  const ports = component('ports', 'USB and device-driver inventory is unavailable.');
  const devices = rows(raw, 'ports');
  ports.devices = devices.map((d, i) => {
    const name = text(d.Name) || `Device ${i + 1}`, code = d.Present === false ? problemCode(d.ConfigManagerErrorCode) : addDeviceProblem(ports, name, d.ConfigManagerErrorCode);
    return { name, status: d.Present === false || code === 24 ? 'absent' : code === 0 ? 'ok' : code === 22 ? 'unknown' : code === null ? 'unknown' : 'warning', details: [pair('Class', text(d.PNPClass)), pair('Manufacturer', text(d.Manufacturer)), pair('Present', typeof d.Present === 'boolean' ? d.Present ? 'Yes' : 'No' : null), pair('Windows device status', codeLabel(code))] };
  });
  ports.metrics = [pair('Device reports', reported(raw, 'ports') ? String(devices.length) : null), pair('Driver problems', reported(raw, 'ports') ? String(ports.findings.length) : null), pair('Physical socket count', null), pair('USB power delivery', null)];
  if (reported(raw, 'ports')) { ports.summary = `${devices.length} USB / problem-device reports. Empty physical sockets cannot be counted reliably.`; if (devices.length && devices.every(d => problemCode(d.ConfigManagerErrorCode) === 0)) ports.status = 'ok'; }
  source(ports, 'Windows Plug and Play USB inventory and device problem codes');
  ports.limitations = ['USB controllers, hubs and connected devices are not a physical socket map. One socket can correspond to multiple entries.', 'HDMI, audio jacks, USB-C power delivery and damaged connectors cannot be fully inspected through generic Windows inventory.', 'TCP/UDP network sockets are software endpoints; open them separately using Network sockets. Disabled and absent devices are not labelled hardware failures.'];
  ports.actions = [{ label: 'Network sockets', screen: 'ports' }, { label: 'Device settings', screen: 'settings' }];
  components.push(assess(ports));

  const cooling = component('cooling', 'No trustworthy component temperature or fan-speed measurement is available.');
  const thermal = rows(raw, 'thermal');
  const celsius = value => { const n = hardwareNumber(value, 1731.5, 4731.5); return n === null ? null : n / 10 - 273.15; };
  const temperatures = [];
  cooling.devices = thermal.map((t, i) => {
    const temperature = celsius(t.CurrentTemperature), critical = celsius(t.CriticalTripPoint), passive = celsius(t.PassiveTripPoint);
    if (temperature !== null) temperatures.push(temperature);
    if (temperature !== null && critical !== null && temperature >= critical) cooling.findings.push(finding('critical', `Firmware zone ${i + 1}: critical threshold reached`, `This firmware thermal zone reports ${unit(temperature, '°C')} against its own ${unit(critical, '°C')} critical trip point. It is not identified as CPU or GPU temperature.`, 'Save work, reduce activity and check cooling. Use the manufacturer’s diagnostics to identify the sensor.'));
    else if (temperature !== null && passive !== null && temperature >= passive) cooling.findings.push(finding('warning', `Firmware zone ${i + 1}: passive cooling threshold reached`, `The reported zone temperature exceeds its firmware-defined passive cooling threshold of ${unit(passive, '°C')}.`, 'Check ventilation and verify the zone using the manufacturer’s diagnostics.'));
    return { name: `Firmware thermal zone ${i + 1}`, details: [pair('Zone temperature', unit(temperature, '°C')), pair('Passive cooling threshold', unit(passive, '°C')), pair('Critical trip point', unit(critical, '°C')), pair('Sensor location', null)] };
  });
  cooling.devices.push(...rows(raw, 'fans').map((fan, i) => ({ name: text(fan.Name) || `Reported fan ${i + 1}`, details: [pair('Provider status', text(fan.Status)), pair('Actual fan RPM', null), pair('Variable-speed capability', typeof fan.VariableSpeed === 'boolean' ? fan.VariableSpeed ? 'Yes' : 'No' : null)] })));
  cooling.metrics = [pair('Readable firmware zones', reported(raw, 'thermal') ? String(temperatures.length) : null), pair('Highest firmware zone', temperatures.length ? unit(Math.max(...temperatures), '°C') : null), pair('CPU / GPU sensors', null), pair('Actual fan speed', null)];
  if (temperatures.length) cooling.summary = `${temperatures.length} firmware thermal zone${temperatures.length === 1 ? '' : 's'} readable. Sensor locations and fan speed are unknown.`;
  source(cooling, 'Windows ACPI thermal zones and Win32_Fan inventory');
  cooling.limitations = ['Firmware thermal zones may be stale, shared or poorly labelled; they are never treated as CPU/GPU sensors.', 'Only a zone’s own reported trip point triggers a thermal warning. Generic temperature thresholds would be misleading.', 'DesiredSpeed is not measured fan RPM and is not displayed as actual speed. Missing sensors do not mean the computer is cool.'];
  components.push(assess(cooling));

  const limitations = ['Read-only snapshot. It cannot inspect physical damage or certify hardware health.', 'Readings are collected over several seconds; they are not a continuous sensor feed or simultaneous measurements.', '“Unknown” means the operating system or firmware did not expose a supported reading. It never means zero or healthy.'];
  if (platform !== 'win32') limitations.push('On this platform Jarvis currently reads CPU, memory and logical network inventory. Detailed firmware, storage-health, battery and USB probes are Windows-only.');
  const unavailable = Object.values(raw).some(s => s?.ok === false);
  if (unavailable || (platform === 'win32' && SECTIONS.size > Object.keys(raw).filter(k => SECTIONS.has(k)).length)) limitations.push('Some providers were unavailable, refused access, or exceeded the collection deadline. Completed readings are preserved; administrator privileges are never requested automatically.');
  if (Object.values(raw).some(s => s?.truncated === true)) limitations.push('A provider returned more than 256 devices. Its inventory is capped to keep the dashboard responsive.');
  return { sampledAt, platform, demo, summary: { attention: components.filter(c => ['warning', 'critical'].includes(c.status)).length, observed: components.filter(c => c.status !== 'unknown' && c.status !== 'absent').length, unknown: components.filter(c => c.status === 'unknown').length }, components, limitations };
}

async function collectOsBase({ signal }) {
  aborted(signal);
  const before = os.cpus(), started = performance.now();
  await delay(180, undefined, { signal });
  const after = os.cpus();
  return { cpuModel: after[0]?.model ?? null, logicalCores: after.length || null, arch: os.arch(), cpuPercent: cpuBusyPercent(before, after), cpuSampleMs: Math.round(performance.now() - started), memoryTotal: os.totalmem(), memoryFree: os.freemem(), uptimeSeconds: os.uptime(), osName: os.type(), osRelease: os.release(), interfaces: Object.entries(os.networkInterfaces()).filter(([, addresses]) => addresses?.some(a => !a.internal)).map(([name, addresses]) => ({ name, families: [...new Set(addresses.filter(a => !a.internal).map(a => a.family))].join(', ') })) };
}

/** Injection supports failure/cancellation tests without changing any host settings. */
export function createHardwareCollector({ platform = process.platform, execute = run, sampleBase = collectOsBase, now = () => new Date().toISOString() } = {}) {
  return async function getSnapshot({ signal } = {}) {
    aborted(signal);
    const controller = new AbortController(), forward = () => controller.abort();
    signal?.addEventListener('abort', forward, { once: true });
    const deadline = setTimeout(() => controller.abort(), 32_000);
    const raw = {};
    let base = {}, next = 0;
    try {
      const sample = Promise.resolve().then(() => sampleBase({ signal: controller.signal })).then(value => { base = value; }).catch(() => {});
      const worker = async () => {
        while (next < PROBES.length && !controller.signal.aborted) {
          const probe = PROBES[next++];
          try {
            const result = await execute(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Probe', probe], { cwd: path.win32.dirname(powershell), signal: controller.signal, timeout: probe === 'cpu' ? 8000 : 6000, maxOutput: 256 * 1024 });
            Object.assign(raw, parseHardwareOutput(result.stdout));
          } catch (cause) { Object.assign(raw, parseHardwareOutput(cause?.stdout)); }
        }
      };
      await Promise.all([sample, ...(platform === 'win32' ? [worker(), worker()] : [])]);
      aborted(signal);
      return normalizeHardwareSnapshot(raw, base, { platform, sampledAt: now() });
    } finally { clearTimeout(deadline); signal?.removeEventListener('abort', forward); }
  };
}
export const getHardwareSnapshot = createHardwareCollector();
export function getDemoHardwareSnapshot() {
  const section = data => ({ ok: true, data });
  const raw = {
    cpu: section([{ Name: 'Example 8-core processor', NumberOfCores: 8, NumberOfLogicalProcessors: 16, CurrentClockSpeed: 3200, MaxClockSpeed: 4800 }]),
    memory: section([{ DeviceLocator: 'DIMM 1', Capacity: 16 * 2 ** 30, ConfiguredClockSpeed: 5600, SMBIOSMemoryType: 34 }, { DeviceLocator: 'DIMM 2', Capacity: 16 * 2 ** 30, ConfiguredClockSpeed: 5600, SMBIOSMemoryType: 34 }]),
    memoryArrays: section([{ MemoryDevices: 4 }]), board: section([{ Manufacturer: 'Example Systems', Product: 'Studio Mainboard', Version: '1.0' }]), bios: section([{ Manufacturer: 'Example Systems', SMBIOSBIOSVersion: '2.10' }]), computer: section([{ Manufacturer: 'Example', Model: 'Studio PC' }]), os: section([{ Caption: 'Windows 11 (example)', Version: 'Demo data', BuildNumber: 'Example' }]),
    gpu: section([{ Name: 'Example graphics adapter', DriverVersion: '32.0.example', ConfigManagerErrorCode: 0, CurrentHorizontalResolution: 2560, CurrentVerticalResolution: 1440, CurrentRefreshRate: 144 }]),
    volumes: section([{ DeviceID: 'C:', VolumeName: 'System', FileSystem: 'NTFS', Size: 500 * 2 ** 30, FreeSpace: 36 * 2 ** 30 }]), disks: section([{ DeviceId: '0', FriendlyName: 'Example NVMe SSD', MediaType: 4, BusType: 17, Size: 512 * 2 ** 30, HealthStatus: 0 }]), reliability: section([{ DeviceId: '0', Temperature: 38, TemperatureMax: 70, Wear: 8, PowerOnHours: 2100 }]),
    batteries: section([{ Name: 'Example laptop battery', EstimatedChargeRemaining: 72, BatteryStatus: 2 }]), batteryStatic: section([{ InstanceName: 'DEMO_BATTERY', Tag: 1, DesignedCapacity: 60000, Capabilities: 0x80000000 }]), batteryFull: section([{ InstanceName: 'DEMO_BATTERY', Tag: 1, FullChargedCapacity: 51000 }]), batteryCycles: section([{ InstanceName: 'DEMO_BATTERY', Tag: 1, CycleCount: 214 }]),
    network: section([{ Name: 'Example Wi-Fi 6 adapter', NetConnectionID: 'Wi-Fi', NetConnectionStatus: 2, Speed: 1200000000, NetEnabled: true, ConfigManagerErrorCode: 0 }]), ports: section([{ Name: 'Example USB controller', PNPClass: 'USB', Present: true, ConfigManagerErrorCode: 0 }, { Name: 'Example USB camera', PNPClass: 'Camera', Present: true, ConfigManagerErrorCode: 0 }]), thermal: section([{ CurrentTemperature: 3152, CriticalTripPoint: 3732, PassiveTripPoint: 3532 }]), fans: section([])
  };
  const result = normalizeHardwareSnapshot(raw, { cpuModel: 'Example 8-core processor', logicalCores: 16, arch: 'x64', cpuPercent: 24, cpuSampleMs: 180, memoryTotal: 32 * 2 ** 30, memoryFree: 19.6 * 2 ** 30, uptimeSeconds: 43200 }, { platform: 'win32', demo: true });
  result.limitations.unshift('Illustrative demo data. None of these values describe this computer.');
  return result;
}
