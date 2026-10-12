#!/usr/bin/env node
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { Dashboard, initialState, safeRemote } from '../src/app.js';
import { renderDashboard, gitSummary, NAV, hardwareReportText } from '../src/ui.js';
import { clean, friendlyError, bytes, fit } from '../src/format.js';
import { demoState } from '../src/demo.js';
import { searchContent, listDirectory, analyzeDisk, getGitStatus, listProcesses, listPorts, getProjectScripts, scanStorage, listScanLocations, getNetworkStatus, getAudioStatus, getSecurityStatus, getSystemSettings } from '../src/index.js';
import { openBrowser } from '../src/browser.js';
import { run } from '../src/run.js';
import { getHardwareSnapshot, getDemoHardwareSnapshot } from '../src/hardware.js';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const HELP = `Jarvis Workbench ${VERSION}
A local terminal dashboard. No API key, account or Linux syntax required.

  jarvis [--path folder]              Open the dashboard
  jarvis --web [--path folder]        Open the local browser dashboard
  jarvis status [--json]              Explain Git save/upload status
  jarvis search "text" [options]       Search project files
  jarvis files [--json]               List the workspace directory
  jarvis disk [--json]                Measure workspace storage
  jarvis scan --path folder [--json]  Scan a folder or drive, read-only
  jarvis locations [--json]           List available drive/home/temp scopes
  jarvis hardware [--json]            Inspect PC components, readings and findings
  jarvis processes [--json]           Inspect processes
  jarvis ports [--json]               Inspect local listening ports
  jarvis network [--json]             Inspect network adapters and saved profiles
  jarvis sound [--json]               Inspect volume and sound devices
  jarvis security [--json]            Inspect Microsoft Defender status
  jarvis settings [--json]            Inspect power plans and settings shortcuts
  jarvis doctor                      Check available tools

  --path folder       Workspace, default current directory
  --regex             Treat the search query as a regular expression
  --case-sensitive    Match letter case in search
  --glob "*.js"       Limit search to matching filenames
  --json              Machine-readable output for a command
  --demo              Explore sample dashboard or hardware data
  --snapshot          Print a dashboard frame instead of opening the TUI
  --screen git        Initial screen; includes hardware (I), control (0)
  --width 110         Snapshot width
  --port 4177         Browser port (default: a free port)
  --no-open           Print browser URL without opening it
  --no-color          Disable dashboard colors
  --ascii             Use ASCII borders
  -h, --help          Show this help
  -v, --version       Show version

Dashboard: 1-9 tools, I Inside your PC, 0 Control Center, $ Support Ashish, arrows select, Enter opens, Ctrl+P task palette,
B browser, A activity, storage: S select drive, C cleanup review, H recovery,
/ search/filter, R refresh, Esc back/cancel, Q quit.
Use the dashboard to review system changes, file actions, Git uploads and scripts.
`;

function parse(args) {
  const opts = { root: process.cwd(), command: 'dashboard', words: [] };
  const values = new Set(['--path', '--glob', '--width', '--screen', '--port']);
  const flags = new Set(['--json', '--regex', '--case-sensitive', '--demo', '--snapshot', '--no-color', '--ascii', '--web', '--no-open']);
  const commands = new Set(['dashboard', 'web', 'status', 'search', 'files', 'disk', 'scan', 'locations', 'hardware', 'processes', 'ports', 'network', 'sound', 'security', 'settings', 'doctor']);
  let literal = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!literal && arg === '--') { literal = true; continue; }
    if (!literal && ['--help', '-h'].includes(arg)) { opts.help = true; continue; }
    if (!literal && ['--version', '-v'].includes(arg)) { opts.version = true; continue; }
    if (!literal && values.has(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${arg} needs a value.`);
      opts[arg.slice(2)] = args[++i]; continue;
    }
    if (!literal && flags.has(arg)) { opts[arg.slice(2)] = true; continue; }
    if (!literal && arg.startsWith('-')) throw new Error(`Unknown option: ${arg}. Use -- before a search query starting with a dash.`);
    if (opts.command === 'dashboard' && !opts.words.length && commands.has(arg)) opts.command = arg;
    else opts.words.push(arg);
  }
  opts.root = path.resolve(opts.path || process.cwd());
  if (opts.web) opts.command = 'web';
  if (opts.port && (!Number.isInteger(Number(opts.port)) || Number(opts.port) < 0 || Number(opts.port) > 65535)) throw new Error('--port must be between 0 and 65535.');
  if (opts.screen && !NAV.some(v => v[0] === opts.screen)) throw new Error('Unknown screen. Choose overview, files, search, git, processes, ports, disk, scripts, recipes, control or hardware.');
  if (opts.width && (!Number.isInteger(Number(opts.width)) || Number(opts.width) < 24 || Number(opts.width) > 300)) throw new Error('--width must be an integer between 24 and 300.');
  if (opts.command !== 'search' && opts.words.length) throw new Error('Use --path to choose a folder. See --help for examples.');
  return opts;
}

function print(value, json = false) { process.stdout.write((json ? JSON.stringify(value, null, 2) : value) + '\n'); }

async function readHardwareForCli(demo = false) {
  if (demo) return getDemoHardwareSnapshot();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try { return await getHardwareSnapshot({ signal: controller.signal }); }
  finally { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); }
}

async function main() {
  const options = parse(process.argv.slice(2));
  if (options.help) return print(HELP);
  if (options.version) return print(VERSION);
  if (!(await stat(options.root)).isDirectory()) throw new Error('The workspace must be a directory.');
  if (options.command === 'web') {
    const { startServer } = await import('../src/server.js');
    const server = await startServer({ root: options.root, port: Number(options.port) || 0, demo: options.demo });
    print(`Jarvis browser dashboard\n${server.url}\nLocal to this PC. Keep this terminal open; Ctrl+C stops the server.`);
    const stop = async () => { await server.close(); process.exitCode = 0; };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    if (!options['no-open']) await openBrowser(server.url).catch(() => print('Open the URL above in your browser.'));
    return;
  }
  if (options.command === 'doctor') {
    const checks = await Promise.all(['git', 'rg'].map(async command => {
      try { const value = await run(command, ['--version']); return `${command}: ${clean(value.stdout.split('\n')[0])}`; }
      catch { return `${command}: unavailable${command === 'rg' ? ' (built-in search will be used)' : ' (Git views unavailable)'}`; }
    }));
    return print(`Node ${process.version}\n${checks.join('\n')}\nPlatform: ${process.platform}\nWorkspace: ${options.root}\nConnections: explicit Git, project, network and Windows security actions\nTelemetry: none`);
  }
  if (options.command === 'hardware') {
    const data = await readHardwareForCli(options.demo);
    return print(options.json ? data : hardwareReportText(data), options.json);
  }
  const inspectors = { network: getNetworkStatus, sound: getAudioStatus, security: getSecurityStatus, settings: getSystemSettings };
  if (inspectors[options.command]) {
    if (options.demo) throw new Error('--demo is available for the dashboard and hardware reports.');
    const data = await inspectors[options.command]();
    if (options.json) return print(data, true);
    if (!data.available) return print(data.reason || data.warning || 'This system control is unavailable.');
    const lines = options.command === 'network' ? data.adapters.map(item => `${clean(item.name)} | ${clean(item.status)} | ${(item.addresses || []).map(clean).join(', ')}`)
      : options.command === 'sound' ? [`Volume: ${data.volume}% | ${data.muted ? 'Muted' : 'Sound on'}`, ...data.devices.map(item => `${clean(item.name)} | ${clean(item.kind)}${item.isDefault ? ' | Default' : ''}`)]
      : options.command === 'security' ? [`Microsoft Defender: ${data.enabled === true ? 'Enabled' : data.enabled === false ? 'Disabled' : 'Unknown'}`, `Real-time protection: ${data.realtimeEnabled === true ? 'On' : data.realtimeEnabled === false ? 'Off' : 'Unknown'}`, `Definitions: ${clean(data.definitionsUpdated || 'Not reported')}`, data.scanUnavailableReason || 'Scan controls available in the dashboard.']
      : data.powerPlans.map(item => `${item.active ? '* ' : '  '}${clean(item.name)}`);
    return print(lines.join('\n') + '\nOpen jarvis and press 0, or jarvis --web, to use these controls.');
  }
  if (options.command === 'dashboard') {
    if (options.json) throw new Error('Choose a command such as status or search with --json.');
    if (options.snapshot || !process.stdin.isTTY || !process.stdout.isTTY) {
      const state = options.demo ? new Dashboard(options.root, { demo: true }).state : initialState(options.root);
      state.screen = options.screen || 'overview';
      if (!options.demo) {
        if (['overview', 'git'].includes(state.screen)) state.git = await getGitStatus(options.root);
        else if (state.screen === 'files') state.files = await listDirectory(options.root);
        else if (state.screen === 'processes') state.processes = await listProcesses();
        else if (state.screen === 'ports') state.ports = await listPorts();
        else if (state.screen === 'disk') state.disk = await analyzeDisk(options.root);
        else if (state.screen === 'scripts') state.scripts = await getProjectScripts(options.root);
        else if (state.screen === 'hardware') state.hardware = await readHardwareForCli();
        else if (state.screen === 'control') state.control = await new Dashboard(options.root).readControl();
      }
      if (state.git) state.git.remoteUrl = safeRemote(state.git.remoteUrl);
      return print(renderDashboard(state, Number(options.width) || 110, 32, { color: false, ascii: options.ascii }));
    }
    const app = new Dashboard(options.root, { demo: options.demo, noColor: options['no-color'], ascii: options.ascii });
    app.state.screen = options.screen || 'overview';
    return app.start();
  }
  if (options.demo) throw new Error('--demo is available for the dashboard and hardware reports.');
  if (options.command === 'locations') {
    const locations = await listScanLocations();
    return print(options.json ? locations : locations.map(item => `${clean(item.label)}  ${clean(item.path)}  ${bytes(item.availableBytes)} available`).join('\n'), options.json);
  }
  if (options.command === 'scan') {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
    try {
      const result = await scanStorage(options.root, { signal: controller.signal, activePaths: [process.cwd()] });
      return print(options.json ? result : result.entries.map(item => `${fit(bytes(item.bytes), 12)} ${clean(item.name)}`).join('\n') +
        `\n${bytes(result.totalBytes)} measured in ${result.totalFiles} files${result.truncated ? ' (partial scan)' : ''}\n${result.skipped} skipped; ${result.cleanupCandidates.length} old temporary files eligible for review.\nOpen jarvis or jarvis --web to review cleanup.`, options.json);
    } finally { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); }
  }
  if (options.command === 'status') {
    const result = await getGitStatus(options.root);
    result.remoteUrl = safeRemote(result.remoteUrl);
    result.remotes = result.remotes.map(remote => ({ ...remote, url: safeRemote(remote.url) }));
    return print(options.json ? result : `${gitSummary(result)}\nRepository: ${clean(result.root || options.root)}\nBranch: ${clean(result.branch || '-')}\nRemote: ${result.remoteUrl}\n${result.changes.length} changed files | ${result.ahead} commits to upload | ${result.behind} to download\nRemote counts reflect the last fetch.`, options.json);
  }
  if (options.command === 'search') {
    const query = options.words.join(' ');
    if (!query) throw new Error('Provide text to search for: jarvis search "TODO"');
    const result = await searchContent(options.root, query, { regex: options.regex, caseSensitive: options['case-sensitive'], glob: options.glob });
    return print(options.json ? result : result.matches.map(v => `${clean(v.path)}:${v.line}:${v.column}  ${clean(v.text)}`).join('\n') +
      `\n${result.matches.length} matching lines (${result.backend})${result.truncated ? '; scan limit reached' : ''}`, options.json);
  }
  if (options.command === 'files') {
    const result = await listDirectory(options.root);
    return print(options.json ? result : result.entries.map(v => `${fit(v.type, 11)} ${fit(bytes(v.size), 9)} ${clean(v.name)}`).join('\n'), options.json);
  }
  if (options.command === 'disk') {
    const result = await analyzeDisk(options.root);
    return print(options.json ? result : result.entries.map(v => `${fit(bytes(v.bytes), 12)} ${clean(v.name)}`).join('\n') +
      `\n${bytes(result.totalBytes)} measured${result.truncated ? ' (partial scan)' : ''}`, options.json);
  }
  if (options.command === 'processes') {
    const result = await listProcesses();
    return print(options.json ? result : `PID      CPU           MEMORY      NAME\n${result.processes.map(v => `${fit(v.pid, 9)}${fit(v.cpu, 14)}${fit(bytes(v.memory), 12)}${clean(v.name)}`).join('\n')}\nCPU: ${result.cpuLabel}${result.warning ? '\n' + result.warning : ''}`, options.json);
  }
  if (options.command === 'ports') {
    const result = await listPorts();
    return print(options.json ? result : `PROTO   PORT     PID      ADDRESS\n${result.ports.map(v => `${fit(v.protocol, 8)}${fit(v.port, 9)}${fit(v.pid ?? '-', 9)}${clean(v.address)}`).join('\n')}${result.warning ? '\n' + result.warning : ''}`, options.json);
  }
}

main().catch(error => { process.stderr.write(`Jarvis: ${friendlyError(error)}\n`); process.exitCode = 1; });
