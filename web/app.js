/* Jarvis web client. All user/project data is rendered as text, never HTML. */
'use strict';

const ICONS = {
  grid: ['M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],
  folder: ['M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z'],
  file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6M8 13h8M8 17h5'],
  search: ['M21 21l-4.35-4.35', 'M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z'],
  branch: ['M6 3v12a3 3 0 1 0 3 3M6 6a3 3 0 1 0 0-6 3 3 0 0 0 0 6M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6M18 9a9 9 0 0 1-9 9'],
  cpu: ['M8 8h8v8H8zM4 4h16v16H4zM8 1v3M16 1v3M8 20v3M16 20v3M1 8h3M1 16h3M20 8h3M20 16h3'],
  network: ['M9 2h6v6H9zM3 16h6v6H3zM15 16h6v6h-6zM12 8v4M6 16v-4h12v4'],
  drive: ['M4 3h16l2 13v5H2v-5L4 3ZM2 16h20M6 19h.01M10 19h.01'],
  terminal: ['M3 4h18v16H3zM7 8l4 4-4 4M14 16h3'],
  activity: ['M2 12h4l3-9 5 18 3-9h5'],
  sparkles: ['m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7L12 3ZM3 2v4M1 4h4M20 18v4M18 20h4'],
  heart: ['M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z'],
  shield: ['M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6l-9-4Z', 'm8 12 3 3 5-6'],
  arrow: ['M4 12h16m-6-6 6 6-6 6'],
  upload: ['M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5'],
  download: ['M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5'],
  cloud: ['M7 18h11a4 4 0 0 0 .5-8A7 7 0 0 0 5 8a5 5 0 0 0 2 10Z'],
  refresh: ['M3 11a9 9 0 0 1 15-6l3 3M21 3v5h-5M21 13A9 9 0 0 1 6 19l-3-3M3 21v-5h5'],
  chevron: ['m9 5 7 7-7 7'],
  back: ['m15 5-7 7 7 7'],
  check: ['m5 12 4 4L19 6'],
  info: ['M12 16v-4M12 8h.01', 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z'],
  clock: ['M12 7v5l3 2', 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z'],
  close: ['m6 6 12 12M6 18 18 6'],
  play: ['m7 3 14 9-14 9V3Z'],
  copy: ['M9 9h12v12H9zM5 15H3V3h12v2'],
  box: ['m12 2 10 5v10l-10 5-10-5V7l10-5ZM2 7l10 5 10-5M12 12v10M7 4.5l10 5'],
  undo: ['M3 9h11a7 7 0 0 1 0 14M3 9l5-5M3 9l5 5'],
  trash: ['M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7'],
  alert: ['m12 3 10 18H2L12 3ZM12 9v5M12 18h.01'],
  leaf: ['M20 3C6 1 1 9 6 17s18 2 14-14ZM5 21 16 9'],
  external: ['M14 3h7v7M21 3 10 14M10 3H3v18h18v-7'],
};
const NAV = [
  { id: 'overview', title: 'Overview', icon: 'grid', group: 'Workspace', description: 'Your workspace at a glance' },
  { id: 'files', title: 'Files', icon: 'folder', description: 'Browse folders and preview files' },
  { id: 'search', title: 'Search', icon: 'search', description: 'Find words, patterns, and code' },
  { id: 'git', title: 'Git & sync', icon: 'branch', description: 'Review, save, and upload your work' },
  { id: 'processes', title: 'Processes', icon: 'cpu', group: 'Your computer', description: 'See what is running' },
  { id: 'ports', title: 'Ports', icon: 'network', description: 'Find what is using a port' },
  { id: 'storage', title: 'Storage', icon: 'drive', description: 'Understand space and clean up safely' },
  { id: 'scripts', title: 'Project tasks', icon: 'terminal', group: 'Tools', description: 'Run your project’s named commands' },
  { id: 'activity', title: 'Activity', icon: 'activity', description: 'A record of your local actions' },
];
const COLORS = ['#799f59', '#a7bf7a', '#c5d7a3', '#d5c692', '#9fbaa1', '#758b69', '#e4e9db'];
const state = {
  screen: 'overview', root: '', overview: null, about: null, activity: [], git: null,
  files: null, filePath: '', fileFilter: '', search: { q: '', regex: false, caseSensitive: false, glob: '', result: null },
  processes: null, processFilter: '', processSort: 'memory', ports: null, portFilter: '', scripts: [], recipes: [],
  storage: { locations: [], history: [], path: '', scan: null, selected: new Set(), tab: 'overview', stale: false },
  activeJob: null, jobs: new Map(), loading: false, requestId: 0, controller: null, toastTimer: null,
};
const $ = selector => document.querySelector(selector);
const page = $('#page');
const modal = $('#modal');
let token = '';

function icon(name, className = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `icon ${className}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  for (const line of ICONS[name] || ICONS.file) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', line);
    svg.append(path);
  }
  return svg;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (['value', 'checked', 'disabled', 'hidden', 'selected'].includes(key)) node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function replace(node, ...children) {
  node.replaceChildren(...children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false));
}
function setPage(...children) { replace(page, ...children); }

function button(text, name, onClick, variant = '', attrs = {}) {
  return el('button', { type: 'button', class: `button ${variant}`.trim(), onClick, ...attrs }, name ? icon(name) : null, text);
}
function iconButton(name, label, onClick) {
  return el('button', { type: 'button', class: 'icon-button', 'aria-label': label, title: label, onClick }, icon(name));
}
function textButton(text, onClick, name = 'arrow') {
  return el('button', { type: 'button', class: 'text-button', onClick }, text, name ? icon(name) : null);
}
function bytes(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n === 0) return '0 B';
  const index = Math.min(4, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** index).toLocaleString(undefined, { maximumFractionDigits: index ? digits : 0 })} ${['B', 'KB', 'MB', 'GB', 'TB'][index]}`;
}
const number = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString() : '—';
const basename = value => String(value || '').replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || value || 'Workspace';
function timestamp(value) {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function relativeTime(value) {
  const difference = Date.now() - new Date(value || '').getTime();
  if (!Number.isFinite(difference)) return '—';
  if (difference < 60000) return 'Just now';
  if (difference < 3600000) return `${Math.floor(difference / 60000)}m ago`;
  if (difference < 86400000) return `${Math.floor(difference / 3600000)}h ago`;
  return timestamp(value);
}
function duration(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
}
function badge(text, tone = '', name) { return el('span', { class: `badge ${tone}` }, name ? icon(name) : null, text); }
function notice(text, tone = '', name = 'info') { return el('div', { class: `notice ${tone}`, role: tone === 'error' ? 'alert' : 'note' }, icon(name), el('span', {}, text)); }

async function api(endpoint, { method = 'GET', body, signal } = {}) {
  if (!token) throw new Error('Open Jarvis from your terminal to connect this browser securely.');
  let response;
  try {
    response = await fetch(endpoint, {
      method, signal, credentials: 'omit', cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('The local server is not responding. Keep Jarvis running in your terminal, then try again.');
  }
  let value;
  try { value = await response.json(); } catch { throw new Error('The local server returned an unreadable response.'); }
  if (!response.ok) {
    const error = new Error(value.error || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return value;
}

function toast(message, error = false) {
  const node = $('#toast');
  node.textContent = message;
  node.className = `toast${error ? ' error' : ''}`;
  node.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { node.hidden = true; }, error ? 6500 : 3600);
}
function report(error) { if (error?.name !== 'AbortError') toast(error?.message || String(error), true); }
function handle(fn) { return event => Promise.resolve().then(() => fn(event)).catch(report); }

function heading(title, description, actions = [], eyebrow = 'Your local workbench') {
  return el('div', { class: 'page-heading' }, el('div', {}, el('p', { class: 'eyebrow' }, eyebrow), el('h1', {}, title), el('p', { class: 'page-description' }, description)), actions.length ? el('div', { class: 'heading-actions' }, actions) : null);
}
function panel(title, subtitle, content, action = null, className = '') {
  return el('section', { class: `panel ${className}` }, el('div', { class: 'panel-header' }, el('div', {}, el('h2', {}, title), subtitle ? el('p', { class: 'panel-subtitle' }, subtitle) : null), action), el('div', { class: 'panel-body' }, content));
}
function empty(title, description, name = 'folder', action = null, compact = false) {
  return el('div', { class: `empty-state${compact ? ' compact' : ''}` }, el('div', { class: 'empty-icon' }, icon(name)), el('h3', {}, title), el('p', {}, description), action);
}
function table(headers, rows, foot = '') {
  return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, headers.map(header => el('th', { scope: 'col' }, header)))), el('tbody', {}, rows))), foot ? el('div', { class: 'table-end' }, el('span', {}, foot)) : null);
}
function metric(label, value, note, name, good = false) {
  return el('div', { class: 'metric' }, el('div', { class: 'metric-label' }, label, el('span', { class: 'metric-icon' }, icon(name))), el('div', { class: 'metric-value' }, value), el('p', { class: `metric-note${good ? ' good' : ''}` }, note));
}
function definition(entries) {
  const list = el('dl', { class: 'definition-list' });
  for (const [name, value] of entries) list.append(el('dt', {}, name), el('dd', {}, value ?? '—'));
  return list;
}
function donut(parts, label, caption, large = false) {
  const holder = el('div', { class: `donut${large ? ' large' : ''}`, 'aria-label': `${label} ${caption}` });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('aria-hidden', 'true');
  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  ring.setAttribute('cx', '60'); ring.setAttribute('cy', '60'); ring.setAttribute('r', '49'); ring.setAttribute('stroke', '#edf1e4');
  svg.append(ring);
  const circumference = Math.PI * 98;
  const total = parts.reduce((sum, part) => sum + Math.max(0, Number(part.value) || 0), 0);
  let offset = 0;
  parts.forEach((part, index) => {
    const fraction = total > 0 ? Math.max(0, Number(part.value) || 0) / total : 0;
    if (!fraction) return;
    const arc = ring.cloneNode();
    arc.setAttribute('stroke', part.color || COLORS[index % COLORS.length]);
    arc.setAttribute('stroke-dasharray', `${Math.max(0, fraction * circumference - (parts.length > 1 ? 3 : 0))} ${circumference}`);
    arc.setAttribute('stroke-dashoffset', String(-offset * circumference));
    svg.append(arc); offset += fraction;
  });
  holder.append(svg, el('span', { class: 'donut-label' }, label, el('small', {}, caption)));
  return holder;
}

function renderNavigation() {
  const nav = $('#nav'); nav.replaceChildren();
  NAV.forEach(item => {
    if (item.group) nav.append(el('div', { class: 'nav-label' }, item.group));
    const count = item.id === 'git' ? state.git?.changes?.length : null;
    nav.append(el('button', { type: 'button', class: `nav-item${state.screen === item.id ? ' active' : ''}`, 'aria-current': state.screen === item.id ? 'page' : null, title: item.title, 'aria-label': item.title, onClick: () => navigate(item.id) }, icon(item.icon), el('span', { class: 'nav-text' }, item.title), count ? el('span', { class: 'nav-count' }, count > 999 ? '999+' : count) : null));
  });
  $('#breadcrumb-screen').textContent = NAV.find(item => item.id === state.screen)?.title || 'Overview';
  $('#workspace-name').textContent = basename(state.root);
  $('#breadcrumb-workspace').textContent = basename(state.root);
  $('#workspace-platform').textContent = state.overview?.system ? `${({ win32: 'Windows', darwin: 'macOS', linux: 'Linux' })[state.overview.system.platform] || state.overview.system.platform} · local workspace` : 'On your computer';
  document.title = `${NAV.find(item => item.id === state.screen)?.title || 'Overview'} · Jarvis`;
}

function renderLoading(screen) {
  const item = NAV.find(entry => entry.id === screen);
  setPage(heading(item?.title || 'Workspace', item?.description || ''), el('div', { class: 'panel loading-state', role: 'status' }, el('span', { class: 'spinner' }), el('p', {}, `Reading ${item?.title.toLowerCase() || 'your workspace'}…`)));
}
function renderError(error) {
  const disconnected = !token || error.status === 401;
  setPage(el('section', { class: 'panel error-page' }, icon(disconnected ? 'shield' : 'alert'), el('h2', {}, disconnected ? 'Connect your local workspace' : 'We couldn’t load this view'), el('p', {}, error.message), disconnected ? el('code', {}, 'jarvis --web') : null, button(disconnected ? 'Try reconnecting' : 'Try again', 'refresh', () => navigate(state.screen), 'primary')));
}
function renderCurrent() {
  renderNavigation();
  const renderers = { overview: renderOverview, files: renderFiles, search: renderSearch, git: renderGit, processes: renderProcesses, ports: renderPorts, storage: renderStorage, scripts: renderScripts, activity: renderActivity };
  renderers[state.screen]?.();
}
async function navigate(screen, { quiet = false } = {}) {
  if (!NAV.some(item => item.id === screen)) screen = 'overview';
  state.controller?.abort();
  state.controller = new AbortController();
  const requestId = ++state.requestId;
  state.screen = screen; state.loading = true;
  renderNavigation();
  if (!quiet) renderLoading(screen);
  try {
    const signal = state.controller.signal;
    if (screen === 'overview') {
      state.overview = await api('/api/overview', { signal });
      state.root = state.overview.root || state.root; state.git = state.overview.git;
      const results = await Promise.allSettled([api('/api/activity', { signal }), api('/api/about', { signal })]);
      if (results[0].status === 'fulfilled') state.activity = Array.isArray(results[0].value) ? results[0].value : [];
      if (results[1].status === 'fulfilled') { state.about = results[1].value; $('#footer-version').textContent = `${state.about.name || 'Jarvis Workbench'} ${state.about.version ? `v${state.about.version}` : ''}`; }
    } else if (screen === 'files') state.files = await api(`/api/files?path=${encodeURIComponent(state.filePath)}`, { signal });
    else if (screen === 'git') state.git = await api('/api/git', { signal });
    else if (screen === 'processes') state.processes = await api('/api/processes', { signal });
    else if (screen === 'ports') state.ports = await api('/api/ports', { signal });
    else if (screen === 'scripts') state.scripts = await api('/api/scripts', { signal });
    else if (screen === 'activity') state.activity = await api('/api/activity', { signal });
    else if (screen === 'storage') {
      const [locations, history] = await Promise.all([api('/api/storage/locations', { signal }), api('/api/storage/history', { signal })]);
      state.storage.locations = Array.isArray(locations) ? locations : locations.locations || [];
      state.storage.history = Array.isArray(history) ? history : history.records || history.history || [];
      if (!state.storage.path || (state.overview?.demo && state.storage.path === state.root)) state.storage.path = state.overview?.demo ? state.storage.locations[0]?.path || '' : state.root || state.storage.locations[0]?.path || '';
    }
    if (requestId !== state.requestId) return;
    state.loading = false; renderCurrent();
    if (!quiet) window.scrollTo({ top: 0, behavior: 'instant' });
  } catch (error) {
    if (error.name === 'AbortError' || requestId !== state.requestId) return;
    state.loading = false; renderError(error);
  }
}

function gitLabel(git) {
  if (!git?.isRepo) return 'No Git repository';
  if (git.conflicts) return 'Conflicts need attention';
  if (git.operation) return `${git.operation} in progress`;
  if (git.changes?.length) return `${number(git.changes.length)} files to save`;
  if (git.ahead) return `${number(git.ahead)} commits to upload`;
  if (git.behind) return `${number(git.behind)} updates to download`;
  if (!git.upstream) return 'No upstream branch';
  return 'Matches last fetched remote';
}
function gitSummaryCard() {
  const git = state.git;
  if (!git?.isRepo) return panel('A home for your work', 'Git & sync', empty('No Git repository here', 'Open a Git project to review changes and upload saved commits.', 'branch', button('Explore files', 'folder', () => navigate('files')), true));
  const body = el('div', {},
    el('div', { class: 'repo-line' }, el('span', { class: 'repo-logo' }, icon('folder')), el('div', { class: 'repo-info' }, el('strong', {}, basename(git.root || state.root)), el('small', { title: git.root || state.root }, git.remoteUrl || git.root || 'Local repository')), badge(git.branch || 'Detached', '', 'branch')),
    el('div', { class: 'sync-steps' },
      el('div', { class: 'sync-step' }, el('span', { class: 'sync-step-icon' }, icon('file')), el('strong', {}, `${number(git.changes?.length || 0)} changed`), el('small', {}, 'In your workspace')),
      el('div', { class: 'sync-step' }, el('span', { class: 'sync-step-icon' }, icon('check')), el('strong', {}, git.lastCommit ? 'Saved locally' : 'No commits yet'), el('small', {}, git.lastCommit?.hash || 'Your next milestone')),
      el('div', { class: 'sync-step' }, el('span', { class: 'sync-step-icon' }, icon('cloud')), el('strong', {}, git.ahead ? `${git.ahead} to upload` : git.upstream ? 'Remote tracked' : 'Not connected'), el('small', {}, git.upstream || 'Set up an upstream'))),
    el('div', { class: 'sync-note' }, icon('info'), 'Remote status reflects your last fetch.'));
  const card = panel('Your project, in sync', 'A clear path from local changes to saved work.', body, badge(git.changes?.length ? 'Changes pending' : 'Working tree clean', git.changes?.length ? 'warn' : 'good'));
  card.append(el('div', { class: 'panel-footer' }, el('span', {}, git.lastCommit ? `Last save · ${git.lastCommit.subject}` : 'Start with a local commit.'), textButton('Open Git & sync', () => navigate('git'))));
  return card;
}
function activityPreview() {
  const items = (Array.isArray(state.activity) ? state.activity : []).slice(0, 3);
  return items.length ? el('div', { class: 'activity-preview' }, items.map(item => el('div', { class: 'activity-item' }, el('span', { class: 'activity-symbol' }, icon(item.status === 'failed' ? 'alert' : 'check')), el('div', { class: 'activity-copy' }, el('strong', {}, item.action || 'Local action'), el('p', {}, item.message || item.target || '')), el('span', { class: 'activity-time' }, relativeTime(item.time))))) : empty('A fresh workspace', 'Scans, saves, and other actions will appear here as you work.', 'activity', null, true);
}
function renderOverview() {
  const system = state.overview?.system || {};
  const git = state.git;
  const used = Math.max(0, Number(system.memoryTotal || 0) - Number(system.memoryFree || 0));
  const percentage = system.memoryTotal ? Math.round(used / system.memoryTotal * 100) : 0;
  const machine = panel('A little system clarity', 'A live snapshot of your computer.', el('div', {},
    el('div', { class: 'machine-summary' }, donut([{ value: used }, { value: system.memoryFree || 0, color: '#e6eedb' }], `${percentage}%`, 'MEMORY IN USE'), el('div', { class: 'machine-values' }, el('div', {}, el('span', { class: 'legend-dot swatch-0' }), el('small', {}, 'In use'), el('strong', {}, bytes(used))), el('div', {}, el('span', { class: 'legend-dot swatch-6' }), el('small', {}, 'Available'), el('strong', {}, bytes(system.memoryFree))))),
    el('div', { class: 'machine-specs' }, el('span', {}, icon('cpu'), `${number(system.cpus)} CPU cores`), el('span', {}, icon('clock'), `Up ${duration(system.uptime)}`))), textButton('Details', () => navigate('processes')));
  const storage = panel('Room for what’s next', '', el('div', {}, el('div', {}, el('p', {}, 'See where your space goes. Review old temporary files before moving anything.'), textButton('Explore storage', () => navigate('storage'))), el('div', { class: 'storage-illustration', 'aria-hidden': 'true' })), badge('ON YOUR DEVICE', ''), 'storage-teaser');
  const storageBody = storage.querySelector('.panel-body');
  storageBody.replaceChildren(...storageBody.firstChild.childNodes);
  const quick = (title, description, name, screen) => el('button', { type: 'button', class: 'quick-action', onClick: () => navigate(screen) }, el('span', { class: 'quick-action-icon' }, icon(name)), el('span', {}, el('strong', {}, title), el('p', {}, description)), icon('arrow'));
  setPage(
    heading('Your workspace, at a glance.', 'Less command line to remember. More room to get things done.', [button('Toolbox', 'sparkles', handle(openToolbox)), button('Refresh', 'refresh', () => navigate('overview'), 'primary')], 'A little clarity. A lot less friction.'),
    state.overview?.demo ? notice('Demo workspace — all sample data is labeled. Local actions are disabled by the server.', 'warning') : null,
    state.overview?.activityWarning ? notice(state.overview.activityWarning, 'warning') : null,
    el('div', { class: 'metrics' }, metric('Files to save', git?.isRepo ? number(git.changes?.length || 0) : '—', git?.isRepo ? (git.clean ? 'Your working tree is clean' : 'Review before you commit') : 'Open a Git project to begin', 'file', !!git?.clean), metric('Ready to upload', git?.isRepo ? number(git.ahead || 0) : '—', git?.upstream ? 'Commits since last fetched remote' : 'No upstream branch configured', 'upload'), metric('Memory available', bytes(system.memoryFree), `of ${bytes(system.memoryTotal)} total memory`, 'cpu'), metric('Logical CPU cores', number(system.cpus), system.hostname || 'On your computer', 'grid')),
    el('div', { class: 'overview-grid' }, el('div', { class: 'stack' }, gitSummaryCard(), panel('Recent activity', 'Your work, with a little more visibility.', activityPreview(), textButton('View all', () => navigate('activity')))), el('div', { class: 'stack' }, machine, storage)),
    el('div', { class: 'section-caption' }, el('h2', {}, 'What would you like to do?'), el('span', { class: 'subtle', text: 'Small shortcuts. Big difference.' })),
    el('div', { class: 'quick-actions' }, quick('Find anything', 'Search text and code across your workspace.', 'search', 'search'), quick('Save & sync', 'Know what’s saved and what’s uploaded.', 'branch', 'git'), quick('Make a little room', 'Understand storage. Clean up with a plan.', 'drive', 'storage')),
  );
}

function searchField(placeholder, value, onInput, label = placeholder) {
  const input = el('input', { type: 'search', placeholder, value, 'aria-label': label, onInput: event => onInput(event.target.value) });
  return el('div', { class: 'field-search' }, icon('search'), input);
}
function renderFiles() {
  const data = state.files || { entries: [], path: '', parent: null };
  const rows = el('tbody');
  const count = el('span');
  const fill = () => {
    const filtered = data.entries.filter(item => item.name.toLowerCase().includes(state.fileFilter.toLowerCase()));
    rows.replaceChildren(...filtered.map(item => el('tr', {}, el('td', {}, el('div', { class: 'cell-name' }, icon(item.type === 'directory' ? 'folder' : 'file'), el('button', { type: 'button', onClick: handle(() => item.type === 'directory' ? (state.filePath = item.path, navigate('files')) : openPreview(item.path)) }, item.name))), el('td', {}, badge(item.type)), el('td', { class: 'nowrap' }, item.type === 'directory' ? '—' : bytes(item.size)), el('td', { class: 'nowrap' }, timestamp(item.modified)), el('td', { class: 'right' }, iconButton(item.type === 'directory' ? 'chevron' : 'search', `Open ${item.name}`, handle(() => item.type === 'directory' ? (state.filePath = item.path, navigate('files')) : openPreview(item.path)))))));
    if (!filtered.length) rows.append(el('tr', {}, el('td', { colspan: 5 }, empty(state.fileFilter ? 'No matching files' : 'This folder is empty', state.fileFilter ? 'Try another filename or clear the filter.' : 'There are no files to show in this folder.', 'folder', null, true))));
    count.textContent = `${number(filtered.length)} ${filtered.length === 1 ? 'item' : 'items'}${state.fileFilter ? ` · filtered from ${number(data.entries.length)}` : ''}`;
  };
  fill();
  const content = el('section', { class: 'panel' }, el('div', { class: 'panel-toolbar' }, el('div', { class: 'path-label' }, data.parent !== null ? iconButton('back', 'Go to parent folder', () => { state.filePath = data.parent || ''; navigate('files'); }) : icon('folder'), el('code', { title: `${state.root}/${data.path}` }, data.path || basename(state.root))), searchField('Filter this folder…', state.fileFilter, value => { state.fileFilter = value; fill(); })), el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, ['Name', 'Type', 'Size', 'Modified', ''].map(name => el('th', {}, name)))), rows)), el('div', { class: 'table-end' }, count, el('span', {}, 'Files stay within this workspace')));
  setPage(heading('A place for everything.', 'Explore folders, preview files, and get to the part of a log that matters.', [button('Refresh', 'refresh', () => navigate('files'))], 'Files & folders'), content);
}

async function openPreview(path, line = null) {
  const body = el('div', {}, el('div', { class: 'loading-state' }, el('span', { class: 'spinner' }), 'Opening preview…'));
  openModal(basename(path), body, { subtitle: path, wide: true });
  let tail = false;
  const load = async () => {
    const result = await api(`/api/preview?path=${encodeURIComponent(path)}&tail=${tail}`);
    body.replaceChildren(el('div', { class: 'preview-toolbar' }, el('span', {}, `${bytes(result.totalBytes)}${result.truncated ? ' · bounded preview' : ''}`), button(tail ? 'Show beginning' : 'Show latest lines', 'clock', handle(async () => { tail = !tail; await load(); }), 'small')));
    if (result.binary) { body.append(empty('This is a binary file', 'Preview supports text files. Open this file in the application that created it.', 'file')); return; }
    const code = el('div', { class: 'code-preview file-code' }, (result.lines || []).map(entry => el('div', { class: `code-line${line && entry.number === line ? ' highlight' : ''}` }, el('span', { class: 'code-line-number' }, entry.number ?? '·'), el('span', { class: 'code-line-text' }, entry.text || ' '))));
    body.append(code);
    if (!result.lines?.length) body.append(el('p', { class: 'muted-caption' }, 'This file has no previewable text.'));
    if (result.truncated) body.append(el('p', { class: 'muted-caption' }, 'Preview reads up to 512 KB. Open the file in your editor for its full contents.'));
    if (tail) body.append(el('p', { class: 'muted-caption' }, 'A snapshot of the latest lines. Switch views or reopen to refresh.'));
    if (line) code.querySelector('.highlight')?.scrollIntoView({ block: 'center' });
  };
  try { await load(); } catch (error) { body.replaceChildren(notice(error.message, 'error')); }
}

function renderSearch() {
  const query = el('input', { type: 'search', placeholder: 'A word, a phrase, a little clue…', value: state.search.q, 'aria-label': 'Search project contents', required: true });
  const regex = el('input', { type: 'checkbox', checked: state.search.regex, onChange: event => { state.search.regex = event.target.checked; } });
  const caseSensitive = el('input', { type: 'checkbox', checked: state.search.caseSensitive, onChange: event => { state.search.caseSensitive = event.target.checked; } });
  const glob = el('input', { type: 'text', placeholder: 'e.g. *.js', value: state.search.glob, 'aria-label': 'Filename pattern', onInput: event => { state.search.glob = event.target.value; } });
  const results = el('div', { id: 'search-results' });
  const submit = button('Find matches', 'search', null, 'primary', { type: 'submit' });
  const search = async () => {
    state.search.q = query.value.trim();
    if (!state.search.q) { query.focus(); return; }
    state.controller?.abort(); state.controller = new AbortController();
    submit.disabled = true;
    results.replaceChildren(el('div', { class: 'panel loading-state' }, el('span', { class: 'spinner' }), el('p', {}, 'Looking through your workspace…'), button('Cancel search', 'close', () => state.controller?.abort(), 'small')));
    try {
      const params = new URLSearchParams({ q: state.search.q, regex: state.search.regex, caseSensitive: state.search.caseSensitive, glob: state.search.glob });
      state.search.result = await api(`/api/search?${params}`, { signal: state.controller.signal });
      if (state.screen === 'search') fillResults(results);
    } catch (error) {
      if (state.screen === 'search') results.replaceChildren(error.name === 'AbortError' ? empty('Search cancelled', 'Change your query or start another search.', 'search') : notice(error.message, 'error'));
    } finally { submit.disabled = false; }
  };
  const form = el('form', { class: 'panel search-panel', onSubmit: event => { event.preventDefault(); void search(); } }, el('div', { class: 'search-form' }, el('div', { class: 'field-search' }, icon('search'), query), submit), el('div', { class: 'search-options' }, el('label', { class: 'check-label' }, regex, 'Use regular expressions'), el('label', { class: 'check-label' }, caseSensitive, 'Match letter case'), el('label', { class: 'glob-control' }, 'File pattern', glob)));
  setPage(heading('Find your needle.', 'Search your project without memorizing grep. Start with a word or use a pattern.', [button('Search tips', 'sparkles', handle(() => openToolbox('Search')))], 'Search across your workspace'), form, results);
  fillResults(results);
  query.focus();
  if (state.search.autoRun) { state.search.autoRun = false; void search(); }
}
function fillResults(holder) {
  const result = state.search.result;
  if (!result) { holder.replaceChildren(el('div', { class: 'panel' }, empty('Good things are easier to find.', 'Try a function name, an error message, or TODO. Dependencies, caches, and build folders are skipped.', 'search'))); return; }
  if (!result.matches?.length) { holder.replaceChildren(el('div', { class: 'panel' }, empty('No matches this time', 'Try a shorter phrase, another file pattern, or turn off case matching.', 'search'))); if (result.truncated) holder.prepend(notice('The search reached its limit. Narrow the search and try again.', 'warning')); return; }
  const groups = new Map();
  result.matches.forEach(match => { if (!groups.has(match.path)) groups.set(match.path, []); groups.get(match.path).push(match); });
  const card = el('section', { class: 'panel' }, el('div', { class: 'panel-header' }, el('div', {}, el('h2', {}, `${number(result.matches.length)} matching lines`), el('p', { class: 'panel-subtitle' }, `Across ${number(groups.size)} files · ${result.backend === 'ripgrep' ? 'ripgrep' : 'Built-in search'}`)), badge(result.truncated ? 'Partial results' : 'Search complete', result.truncated ? 'warn' : 'good')));
  groups.forEach((matches, path) => card.append(el('div', { class: 'result-group' }, el('div', { class: 'result-title' }, icon('file'), path), matches.map(match => el('button', { type: 'button', class: 'result-line', 'aria-label': `Preview ${path}, line ${match.line}`, onClick: handle(() => openPreview(path, match.line)) }, el('span', { class: 'line-number' }, match.line), el('span', { class: 'line-text' }, match.text))))));
  card.append(el('div', { class: 'table-end' }, `${number(result.skipped || 0)} skipped items reported · Files over 2 MB are excluded`));
  holder.replaceChildren(result.truncated ? notice('The search reached its time or result limit. Narrow the phrase or filename pattern to see more relevant matches.', 'warning') : el('span'), card);
}

function renderGit() {
  const git = state.git;
  if (!git?.isRepo) { setPage(heading('Know what’s saved.', 'A clear view of your local changes and your last known remote status.', [], 'Git & sync'), el('div', { class: 'panel' }, empty('This folder isn’t a Git repository', 'Open Jarvis in a Git project to review, save, and upload your work.', 'branch'))); return; }
  const changes = git.changes || [];
  const rows = changes.map(item => el('tr', {}, el('td', {}, el('div', { class: 'cell-name' }, icon('file'), el('button', { type: 'button', onClick: handle(() => openDiff(item.path)) }, item.path))), el('td', {}, badge(item.kind, item.kind === 'conflict' ? 'bad' : item.kind === 'untracked' ? 'good' : '')), el('td', { class: 'right' }, iconButton('search', `Review ${item.path}`, handle(() => openDiff(item.path))))));
  const changeTable = changes.length ? table(['Changed file', 'Status', ''], rows, `${number(changes.length)} changed files in the whole Git repository`) : el('section', { class: 'panel' }, empty('Your working tree is clean', git.ahead ? 'Your changes are saved locally. There are still commits ready to upload.' : 'There are no uncommitted changes. Fetch to refresh your view of the remote.', 'check'));
  const ready = !git.conflicts && !git.operation && !git.detached;
  const actions = panel('One step at a time', 'Review first. Then choose an action.', el('div', { class: 'git-actions' }, button('Save snapshot', 'check', handle(() => reviewGit('commit')), 'primary', { disabled: !changes.length || !ready }), button('Upload commits', 'upload', handle(() => reviewGit('push')), '', { disabled: !git.remoteUrl || !ready || git.unborn }), button('Download updates', 'download', handle(() => reviewGit('pull')), '', { disabled: !git.remoteUrl || !ready || !git.clean }), button('Fetch remote status', 'refresh', handle(() => launchAction('fetch', {}, 'Fetching remote status')), '', { disabled: !git.remoteUrl }), el('p', {}, 'A snapshot stages every changed file in this Git repository. Upload sends saved commits to your existing remote.')));
  const info = panel('Repository details', null, definition([['Root', git.root], ['Branch', git.branch || 'Detached HEAD'], ['Upstream', git.upstream || 'Not configured'], ['Remote', git.remoteUrl || 'Not configured'], ['Last save', git.lastCommit ? `${git.lastCommit.hash} · ${git.lastCommit.subject}` : 'No commits yet']]));
  setPage(heading('Know what’s saved.', 'Your local changes, saved commits, and remote status — in one clear view.', [button('Refresh', 'refresh', () => navigate('git'))], 'Git & sync'),
    notice('Ahead and behind counts reflect your last fetch. A clean working tree does not mean every commit is uploaded.'),
    git.conflicts || git.operation || git.detached ? notice(git.conflicts ? 'Resolve merge conflicts in your editor before saving or syncing.' : git.operation ? `A ${git.operation} is in progress. Finish it in Git before continuing.` : 'You are viewing a detached commit. Switch to a branch before saving or uploading.', 'warning') : null,
    el('div', { class: 'metrics' }, metric('Changed files', number(changes.length), 'Included in Save snapshot', 'file'), metric('Commits to upload', number(git.ahead), 'Compared with last fetched remote', 'upload'), metric('Updates to download', number(git.behind), 'Fast-forward only', 'download'), metric('Current branch', git.branch || 'Detached', gitLabel(git), 'branch')),
    el('div', { class: 'git-layout' }, changeTable, el('div', { class: 'stack' }, actions, info)));
}
async function openDiff(path) {
  const body = el('div', { class: 'loading-state' }, el('span', { class: 'spinner' }), 'Reading changes…');
  openModal('Review changes', body, { subtitle: path, wide: true });
  try {
    const data = await api(`/api/diff?path=${encodeURIComponent(path)}`);
    body.className = '';
    body.replaceChildren(el('div', { class: 'code-preview' }, String(data.diff || 'No text diff is available.').split('\n').map(line => el('div', { class: `diff-line${line.startsWith('+') && !line.startsWith('+++') ? ' added' : line.startsWith('-') && !line.startsWith('---') ? ' removed' : ''}` }, line || ' '))));
  } catch (error) { body.className = ''; body.replaceChildren(notice(error.message, 'error')); }
}
async function reviewGit(action) {
  const git = await api('/api/git'); state.git = git;
  const title = { commit: 'Review your snapshot', push: 'Upload saved commits', pull: 'Download updates' }[action];
  const body = el('div', {}, el('div', { class: 'review-details' }, definition([['Repository', git.root], ['Branch', git.branch || 'Detached'], ['Remote', git.remoteUrl || 'Not configured'], ['Upstream', git.upstream || 'Not configured'], ['Changed files', number(git.changes?.length || 0)]])));
  let message;
  if (action === 'commit') {
    body.append(notice('This stages and commits all changed files in the whole repository, including deletions and non-ignored new files. Saving is local; upload is separate.', 'warning'), el('ul', { class: 'review-list' }, (git.changes || []).map(item => el('li', {}, `${item.kind} · ${item.path}`))));
    message = el('textarea', { placeholder: 'Describe what changed…', 'aria-label': 'Commit message', required: true });
    body.append(el('div', { class: 'form-field' }, el('label', {}, 'Snapshot message'), message));
  } else body.append(el('p', {}, action === 'push' ? 'Only saved commits are uploaded. This uses your existing Git credentials and never force-pushes.' : 'This uses a fast-forward-only pull and requires a clean working tree. Divergent histories stop for your review.'));
  openModal(title, body, { confirmText: action === 'commit' ? 'Save snapshot' : action === 'push' ? 'Upload commits' : 'Download updates', onConfirm: async () => {
    if (message && !message.value.trim()) { message.focus(); throw new Error('Add a short message describing this snapshot.'); }
    await launchAction(action, message ? { message: message.value.trim() } : {}, title);
  } });
}

function renderProcesses() {
  const data = state.processes || { processes: [], cpuLabel: 'CPU' };
  const rows = el('tbody'); const summary = el('span');
  const fill = () => {
    const items = data.processes.filter(item => `${item.name} ${item.pid}`.toLowerCase().includes(state.processFilter.toLowerCase())).sort((a, b) => Number(b[state.processSort] || 0) - Number(a[state.processSort] || 0));
    rows.replaceChildren(...items.slice(0, 600).map(item => el('tr', {}, el('td', {}, el('div', { class: 'cell-name' }, icon('box'), item.name)), el('td', { class: 'mono' }, item.pid), el('td', {}, Number(item.cpu || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })), el('td', {}, bytes(item.memory)), el('td', {}, badge('Running', 'good')))));
    if (!items.length) rows.append(el('tr', {}, el('td', { colspan: 5 }, empty('No matching processes', 'Try another name or process ID.', 'cpu', null, true))));
    summary.textContent = `${number(items.length)} processes${items.length > 600 ? ' · showing first 600' : ''} · ${data.cpuLabel}`;
  };
  fill();
  const sort = el('select', { 'aria-label': 'Sort processes', onChange: event => { state.processSort = event.target.value; fill(); } }, el('option', { value: 'memory', selected: state.processSort === 'memory' }, 'Highest memory first'), el('option', { value: 'cpu', selected: state.processSort === 'cpu' }, 'Highest CPU first'));
  setPage(heading('Meet your background crew.', 'See what is running, how much memory it uses, and where to look next.', [button('Refresh', 'refresh', () => navigate('processes'))], 'Processes'),
    data.warning ? notice(data.warning, 'warning') : null,
    el('div', { class: 'toolbar' }, searchField('Filter by process name or PID…', state.processFilter, value => { state.processFilter = value; fill(); }), sort, badge('INSPECTION ONLY', '', 'shield')),
    el('section', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, ['Process', 'PID', data.cpuLabel, 'Memory', 'Status'].map(value => el('th', {}, value)))), rows)), el('div', { class: 'table-end' }, summary, el('span', {}, 'Refresh for a new snapshot'))),
    el('p', { class: 'muted-caption' }, 'Windows reports cumulative CPU seconds; Linux and macOS report CPU percentage. Jarvis does not stop processes.'));
}
function renderPorts() {
  const data = state.ports || { ports: [] }; const rows = el('tbody'); const summary = el('span');
  const fill = () => {
    const items = data.ports.filter(item => `${item.port} ${item.pid} ${item.address} ${item.process || ''} ${item.protocol}`.toLowerCase().includes(state.portFilter.toLowerCase()));
    rows.replaceChildren(...items.map(item => el('tr', {}, el('td', {}, el('div', { class: 'cell-name' }, icon('network'), el('strong', {}, item.port))), el('td', {}, badge(item.protocol)), el('td', { class: 'mono' }, item.address), el('td', { class: 'mono' }, item.pid ?? 'Hidden'), el('td', {}, item.process || '—'))));
    if (!items.length) rows.append(el('tr', {}, el('td', { colspan: 5 }, empty('No matching listeners', state.portFilter ? 'Try a different port, process ID, or address.' : 'No listeners were reported by the system.', 'network', null, true))));
    summary.textContent = `${number(items.length)} local endpoints`;
  }; fill();
  setPage(heading('Who’s listening?', 'Find what is using a port before starting your next server.', [button('Refresh', 'refresh', () => navigate('ports'))], 'Ports & connections'), data.warning ? notice(data.warning, 'warning') : null,
    el('div', { class: 'toolbar' }, searchField('Search port, PID, or address…', state.portFilter, value => { state.portFilter = value; fill(); }), badge('LOCAL ENDPOINTS', '', 'shield')),
    el('section', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, ['Port', 'Protocol', 'Address', 'PID', 'Process'].map(value => el('th', {}, value)))), rows)), el('div', { class: 'table-end' }, summary, el('span', {}, 'TCP listeners + bound UDP sockets'))), el('p', { class: 'muted-caption' }, 'A listening port is not necessarily reachable from the internet. Process details depend on your operating-system permissions.'));
}

function renderScripts() {
  const scripts = Array.isArray(state.scripts) ? state.scripts : [];
  setPage(heading('Your project, one click closer.', 'Named commands from this folder’s package.json. Review the command, then run it.', [button('Refresh', 'refresh', () => navigate('scripts'))], 'Project tasks'), notice('Project scripts can run code and npm lifecycle hooks. Use scripts from projects you trust. Running tasks can be cancelled.'),
    scripts.length ? el('div', { class: 'script-grid' }, scripts.map(script => el('section', { class: 'panel script-card' }, el('div', { class: 'script-card-header' }, icon('terminal'), el('h3', {}, script.name)), el('code', {}, script.command), button('Review & run', 'play', () => reviewScript(script), 'small')))) : el('section', { class: 'panel' }, empty('No project tasks found', 'This view reads scripts from package.json in the selected workspace folder, without searching parent folders.', 'terminal')));
}
function reviewScript(script) {
  const body = el('div', {}, el('div', { class: 'review-details' }, definition([['Workspace', state.root], ['Script', script.name]])), el('pre', { class: 'code-preview' }, script.command), el('p', { class: 'muted-caption' }, 'This executes the project’s npm script and its lifecycle hooks in your normal environment. Output is limited to 256 KB; the task stops if it exceeds that limit. You can cancel a running task.'));
  openModal(`Run “${script.name}”?`, body, { confirmText: 'Run project task', onConfirm: () => launchAction('script', { name: script.name }, `Running ${script.name}`) });
}

function renderStorage() {
  const data = state.storage;
  const options = data.locations.map(location => el('option', { value: location.path, selected: location.path === data.path }, `${location.label || basename(location.path)}${location.path ? ` · ${location.path}` : ''}`));
  const pathInput = el('input', { type: 'text', value: data.path, placeholder: 'Choose a folder or drive…', 'aria-label': 'Folder or drive to scan', onInput: event => { data.path = event.target.value; } });
  const select = el('select', { 'aria-label': 'Common storage locations', onChange: event => { data.path = event.target.value; pathInput.value = event.target.value; } }, el('option', { value: '', disabled: true, selected: !data.locations.some(location => location.path === data.path) }, 'Choose a location'), options);
  const scope = el('section', { class: 'panel' }, el('form', { class: 'storage-select', onSubmit: event => { event.preventDefault(); void startScan().catch(report); } }, el('div', { class: 'form-field storage-location' }, el('label', {}, 'Start somewhere'), select), el('div', { class: 'form-field storage-path' }, el('label', {}, 'Folder or drive'), pathInput), button('Analyze storage', 'search', null, 'primary', { type: 'submit', disabled: !!state.activeJob })), el('div', { class: 'storage-scan-hint' }, icon('shield'), 'Scanning only reads files. Nothing moves or gets deleted.'));
  const content = el('div');
  const tabs = el('div', { class: 'storage-tabs', role: 'tablist', 'aria-label': 'Storage sections' }, [['overview', 'Storage map'], ['cleanup', 'Review cleanup'], ['recovery', 'Recovery']].map(([id, label]) => el('button', { type: 'button', role: 'tab', 'aria-selected': data.tab === id, class: `storage-tab${data.tab === id ? ' active' : ''}`, onClick: () => { data.tab = id; renderStorage(); } }, label, id === 'cleanup' && data.scan?.cleanupCandidates?.length ? ` (${data.scan.cleanupCandidates.length})` : '')));
  if (data.tab === 'recovery') content.append(renderRecovery());
  else if (!data.scan) content.append(el('section', { class: 'panel' }, empty('Space makes more sense when you can see it.', 'Choose your workspace, a folder, or a drive. We’ll map file sizes and identify eligible old temporary files for your review.', 'drive')));
  else if (data.tab === 'cleanup') content.append(renderCleanup());
  else content.append(renderStorageMap());
  setPage(heading('Make room for what matters.', 'A clearer view of your computer’s storage. A careful way to clean it up.', [button('Recovery', 'undo', () => { data.tab = 'recovery'; renderStorage(); })], 'Storage & cleanup'), scope,
    state.activeJob?.kind === 'scan' ? el('div', { class: 'scan-progress' }, el('span', { class: 'spinner' }), el('div', {}, el('strong', {}, 'Building your storage map…'), el('p', {}, 'Large drives take a little longer. Inaccessible folders are skipped.'), el('div', { class: 'progress-track' })), button('Cancel scan', 'close', handle(cancelJob), 'small')) : null,
    data.stale ? notice('Files changed after this scan. Analyze storage again for current sizes and cleanup candidates.', 'warning') : null,
    tabs, content);
}
async function startScan() {
  const path = state.storage.path.trim();
  if (!path) throw new Error('Choose a folder or drive to analyze.');
  await launchJob('/api/storage/scan', { path, maxEntries: 250000, timeBudgetMs: 120000 }, `Analyzing ${path}`, result => {
    state.storage.scan = result; state.storage.selected.clear(); state.storage.stale = false; state.storage.tab = 'overview';
    if (state.screen === 'storage') renderStorage();
  }, 'scan');
  if (state.screen === 'storage') renderStorage();
}
function renderStorageMap() {
  const data = state.storage.scan;
  const entries = [...(data.entries || [])].sort((a, b) => (b.bytes || b.size || 0) - (a.bytes || a.size || 0));
  const top = entries.slice(0, 6).map(item => ({ ...item, value: Number(item.bytes ?? item.size ?? 0) }));
  const other = Math.max(0, Number(data.totalBytes || 0) - top.reduce((sum, item) => sum + item.value, 0));
  const segments = [...top, ...(other ? [{ name: 'Other files', value: other }] : [])];
  const chart = el('div', { class: 'storage-chart' }, donut(segments, bytes(data.totalBytes), 'MEASURED FILE BYTES', true), el('div', { class: 'storage-legend' }, segments.map((item, index) => el('div', {}, el('div', { class: 'legend-row' }, el('span', { class: `legend-dot swatch-${index % 7}` }), el('strong', { title: item.path || item.name }, item.name || basename(item.path)), el('span', {}, bytes(item.value))), sizeBar(item.value, data.totalBytes, index)))));
  const overview = panel('Where your space goes', data.root || state.storage.path, chart, badge(data.cancelled ? 'Cancelled · partial scan' : data.truncated ? 'Partial scan' : 'Scan complete', data.truncated || data.cancelled ? 'warn' : 'good'));
  overview.append(el('div', { class: 'panel-footer' }, `${number(data.totalFiles)} files · ${number(data.totalDirectories || 0)} folders`, `${duration(Number(data.elapsedMs || 0) / 1000)} elapsed`));
  const candidates = data.cleanupCandidates || [];
  const candidateBytes = candidates.reduce((sum, item) => sum + Number(item.size ?? item.bytes ?? 0), 0);
  const cleanup = panel('A little breathing room', 'Only eligible old temporary files are suggested.', el('div', {}, el('div', { class: 'stat-inline' }, el('div', {}, el('strong', {}, bytes(candidateBytes)), el('small', {}, 'Candidates to review')), el('div', {}, el('strong', {}, number(candidates.length)), el('small', {}, 'Temporary files'))), el('p', { class: 'muted-caption' }, 'Review the exact files first. Moving files to recovery is reversible and does not free disk space until you permanently delete them.'), button('Review cleanup', 'leaf', () => { state.storage.tab = 'cleanup'; renderStorage(); }, 'soft section-space', { disabled: !candidates.length })));
  const largest = (data.largestFiles || []).slice(0, 30);
  const largestTable = largest.length ? table(['Largest files', 'File size', 'Modified'], largest.map(item => el('tr', {}, el('td', {}, el('div', { class: 'cell-name' }, icon('file'), el('span', { title: item.path }, item.path || item.name))), el('td', { class: 'nowrap' }, bytes(item.size ?? item.bytes)), el('td', { class: 'nowrap' }, timestamp(item.modified || item.mtime)))), 'Large does not mean disposable. These files are shown for inspection only.') : el('section', { class: 'panel' }, empty('No regular files were measured', 'Choose another folder or inspect the scan’s access limits.', 'folder', null, true));
  return el('div', {}, data.truncated || data.skipped ? notice(`${data.truncated ? 'This scan reached its time or entry limit. Totals are partial. ' : ''}${number(data.skipped || 0)} items were skipped. Permissions, symlinks, and changing files can limit a scan.`, 'warning') : null, el('div', { class: 'storage-summary-grid' }, overview, cleanup), el('div', { class: 'section-caption' }, el('h2', {}, 'Largest files in this scan'), badge('READ ONLY')), largestTable);
}
function sizeBar(value, total, index) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 300 5'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('class', 'size-bar-svg'); svg.setAttribute('aria-hidden', 'true');
  const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  background.setAttribute('width', '300'); background.setAttribute('height', '5'); background.setAttribute('rx', '2.5'); background.setAttribute('fill', '#f0f3e9');
  const bar = background.cloneNode(); bar.setAttribute('width', String(total > 0 ? Math.min(300, Math.max(0, value / total * 300)) : 0)); bar.setAttribute('fill', COLORS[index % COLORS.length]);
  svg.append(background, bar); return svg;
}
function renderCleanup() {
  const candidates = state.storage.scan?.cleanupCandidates || [];
  if (!candidates.length) return el('section', { class: 'panel' }, empty('Nothing to clean up automatically', 'No eligible old temporary files were found in this scan. Your other files are left alone.', 'shield'));
  const summary = el('strong');
  const review = button('Review selected files', 'shield', handle(planCleanup), 'primary small', { disabled: !state.storage.selected.size });
  const update = () => {
    const selected = candidates.filter(item => state.storage.selected.has(item.path));
    summary.textContent = `${selected.length} selected · ${bytes(selected.reduce((sum, item) => sum + Number(item.size ?? item.bytes ?? 0), 0))}`;
    review.disabled = !selected.length || state.storage.stale;
  };
  const boxes = [];
  const all = el('input', { type: 'checkbox', 'aria-label': 'Select all eligible files (up to 500)', onChange: event => {
    state.storage.selected.clear();
    if (event.target.checked) candidates.slice(0, 500).forEach(item => state.storage.selected.add(item.path));
    boxes.forEach(({ box, item }) => { box.checked = state.storage.selected.has(item.path); }); update();
  } });
  const rows = candidates.slice(0, 500).map(item => {
    const box = el('input', { type: 'checkbox', checked: state.storage.selected.has(item.path), 'aria-label': `Select ${item.path}`, onChange: event => { if (event.target.checked) state.storage.selected.add(item.path); else state.storage.selected.delete(item.path); all.checked = false; update(); } });
    boxes.push({ box, item });
    return el('tr', {}, el('td', { class: 'check-cell' }, box), el('td', {}, el('div', { class: 'cell-name' }, icon('file'), el('span', { title: item.path }, item.name || basename(item.path))), el('p', { class: 'candidate-reason', title: item.path }, item.path), el('p', { class: 'candidate-reason' }, item.reason || 'Eligible old temporary file')), el('td', { class: 'nowrap' }, bytes(item.size ?? item.bytes)), el('td', { class: 'nowrap' }, timestamp(item.modified || item.mtime)));
  }); update();
  return el('div', {}, notice('Cleanup moves only the files you review into local recovery. Recovery still occupies disk space. Permanently deleting a recovery batch is a separate, irreversible action.'), el('section', { class: 'panel' }, el('div', { class: 'panel-toolbar' }, el('label', { class: 'checkbox-heading' }, all, 'Select eligible files'), el('div', { class: 'selected-summary' }, summary, review)), el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, ['', 'Temporary file', 'Size', 'Modified'].map(value => el('th', {}, value)))), el('tbody', {}, rows))), el('div', { class: 'table-end' }, `${number(candidates.length)} eligible files${candidates.length > 500 ? ' · showing first 500 per review' : ''}`, 'No folders or personal files selected automatically')));
}
async function planCleanup() {
  const paths = [...state.storage.selected];
  if (!paths.length) throw new Error('Select the temporary files you want to review.');
  const plan = await api('/api/storage/plan', { method: 'POST', body: { paths } });
  const entries = plan.entries || [];
  const body = el('div', {}, notice('This moves files into local recovery. It does not free disk space yet. You can restore them later; permanent deletion is a separate action.', 'warning'), el('div', { class: 'review-details' }, definition([['Files', number(entries.length)], ['Total size', bytes(plan.totalBytes)], ['Mode', 'Move to recovery'], ['Plan expires', timestamp(plan.expiresAt)]])), el('ul', { class: 'review-list' }, entries.map(item => el('li', {}, `${item.path || item.originalPath} · ${bytes(item.size ?? item.bytes)}`))));
  openModal('Review this cleanup plan', body, { confirmText: 'Move to recovery', onConfirm: () => launchJob('/api/storage/execute', { planId: plan.id, confirmed: true }, 'Moving reviewed files to recovery', refreshStorageAfterChange, 'cleanup') });
}
async function refreshStorageAfterChange() {
  state.storage.stale = !!state.storage.scan; state.storage.selected.clear();
  try {
    const result = await api('/api/storage/history');
    state.storage.history = Array.isArray(result) ? result : result.records || result.history || [];
  } catch (error) { report(error); }
  state.storage.tab = 'recovery'; if (state.screen === 'storage') renderStorage();
}
function renderRecovery() {
  const history = state.storage.history || [];
  if (!history.length) return el('section', { class: 'panel' }, empty('Your recovery space is empty', 'Files you move during cleanup will appear here. You can restore a batch before choosing to permanently delete it.', 'undo'));
  return el('div', {}, notice('Files in recovery still take up disk space. Restore keeps them; permanent deletion frees their stored bytes and cannot be undone.', 'warning'), el('div', { class: 'storage-history-list' }, history.map(item => {
    const status = item.status || 'quarantined';
    const restorable = status !== 'unavailable' && (item.entries || []).some(entry => ['moving', 'quarantined', 'restoring', 'purging'].includes(entry.state));
    return el('section', { class: 'panel history-card' }, el('span', { class: 'empty-icon' }, icon(status === 'restored' ? 'undo' : status === 'purged' ? 'trash' : 'box')), el('div', { class: 'history-info' }, el('h3', {}, `${number(item.files ?? item.fileCount ?? item.count ?? item.entries?.length ?? 0)} files in recovery · ${bytes(item.bytes ?? item.totalBytes)}`), el('p', {}, `${timestamp(item.createdAt || item.time || item.startedAt)} · ${status}`), item.warning || item.error ? el('p', {}, item.warning || item.error) : null), el('div', { class: 'actions' }, button('Details', 'search', () => reviewRecovery(item, 'details'), 'small'), restorable ? button('Restore', 'undo', () => reviewRecovery(item, 'restore'), 'small') : null, restorable ? button('Delete permanently', 'trash', () => reviewRecovery(item, 'purge'), 'small') : null));
  })));
}
function reviewRecovery(item, action) {
  const entries = item.entries || [];
  const body = el('div', {}, el('div', { class: 'review-details' }, definition([['Recovery batch', item.id], ['Held files', number(item.files ?? item.fileCount ?? item.count ?? entries.length)], ['Held size', bytes(item.bytes ?? item.totalBytes)], ['Created', timestamp(item.createdAt || item.time)], ['Status', item.status || 'In recovery']])), item.error ? notice(item.error, 'error') : null, el('ul', { class: 'review-list' }, entries.map(entry => el('li', {}, `${entry.originalPath || entry.path} · ${bytes(entry.size ?? entry.bytes)} · ${entry.state || 'recorded'}${entry.error ? ` — ${entry.error}` : ''}`))));
  let phrase;
  if (action === 'purge') {
    body.prepend(notice('Permanent deletion cannot be undone. These recovery copies will be removed from disk.', 'error', 'alert'));
    phrase = el('input', { type: 'text', placeholder: 'Type DELETE', autocomplete: 'off', 'aria-label': 'Type DELETE to confirm permanent deletion' });
    body.append(el('div', { class: 'form-field' }, el('label', {}, 'Type DELETE to confirm'), phrase));
  } else if (action === 'restore') body.prepend(notice('Files will return to their original locations. Existing files are not overwritten; any conflicts will be reported.'));
  openModal(action === 'purge' ? 'Permanently delete this batch?' : action === 'restore' ? 'Restore these files?' : 'Recovery batch details', body, {
    confirmText: action === 'details' ? null : action === 'purge' ? 'Delete permanently' : 'Restore files', danger: action === 'purge', onConfirm: async () => {
      if (phrase && phrase.value !== 'DELETE') { phrase.focus(); throw new Error('Type DELETE exactly to confirm permanent deletion.'); }
      await launchJob(`/api/storage/${action}`, { id: item.id, confirmed: true }, action === 'purge' ? 'Permanently deleting recovery batch' : 'Restoring files', refreshStorageAfterChange, action);
    },
  });
}

function renderActivity() {
  const records = Array.isArray(state.activity) ? state.activity : [];
  const content = el('div'); const filters = el('div', { class: 'activity-filters' });
  const fill = status => {
    filters.replaceChildren(...[['all', 'All activity'], ['completed', 'Completed'], ['failed', 'Needs attention']].map(([key, label]) => el('button', { type: 'button', class: `filter-chip${status === key ? ' active' : ''}`, onClick: () => fill(key) }, label)));
    const items = records.filter(item => status === 'all' || (status === 'completed' ? ['completed', 'success', 'succeeded'].includes(item.status) : ['failed', 'error', 'cancelled'].includes(item.status)));
    content.replaceChildren(items.length ? table(['Action', 'Result', 'When', ''], items.map(item => el('tr', {}, el('td', {}, el('div', { class: 'cell-name' }, icon('activity'), item.action || 'Local action'), el('p', { class: 'candidate-reason', title: item.target || '' }, item.message || item.target || '')), el('td', {}, badge(item.status || 'Recorded', ['failed', 'error'].includes(item.status) ? 'bad' : ['cancelled', 'running'].includes(item.status) ? 'warn' : 'good')), el('td', { class: 'nowrap' }, timestamp(item.time)), el('td', { class: 'right' }, iconButton('search', 'View activity details', () => openModal('Activity details', el('div', { class: 'review-details' }, definition([['Action', item.action], ['Status', item.status], ['When', timestamp(item.time)], ['Target', item.target], ['Message', item.message]]))))))), `${number(items.length)} recorded actions`) : el('section', { class: 'panel' }, empty('A clear record starts here.', 'Your scans, Git actions, and project tasks will appear here as you use Jarvis.', 'activity')));
  };
  fill('all');
  setPage(heading('A little history. A lot of clarity.', 'See what ran, what changed, and what needs another look.', [button('Refresh', 'refresh', () => navigate('activity'))], 'Activity'), filters, content);
}

function openModal(title, content, { subtitle = '', wide = false, confirmText = null, onConfirm = null, danger = false } = {}) {
  if (modal.open) modal.close();
  delete modal.dataset.job;
  modal.className = `modal${wide ? ' wide' : ''}`;
  const errors = el('div');
  const body = el('div', { class: 'modal-body' }, content, errors);
  const footer = el('div', { class: 'modal-footer' }, button(confirmText ? 'Cancel' : 'Done', null, () => modal.close()));
  if (confirmText) {
    const confirm = button(confirmText, danger ? 'trash' : 'check', async () => {
      confirm.disabled = true; errors.replaceChildren();
      try { await onConfirm?.(); modal.close(); }
      catch (error) { errors.append(el('div', { class: 'modal-error', role: 'alert' }, error.message)); }
      finally { confirm.disabled = false; }
    }, danger ? 'danger' : 'primary');
    footer.append(confirm);
  }
  modal.replaceChildren(el('div', { class: 'modal-header' }, el('div', {}, el('h2', { id: 'modal-title' }, title), subtitle ? el('p', {}, subtitle) : null), iconButton('close', 'Close dialog', () => modal.close())), body, footer);
  modal.showModal();
}
function openPalette() {
  if (modal.open) modal.close();
  modal.className = 'modal';
  const list = el('div', { class: 'palette-results' });
  const actions = [...NAV, { id: 'toolbox', title: 'Explore the toolbox', description: 'Step-by-step recipes for common tasks', icon: 'sparkles' }, { id: 'support', title: 'About & support', description: 'About this local workbench', icon: 'heart' }];
  const choose = item => { modal.close(); if (item.id === 'toolbox') void openToolbox().catch(report); else if (item.id === 'support') void openAbout().catch(report); else void navigate(item.id); };
  const fill = value => {
    const matches = actions.filter(item => `${item.title} ${item.description}`.toLowerCase().includes(value.toLowerCase()));
    list.replaceChildren(...matches.map(item => el('button', { class: 'palette-item', type: 'button', onClick: () => choose(item) }, icon(item.icon), el('span', {}, el('strong', {}, item.title), el('small', {}, item.description)), icon('arrow'))));
    if (!matches.length) list.append(empty('No tool matches yet', 'Try files, search, storage, or Git.', 'search', null, true));
  };
  const input = el('input', {
    class: 'palette-input', type: 'search', placeholder: 'What would you like to do?', 'aria-label': 'Find a tool or action',
    onInput: event => fill(event.target.value),
    onKeydown: event => {
      if (!['ArrowDown', 'Enter'].includes(event.key)) return;
      // Closing the dialog restores focus to its opener. Consume Enter before
      // the browser can activate that newly focused button and reopen it.
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'ArrowDown') list.querySelector('button')?.focus();
      else list.querySelector('button')?.click();
    },
  });
  modal.replaceChildren(el('h2', { id: 'modal-title', class: 'sr-only' }, 'Find a tool or action'), input, list, el('div', { class: 'palette-footer' }, 'Tools for real tasks. No commands to memorize.', el('span', {}, 'Esc to close')));
  fill(''); modal.showModal(); input.focus();
}
async function openToolbox(category = '') {
  if (!state.recipes.length) state.recipes = await api('/api/recipes');
  const recipes = category ? state.recipes.filter(recipe => recipe.category === category) : state.recipes;
  const content = el('div', { class: 'recipe-grid' }, recipes.map(recipe => el('button', { type: 'button', class: 'recipe-card', onClick: () => showRecipe(recipe) }, el('small', {}, recipe.category), el('h3', {}, recipe.title), el('p', {}, recipe.description))));
  openModal(category ? `${category} made simpler` : 'Start with what you want to do.', content, { subtitle: 'Practical recipes, useful tools, and a little less guesswork.', wide: true });
}
function showRecipe(recipe) {
  const content = el('div', {}, el('p', {}, recipe.explanation), (recipe.examples || []).map(example => el('div', { class: 'example-block' }, el('code', {}, example.command), el('p', {}, example.explanation))));
  content.append(el('p', { class: 'muted-caption' }, 'These examples are for learning. Opening a tool does not execute them.'));
  openModal(recipe.title, content, { confirmText: 'Open this tool', onConfirm: async () => {
    const route = recipe.screen === 'disk' ? 'storage' : recipe.screen === 'recipes' ? 'overview' : recipe.screen;
    if (recipe.query && route === 'search') { state.search.q = recipe.query; state.search.autoRun = true; }
    await navigate(route);
  } });
}
async function copy(value) {
  try { await navigator.clipboard.writeText(String(value)); toast('Copied to clipboard.'); }
  catch { throw new Error('Clipboard access is unavailable. Select the visible value and copy it manually.'); }
}
async function openAbout() {
  const about = await api('/api/about'); state.about = about;
  const content = el('div', {}, el('div', { class: 'about-heading' }, el('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'j', el('span', {}, '›')), el('div', {}, el('h3', {}, about.name || 'Jarvis Workbench'), el('p', {}, `${about.version ? `Version ${about.version}` : 'Your local workbench'}${about.author ? ` · By ${typeof about.author === 'string' ? about.author : about.author.name || ''}` : ''}`))), el('p', {}, 'A calmer way to work with your computer. Files, search, Git, storage, and project tasks — close at hand, running locally.'), notice('No API key, cloud account, or telemetry. Your browser connects to a local server on this computer.', '', 'shield'));
  if (about.donations) {
    const fields = [['accountHolder', 'Account holder'], ['accountNumber', 'Account number'], ['ifsc', 'IFSC'], ['upi', 'UPI ID']].filter(([key]) => typeof about.donations[key] === 'string' && about.donations[key].trim());
    const placeholder = value => /^(?:YOUR[_ -]|PLACEHOLDER|TODO|TBD|<)/i.test(String(value || '').trim());
    const unconfigured = fields.some(([key]) => placeholder(about.donations[key]));
    if (fields.length) content.append(el('hr', { class: 'soft-divider' }), el('h3', {}, 'Support independent development'), el('p', { class: 'muted-caption' }, unconfigured ? 'Donation details are not configured yet. The author’s account fields below are placeholders, so payments are not available.' : 'Public donation details shared by the author. Contributions are optional.'), el('div', { class: 'donation-fields' }, fields.map(([key, label]) => el('div', { class: 'donation-field' }, el('div', {}, el('small', {}, label), el('strong', {}, placeholder(about.donations[key]) ? 'Not configured' : about.donations[key])), placeholder(about.donations[key]) || unconfigured ? badge('Not available') : iconButton('copy', `Copy ${label.toLowerCase()}`, handle(() => copy(about.donations[key])))))));
    if (about.donations.paymentUrl && !unconfigured && !placeholder(about.donations.paymentUrl)) {
      try { const url = new URL(about.donations.paymentUrl); if (url.protocol === 'https:') content.append(el('a', { class: 'button soft section-space', href: url.href, target: '_blank', rel: 'noopener noreferrer' }, icon('external'), 'Open author’s support page')); } catch { /* Invalid donation URLs are not links. */ }
    }
  } else content.append(el('p', { class: 'muted-caption' }, 'Thanks for trying Jarvis. Author support details have not been configured for this build.'));
  openModal('Built to make work feel simpler.', content);
}

async function launchAction(action, fields, title) {
  return launchJob('/api/actions', { action, ...fields, confirmed: true }, title, async () => {
    if (['overview', 'git', 'activity'].includes(state.screen)) await navigate(state.screen, { quiet: true });
  }, action);
}
async function launchJob(endpoint, body, title, onDone, kind) {
  if (state.activeJob) throw new Error('Another task is running. Let it finish or cancel it before starting another.');
  const result = await api(endpoint, { method: 'POST', body });
  const job = { id: result.id, title, kind, status: 'running', logs: [], startedAt: new Date().toISOString(), onDone };
  state.activeJob = job; state.jobs.set(job.id, job); renderJobDock(job);
  void pollJob(job);
  return job;
}
async function pollJob(job) {
  try {
    const current = await api(`/api/jobs/${encodeURIComponent(job.id)}`);
    Object.assign(job, current); renderJobDock(job);
    if (modal.open && modal.dataset.job === job.id) fillJobModal(job);
    if (job.status === 'running' || job.status === 'queued') { job.timer = setTimeout(() => void pollJob(job), 850); return; }
    if (state.activeJob?.id === job.id) state.activeJob = null;
    if (job.status === 'completed') {
      if (job.result?.code && job.result.code !== 0) toast(`${job.title} finished with exit code ${job.result.code}.`, true);
      else if (jobWarnings(job).length) toast('Task finished with notes. Open Details to review them.', true);
      else toast('Task completed.');
      await job.onDone?.(job.result);
    } else if (job.status === 'failed') {
      toast(job.error || 'The task did not finish.', true);
      if (job.kind !== 'scan' || job.result) await job.onDone?.(job.result);
    }
    else if (job.status === 'cancelled') {
      toast(job.result ? 'Task cancelled. Partial results are available.' : 'Task cancelled.');
      if (job.kind !== 'scan' || job.result) await job.onDone?.(job.result);
    }
    if (state.screen === 'storage') renderStorage();
    try { state.activity = await api('/api/activity'); } catch { /* A refresh can retry activity. */ }
    if (state.screen === 'activity') renderActivity();
  } catch (error) {
    job.connectionError = error.message; renderJobDock(job);
  }
}
async function cancelJob() {
  const job = state.activeJob;
  if (!job) return;
  await api(`/api/jobs/${encodeURIComponent(job.id)}/cancel`, { method: 'POST', body: {} });
  toast('Cancellation requested.');
}
function renderJobDock(job) {
  const dock = $('#job-dock'); dock.hidden = false;
  const running = ['running', 'queued'].includes(job.status);
  const warnings = jobWarnings(job);
  const message = job.connectionError || (running ? `Working locally · ${duration((Date.now() - new Date(job.startedAt).getTime()) / 1000)} elapsed` : job.status === 'failed' ? job.error || 'Open details for the error.' : job.status === 'cancelled' ? 'Cancelled. Any partial results are preserved.' : job.result?.code ? `Finished with exit code ${job.result.code}` : warnings.length ? 'Finished with notes. Review the task details.' : 'Completed on your computer.');
  dock.replaceChildren(running && !job.connectionError ? el('span', { class: 'spinner' }) : icon(job.status === 'failed' || job.connectionError || warnings.length ? 'alert' : 'check'), el('div', { class: 'job-copy' }, el('strong', {}, job.title), el('p', {}, message)),
    job.connectionError ? button('Reconnect', 'refresh', () => { job.connectionError = ''; void pollJob(job); }, 'small') : button('Details', null, () => openJobModal(job), 'small'),
    running ? button('Cancel', null, handle(cancelJob), 'small') : iconButton('close', 'Dismiss completed task', () => { dock.hidden = true; }));
}
function openJobModal(job) {
  openModal(job.title, el('div', { id: 'job-modal-content' }), { wide: true });
  modal.dataset.job = job.id; fillJobModal(job);
}
function jobWarnings(job) {
  return [...new Set([...(job.warnings || []), ...(job.activityWarning ? [job.activityWarning] : []), ...(job.result?.errors || []).map(error => typeof error === 'string' ? error : `${error.path || 'File'}: ${error.message || error.error || 'Needs review'}`)].filter(Boolean))];
}
function fillJobModal(job) {
  const holder = $('#job-modal-content'); if (!holder) return;
  const result = job.result;
  const extra = result && (result.stdout || result.stderr) ? [result.stdout || '', result.stderr || ''].filter(Boolean).join('\n') : '';
  const logs = (job.logs || []).join('\n');
  const warnings = jobWarnings(job);
  replace(holder, el('div', { class: 'preview-toolbar' }, badge(warnings.length ? `${job.status} with notes` : job.status, job.status === 'failed' ? 'bad' : warnings.length ? 'warn' : job.status === 'completed' ? 'good' : 'warn'), el('span', {}, `Started ${timestamp(job.startedAt)}`)), job.error ? notice(job.error, 'error') : null,
    warnings.map(warning => notice(warning, 'warning')),
    result && ['movedBytes', 'restoredBytes', 'reclaimedBytes'].some(key => result[key] !== undefined) ? el('div', { class: 'review-details' }, definition([['Moved to recovery', bytes(result.movedBytes || 0)], ['Restored', bytes(result.restoredBytes || 0)], ['Permanently removed', bytes(result.reclaimedBytes || 0)]])) : null,
    el('pre', { class: 'code-preview' }, logs || extra || (job.status === 'running' ? 'Waiting for task output…' : 'This task produced no console output.')), job.logTruncated ? el('p', { class: 'muted-caption' }, 'Older output was truncated to keep this view responsive.') : null, ['running', 'queued'].includes(job.status) ? button('Cancel task', 'close', handle(cancelJob), 'small section-space') : null);
}

async function init() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const incoming = fragment.get('token');
  try {
    if (incoming) { token = incoming; sessionStorage.setItem('jarvis-session-token', incoming); }
    else token = sessionStorage.getItem('jarvis-session-token') || '';
  } catch { token = incoming || ''; }
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  document.querySelectorAll('[data-icon]').forEach(node => node.replaceChildren(icon(node.dataset.icon)));
  $('#brand-home').addEventListener('click', () => navigate('overview'));
  $('#command-button').addEventListener('click', openPalette);
  $('#mobile-command').addEventListener('click', openPalette);
  $('#toolbox-button').addEventListener('click', handle(() => openToolbox()));
  $('#support-button').addEventListener('click', handle(openAbout));
  modal.addEventListener('close', () => { if (!modal.open) delete modal.dataset.job; });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openPalette(); return; }
    if (event.key === 'Escape' && !modal.open && state.activeJob) { event.preventDefault(); void cancelJob().catch(report); }
    const typing = event.target.matches('input, textarea, select, [contenteditable="true"]');
    if (typing || modal.open || event.ctrlKey || event.metaKey || event.altKey) return;
    if (/^[1-9]$/.test(event.key)) { event.preventDefault(); void navigate(NAV[Number(event.key) - 1].id); }
    else if (event.key === '/') { event.preventDefault(); page.querySelector('input[type="search"]')?.focus(); }
    else if (event.key === '?') { event.preventDefault(); void openToolbox().catch(report); }
  });
  renderNavigation();
  if (!token) { renderError(new Error('Start Jarvis in your project and use the browser link from your terminal. The local session keeps access on this computer.')); return; }
  await navigate('overview');
}

void init().catch(error => renderError(error));
