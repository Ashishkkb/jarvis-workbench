import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { run } from './run.js';
import { clean } from './format.js';

const windowsSystemDirectory = path.win32.join(process.env.SystemRoot || 'C:/Windows', 'System32');
const windowsPowerShell = path.win32.join(windowsSystemDirectory, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const windowsNetstat = path.win32.join(windowsSystemDirectory, 'netstat.exe');

// These scripts are fixed strings. Paths, search terms, and other user input never
// become PowerShell code; the runner invokes commands without a shell.
export const WINDOWS_PROCESS_SCRIPT = "$ErrorActionPreference='Stop'; ConvertTo-Json -Compress -InputObject @(Get-Process | Select-Object Id,ProcessName,CPU,WorkingSet64)";
export const WINDOWS_PORT_OWNER_SCRIPT = "$ErrorActionPreference='Stop'; ConvertTo-Json -Compress -InputObject @(Get-Process | Select-Object Id,ProcessName)";
export const WINDOWS_PORT_SCRIPT = "$ErrorActionPreference='Stop'; $tcp = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Select-Object @{Name='Protocol';Expression={'TCP'}},LocalAddress,LocalPort,OwningProcess); $udp = @(Get-NetUDPEndpoint -ErrorAction Stop | Select-Object @{Name='Protocol';Expression={'UDP'}},LocalAddress,LocalPort,OwningProcess); ConvertTo-Json -Compress -InputObject @($tcp + $udp)";

export function getSystemInfo() {
  const cpus = os.cpus();
  return {
    platform: os.platform(),
    hostname: os.hostname(),
    node: process.version,
    cpus: cpus.length,
    cpuModel: cpus[0]?.model || 'Unknown processor',
    memoryTotal: os.totalmem(),
    memoryFree: os.freemem(),
    uptime: os.uptime(),
    loadAverage: os.loadavg(),
    home: os.homedir(),
  };
}

function finiteNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isIntegerValue(value) {
  return value !== null && value !== undefined && value !== '' && Number.isInteger(Number(value));
}

function jsonRows(text) {
  const parsed = JSON.parse(String(text).replace(/^\uFEFF/, '').trim() || '[]');
  return Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : [];
}

export function parseWindowsProcesses(text) {
  return jsonRows(text)
    .filter(row => row && isIntegerValue(row.Id) && Number(row.Id) >= 0 && typeof row.ProcessName === 'string')
    .map(row => ({
      pid: Number(row.Id),
      name: row.ProcessName,
      cpu: finiteNumber(row.CPU),
      memory: finiteNumber(row.WorkingSet64),
    }));
}

export function parsePosixProcesses(text) {
  const processes = [];
  for (const line of String(text).split(/\r?\n/)) {
    // comm can contain spaces; the last two numeric columns are CPU and RSS.
    const match = /^\s*(\d+)\s+(.+?)\s+([\d.,]+)\s+(\d+)\s*$/.exec(line);
    if (!match) continue;
    processes.push({
      pid: Number(match[1]),
      name: path.posix.basename(match[2].trim()),
      cpu: finiteNumber(match[3].replace(',', '.')),
      memory: Number(match[4]) * 1024,
    });
  }
  return processes;
}

async function collect(command, args, signal, { execute = run, platform = process.platform, timeout = 15_000, maxOutput = 4 * 1024 * 1024 } = {}) {
  const result = await execute(command, args, {
    cwd: platform === 'win32' ? path.win32.dirname(command) : undefined,
    signal, timeout, maxOutput, allowFailure: true,
  });
  // lsof uses exit 1 with empty output when no matching sockets exist.
  const emptyLsof = command === 'lsof' && result.code === 1 && !result.stdout.trim() && !result.stderr.trim();
  if (result.code !== 0 && !emptyLsof) {
    throw new Error(`${command} exited with status ${result.code}`);
  }
  return result.stdout;
}

export async function listProcesses({ signal } = {}) {
  const windows = process.platform === 'win32';
  const cpuLabel = windows ? 'CPU time (s)' : 'CPU (%)';
  try {
    const output = windows
      ? await collect(windowsPowerShell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_PROCESS_SCRIPT], signal)
      : await collect('ps', ['-axo', 'pid=,comm=,%cpu=,rss='], signal);
    const processes = (windows ? parseWindowsProcesses(output) : parsePosixProcesses(output))
      .sort((a, b) => b.memory - a.memory || a.pid - b.pid);
    return { processes, cpuLabel };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { processes: [], cpuLabel, warning: 'The operating system could not provide the process list. Check that its process tools are available.' };
  }
}

function splitEndpoint(endpoint) {
  const index = endpoint.lastIndexOf(':');
  if (index < 0) return null;
  const portText = endpoint.slice(index + 1);
  if (!/^\d+$/.test(portText)) return null;
  const port = Number(portText);
  if (port < 0 || port > 65535) return null;
  const address = endpoint.slice(0, index).replace(/^\[|\]$/g, '') || '*';
  return { address, port };
}

function orderPorts(ports) {
  const unique = new Map();
  for (const port of ports) {
    const key = `${port.protocol}|${port.address}|${port.port}|${port.pid ?? ''}`;
    unique.set(key, port);
  }
  return [...unique.values()].sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol) || a.address.localeCompare(b.address) || (a.pid ?? -1) - (b.pid ?? -1));
}

function windowsPid(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
  const pid = Number(value);
  return Number.isInteger(pid) && pid >= 0 && pid <= 0xffffffff ? pid : null;
}

export function parseWindowsPorts(text) {
  return orderPorts(jsonRows(text)
    .filter(row => row && ['TCP', 'UDP'].includes(row.Protocol) && typeof row.LocalAddress === 'string' && isIntegerValue(row.LocalPort) && Number(row.LocalPort) >= 0 && Number(row.LocalPort) <= 65535)
    .map(row => ({
      protocol: row.Protocol,
      address: row.LocalAddress,
      port: Number(row.LocalPort),
      pid: windowsPid(row.OwningProcess),
    })));
}

export function parseSsPorts(text) {
  const ports = [];
  for (const line of String(text).split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (!['tcp', 'udp'].includes(columns[0]) || !['LISTEN', 'UNCONN'].includes(columns[1])) continue;
    const endpoint = splitEndpoint(columns[4] || '');
    if (!endpoint) continue;
    const owners = [...line.matchAll(/\("([^"]+)",pid=(\d+)/g)];
    if (owners.length) {
      for (const owner of owners) {
        ports.push({ protocol: columns[0].toUpperCase(), ...endpoint, pid: Number(owner[2]), process: owner[1] });
      }
    } else {
      ports.push({ protocol: columns[0].toUpperCase(), ...endpoint, pid: null });
    }
  }
  return orderPorts(ports);
}

export function parseLsofPorts(text) {
  const ports = [];
  let processInfo = { pid: null, process: undefined };
  let socket = {};
  function flush() {
    if (socket.protocol !== 'UDP' && !(socket.protocol === 'TCP' && socket.state === 'LISTEN')) return;
    const endpoint = splitEndpoint((socket.endpoint || '').split('->')[0]);
    if (endpoint) ports.push({ protocol: socket.protocol, ...endpoint, ...processInfo });
  }
  for (const line of String(text).split(/\r?\n/)) {
    const value = line.slice(1);
    switch (line[0]) {
      case 'p':
        flush();
        socket = {};
        processInfo = { pid: /^\d+$/.test(value) ? Number(value) : null, process: undefined };
        break;
      case 'c': processInfo.process = value; break;
      case 'f': flush(); socket = {}; break;
      case 'P': socket.protocol = value; break;
      case 'n': socket.endpoint = value; break;
      case 'T': if (value.startsWith('ST=')) socket.state = value.slice(3); break;
      default: break;
    }
  }
  flush();
  return orderPorts(ports);
}

export function parseNetstatPorts(text) {
  const ports = [];
  for (const line of String(text).split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    const protocol = columns[0]?.replace(/6$/, '').toUpperCase();
    if (!['TCP', 'UDP'].includes(protocol)) continue;
    // Windows: TCP local peer LISTENING pid; Linux: tcp recv send local peer LISTEN pid/name.
    const windows = columns[0] === columns[0].toUpperCase();
    const state = windows ? columns[3] : columns[5];
    if (protocol === 'TCP' && !['LISTEN', 'LISTENING'].includes(state)) continue;
    const endpoint = splitEndpoint(columns[windows ? 1 : 3] || '');
    if (!endpoint) continue;
    const owner = windows ? columns.at(-1) : columns[protocol === 'TCP' ? 6 : 5];
    const match = /^(\d+)(?:\/(.*))?$/.exec(owner || '');
    const port = { protocol, ...endpoint, pid: match ? Number(match[1]) : null };
    if (match?.[2]) port.process = match[2];
    ports.push(port);
  }
  return orderPorts(ports);
}


/** Resolve display names in one bounded read; port ownership can change after either snapshot. */
async function windowsPortOwners(ports, signal, options) {
  if (!ports.some(port => windowsPid(port.pid) !== null)) return ports;
  const output = await collect(windowsPowerShell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_PORT_OWNER_SCRIPT],
    signal, { ...options, timeout: 5000, maxOutput: 1024 * 1024 });
  const names = new Map();
  for (const row of jsonRows(output)) {
    const pid = windowsPid(row?.Id);
    if (pid === null || typeof row.ProcessName !== 'string') continue;
    const name = clean(row.ProcessName).trim().slice(0, 260);
    if (!name) continue;
    // Duplicate equal rows are harmless; conflicting identities remain unknown.
    names.set(pid, names.has(pid) && names.get(pid) !== name ? null : name);
  }
  return ports.map(port => names.get(port.pid) ? { ...port, process: names.get(port.pid) } : port);
}

/** Injection keeps fallback, permission and cancellation tests independent of the host. */
export function createPortInspector({ platform = process.platform, execute = run } = {}) {
  return async function inspectPorts({ signal } = {}) {
    const windows = platform === 'win32';
    const candidates = windows
      ? [
        [windowsPowerShell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_PORT_SCRIPT], parseWindowsPorts],
        [windowsNetstat, ['-ano'], parseNetstatPorts],
      ]
      : platform === 'linux'
        ? [
          ['ss', ['-H', '-lntup'], parseSsPorts],
          ['lsof', ['-nP', '-i', '-FpcfPnT'], parseLsofPorts],
          ['netstat', ['-lntup'], parseNetstatPorts],
        ]
        : [['lsof', ['-nP', '-i', '-FpcfPnT'], parseLsofPorts]];

    for (const [command, args, parse] of candidates) {
      try {
        let ports = parse(await collect(command, args, signal, { platform, execute }));
        if (windows) {
          try { ports = await windowsPortOwners(ports, signal, { platform, execute }); }
          catch (error) { if (signal?.aborted) throw error; }
        }
        const warnings = [];
        if (ports.some(port => port.pid === null)) warnings.push('Some process owners are hidden by operating-system permissions.');
        if (windows && ports.some(port => port.pid !== null && !port.process)) warnings.push('Some process names are unavailable. Their PIDs are still shown; the process may have exited or access may be restricted.');
        return { ports, ...(warnings.length ? { warning: warnings.join(' ') } : {}) };
      } catch (error) {
        if (signal?.aborted) throw error;
      }
    }
    return {
      ports: [],
      warning: windows
        ? 'Could not read listening ports with Get-NetTCPConnection or netstat.'
        : 'Could not read listening ports. Install ss (Linux) or lsof, then refresh this view.',
    };
  };
}

export const listPorts = createPortInspector();

export async function getProjectScripts(root) {
  try {
    const data = JSON.parse((await readFile(path.join(root, 'package.json'), 'utf8')).replace(/^\uFEFF/, ''));
    if (!data || typeof data.scripts !== 'object' || Array.isArray(data.scripts) || data.scripts === null) return [];
    return Object.entries(data.scripts)
      .filter(([, command]) => typeof command === 'string')
      .map(([name, command]) => ({ name, command }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}
