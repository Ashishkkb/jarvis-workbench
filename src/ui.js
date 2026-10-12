import { bytes, clean, elapsed, fit, plural, width, safeRemote } from './format.js';

export const NAV = [
  ['overview', 'Overview', 'Your workspace at a glance'],
  ['files', 'Files', 'Browse, preview and follow logs'],
  ['search', 'Search', 'Find text without remembering grep'],
  ['git', 'Git & upload', 'Review, save and upload your work'],
  ['processes', 'Processes', 'Inspect running programs and review a process to stop'],
  ['ports', 'Ports', 'Find what is listening'],
  ['disk', 'Storage', 'Scan disk space, clean temporary files and recover cleanup'],
  ['scripts', 'Project tasks', 'Run named project scripts'],
  ['recipes', 'Toolbox', 'Start with what you want to do'],
  ['control', 'Control Center', 'Wi-Fi, sound, Defender and Windows settings'],
  ['hardware', 'Inside your PC', 'Explore components, readings and evidence behind warnings']
];

export const CONTROL_ITEMS = [
  { id: 'network', title: 'Network & Wi-Fi', description: 'Connections, IPv4 DNS and saved passwords' },
  { id: 'audio', title: 'Sound', description: 'Volume, mute and output settings' },
  { id: 'security', title: 'Security', description: 'Microsoft Defender scans and protection history' },
  { id: 'power', title: 'Power plan', description: 'Choose an existing Windows power plan' },
  { id: 'settings', title: 'Windows Settings', description: 'Open native OS settings' },
  { id: 'support', title: 'Support Ashish', description: 'About this free, open-source project' },
];

const theme = {
  normal: '\x1b[38;2;220;228;245m', muted: '\x1b[38;2;145;163;194m',
  accent: '\x1b[1;38;2;165;180;252m', key: '\x1b[1;38;2;103;232;249m',
  good: '\x1b[38;2;110;231;183m', warn: '\x1b[38;2;252;211;125m',
  bad: '\x1b[38;2;253;137;160m', selected: '\x1b[1;38;2;239;245;255m',
  heading: '\x1b[1;38;2;241;245;255m', border: '\x1b[38;2;47;65;100m',
};
const surfaces = {
  canvas: '\x1b[48;2;10;16;31m', rail: '\x1b[48;2;13;22;42m',
  header: '\x1b[48;2;19;29;53m', footer: '\x1b[48;2;14;24;44m',
  selected: '\x1b[48;2;42;53;91m',
};
const row = (text = '', tone = 'normal') => ({ text, tone });
export const selection = (state, key = state.screen) => state.selected?.[key] ?? 0;

export function gitSummary(git) {
  if (!git?.isRepo) return 'No Git repository in this folder';
  if (git.conflicts) return `${plural(git.conflicts, 'conflict')} need attention`;
  if (git.operation) return `Finish the ${git.operation} in progress`;
  if (git.detached) return 'Viewing a commit without a branch';
  if (git.changes?.length) return `${plural(git.changes.length, 'file')} changed since the last save`;
  if (git.unborn) return 'Ready for your first snapshot';
  if (!git.upstream) return 'Saved locally; no upload destination is tracked';
  if (git.ahead && git.behind) return 'Local and remote histories have diverged';
  if (git.behind) return `${plural(git.behind, 'commit')} to download`;
  if (git.ahead) return `${plural(git.ahead, 'commit')} ready to upload`;
  return 'Saved locally; matches the last known remote';
}

function wrap(text, max) {
  const words = clean(text).split(/\s+/);
  const lines = []; let line = '';
  for (const word of words) {
    if (width(word) > max) {
      if (line) { lines.push(line); line = ''; }
      let used = 0;
      for (const character of word) {
        const cells = width(character);
        if (line && used + cells > max) { lines.push(line); line = ''; used = 0; }
        line += character;
        used += cells;
      }
    } else {
      if (line && width(line + ' ' + word) > max) { lines.push(line); line = ''; }
      line += (line ? ' ' : '') + word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
function table(state, data, count, toRow, key = state.screen) {
  const selected = Math.min(selection(state, key), Math.max(0, data.length - 1));
  const start = Math.max(0, Math.min(selected - Math.floor(count / 2), data.length - count));
  const rows = data.slice(start, start + count).map((item, i) =>
    row(`${start + i === selected ? '>' : ' '} ${toRow(item)}`, start + i === selected ? 'selected' : 'normal'));
  if (data.length > count) rows.push(row(`  ${start + 1}-${Math.min(start + count, data.length)} of ${data.length}   Up/Down to explore`, 'muted'));
  return rows;
}
function meter(value, max, size = 24) {
  const used = max > 0 ? Math.max(0, Math.min(size, Math.round(value / max * size))) : 0;
  return '[' + '='.repeat(used) + '.'.repeat(size - used) + ']';
}

function overviewRows(state, w, h) {
  const git = state.git;
  const sys = state.system;
  const rows = [row('WORKSPACE OVERVIEW', 'heading'), row('Your files, tools and computer. All within reach.', 'muted'), row(),
    row(gitSummary(git), !git?.isRepo ? 'muted' : git?.changes?.length || git?.behind || git?.conflicts ? 'warn' : 'good'), row()];
  if (git?.isRepo) {
    const column = Math.floor(w / 3);
    rows.push(row(fit('FILES CHANGED', column) + fit('READY TO UPLOAD', column) + 'TO DOWNLOAD', 'muted'));
    rows.push(row(fit(git.changes.length, column) + fit(git.ahead || 0, column) + (git.behind || 0), 'heading'));
    rows.push(row(), row(`Branch  ${git.branch || '(detached)'}   /   ${git.upstream || 'No tracked remote'}`, 'muted'));
    if (git.lastCommit) rows.push(row(`Last save  ${git.lastCommit.hash.slice(0, 7)}  ${git.lastCommit.subject}`));
    rows.push(row('Remote counts are cached. Press F to check the server.', 'muted'));
  } else {
    rows.push(row('Search, files and system tools work without Git.'));
  }
  rows.push(row(), row('YOUR COMPUTER', 'accent'));
  if (sys) {
    const used = sys.memoryTotal - sys.memoryFree;
    rows.push(row(`${sys.platform}  /  ${sys.cpus} CPU cores  /  Node ${sys.node}`));
    rows.push(row(`Memory ${meter(used, sys.memoryTotal, Math.min(22, Math.max(8, w - 35)))} ${bytes(used)} / ${bytes(sys.memoryTotal)}`));
    rows.push(row(`Uptime ${elapsed(sys.uptime)}  /  ${sys.hostname}`, 'muted'));
  }
  rows.push(row(), row('A GOOD PLACE TO START', 'accent'));
  rows.push(...wrap('[I] Explore your PC   [3] Find text   [4] Save & upload   [7] Free up space', w).map(v => row(v)));
  rows.push(...wrap('Ctrl+P opens the task palette. Search for what you want to do.', w).map(v => row(v, 'muted')));
  const activitySpace = h - rows.length - 2;
  if (activitySpace > 0 && state.activity?.length) {
    rows.push(row(), row('RECENT ACTIVITY', 'accent'));
    rows.push(...state.activity.slice(-Math.min(3, activitySpace)).map(v => row(v, 'muted')));
  }
  return rows;
}

function fileRows(state, w, h) {
  if (state.preview) {
    const p = state.preview;
    const heading = [row(state.tail ? 'FOLLOWING LOG' : 'FILE PREVIEW', 'accent'), row(p.path, 'heading'),
      row(`${bytes(p.totalBytes)}  |  [T] ${state.tail ? 'Stop following' : 'Follow last lines'}  [Esc] Back  [/] Find in file`, 'muted'), row()];
    if (p.binary) return [...heading, row('Binary file. Text preview is unavailable.', 'warn')];
    const visible = Math.max(1, h - heading.length - 2);
    const start = Math.min(selection(state, 'preview'), Math.max(0, p.lines.length - visible));
    return [...heading, ...p.lines.slice(start, start + visible).map(v => row(`${String(v.number ?? '-').padStart(5)}  ${v.text}`)),
      ...(p.truncated ? [row('Preview is bounded; use Search to find text elsewhere in the file.', 'muted')] : [])];
  }
  const rows = [row('FILE EXPLORER', 'accent'), row(state.files?.path || './', 'heading'),
    row('[Enter] Open  [Backspace] Parent  [/] Filter', 'muted'),
    ...wrap('[N] New folder  [C] Copy  [M] Move  [E] Rename  [X] To recovery  [H] Restore', w).map(value => row(value, 'muted')), row()];
  if (state.fileFilter) rows.push(row(`Filter: ${state.fileFilter}   [Esc] Clear`, 'warn'));
  rows.push(row(`  ${fit('NAME', Math.max(14, w - 28))}${fit('SIZE', 12)}TYPE`, 'muted'));
  const entries = visibleFiles(state);
  if (!entries.length) return [...rows, row('No matching entries in this folder.', 'muted')];
  return [...rows, ...table(state, entries, Math.max(1, h - rows.length - 1), entry =>
    fit((entry.type === 'directory' ? '+ ' : '  ') + entry.name, Math.max(14, w - 30)) +
    fit(entry.type === 'directory' ? '-' : bytes(entry.size), 12) + entry.type)];
}
export function visibleFiles(state) {
  const filter = state.fileFilter?.toLowerCase() || '';
  return (state.files?.entries || []).filter(v => v.name.toLowerCase().includes(filter));
}

function searchRows(state, w, h) {
  const s = state.search || {};
  const rows = [row('SEARCH ACROSS FILES', 'accent'),
    row('[ / ] New search   [M] Literal/regex   [C] Case   [G] File filter', 'muted'),
    row(`Mode: ${s.regex ? 'regular expression' : 'literal text'}  |  ${s.caseSensitive ? 'case sensitive' : 'ignore case'}`, 'muted'),
    row(`Files: ${s.glob || 'all searchable files'}  |  ${s.backend || 'ripgrep or built-in scanner'}`, 'muted'), row()];
  if (!s.query) return [...rows, row('What are you looking for?', 'heading'), row(),
    ...wrap('Press / and type a word, error message, function name, or regular expression.', w).map(v => row(v)), row(),
    row('Examples', 'accent'), row('  TODO                       Find unfinished work'),
    row('  connection refused         Find an error message'), row('  Files: *.js                Limit to JavaScript'),
    row('  Regex: error|warning       Match either word'), row(),
    ...wrap('Search ignores common dependency/cache folders and skips binary files. Results are capped so the terminal stays responsive.', w).map(v => row(v, 'muted'))];
  rows.push(row(`"${s.query}"  /  ${plural(s.matches?.length || 0, 'matching line')}${s.truncated ? ' (limit reached)' : ''}`, 'heading'));
  rows.push(row('[Enter] Preview selected match', 'muted'));
  if (!s.matches?.length) rows.push(row(state.busy ? 'Searching...' : 'No matches. Try a shorter phrase or a broader file filter.', 'muted'));
  return [...rows, ...table(state, s.matches || [], Math.max(1, h - rows.length - 1), match =>
    `${match.path}:${match.line}  ${match.text}`)];
}

function gitRows(state, w, h) {
  const git = state.git;
  if (!git?.isRepo) return [row('GIT & UPLOAD', 'accent'), row(), row('This folder is not a Git repository.', 'warn'),
    ...wrap('Open Jarvis inside an existing project. File search and system tools are available in any folder.', w).map(v => row(v))];
  const rows = [row('GIT & UPLOAD', 'accent'), row(gitSummary(git), git.conflicts || git.behind ? 'warn' : 'good'),
    row(`${git.branch || '(detached)'}  ->  ${git.upstream || 'No upstream'}`, 'heading'),
    row(`Repository: ${git.root}`, 'muted'),
    row(safeRemote(git.remoteUrl), 'muted'),
    row(`${git.staged} staged  /  ${git.modified} modified  /  ${git.untracked} new  /  ${git.ahead} ahead  /  ${git.behind} behind`),
    row('Remote counts reflect the last fetch. [F] checks the server.', 'muted'), row(),
    row('[C] Save snapshot  [P] Upload commits  [L] Download updates', 'accent'),
    row('[Enter] Review diff  [F] Check remote  [R] Refresh local', 'muted'), row()];
  if (git.operation) rows.push(row(`In progress: ${git.operation}. Finish it in your Git client.`, 'warn'));
  if (!git.changes.length) return [...rows, row('The working tree is clean.', 'good'), row(),
    ...wrap('Save snapshot stages your reviewed changes and commits them locally. Upload sends saved commits to your existing remote. Each action has a review step.', w).map(v => row(v, 'muted'))];
  rows.push(row('  STATUS        FILE', 'muted'));
  return [...rows, ...table(state, git.changes, Math.max(1, h - rows.length - 1), change =>
    `${fit(change.kind || 'changed', 13)} ${change.path}${change.originalPath ? ' <- ' + change.originalPath : ''}`)];
}

function processRows(state, w, h) {
  const data = state.processes;
  const rows = [row('PROCESS EXPLORER', 'accent'), row('See what is running without remembering ps or top.', 'muted'),
    row(`[K] Stop selected  [S] Sort ${state.processSort === 'memory' ? 'CPU' : 'memory'}  [/] Filter  [R] Refresh`, 'muted'),
    row(`CPU column: ${data?.cpuLabel || 'platform dependent'}  |  ${data?.processes?.length || 0} processes`), row()];
  if (data?.warning) rows.push(...wrap(data.warning, w).map(v => row(v, 'warn')));
  rows.push(row(`  ${fit('PID', 8)}${fit('CPU', 12)}${fit('MEMORY', 12)}NAME`, 'muted'));
  return [...rows, ...table(state, visibleProcesses(state), Math.max(1, h - rows.length - 1), item =>
    `${fit(item.pid, 8)}${fit(item.cpu == null ? '-' : Number(item.cpu).toFixed(1), 12)}${fit(bytes(item.memory), 12)}${item.name}`)];
}
export function visibleProcesses(state) {
  return [...(state.processes?.processes || [])]
    .filter(p => `${p.pid} ${p.name}`.toLowerCase().includes((state.processFilter || '').toLowerCase()))
    .sort((a, b) => state.processSort === 'memory' ? b.memory - a.memory : (b.cpu || 0) - (a.cpu || 0));
}

function portRows(state, w, h) {
  const data = state.ports;
  const rows = [row('PORT INSPECTOR', 'accent'), row('Find the process behind a listening port.', 'muted'),
    row('[ / ] Filter by port, PID or address   [R] Refresh', 'muted'), row()];
  if (data?.warning) rows.push(...wrap(data.warning, w).map(v => row(v, 'warn')));
  rows.push(row(`  ${fit('PROTO', 7)}${fit('PORT', 8)}${fit('PID', 9)}ADDRESS / PROCESS`, 'muted'));
  const ports = visiblePorts(state);
  if (!ports.length) rows.push(row(state.busy ? 'Reading listeners...' : 'No listeners match this filter.', 'muted'));
  return [...rows, ...table(state, ports, Math.max(1, h - rows.length - 1), item =>
    `${fit(item.protocol, 7)}${fit(item.port, 8)}${fit(item.pid ?? '-', 9)}${item.address}${item.process ? '  ' + item.process : ''}`)];
}
export function visiblePorts(state) {
  const filter = (state.portFilter || '').toLowerCase();
  return (state.ports?.ports || []).filter(p => `${p.port} ${p.pid} ${p.address} ${p.process || ''}`.toLowerCase().includes(filter));
}

function diskRows(state, w, h) {
  const disk = state.disk;
  const rows = [row('STORAGE & CLEANUP', 'accent'), row(disk?.root || state.root, 'muted'),
    row('[S] Choose drive  [C] Cleanup plan  [H] Recovery  [R] Workspace scan', 'muted'), row()];
  if (!disk) return [...rows, row(state.busy ? 'Measuring folders...' : 'Press R to measure this workspace.', 'muted')];
  rows.push(row(`${bytes(disk.totalBytes)} measured  /  ${plural(disk.totalFiles, 'file')}  /  ${(disk.elapsedMs / 1000).toFixed(1)}s`, 'heading'));
  if (disk.truncated) rows.push(row(disk.cancelled ? 'Scan cancelled: partial results shown.' : 'Partial scan: the time or file limit was reached.', 'warn'));
  if (disk.skipped) rows.push(row(`${disk.skipped} entries skipped (permissions or unsupported files).`, 'muted'));
  if (disk.cleanupCandidates) rows.push(row(`${disk.cleanupCandidates.length} old temporary files eligible for review. [C]`, 'accent'));
  rows.push(row('  SIZE        SHARE            ITEM', 'muted'));
  return [...rows, ...table(state, disk.entries || [], Math.max(1, h - rows.length - 1), item =>
    `${fit(bytes(item.bytes), 12)}${meter(item.bytes, disk.totalBytes, 12)}  ${item.name}`)];
}

function scriptRows(state, w, h) {
  const rows = [row('PROJECT TASKS', 'accent'), row('Named scripts from this folder\'s package.json.', 'muted'),
    row('[Enter] Review & run   [R] Refresh', 'muted'), row()];
  if (!state.scripts?.length) return [...rows, row('No npm scripts in this folder.', 'muted'),
    ...wrap('Open Jarvis in a Node project to see its build, test and development tasks here.', w).map(v => row(v, 'muted'))];
  rows.push(row('  TASK                 COMMAND', 'muted'));
  return [...rows, ...table(state, state.scripts, Math.max(1, h - rows.length - 1), item => `${fit(item.name, 21)}${item.command}`)];
}

function recipeRows(state, w, h) {
  const list = state.recipes || [];
  const selected = list[selection(state)] || list[0];
  const rows = [row('THE TOOLBOX', 'accent'), row('Choose the outcome. Jarvis opens the right tool.', 'muted'), row('[Enter] Open tool   [E] Explain the equivalent command', 'muted'), row()];
  const space = Math.max(1, h - rows.length - 5);
  rows.push(...table(state, list, space, item => `${fit(item.category, 12)}${item.title}`));
  if (selected) rows.push(row(), ...wrap(selected.description, w).slice(0, 3).map(v => row(v, 'muted')));
  return rows;
}

function controlRows(state, w, h) {
  const { network, audio, security, settings } = state.control || {};
  const connected = network?.adapters?.find(item => item.profile) || network?.adapters?.[0];
  const plan = settings?.powerPlans?.find(item => item.active);
  const rows = [row('CONTROL CENTER', 'accent'), row('Your computer. Familiar controls. Explicit review.', 'muted'),
    row('[Enter] Actions   [W] Wi-Fi   [V] Sound   [S] Security', 'muted'), row()];
  rows.push(row(`NETWORK  ${network?.available ? `${connected?.name || 'No adapters'}  ${connected?.profile || connected?.status || ''}` : network ? 'Unavailable on this session' : 'Reading...'}`));
  rows.push(row(`SOUND    ${audio?.available ? `${Math.round(audio.volume)}%  ${audio.muted ? 'Muted' : 'Unmuted'}` : audio ? 'Unavailable on this session' : 'Reading...'}`));
  rows.push(row(`SECURITY ${security?.available ? `Defender ${security.enabled === true ? 'enabled' : security.enabled === false ? 'disabled' : 'unknown'}  /  Real-time ${security.realtimeEnabled === true ? 'on' : security.realtimeEnabled === false ? 'off' : 'unknown'}` : security ? 'Open Security for availability details' : 'Reading...'}`, security?.available && security.realtimeEnabled === false ? 'warn' : 'normal'));
  rows.push(row(`POWER    ${plan?.name || settings?.powerPlanError || (settings ? 'Use native settings' : 'Reading...')}`));
  rows.push(row(), row('CHOOSE A CONTROL', 'accent'));
  rows.push(...table(state, CONTROL_ITEMS, Math.max(1, h - rows.length - 2), item => `${item.title}${w > 65 ? '  /  ' + item.description : ''}`));
  return rows;
}

const hardwareStatuses = { ok: 'Observed', warning: 'Needs attention', critical: 'Critical', unknown: 'Unknown', absent: 'Not present' };
const hardwareTone = status => ({ ok: 'normal', warning: 'warn', critical: 'bad', unknown: 'muted', absent: 'muted' }[status] || 'muted');
const hardwareValue = value => value === null || value === undefined || value === '' || typeof value === 'object' ? 'Unknown' : clean(value);
const hardwareStatus = status => hardwareStatuses[status] || 'Unknown';

/** Shared by the terminal detail viewer and plain-text CLI report. */
export function hardwareComponentText(component) {
  if (!component) return 'Select a component to inspect its readings.';
  const lines = [
    clean(component.title), `Status: ${hardwareStatus(component.status)}`, clean(component.summary || ''),
    '', 'WHAT WAS REPORTED',
  ];
  const readings = [...(component.metrics || []), ...(component.details || [])];
  if (!readings.length) lines.push('No readings were reported for this component.');
  for (const item of readings) {
    lines.push(`${clean(item.label)}: ${hardwareValue(item.value)}`);
    if (item.note) lines.push(`  ${clean(item.note)}`);
  }
  if (component.findings?.length) {
    lines.push('', 'FINDINGS AND NEXT STEPS');
    for (const item of component.findings) {
      lines.push(`${clean(item.severity || 'info').toUpperCase()}: ${clean(item.title)}`);
      if (item.explanation) lines.push(clean(item.explanation));
      if (item.recommendation) lines.push(`Next step: ${clean(item.recommendation)}`);
      lines.push('');
    }
  }
  if (component.devices?.length) {
    lines.push('', 'DEVICES');
    for (const item of component.devices) {
      lines.push(clean(item.name));
      if (item.status) lines.push(`Status reported: ${clean(item.status)}`);
      for (const detail of item.details || []) lines.push(`  ${clean(detail.label)}: ${hardwareValue(detail.value)}`);
      lines.push('');
    }
  }
  if (component.limitations?.length) lines.push('', 'WHAT THIS VIEW CANNOT CONFIRM', ...component.limitations.map(value => `- ${clean(value)}`));
  return lines.join('\n');
}

export function hardwareReportText(snapshot) {
  if (!snapshot) return 'Hardware readings have not been collected.';
  return [
    `INSIDE YOUR PC${snapshot.demo ? ' / DEMO DATA' : ''}`,
    `Sampled: ${hardwareValue(snapshot.sampledAt)}  /  Platform: ${hardwareValue(snapshot.platform)}`,
    `${snapshot.summary?.attention ?? 0} need attention / ${snapshot.summary?.observed ?? 0} observed / ${snapshot.summary?.unknown ?? 0} unknown`,
    'Observed means data was reported; it does not certify hardware health.',
    '', ...(snapshot.components || []).map(hardwareComponentText),
    '', 'REPORT LIMITATIONS', ...(snapshot.limitations || []).map(value => `- ${clean(value)}`),
    '', 'Open jarvis and press I for component details, or use jarvis --web.',
  ].join('\n');
}

function hardwareRows(state, w, h) {
  const snapshot = state.hardware;
  const rows = [row('INSIDE YOUR PC', 'accent'), row('[Up/Down] Select  [Enter] Details  O Tools  R Refresh', 'muted')];
  if (!snapshot) return [...rows, row(), row(state.busy ? 'Reading hardware reported by your operating system...' : 'Press R to read available hardware information.', 'muted'),
    ...wrap('Read-only inspection. Unavailable sensors remain Unknown.', w).map(value => row(value, 'muted'))];
  const components = snapshot.components || [];
  const sampled = new Date(snapshot.sampledAt);
  rows.push(row(`Sampled ${Number.isFinite(sampled.getTime()) ? sampled.toLocaleTimeString() : 'Unknown'} / Read-only snapshot`, 'muted'));
  const selected = components[Math.min(selection(state), Math.max(0, components.length - 1))];
  rows.push(row(`${snapshot.summary?.attention ?? 0} need attention  /  ${snapshot.summary?.observed ?? 0} observed  /  ${snapshot.summary?.unknown ?? 0} unknown`, snapshot.summary?.attention ? 'warn' : 'muted'));
  if (h >= 18) rows.push(row('Observed is a reading, not a hardware health certificate.', 'muted'));
  rows.push(row());
  const visible = Math.max(1, h - rows.length - 7);
  const titleWidth = Math.min(23, Math.max(16, Math.floor(w * .4)));
  rows.push(...table(state, components, visible, item => `${fit(item.title, titleWidth)} ${hardwareStatus(item.status)}`));
  if (selected) {
    rows.push(row(), row(selected.title, 'accent'));
    rows.push(...wrap(selected.summary || hardwareStatus(selected.status), w).slice(0, 2).map(value => row(value, hardwareTone(selected.status))));
    const metric = selected.metrics?.[0];
    if (metric) rows.push(row(`${metric.label}: ${hardwareValue(metric.value)}`, 'heading'));
    rows.push(row('Enter opens all readings, findings, devices and limits.', 'muted'));
  }
  return rows;
}

function modalRows(state, w, h) {
  const m = state.modal;
  const rows = [row(m.title.toUpperCase(), m.type === 'confirm' ? 'warn' : 'accent'), row()];
  if (m.type === 'confirm') {
    const details = String(m.detail || '').split('\n').flatMap(value => wrap(value, w));
    const available = Math.max(1, h - rows.length - 3);
    const start = Math.min(m.offset || 0, Math.max(0, details.length - available));
    return [...rows, ...details.slice(start, start + available).map(value => row(value, 'muted')), row(),
      ...(details.length > available ? [row(`[Up/Down] Review ${start + 1}-${Math.min(start + available, details.length)} of ${details.length} lines`, 'muted')] : []),
      row('Continue? [Y] Yes   [N / Esc / Enter] Cancel', 'heading')];
  }
  if (m.detail) rows.push(...String(m.detail).split('\n').flatMap(v => wrap(v, w)).slice(0, Math.max(2, h - 10)).map(v => row(v, 'muted')), row());
  if (m.type === 'text') {
    const lines = String(m.content || '').split(/\r?\n/).flatMap(line => wrap(line, w));
    const start = Math.min(m.offset || 0, Math.max(0, lines.length - (h - 5)));
    return [...rows, ...lines.slice(start, start + h - rows.length - 2).map(v => row(v)), row(`[Up/Down] Scroll   ${m.continue ? `[Enter] ${m.continueLabel || 'Continue'}   ` : ''}[Esc] Close`, 'muted')];
  }
  rows.push(row(m.label || 'Type here', 'heading'), row('> ' + (m.value || '') + '_', 'selected'), row());
  if (m.type === 'palette') {
    const matches = m.choices.filter(v => `${v.title} ${v.description || ''}`.toLowerCase().includes((m.value || '').toLowerCase()));
    const available = Math.max(1, h - rows.length - 2);
    const start = Math.max(0, (m.choice || 0) - available + 1);
    rows.push(...matches.slice(start, start + available).map((v, i) => row(`${i + start === (m.choice || 0) ? '>' : ' '} ${v.title}`, i + start === (m.choice || 0) ? 'selected' : 'normal')));
    if (!matches.length) rows.push(row('No matching task. Try search, files, Git, ports or disk.', 'muted'));
  }
  rows.push(row('[Enter] Continue   [Esc] Cancel', 'muted'));
  return rows;
}

const screens = { overview: overviewRows, files: fileRows, search: searchRows, git: gitRows, processes: processRows,
  ports: portRows, disk: diskRows, scripts: scriptRows, recipes: recipeRows, control: controlRows, hardware: hardwareRows };

function navigationRows(state, h) {
  const rows = Array.from({ length: h }, () => row());
  const count = Math.min(NAV.length, Math.max(1, h - 2));
  const selected = Math.max(0, NAV.findIndex(([id]) => id === state.screen));
  const start = Math.max(0, Math.min(selected - Math.floor(count / 2), NAV.length - count));
  rows[0] = row(count < NAV.length ? `  TOOLS  ${start + 1}-${start + count}/${NAV.length}` : '  YOUR WORKSPACE', 'muted');
  NAV.slice(start, start + count).forEach(([id, label], offset) => {
    const shortcut = id === 'hardware' ? 'I' : (start + offset + 1) % 10;
    rows[offset + 2] = row(` ${state.screen === id ? '>' : ' '} ${shortcut}  ${label}`, state.screen === id ? 'selected' : 'normal');
  });
  if (h >= NAV.length + 7) {
    rows[NAV.length + 4] = row('  Ctrl+P  Find a task', 'accent');
    rows[NAV.length + 5] = row('  B       Browser', 'muted');
    rows[NAV.length + 6] = row('  $       Support', 'muted');
  }
  if (h >= NAV.length + 11) {
    rows[h - 3] = row('  No API key', 'muted');
    rows[h - 2] = row('  No telemetry', 'muted');
  }
  return rows;
}

/** Pure terminal renderer. Untrusted filenames, process names and output are sanitized. */
export function renderDashboard(state, columns = 110, lines = 32, { color = true, ascii = false } = {}) {
  const w = Math.max(24, Math.floor(columns));
  const h = Math.max(10, Math.floor(lines));
  const paint = (value, tone = 'normal', surface = 'canvas') => color
    ? (surfaces[tone === 'selected' ? 'selected' : surface] || surfaces.canvas) + (theme[tone] || theme.normal) + value + '\x1b[0m'
    : value;
  const line = ascii ? '-' : '\u2500';
  const vertical = ascii ? '|' : '\u2502';
  if (w < 56 || h < 17) {
    return [paint(fit('JARVIS / TERMINAL WORKBENCH', w), 'heading'), '',
      fit('Terminal too small for the dashboard.', w), fit('Resize to at least 56 x 17.', w), '',
      fit('Or use: jarvis status / search / files', w), fit('Press Q to quit.', w)].join('\r\n');
  }
  const side = w >= 100 ? 24 : w >= 88 ? 21 : 0;
  const contentWidth = w - side - (side ? 4 : 2);
  const bodyHeight = h - 7;
  const nav = NAV.find(v => v[0] === state.screen) || NAV[0];
  const body = state.modal ? modalRows(state, contentWidth, bodyHeight) : (screens[state.screen] || overviewRows)(state, contentWidth, bodyHeight);
  const rail = navigationRows(state, bodyHeight);
  const frame = [];
  frame.push(paint(fit('  JARVIS  /  WORKBENCH', w - 15), 'heading', 'header') +
    paint(fit(state.demo ? 'DEMO SESSION' : 'LOCAL SESSION', 15), state.demo ? 'warn' : 'key', 'header'));
  const breadcrumb = side ? `  ${nav[1]}   /   ${state.root}` : `  ${nav[1]}  /  ${state.root}`;
  frame.push(paint(fit(breadcrumb, w), 'muted', 'header'));
  // A quiet accent rule instead of animation; monochrome and ASCII are equivalent.
  if (color) {
    let rule = '';
    for (let offset = 0; offset < w; offset += 8) {
      const fraction = offset / Math.max(1, w - 1);
      const rgb = [112, 113, 245].map((value, index) => Math.round(value + ([68, 214, 222][index] - value) * fraction));
      rule += surfaces.canvas + `\x1b[38;2;${rgb.join(';')}m` + line.repeat(Math.min(8, w - offset));
    }
    frame.push(rule + '\x1b[0m');
  } else frame.push(line.repeat(w));
  for (let i = 0; i < bodyHeight; i++) {
    const sidebar = rail[i] || row();
    const item = body[i] || row();
    const tone = i === 0 && ['accent', 'heading'].includes(item.tone) ? 'heading' : item.tone;
    frame.push((side ? paint(fit(sidebar.text, side), sidebar.tone, 'rail') + paint(vertical, 'border') + paint('  ') : paint(' ')) +
      paint(fit(item.text, contentWidth), tone) + paint(' '));
  }
  frame.push(paint(line.repeat(w), 'border'));
  const status = state.busy ? 'WORKING' : state.message?.tone === 'bad' ? 'ERROR' : state.message?.tone === 'warn' ? 'NOTICE' : 'READY';
  const statusTone = state.busy ? 'key' : state.message?.tone || 'muted';
  const statusLabel = fit(`  ${status}`, 11);
  const cancel = state.busy ? `  [Esc] ${state.scanMonitoring ? 'Stop monitoring' : 'Cancel'} ` : '';
  const message = state.busy || state.message?.text || 'Choose a tool, or use Ctrl+P to find a task.';
  frame.push(paint(statusLabel, statusTone, 'footer') + paint(fit(message, w - 11 - width(cancel)), statusTone, 'footer') +
    paint(cancel, 'key', 'footer'));
  const hints = w >= 100
    ? ['Q Quit', '1-9 Tools', '0 Controls', 'I Inside PC', 'Enter Open', 'B Web', 'A Logs', '$ Support', 'R Refresh']
    : w >= 72 ? ['Q Quit', '0 Controls', 'I Inside PC', 'B Web', 'A Logs', '$ Support', 'Ctrl+P Tasks']
      : ['Q Quit', 'I PC', '0 Controls', 'B Web', 'A Logs', '$ Support', 'Ctrl+P'];
  const separator = w < 72 ? ' ' : '  ';
  const hintText = '  ' + hints.join(separator);
  let hintRow = paint('  ', 'muted', 'footer');
  for (const [index, hint] of hints.entries()) {
    const split = hint.indexOf(' ');
    const key = split < 0 ? hint : hint.slice(0, split);
    const label = split < 0 ? '' : hint.slice(split);
    if (index) hintRow += paint(separator, 'muted', 'footer');
    hintRow += paint(key, 'key', 'footer') + paint(label, 'muted', 'footer');
  }
  frame.push(width(hintText) > w ? paint(fit(hintText, w), 'muted', 'footer') : hintRow + paint(fit('', w - width(hintText)), 'muted', 'footer'));
  frame.push(paint(fit(`  ${state.lastRefresh ? 'Updated ' + new Date(state.lastRefresh).toLocaleTimeString() : 'Local workspace'}${state.lastFetch ? '  /  Remote checked ' + new Date(state.lastFetch).toLocaleTimeString() : '  /  Network checks are manual'}`, w), 'muted'));
  return frame.join('\r\n');
}
