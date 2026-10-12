/* Jarvis web client. All user/project data is rendered as text, never HTML. */
'use strict';

const ICONS = {
  grid: ['M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],
  folder: ['M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z'],
  file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6M8 13h8M8 17h5'],
  search: ['M21 21l-4.35-4.35', 'M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z'],
  branch: ['M6 3v12a3 3 0 1 0 3 3M6 6a3 3 0 1 0 0-6 3 3 0 0 0 0 6M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6M18 9a9 9 0 0 1-9 9'],
  cpu: ['M8 8h8v8H8zM4 4h16v16H4zM8 1v3M16 1v3M8 20v3M16 20v3M1 8h3M1 16h3M20 8h3M20 16h3'],
  audio: ['M11 5 6 9H2v6h4l5 4V5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14'],
  settings: ['M4 7h16M4 17h16M8 4v6M16 14v6'],
  wifi: ['M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M9 16a5 5 0 0 1 6 0M12 20h.01'],
  more: ['M5 12h.01M12 12h.01M19 12h.01'],
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
  stop: ['M6 6h12v12H6z'],
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
  { id: 'network', title: 'Network', icon: 'wifi', group: 'Controls', description: 'Wi-Fi, adapters, IP addresses, and DNS' },
  { id: 'audio', title: 'Sound', icon: 'audio', description: 'Volume, mute, and audio devices' },
  { id: 'security', title: 'Security', icon: 'shield', description: 'Microsoft Defender status and scans' },
  { id: 'settings', title: 'Settings', icon: 'settings', description: 'Frequently used system settings' },
  { id: 'scripts', title: 'Project tasks', icon: 'terminal', group: 'Tools', description: 'Run your project’s named commands' },
  { id: 'activity', title: 'Activity', icon: 'activity', description: 'A record of your local actions' },
];
const COLORS = ['#799f59', '#a7bf7a', '#c5d7a3', '#d5c692', '#9fbaa1', '#758b69', '#e4e9db'];
const state = {
  screen: 'overview', root: '', overview: null, about: null, activity: [], git: null,
  files: null, filePath: '', fileFilter: '', search: { q: '', regex: false, caseSensitive: false, glob: '', result: null },
  processes: null, processFilter: '', processSort: 'memory', ports: null, portFilter: '', scripts: [], recipes: [],
  storage: { locations: [], history: [], path: '', scan: null, selected: new Set(), tab: 'overview', stale: false },
  network: null, audio: null, security: null, settings: null,
  activeJob: null, jobs: new Map(), loading: false, requestId: 0, controller: null, toastTimer: null,
};
const $ = selector => document.querySelector(selector);
const page = $('#page');
const modal = $('#modal');
let token = '';
let sensitiveCleanup = null;
let modalRevision = 0;
let workspaceBootstrap = null;
function clearSensitive() { const cleanup = sensitiveCleanup; sensitiveCleanup = null; cleanup?.(); }
function onModalClose() { if (!modal.open) { clearSensitive(); delete modal.dataset.job; } }

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
  node.className = `toast${error === 'warning' ? ' warning' : error ? ' error' : ''}`;
  node.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { node.hidden = true; }, error ? 6500 : 3600);
}
function report(error) { if (error?.name !== 'AbortError') toast(error?.message || String(error), true); }
function handle(fn) { return event => Promise.resolve().then(() => fn(event)).catch(report); }

function heading(title, description, actions = [], eyebrow = 'Local control center') {
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
  const renderers = { overview: renderOverview, files: renderFiles, search: renderSearch, git: renderGit, processes: renderProcesses, ports: renderPorts, storage: renderStorage, network: renderNetwork, audio: renderAudio, security: renderSecurity, settings: renderSettings, scripts: renderScripts, activity: renderActivity };
  renderers[state.screen]?.();
}
async function bootstrapWorkspace() {
  if (!workspaceBootstrap) workspaceBootstrap = Promise.all([api('/api/overview'), api('/api/about').catch(() => null)]).catch(error => { workspaceBootstrap = null; throw error; });
  const [overview, about] = await workspaceBootstrap;
  state.overview = overview; state.root = overview.root || ''; state.git = overview.git;
  if (about) { state.about = about; $('#footer-version').textContent = `${about.name || 'Jarvis Workbench'}${about.version ? ` v${about.version}` : ''}`; }
}
async function navigate(screen, { quiet = false } = {}) {
  if (!NAV.some(item => item.id === screen)) screen = 'overview';
  if (sensitiveCleanup) { clearSensitive(); if (modal.open) modal.close(); }
  state.controller?.abort();
  state.controller = new AbortController();
  const requestId = ++state.requestId;
  state.screen = screen; state.loading = true;
  renderNavigation();
  if (!quiet) renderLoading(screen);
  try {
    const signal = state.controller.signal;
    const needsBootstrap = !state.root;
    if (needsBootstrap) await bootstrapWorkspace();
    if (requestId !== state.requestId) return;
    if (screen === 'overview') {
      if (!needsBootstrap) state.overview = await api('/api/overview', { signal });
      state.root = state.overview.root || state.root; state.git = state.overview.git;
      const results = await Promise.allSettled([api('/api/activity', { signal }), api('/api/about', { signal })]);
      if (results[0].status === 'fulfilled') state.activity = Array.isArray(results[0].value) ? results[0].value : [];
      if (results[1].status === 'fulfilled') { state.about = results[1].value; $('#footer-version').textContent = `${state.about.name || 'Jarvis Workbench'} ${state.about.version ? `v${state.about.version}` : ''}`; }
    } else if (screen === 'files') state.files = await api(`/api/files?path=${encodeURIComponent(state.filePath)}`, { signal });
    else if (screen === 'git') state.git = await api('/api/git', { signal });
    else if (screen === 'processes') state.processes = await api('/api/processes', { signal });
    else if (screen === 'ports') state.ports = await api('/api/ports', { signal });
    else if (['network', 'audio', 'security', 'settings'].includes(screen)) state[screen] = await api(`/api/${screen}`, { signal });
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
  if (!git?.isRepo) return panel('Git workspace', 'Git & sync', empty('No Git repository here', 'Open a Git project to review changes and upload saved commits.', 'branch', button('Explore files', 'folder', () => navigate('files')), true));
  const body = el('div', {},
    el('div', { class: 'repo-line' }, el('span', { class: 'repo-logo' }, icon('folder')), el('div', { class: 'repo-info' }, el('strong', {}, basename(git.root || state.root)), el('small', { title: git.root || state.root }, git.remoteUrl || git.root || 'Local repository')), badge(git.branch || 'Detached', '', 'branch')),
    el('div', { class: 'sync-steps' },
      el('div', { class: 'sync-step' }, el('span', { class: 'sync-step-icon' }, icon('file')), el('strong', {}, `${number(git.changes?.length || 0)} changed`), el('small', {}, 'In your workspace')),
      el('div', { class: 'sync-step' }, el('span', { class: 'sync-step-icon' }, icon('check')), el('strong', {}, git.lastCommit ? 'Saved locally' : 'No commits yet'), el('small', {}, git.lastCommit?.hash || 'Your next milestone')),
      el('div', { class: 'sync-step' }, el('span', { class: 'sync-step-icon' }, icon('cloud')), el('strong', {}, git.ahead ? `${git.ahead} to upload` : git.upstream ? 'Remote tracked' : 'Not connected'), el('small', {}, git.upstream || 'Set up an upstream'))),
    el('div', { class: 'sync-note' }, icon('info'), 'Remote status reflects your last fetch.'));
  const card = panel('Repository status', 'Review changes, save a commit, then upload.', body, badge(git.changes?.length ? 'Changes pending' : 'Working tree clean', git.changes?.length ? 'warn' : 'good'));
  card.append(el('div', { class: 'panel-footer' }, el('span', {}, git.lastCommit ? `Last save · ${git.lastCommit.subject}` : 'Start with a local commit.'), textButton('Open Git & sync', () => navigate('git'))));
  return card;
}
function actionLabel(value) { return String(value || 'Local action').replace(/[-_]+/g, ' ').replace(/^\w/, letter => letter.toUpperCase()); }
function activityTone(status) { return ['failed', 'error'].includes(status) ? 'bad' : ['completed', 'success', 'succeeded'].includes(status) ? 'good' : ['started', 'queued', 'running', 'cancelled'].includes(status) ? 'warn' : ''; }
function activityPreview() {
  const items = (Array.isArray(state.activity) ? state.activity : []).slice(0, 3);
  return items.length ? el('div', { class: 'activity-preview' }, items.map(item => el('div', { class: 'activity-item' }, el('span', { class: 'activity-symbol' }, icon(item.status === 'failed' ? 'alert' : ['completed', 'success', 'succeeded'].includes(item.status) ? 'check' : 'clock')), el('div', { class: 'activity-copy' }, el('strong', {}, actionLabel(item.action)), el('p', {}, item.message || item.target || '')), el('span', { class: 'activity-time' }, relativeTime(item.time))))) : empty('A fresh workspace', 'Scans, saves, and other actions will appear here as you work.', 'activity', null, true);
}
function renderOverview() {
  const system = state.overview?.system || {};
  const git = state.git;
  const used = Math.max(0, Number(system.memoryTotal || 0) - Number(system.memoryFree || 0));
  const percentage = system.memoryTotal ? Math.round(used / system.memoryTotal * 100) : 0;
  const machine = panel('System memory', 'Current memory allocation and processor count.', el('div', {},
    el('div', { class: 'machine-summary' }, donut([{ value: used }, { value: system.memoryFree || 0, color: '#e6eedb' }], `${percentage}%`, 'MEMORY IN USE'), el('div', { class: 'machine-values' }, el('div', {}, el('span', { class: 'legend-dot swatch-0' }), el('small', {}, 'In use'), el('strong', {}, bytes(used))), el('div', {}, el('span', { class: 'legend-dot swatch-6' }), el('small', {}, 'Available'), el('strong', {}, bytes(system.memoryFree))))),
    el('div', { class: 'machine-specs' }, el('span', {}, icon('cpu'), `${number(system.cpus)} CPU cores`), el('span', {}, icon('clock'), `Up ${duration(system.uptime)}`))), textButton('Details', () => navigate('processes')));
  const storage = panel('Storage analysis', '', el('div', {}, el('div', {}, el('p', {}, 'See where your space goes. Review old temporary files before moving anything.'), textButton('Explore storage', () => navigate('storage'))), el('div', { class: 'storage-illustration', 'aria-hidden': 'true' })), badge('ON YOUR DEVICE', ''), 'storage-teaser');
  const storageBody = storage.querySelector('.panel-body');
  storageBody.replaceChildren(...storageBody.firstChild.childNodes);
  const quick = (title, description, name, screen) => el('button', { type: 'button', class: 'quick-action', onClick: () => navigate(screen) }, el('span', { class: 'quick-action-icon' }, icon(name)), el('span', {}, el('strong', {}, title), el('p', {}, description)), icon('arrow'));
  setPage(
    heading('Overview', 'Files, development tools, and system controls in one local workspace.', [button('Toolbox', 'sparkles', handle(openToolbox)), button('Refresh', 'refresh', () => navigate('overview'), 'primary')], 'Jarvis Workbench'),
    state.overview?.demo ? notice('Demo workspace — all sample data is labeled. Local actions are disabled by the server.', 'warning') : null,
    state.overview?.activityWarning ? notice(state.overview.activityWarning, 'warning') : null,
    el('div', { class: 'metrics' }, metric('Files to save', git?.isRepo ? number(git.changes?.length || 0) : '—', git?.isRepo ? (git.clean ? 'Your working tree is clean' : 'Review before you commit') : 'Open a Git project to begin', 'file', !!git?.clean), metric('Ready to upload', git?.isRepo ? number(git.ahead || 0) : '—', git?.upstream ? 'Commits since last fetched remote' : 'No upstream branch configured', 'upload'), metric('Memory available', bytes(system.memoryFree), `of ${bytes(system.memoryTotal)} total memory`, 'cpu'), metric('Logical CPU cores', number(system.cpus), system.hostname || 'On your computer', 'grid')),
    el('div', { class: 'overview-grid' }, el('div', { class: 'stack' }, gitSummaryCard(), panel('Recent activity', 'Recent scans, changes, and system actions.', activityPreview(), textButton('View all', () => navigate('activity')))), el('div', { class: 'stack' }, machine, storage)),
    el('div', { class: 'section-caption' }, el('h2', {}, 'Workspace tools'), el('span', { class: 'subtle', text: 'Choose a task to get started' })),
    el('div', { class: 'quick-actions' }, quick('Find anything', 'Search text and code across your workspace.', 'search', 'search'), quick('Save & sync', 'Know what’s saved and what’s uploaded.', 'branch', 'git'), quick('Analyze storage', 'Understand storage. Clean up with a plan.', 'drive', 'storage')),
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
  const openEntry = item => item.type === 'directory' ? (state.filePath = item.path, navigate('files')) : openPreview(item.path);
  const fill = () => {
    const filtered = data.entries.filter(item => item.name.toLowerCase().includes(state.fileFilter.toLowerCase()));
    rows.replaceChildren(...filtered.slice(0, 1000).map(item => el('tr', {},
      el('td', {}, el('div', { class: 'cell-name' }, icon(item.type === 'directory' ? 'folder' : 'file'), el('button', { type: 'button', onClick: handle(() => openEntry(item)) }, item.name))),
      el('td', {}, badge(item.type)), el('td', { class: 'nowrap' }, item.type === 'directory' ? '—' : bytes(item.size)), el('td', { class: 'nowrap' }, timestamp(item.modified)),
      el('td', { class: 'right' }, el('div', { class: 'row-actions' }, iconButton(item.type === 'directory' ? 'chevron' : 'search', `Open ${item.name}`, handle(() => openEntry(item))), iconButton('more', `Actions for ${item.name}`, () => fileActions(item)))))));
    if (!filtered.length) rows.append(el('tr', {}, el('td', { colspan: 5 }, empty(state.fileFilter ? 'No matching files' : 'This folder is empty', state.fileFilter ? 'Try another filename or clear the filter.' : 'Create a folder or add files from your computer.', 'folder', null, true))));
    count.textContent = `${number(filtered.length)} ${filtered.length === 1 ? 'item' : 'items'}${filtered.length > 1000 ? ' · showing first 1,000; filter to narrow the list' : ''}${state.fileFilter ? ` · filtered from ${number(data.entries.length)}` : ''}`;
  };
  fill();
  const content = el('section', { class: 'panel files-panel' }, el('div', { class: 'panel-toolbar' }, el('div', { class: 'path-label' }, data.parent !== null ? iconButton('back', 'Go to parent folder', () => { state.filePath = data.parent || ''; navigate('files'); }) : icon('folder'), el('code', { title: `${state.root}/${data.path}` }, data.path || basename(state.root))), searchField('Filter this folder...', state.fileFilter, value => { state.fileFilter = value; fill(); })),
    el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, ['Name', 'Type', 'Size', 'Modified', 'Actions'].map(name => el('th', {}, name)))), rows)), el('div', { class: 'table-end' }, count, el('span', {}, 'Files stay within this workspace')));
  setPage(heading('Files', 'Browse, preview, and organize the files in your workspace.', [button('Recovery', 'undo', handle(fileRecovery)), button('New folder', 'folder', () => editFileAction('mkdir'), 'primary'), button('Refresh', 'refresh', () => navigate('files'))], 'Files & folders'), content,
    el('p', { class: 'muted-caption' }, 'Use the actions menu on a row to copy, move, rename, or move an item to recovery. Existing files are never overwritten.'));
}
function fileActions(item) {
  const actions = [['copy', 'Copy', 'Create a copy at a new workspace path.', 'copy'], ['move', 'Move', 'Move this item to a different workspace path.', 'folder'], ['rename', 'Rename', 'Change the name in its current folder.', 'file'], ['trash', 'Move to recovery', 'Remove this item from its folder, with an option to restore.', 'undo']];
  openModal(item.name, el('div', {}, el('p', { class: 'path-label' }, item.path), el('div', { class: 'file-action-list' }, actions.map(([action, label, description, name]) => el('button', { type: 'button', class: 'file-action', onClick: handle(() => action === 'trash' ? reviewFileAction({ action, path: item.path }) : editFileAction(action, item)) }, icon(name), el('span', {}, el('strong', {}, label), el('small', {}, description)), icon('chevron'))))));
}
function editFileAction(action, item) {
  const input = el('input', { type: 'text', value: action === 'rename' ? item.name : '', autocomplete: 'off', placeholder: action === 'mkdir' ? 'New folder name' : action === 'rename' ? 'New name' : 'folder/new-name.ext' });
  const label = action === 'mkdir' ? 'Folder name' : action === 'rename' ? 'New name' : 'Destination path';
  const title = ({ mkdir: 'Create a folder', copy: 'Copy an item', move: 'Move an item', rename: 'Rename an item' })[action];
  const details = [['Workspace', state.root], ['Current folder', state.filePath || '/'], ...(item ? [['Source', item.path]] : [])];
  openModal(title, el('div', {}, el('div', { class: 'review-details' }, definition(details)), formField(label, input, ['copy', 'move'].includes(action) ? 'Enter the complete destination path relative to this workspace, including the new filename or folder name.' : 'Use a name without folder separators.')),
    { confirmText: 'Review change', onConfirm: async () => {
      const value = input.value.trim(); if (!value) throw new Error(`Enter a ${label.toLowerCase()}.`);
      await reviewFileAction({ action, path: item?.path ?? state.filePath, ...(['copy', 'move'].includes(action) ? { destination: value } : { name: value }) });
    } });
}
async function reviewFileAction(body) {
  const plan = await api('/api/files/plan', { method: 'POST', body });
  const title = ({ mkdir: 'Create folder', copy: 'Copy item', move: 'Move item', rename: 'Rename item', trash: 'Move to recovery', restore: 'Restore item' })[body.action];
  const details = [['Workspace', state.root], ['Action', title], ...(body.path !== undefined ? [['Source', body.path || '/']] : []), ...(body.name ? [['New name', body.name]] : []), ...(body.destination ? [['Destination', body.destination]] : []), ...(plan.destination ? [['Target', plan.destination]] : []), ...(Number.isFinite(plan.files) ? [['Files', number(plan.files)], ['Size', bytes(plan.bytes || 0)]] : [])];
  openModal(`${title}?`, el('div', {}, el('div', { class: 'review-details' }, definition(details)),
    notice(plan.warning || (body.action === 'trash' ? 'This item will move into workspace recovery. Its space will still be used, and you can restore it later.' : 'Jarvis checks the item again before applying this change. Existing destination files will not be overwritten.'), body.action === 'trash' ? 'warning' : ''),
    (plan.warnings || []).map(warning => notice(warning, 'warning'))),
    { confirmText: title, confirmIcon: body.action === 'trash' ? 'undo' : 'check', onConfirm: () => launchJob('/api/files/execute', { planId: plan.id, confirmed: true }, title, async () => {
      if (state.screen === 'files') { state.files = await api(`/api/files?path=${encodeURIComponent(state.filePath)}`); renderFiles(); }
    }, 'files') });
}
async function fileRecovery() {
  const result = await api('/api/files/recovery');
  const records = Array.isArray(result) ? result : result.records || result.history || [];
  const content = records.length ? el('div', {}, notice('Items in recovery still use disk space. Restoring never overwrites an existing file.'), el('div', { class: 'recovery-list' }, records.map(item => el('div', { class: 'setting-row' }, icon('undo'), el('div', { class: 'setting-copy' }, el('h3', {}, item.originalPath || item.path || item.name || 'Recovered item'), el('p', {}, timestamp(item.createdAt || item.time)), item.status ? badge(item.status) : null), item.available === true ? button('Review restore', 'undo', handle(() => reviewFileAction({ action: 'restore', recoveryId: item.id })), 'small', { disabled: !!state.activeJob }) : null)))) : empty('Workspace recovery is empty', 'Items you move to recovery from the file manager will appear here.', 'undo', null, true);
  openModal('Workspace recovery', content, { subtitle: state.root, wide: true });
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
  setPage(heading('Search files', 'Search your project without memorizing grep. Start with a word or use a pattern.', [button('Search tips', 'sparkles', handle(() => openToolbox('Search')))], 'Search across your workspace'), form, results);
  fillResults(results);
  query.focus();
  if (state.search.autoRun) { state.search.autoRun = false; void search(); }
}
function fillResults(holder) {
  const result = state.search.result;
  if (!result) { holder.replaceChildren(el('div', { class: 'panel' }, empty('Search within file contents', 'Try a function name, an error message, or TODO. Dependencies, caches, and build folders are skipped.', 'search'))); return; }
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
  if (!git?.isRepo) { setPage(heading('Git & sync', 'A clear view of your local changes and your last known remote status.', [], 'Git & sync'), el('div', { class: 'panel' }, empty('This folder isn’t a Git repository', 'Open Jarvis in a Git project to review, save, and upload your work.', 'branch'))); return; }
  const changes = git.changes || [];
  const rows = changes.map(item => el('tr', {}, el('td', {}, el('div', { class: 'cell-name' }, icon('file'), el('button', { type: 'button', onClick: handle(() => openDiff(item.path)) }, item.path))), el('td', {}, badge(item.kind, item.kind === 'conflict' ? 'bad' : item.kind === 'untracked' ? 'good' : '')), el('td', { class: 'right' }, iconButton('search', `Review ${item.path}`, handle(() => openDiff(item.path))))));
  const changeTable = changes.length ? table(['Changed file', 'Status', ''], rows, `${number(changes.length)} changed files in the whole Git repository`) : el('section', { class: 'panel' }, empty('Your working tree is clean', git.ahead ? 'Your changes are saved locally. There are still commits ready to upload.' : 'There are no uncommitted changes. Fetch to refresh your view of the remote.', 'check'));
  const ready = !git.conflicts && !git.operation && !git.detached;
  const actions = panel('One step at a time', 'Review first. Then choose an action.', el('div', { class: 'git-actions' }, button('Save snapshot', 'check', handle(() => reviewGit('commit')), 'primary', { disabled: !changes.length || !ready }), button('Upload commits', 'upload', handle(() => reviewGit('push')), '', { disabled: !git.remoteUrl || !ready || git.unborn }), button('Download updates', 'download', handle(() => reviewGit('pull')), '', { disabled: !git.remoteUrl || !ready || !git.clean }), button('Fetch remote status', 'refresh', handle(() => launchAction('fetch', {}, 'Fetching remote status')), '', { disabled: !git.remoteUrl }), el('p', {}, 'A snapshot stages every changed file in this Git repository. Upload sends saved commits to your existing remote.')));
  const info = panel('Repository details', null, definition([['Root', git.root], ['Branch', git.branch || 'Detached HEAD'], ['Upstream', git.upstream || 'Not configured'], ['Remote', git.remoteUrl || 'Not configured'], ['Last save', git.lastCommit ? `${git.lastCommit.hash} · ${git.lastCommit.subject}` : 'No commits yet']]));
  setPage(heading('Git & sync', 'Your local changes, saved commits, and remote status — in one clear view.', [button('Refresh', 'refresh', () => navigate('git'))], 'Git & sync'),
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
    rows.replaceChildren(...items.slice(0, 600).map(item => el('tr', {}, el('td', {}, el('div', { class: 'cell-name' }, icon('box'), item.name)), el('td', { class: 'mono' }, item.pid), el('td', {}, Number(item.cpu || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })), el('td', {}, bytes(item.memory)), el('td', {}, badge('Running', 'good')), el('td', { class: 'right' }, button('Stop', 'stop', handle(() => reviewProcessStop(item)), 'small process-stop', { 'aria-label': `Review stopping ${item.name} (PID ${item.pid})`, disabled: !!state.activeJob })))));
    if (!items.length) rows.append(el('tr', {}, el('td', { colspan: 6 }, empty('No matching processes', 'Try another name or process ID.', 'cpu', null, true))));
    summary.textContent = `${number(items.length)} processes${items.length > 600 ? ' · showing first 600' : ''} · ${data.cpuLabel}`;
  };
  fill();
  const sort = el('select', { 'aria-label': 'Sort processes', onChange: event => { state.processSort = event.target.value; fill(); } }, el('option', { value: 'memory', selected: state.processSort === 'memory' }, 'Highest memory first'), el('option', { value: 'cpu', selected: state.processSort === 'cpu' }, 'Highest CPU first'));
  setPage(heading('Processes', 'See what is running, inspect memory use, and review a process before stopping it.', [button('Refresh', 'refresh', () => navigate('processes'))], 'Processes'),
    data.warning ? notice(data.warning, 'warning') : null,
    el('div', { class: 'toolbar' }, searchField('Filter by process name or PID…', state.processFilter, value => { state.processFilter = value; fill(); }), sort, badge('REVIEW BEFORE STOPPING', '', 'shield')),
    el('section', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, ['Process', 'PID', data.cpuLabel, 'Memory', 'Status', 'Action'].map(value => el('th', {}, value)))), rows)), el('div', { class: 'table-end' }, summary, el('span', {}, 'Refresh for a new snapshot'))),
    el('p', { class: 'muted-caption' }, 'Windows reports cumulative CPU seconds; Linux and macOS report CPU percentage. Stopping affects only the selected process and can lose unsaved work.'));
}
async function reviewProcessStop(item) {
  if (state.activeJob) throw new Error('Another task is running. Let it finish or cancel it before stopping a process.');
  const plan = await api('/api/processes/plan', { method: 'POST', body: { pid: item.pid } });
  const body = el('div', {},
    notice('Unsaved work can be lost. Save your work in this application before continuing.', 'warning', 'alert'),
    el('div', { class: 'review-details process-review' }, definition([
      ['Process', plan.name], ['PID', plan.pid], ['Owner', plan.owner],
      ['Started / identity', plan.startedAt], ['Stop method', plan.method], ['Review expires', timestamp(plan.expiresAt)],
    ])),
    notice(plan.warning || (plan.platform === 'win32'
      ? 'Windows stops this process immediately; the application may not get a chance to save.'
      : 'Jarvis sends SIGTERM. The application may take time to exit or may keep running.'), 'warning'),
    el('p', { class: 'muted-caption' }, 'Only this process is targeted. Jarvis checks its identity again before sending the stop request.'));
  openModal(`Stop ${plan.name}?`, body, {
    subtitle: `PID ${plan.pid}`, confirmText: 'Stop process', danger: true, confirmIcon: 'stop',
    onConfirm: () => launchJob('/api/processes/stop', { planId: plan.id, confirmed: true }, `Stop ${plan.name} (PID ${plan.pid})`, async () => {
      state.processes = await api('/api/processes');
      if (state.screen === 'processes') renderProcesses();
    }, 'process-stop'),
  });
}

function controlUnavailable(title, data, setting) {
  return el('section', { class: 'panel' }, empty(title, data.reason || data.message || data.warning || 'This control is available on supported Windows computers.', 'settings', setting ? button('Open Windows settings', 'external', handle(() => openSystemSetting(setting))) : null));
}
function formField(label, input, hint = '') {
  const id = input.getAttribute('id') || `field-${++formField.sequence}`;
  input.setAttribute('id', id);
  return el('div', { class: 'form-field' }, el('label', { for: id }, label), input, hint ? el('p', { class: 'field-hint' }, hint) : null);
}
formField.sequence = 0;
function values(value) { return Array.isArray(value) ? value.map(item => typeof item === 'object' ? item.address || item.ipAddress || item.name || '' : item).filter(Boolean).join(', ') || '—' : value || '—'; }
async function openSystemSetting(id) {
  const result = await api('/api/settings/open', { method: 'POST', body: { id, confirmed: true } });
  toast(result.message || 'Opened Windows settings.');
}
async function reviewNetwork(body, title) {
  const plan = await api('/api/network/plan', { method: 'POST', body });
  const adapter = state.network?.adapters?.find(item => item.id === body.adapterId);
  const details = [['Adapter', adapter?.name || body.adapterId], ['Action', title]];
  if (body.profile) details.push(['Saved network', body.profile]);
  if (body.action === 'dns') details.push(['DNS servers', body.dns === null ? 'Automatic (DHCP)' : values(body.dns)]);
  openModal(title, el('div', {}, el('div', { class: 'review-details' }, definition(details)),
    notice(plan.warning || 'Changing network settings may interrupt connections, downloads, and remote sessions.', 'warning'),
    el('p', { class: 'muted-caption' }, 'Review these settings before applying them. System permissions may be required.')),
    { confirmText: 'Apply network change', onConfirm: () => launchJob('/api/network/execute', { planId: plan.id, confirmed: true }, title, async () => {
      state.network = await api('/api/network'); if (state.screen === 'network') renderNetwork();
    }, 'network') });
}
function reviewDns(adapter) {
  const mode = el('select', {}, el('option', { value: 'automatic' }, 'Automatic - use network DNS'), el('option', { value: 'manual' }, 'Custom DNS servers'));
  const servers = el('input', { type: 'text', placeholder: '1.1.1.1, 8.8.8.8', 'aria-label': 'DNS server addresses', disabled: true });
  mode.addEventListener('change', () => { servers.disabled = mode.value !== 'manual'; if (!servers.disabled) servers.focus(); });
  openModal('Configure DNS', el('div', {}, el('div', { class: 'review-details' }, definition([['Adapter', adapter.name], ['Current DNS', values(adapter.dns)]])),
    formField('DNS mode', mode), formField('DNS servers', servers, 'For custom DNS, enter IPv4 addresses separated by commas.')),
    { confirmText: 'Review change', onConfirm: async () => {
      const dns = mode.value === 'manual' ? servers.value.split(/[\s,;]+/).filter(Boolean) : null;
      if (dns && !dns.length) throw new Error('Enter at least one DNS server address.');
      await reviewNetwork({ action: 'dns', adapterId: adapter.id, dns }, 'Change DNS settings');
    } });
}
function reviewWifiPassword(profile) {
  openModal('View saved Wi-Fi password?', el('div', {}, el('div', { class: 'review-details' }, definition([['Network', profile.name], ['Adapter', profile.interfaceName || profile.adapterId]])),
    notice('This is a saved credential on your computer. It will be shown only in this dialog and cleared when you close it or change views.', 'warning', 'shield')),
    { confirmText: 'Load saved password', onConfirm: async () => {
      const reviewRevision = modalRevision;
      const result = await api('/api/network/password', { method: 'POST', body: { profile: profile.name, adapterId: profile.adapterId, confirmed: true } });
      if (reviewRevision !== modalRevision || !modal.open) { result.password = ''; return; }
      const password = el('input', { type: 'password', autocomplete: 'off', readonly: true, 'aria-label': 'Saved Wi-Fi password' });
      password.value = result.password || '';
      result.password = '';
      const reveal = button('Show password', 'search', () => {
        const show = password.type === 'password' || password.getAttribute('type') === 'password';
        password.type = show ? 'text' : 'password'; password.setAttribute('type', password.type);
        reveal.textContent = show ? 'Hide password' : 'Show password';
      });
      openModal('Saved Wi-Fi password', el('div', {}, el('p', {}, profile.name), formField('Password', password),
        el('div', { class: 'button-row section-space' }, reveal), el('p', { class: 'muted-caption' }, 'The password is not written to your activity log. Close this dialog to clear it.')));
      sensitiveCleanup = () => { password.value = ''; password.type = 'password'; password.setAttribute('type', 'password'); };
    } });
}
function renderNetwork() {
  const data = state.network || {};
  const header = heading('Network', 'Manage saved Wi-Fi connections, inspect adapters, and configure DNS.', [button('Windows network settings', 'external', handle(() => openSystemSetting('network'))), button('Refresh', 'refresh', () => navigate('network'))], 'System controls');
  if (data.available === false) { setPage(header, controlUnavailable('Network controls are unavailable', data)); return; }
  const adapters = data.adapters || [];
  const adapterRows = adapters.map(adapter => el('tr', {},
    el('td', {}, el('div', { class: 'cell-name' }, icon(adapter.wifi ? 'wifi' : 'network'), el('strong', {}, adapter.name)), el('p', { class: 'candidate-reason' }, adapter.description || adapter.id)),
    el('td', {}, badge(adapter.status || 'Unknown', /^(up|connected)$/i.test(adapter.status || '') ? 'good' : '')),
    el('td', { class: 'mono' }, values(adapter.addresses)), el('td', { class: 'mono' }, values(adapter.dns)),
    el('td', {}, el('div', { class: 'row-actions' }, button('Details', 'info', () => openModal(adapter.name, el('div', { class: 'review-details' }, definition([
      ['Status', adapter.status], ['IPv4 / IPv6', values(adapter.addresses)], ['Gateway', values(adapter.gateway)], ['IPv4 DNS', values(adapter.dns)], ['IPv6 DNS', values(adapter.dnsIpv6)], ['DHCP', adapter.dhcp === true ? 'Automatic' : adapter.dhcp === false ? 'Manual' : 'Not reported'], ['Connection', adapter.profile || '—'],
    ]))), 'small'), button('DNS', 'settings', () => reviewDns(adapter), 'small', { disabled: !!state.activeJob }),
    adapter.wifi && /^(up|connected)$/i.test(adapter.status || '') ? button('Disconnect', 'close', handle(() => reviewNetwork({ action: 'disconnect', adapterId: adapter.id }, 'Disconnect Wi-Fi')), 'small', { disabled: !!state.activeJob }) : null))));
  const profiles = data.profiles || [];
  const profilesTable = profiles.length ? table(['Saved network', 'Adapter', 'Actions'], profiles.map(profile => el('tr', {}, el('td', {}, el('div', { class: 'cell-name' }, icon('wifi'), profile.name)), el('td', {}, profile.interfaceName || adapters.find(adapter => adapter.id === profile.adapterId)?.name || 'Wi-Fi'), el('td', {}, el('div', { class: 'row-actions' }, button('Connect', 'wifi', handle(() => reviewNetwork({ action: 'connect', adapterId: profile.adapterId, profile: profile.name }, 'Connect to saved Wi-Fi')), 'small', { disabled: !!state.activeJob }), button('Saved password', 'shield', () => reviewWifiPassword(profile), 'small')))))) : el('section', { class: 'panel' }, empty('No saved Wi-Fi networks', 'Use Windows network settings to join a new network. Saved profiles will appear here after refreshing.', 'wifi', null, true));
  setPage(header, data.warning ? notice(data.warning, 'warning') : null, (data.warnings || []).map(warning => notice(warning, 'warning')),
    el('div', { class: 'section-caption' }, el('h2', {}, 'Network adapters'), el('span', { class: 'subtle' }, `${adapters.length} adapters`)),
    adapters.length ? table(['Adapter', 'Status', 'IP addresses', 'DNS servers', 'Actions'], adapterRows) : el('section', { class: 'panel' }, empty('No adapters reported', 'Refresh or open Windows network settings to inspect your connection.', 'network', null, true)),
    el('div', { class: 'section-caption' }, el('h2', {}, 'Saved Wi-Fi networks'), el('span', { class: 'subtle' }, 'Only profiles already saved on this computer')),
    profilesTable, el('p', { class: 'muted-caption' }, 'For a new Wi-Fi network or manual IP/gateway assignment, open Windows network settings. Network changes are reviewed before they run.'));
}
function renderAudio() {
  const data = state.audio || {};
  const header = heading('Sound', 'Adjust your default output volume and inspect connected audio devices.', [button('Windows sound settings', 'external', handle(() => openSystemSetting('sound'))), button('Refresh', 'refresh', () => navigate('audio'))], 'System controls');
  if (data.available === false) { setPage(header, controlUnavailable('Audio controls are unavailable', data)); return; }
  const volume = el('input', { type: 'range', min: 0, max: 100, step: 1, value: Number(data.volume || 0), 'aria-label': 'Output volume' });
  const output = el('output', { class: 'volume-value' }, `${Math.round(Number(data.volume || 0))}%`);
  volume.addEventListener('input', () => { output.textContent = `${volume.value}%`; });
  const apply = button('Apply volume', 'check', handle(async () => {
    apply.disabled = true;
    try { const result = await api('/api/audio', { method: 'POST', body: { volume: Number(volume.value), confirmed: true } }); toast(result.message || 'Volume updated.'); state.audio = await api('/api/audio'); if (state.screen === 'audio') renderAudio(); }
    finally { apply.disabled = false; }
  }), 'primary');
  const mute = button(data.muted ? 'Unmute output' : 'Mute output', 'audio', handle(async () => {
    mute.disabled = true;
    try { const result = await api('/api/audio', { method: 'POST', body: { muted: !data.muted, confirmed: true } }); toast(result.message || (data.muted ? 'Output unmuted.' : 'Output muted.')); state.audio = await api('/api/audio'); if (state.screen === 'audio') renderAudio(); }
    finally { mute.disabled = false; }
  }));
  const devices = data.devices || [];
  setPage(header, data.warning ? notice(data.warning, 'warning') : null,
    panel('Default output', data.defaultDevice || 'Volume changes apply to the current default playback device.', el('div', { class: 'audio-control' }, el('div', { class: 'volume-control' }, icon('audio'), volume, output), el('div', { class: 'button-row' }, apply, mute), el('p', { class: 'field-hint' }, 'Drag the slider, then apply. Muting preserves your volume level.')), badge(data.muted ? 'Muted' : 'Sound on', data.muted ? 'warn' : 'good')),
    el('div', { class: 'section-caption' }, el('h2', {}, 'Audio devices'), textButton('Choose input or output in Windows', handle(() => openSystemSetting('sound')), 'external')),
    devices.length ? table(['Device', 'Type', 'Status'], devices.map(device => el('tr', {}, el('td', {}, el('div', { class: 'cell-name' }, icon('audio'), device.name)), el('td', {}, /input|capture|record/i.test(device.kind) ? 'Input / microphone' : 'Output / speakers'), el('td', {}, device.isDefault ? badge('Default', 'good') : device.status || 'Available')))) : el('section', { class: 'panel' }, empty('No audio devices reported', 'Windows sound settings can show disconnected devices and device permissions.', 'audio', null, true)));
}
function securityState(value, enabled = 'On', disabled = 'Off') { return value === true ? badge(enabled, 'good') : value === false ? badge(disabled, 'bad') : badge('Not reported'); }
async function reviewSecurityScan(type, path) {
  const plan = await api('/api/security/plan', { method: 'POST', body: { type, ...(path ? { path } : {}) } });
  openModal(plan.title || `${type[0].toUpperCase() + type.slice(1)} scan`, el('div', {}, el('div', { class: 'review-details' }, definition([['Engine', 'Microsoft Defender'], ['Scan', type], ...(path ? [['Folder', path]] : [])])),
    notice(plan.warning || 'A scan can use significant disk and CPU resources. Defender manages detection and remediation using your Windows security policy.'),
    el('p', { class: 'muted-caption' }, 'Jarvis reports Defender status and output. Stopping monitoring may leave the Defender scan running.')),
    { confirmText: 'Start Defender scan', onConfirm: () => launchJob('/api/security/scan', { planId: plan.id, confirmed: true }, plan.title || 'Microsoft Defender scan', async () => {
      state.security = await api('/api/security'); if (state.screen === 'security') renderSecurity();
    }, 'security-scan') });
}
function customSecurityScan() {
  const path = el('input', { type: 'text', value: state.root, placeholder: 'C:\\Users\\YourName\\Downloads', 'aria-label': 'Folder to scan' });
  openModal('Scan a folder', el('div', {}, formField('Folder path', path, 'Use an absolute folder path on this computer.')),
    { confirmText: 'Review scan', onConfirm: async () => { if (!path.value.trim()) throw new Error('Enter a folder to scan.'); await reviewSecurityScan('custom', path.value.trim()); } });
}
function renderSecurity() {
  const data = state.security || {};
  const header = heading('Security', 'Run Microsoft Defender scans and review protection status reported by Windows.', [button('Open Windows Security', 'external', handle(() => openSystemSetting('security'))), button('Refresh', 'refresh', () => navigate('security'))], 'System controls');
  if (data.available === false) { setPage(header, controlUnavailable('Microsoft Defender is unavailable', data)); return; }
  const detections = data.detections || [];
  const active = state.activeJob?.kind === 'security-scan';
  const disabled = data.canScan === false || !!state.activeJob;
  const scanStatus = typeof data.scanStatus === 'object' ? data.scanStatus?.status || data.scanStatus?.message || 'Not reported' : data.scanStatus || 'Not reported';
  const scan = (title, description, onClick) => el('div', { class: 'setting-row' }, el('span', { class: 'control-symbol' }, icon('shield')), el('div', { class: 'setting-copy' }, el('h3', {}, title), el('p', {}, description)), button(active ? 'Scan running' : 'Review scan', 'play', handle(onClick), 'small', { disabled }));
  setPage(header, (data.warnings || []).map(warning => notice(warning, 'warning')),
    el('section', { class: 'panel status-strip' }, el('div', {}, el('span', {}, 'Antivirus'), securityState(data.enabled, 'Enabled', 'Disabled')), el('div', {}, el('span', {}, 'Real-time protection'), securityState(data.realtimeEnabled)), el('div', {}, el('span', {}, 'Definitions updated'), el('strong', {}, timestamp(data.definitionsUpdated))), el('div', {}, el('span', {}, 'Scan status'), el('strong', {}, scanStatus))),
    active ? el('div', { class: 'scan-progress' }, el('span', { class: 'spinner' }), el('div', {}, el('strong', {}, 'Monitoring Microsoft Defender...'), el('p', {}, 'Progress is shown when the scan engine reports it. No percentage is estimated.')), button('Stop monitoring', 'close', handle(cancelJob), 'small')) : null,
    data.canScan === false ? notice(data.scanUnavailableReason || 'Scanning is unavailable with the current Windows permissions or Defender configuration.', 'warning') : null,
    el('div', { class: 'section-caption' }, el('h2', {}, 'Start a scan'), el('span', { class: 'subtle' }, 'Microsoft Defender engine')),
    el('section', { class: 'panel settings-list' }, scan('Quick scan', 'Scan common locations where threats are found.', () => reviewSecurityScan('quick')), scan('Full scan', 'Scan files and running programs across the computer. This can take a long time.', () => reviewSecurityScan('full')), scan('Custom scan', 'Choose a specific folder to scan.', customSecurityScan)),
    el('div', { class: 'section-caption' }, el('h2', {}, 'Detection history'), el('span', { class: 'subtle' }, 'Reported by Microsoft Defender')),
    detections.length ? table(['Detection', 'Severity', 'Status', 'When', 'Details'], detections.map(item => el('tr', {}, el('td', {}, item.name || item.id || 'Detected threat'), el('td', {}, String(item.severity || 'Not reported')), el('td', {}, badge(item.active ? 'Active' : item.actionSuccess ? 'Action succeeded' : 'Review in Windows', item.active ? 'bad' : item.actionSuccess ? 'good' : 'warn')), el('td', { class: 'nowrap' }, timestamp(item.detectedAt)), el('td', {}, button('Details', 'info', () => openModal('Detection details', el('div', {}, definition([['Name', item.name], ['Severity', item.severity], ['Detected', timestamp(item.detectedAt)]]), el('ul', { class: 'review-list' }, (item.resources || []).map(resource => el('li', {}, resource))), button('Open Windows Security', 'external', handle(() => openSystemSetting('security'))))), 'small'))))) : el('section', { class: 'panel' }, empty('No detection history reported', 'This is the history returned by Defender, not a guarantee that the computer is threat-free. Run a scan or inspect Windows Security for more detail.', 'shield', null, true)),
    el('p', { class: 'muted-caption' }, 'Jarvis uses Windows security tools. It does not replace an antivirus engine or change your protection policy.'));
}
function renderSettings() {
  const data = state.settings || {};
  const header = heading('System settings', 'Useful Windows controls and direct paths to the settings you use most.', [button('Refresh', 'refresh', () => navigate('settings'))], 'System controls');
  if (data.available === false) { setPage(header, controlUnavailable('Windows controls are unavailable', data)); return; }
  const items = data.items || [];
  const plans = data.powerPlans || [];
  const planSelect = el('select', { 'aria-label': 'Power plan' }, plans.map(plan => el('option', { value: plan.id, selected: !!plan.active }, plan.name)));
  const apply = button('Review power plan', 'check', handle(async () => {
    const selected = plans.find(plan => plan.id === planSelect.value);
    if (!selected) throw new Error('Choose an available power plan.');
    const plan = await api('/api/settings/plan', { method: 'POST', body: { action: 'power-plan', id: selected.id } });
    openModal('Change power plan?', el('div', {}, el('div', { class: 'review-details' }, definition([['Power plan', selected.name]])), notice(plan.warning || 'Power plans affect battery life, performance, and sleep behavior.')),
      { confirmText: 'Apply power plan', onConfirm: () => launchJob('/api/settings/execute', { planId: plan.id, confirmed: true }, 'Change power plan', async () => { state.settings = await api('/api/settings'); if (state.screen === 'settings') renderSettings(); }, 'settings') });
  }), 'primary', { disabled: !!state.activeJob });
  setPage(header, plans.length ? panel('Power plan', 'Choose an existing Windows power plan.', el('div', { class: 'inline-form' }, formField('Active plan', planSelect), apply)) : data.powerPlanError ? notice(data.powerPlanError, 'warning') : null,
    el('div', { class: 'section-caption' }, el('h2', {}, 'Windows settings'), el('span', { class: 'subtle' }, 'Opens the system settings app')),
    el('section', { class: 'panel settings-list' }, items.filter(item => item.available !== false).map(item => el('div', { class: 'setting-row' }, el('span', { class: 'control-symbol' }, icon(({ sound: 'audio', network: 'wifi', security: 'shield', storage: 'drive', apps: 'box', updates: 'refresh' })[item.id] || 'settings')), el('div', { class: 'setting-copy' }, el('h3', {}, item.title), el('p', {}, item.description)), button('Open settings', 'external', handle(() => openSystemSetting(item.id)), 'small')))),
    el('p', { class: 'muted-caption' }, 'These shortcuts open Windows settings. Changes there are managed by Windows; they do not apply automatically.'));
}

function renderPorts() {
  const data = state.ports || { ports: [] }; const rows = el('tbody'); const summary = el('span');
  const fill = () => {
    const items = data.ports.filter(item => `${item.port} ${item.pid} ${item.address} ${item.process || ''} ${item.protocol}`.toLowerCase().includes(state.portFilter.toLowerCase()));
    rows.replaceChildren(...items.map(item => el('tr', {}, el('td', {}, el('div', { class: 'cell-name' }, icon('network'), el('strong', {}, item.port))), el('td', {}, badge(item.protocol)), el('td', { class: 'mono' }, item.address), el('td', { class: 'mono' }, item.pid ?? 'Hidden'), el('td', {}, item.process || '—'))));
    if (!items.length) rows.append(el('tr', {}, el('td', { colspan: 5 }, empty('No matching listeners', state.portFilter ? 'Try a different port, process ID, or address.' : 'No listeners were reported by the system.', 'network', null, true))));
    summary.textContent = `${number(items.length)} local endpoints`;
  }; fill();
  setPage(heading('Ports & connections', 'Find what is using a port before starting your next server.', [button('Refresh', 'refresh', () => navigate('ports'))], 'Ports & connections'), data.warning ? notice(data.warning, 'warning') : null,
    el('div', { class: 'toolbar' }, searchField('Search port, PID, or address…', state.portFilter, value => { state.portFilter = value; fill(); }), badge('LOCAL ENDPOINTS', '', 'shield')),
    el('section', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, ['Port', 'Protocol', 'Address', 'PID', 'Process'].map(value => el('th', {}, value)))), rows)), el('div', { class: 'table-end' }, summary, el('span', {}, 'TCP listeners + bound UDP sockets'))), el('p', { class: 'muted-caption' }, 'A listening port is not necessarily reachable from the internet. Process details depend on your operating-system permissions.'));
}

function renderScripts() {
  const scripts = Array.isArray(state.scripts) ? state.scripts : [];
  setPage(heading('Project tasks', 'Named commands from this folder’s package.json. Review the command, then run it.', [button('Refresh', 'refresh', () => navigate('scripts'))], 'Project tasks'), notice('Project scripts can run code and npm lifecycle hooks. Use scripts from projects you trust. Running tasks can be cancelled.'),
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
  else if (!data.scan) content.append(el('section', { class: 'panel' }, empty('Analyze a folder or drive', 'Choose your workspace, a folder, or a drive. We’ll map file sizes and identify eligible old temporary files for your review.', 'drive')));
  else if (data.tab === 'cleanup') content.append(renderCleanup());
  else content.append(renderStorageMap());
  setPage(heading('Storage', 'Inspect disk usage and review old temporary files before cleanup.', [button('Recovery', 'undo', () => { data.tab = 'recovery'; renderStorage(); })], 'Storage & cleanup'), scope,
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
    content.replaceChildren(items.length ? table(['Action', 'Result', 'When', ''], items.map(item => el('tr', {}, el('td', {}, el('div', { class: 'cell-name' }, icon('activity'), actionLabel(item.action)), el('p', { class: 'candidate-reason', title: item.target || '' }, item.message || item.target || '')), el('td', {}, badge(actionLabel(item.status || 'Recorded'), activityTone(item.status))), el('td', { class: 'nowrap' }, timestamp(item.time)), el('td', { class: 'right' }, iconButton('search', 'View activity details', () => openModal('Activity details', el('div', { class: 'review-details' }, definition([['Action', item.action], ['Status', item.status], ['When', timestamp(item.time)], ['Target', item.target], ['Message', item.message]]))))))), `${number(items.length)} recorded actions`) : el('section', { class: 'panel' }, empty('A clear record starts here.', 'Your scans, Git actions, and project tasks will appear here as you use Jarvis.', 'activity')));
  };
  fill('all');
  setPage(heading('Activity log', 'See what ran, what changed, and what needs another look.', [button('Refresh', 'refresh', () => navigate('activity'))], 'Activity'), filters, content);
}

function openModal(title, content, { subtitle = '', wide = false, confirmText = null, onConfirm = null, danger = false, confirmIcon = null } = {}) {
  clearSensitive();
  if (modal.open) modal.close();
  const revision = ++modalRevision;
  delete modal.dataset.job;
  modal.className = `modal${wide ? ' wide' : ''}`;
  const errors = el('div');
  const body = el('div', { class: 'modal-body' }, content, errors);
  const footer = el('div', { class: 'modal-footer' }, button(confirmText ? 'Cancel' : 'Done', null, () => modal.close()));
  if (confirmText) {
    const confirm = button(confirmText, confirmIcon || (danger ? 'trash' : 'check'), async () => {
      confirm.disabled = true; errors.replaceChildren();
      try { await onConfirm?.(); if (revision === modalRevision) modal.close(); }
      catch (error) { errors.append(el('div', { class: 'modal-error', role: 'alert' }, error.message)); }
      finally { confirm.disabled = false; }
    }, danger ? 'danger' : 'primary');
    footer.append(confirm);
  }
  modal.replaceChildren(el('div', { class: 'modal-header' }, el('div', {}, el('h2', { id: 'modal-title' }, title), subtitle ? el('p', {}, subtitle) : null), iconButton('close', 'Close dialog', () => modal.close())), body, footer);
  modal.showModal();
}
function openPalette() {
  ++modalRevision;
  clearSensitive();
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
    class: 'palette-input', type: 'search', placeholder: 'Workspace tools', 'aria-label': 'Find a tool or action',
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
  openModal(category ? `${category} made simpler` : 'Command reference', content, { subtitle: 'Practical recipes, useful tools, and a little less guesswork.', wide: true });
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
  const author = typeof about.author === 'string' ? about.author : about.author?.name || 'Ashish';
  const donation = about.donations || {};
  const configured = value => typeof value === 'string' && value.trim() && !/^(?:YOUR[_ -]|PLACEHOLDER|TODO|TBD|<)/i.test(value.trim());
  const fields = [['accountNumber', 'Account number'], ['ifsc', 'IFSC'], ['upi', 'UPI ID']].filter(([key]) => configured(donation[key]));
  let supportLink = null;
  try { const url = new URL(donation.paymentUrl); if (url.protocol === 'https:' && configured(donation.paymentUrl)) supportLink = url.href; } catch { /* Unconfigured donation link. */ }
  const content = el('div', {}, el('div', { class: 'about-heading' }, el('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'j', el('span', {}, '›')), el('div', {}, el('h3', {}, about.name || 'Jarvis Workbench'), el('p', {}, `${about.version ? `Version ${about.version} · ` : ''}Created by ${author}`))),
    el('p', {}, 'Free, open-source tools for your files, terminal, and computer. Jarvis runs locally and needs no API key.'),
    el('section', { class: 'support-panel' }, el('div', { class: 'support-title' }, icon('heart'), el('h3', {}, 'Support Ashish')),
      el('p', {}, 'If Jarvis makes your work easier, you can help support its development. Donations are optional.'),
      el('p', { class: 'support-owner' }, 'Account holder: ', el('strong', {}, configured(donation.accountHolder) ? donation.accountHolder : 'Ashish')),
      fields.length || supportLink ? el('div', {}, fields.length ? el('div', { class: 'donation-fields' }, fields.map(([key, label]) => el('div', { class: 'donation-field' }, el('div', {}, el('small', {}, label), el('strong', {}, donation[key])), iconButton('copy', `Copy ${label.toLowerCase()}`, handle(() => copy(donation[key])))))) : null,
        supportLink ? el('a', { class: 'button primary section-space', href: supportLink, target: '_blank', rel: 'noopener noreferrer' }, icon('external'), 'Support this project') : null)
        : el('p', { class: 'support-coming' }, icon('clock'), 'Donation details coming soon.')),
    notice('Your browser connects directly to Jarvis on this computer. Files and system controls stay local.', '', 'shield'));
  openModal('About & support', content);
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
      else if (job.kind === 'process-stop' && job.result?.status === 'requested') toast(job.result.message || 'Stop requested; the process has not exited yet.', 'warning');
      else if (jobWarnings(job).length) toast('Task finished with notes. Open Details to review them.', 'warning');
      else if (job.result?.message) toast(job.result.message);
      else toast('Task completed.');
      await job.onDone?.(job.result);
    } else if (job.status === 'failed') {
      toast(job.error || 'The task did not finish.', true);
      if (job.kind !== 'scan' || job.result) await job.onDone?.(job.result);
    }
    else if (job.status === 'cancelled') {
      toast(job.result?.scanMayContinue ? 'Monitoring stopped. Microsoft Defender may still be scanning.' : job.result ? 'Task cancelled. Partial results are available.' : 'Task cancelled.', job.result?.scanMayContinue ? 'warning' : false);
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
  toast(job.kind === 'security-scan' ? 'Stop monitoring requested. Microsoft Defender may continue scanning.' : 'Cancellation requested.');
}
function renderJobDock(job) {
  const dock = $('#job-dock'); dock.hidden = false;
  const running = ['running', 'queued'].includes(job.status);
  const warnings = jobWarnings(job);
  const message = job.connectionError || (running ? `Working locally · ${duration((Date.now() - new Date(job.startedAt).getTime()) / 1000)} elapsed` : job.status === 'failed' ? job.error || 'Open details for the error.' : job.status === 'cancelled' ? (job.result?.scanMayContinue ? 'Monitoring stopped. Microsoft Defender may still be scanning.' : 'Cancelled. Any partial results are preserved.') : job.result?.code ? `Finished with exit code ${job.result.code}` : job.result?.message ? job.result.message : warnings.length ? 'Finished with notes. Review the task details.' : 'Completed on your computer.');
  dock.replaceChildren(running && !job.connectionError ? el('span', { class: 'spinner' }) : icon(job.status === 'failed' || job.connectionError || warnings.length ? 'alert' : 'check'), el('div', { class: 'job-copy' }, el('strong', {}, job.title), el('p', {}, message)),
    job.connectionError ? button('Reconnect', 'refresh', () => { job.connectionError = ''; void pollJob(job); }, 'small') : button('Details', null, () => openJobModal(job), 'small'),
    running ? button(job.kind === 'security-scan' ? 'Stop monitoring' : 'Cancel', null, handle(cancelJob), 'small') : iconButton('close', 'Dismiss completed task', () => { dock.hidden = true; }));
}
function openJobModal(job) {
  openModal(job.title, el('div', { id: 'job-modal-content' }), { wide: true });
  modal.dataset.job = job.id; fillJobModal(job);
}
function jobWarnings(job) {
  return [...new Set([...(['process-stop', 'network'].includes(job.kind) && job.result?.status === 'requested' ? [job.result.message || 'Stop requested; the process has not exited yet.'] : []), ...(job.result?.scanMayContinue ? ['Microsoft Defender may still be scanning. Check Windows Security for its current status.'] : []), ...(job.warnings || []), ...(job.activityWarning ? [job.activityWarning] : []), ...(job.result?.errors || []).map(error => typeof error === 'string' ? error : `${error.path || 'File'}: ${error.message || error.error || 'Needs review'}`)].filter(Boolean))];
}
function fillJobModal(job) {
  const holder = $('#job-modal-content'); if (!holder) return;
  const result = job.result;
  const extra = result && (result.stdout || result.stderr) ? [result.stdout || '', result.stderr || ''].filter(Boolean).join('\n') : '';
  const logs = (job.logs || []).join('\n');
  const warnings = jobWarnings(job);
  const resultLabel = job.kind === 'process-stop' && result?.status === 'requested' ? 'Stop requested' : warnings.length ? `${job.status} with notes` : job.status;
  replace(holder, el('div', { class: 'preview-toolbar' }, badge(resultLabel, job.status === 'failed' ? 'bad' : warnings.length ? 'warn' : job.status === 'completed' ? 'good' : 'warn'), el('span', {}, `Started ${timestamp(job.startedAt)}`)), job.error ? notice(job.error, 'error') : null,
    warnings.map(warning => notice(warning, 'warning')),
    job.kind === 'process-stop' && result ? el('div', { class: 'review-details' }, definition([['Process', result.name], ['PID', result.pid], ['Result', result.message || result.status]])) : null,
    result && ['movedBytes', 'restoredBytes', 'reclaimedBytes'].some(key => result[key] !== undefined) ? el('div', { class: 'review-details' }, definition([['Moved to recovery', bytes(result.movedBytes || 0)], ['Restored', bytes(result.restoredBytes || 0)], ['Permanently removed', bytes(result.reclaimedBytes || 0)]])) : null,
    el('pre', { class: 'code-preview' }, logs || extra || (job.status === 'running' ? 'Waiting for task output…' : 'This task produced no console output.')), job.logTruncated ? el('p', { class: 'muted-caption' }, 'Older output was truncated to keep this view responsive.') : null, ['running', 'queued'].includes(job.status) ? button(job.kind === 'security-scan' ? 'Stop monitoring' : 'Cancel task', 'close', handle(cancelJob), 'small section-space') : null);
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
  $('#header-support').addEventListener('click', handle(openAbout));
  $('#footer-support').addEventListener('click', handle(openAbout));
  modal.addEventListener('close', onModalClose);
  modal.addEventListener('cancel', clearSensitive);
  window.addEventListener('pagehide', clearSensitive);
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
