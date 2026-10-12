import path from 'node:path';
import readline from 'node:readline';
import { renderDashboard, NAV, selection, visibleFiles, visibleProcesses, visiblePorts } from './ui.js';
import { clean, friendlyError, plural, safeRemote } from './format.js';
export { safeRemote } from './format.js';
import { searchContent } from './search.js';
import { listDirectory, readPreview, analyzeDisk } from './files.js';
import { getGitStatus, getGitDiff, fetchRemote, commitAll, pushCurrent, pullCurrent } from './git.js';
import { getSystemInfo, listProcesses, listPorts, getProjectScripts } from './system.js';
import { runProjectScript } from './tasks.js';
import { RECIPES } from './recipes.js';
import { demoState } from './demo.js';
import { ActivityLog } from './activity.js';
import { openBrowser } from './browser.js';

export function initialState(root) {
  return {
    root: path.resolve(root), screen: 'overview', selected: {}, recipes: RECIPES, activity: [],
    search: { query: '', regex: false, caseSensitive: false, glob: '', matches: [] },
    files: { path: '', entries: [], parent: null }, system: getSystemInfo(), processSort: 'cpu', scripts: []
  };
}

/** A local TUI controller; construction alone never changes terminal state. */
export class Dashboard {
  constructor(root, options = {}) {
    this.state = options.demo ? demoState() : initialState(root);
    this.options = options;
    this.input = options.input || process.stdin;
    this.output = options.output || process.stdout;
    this.running = false;
    this.refreshing = false;
    this.controller = null;
    this.epoch = 0;
    this.frame = '';
    this.activity = options.activity || new ActivityLog();
  }

  draw() {
    if (!this.running) return;
    const frame = renderDashboard(this.state, this.output.columns || 110, (this.output.rows || 32) - 1,
      { color: !this.options.noColor && !process.env.NO_COLOR, ascii: this.options.ascii });
    if (frame !== this.frame) {
      this.output.write('\x1b[H' + frame + '\x1b[J');
      this.frame = frame;
    }
  }

  note(text, tone = 'good') {
    this.state.message = { text: clean(text), tone };
    this.state.activity.push(`${new Date().toLocaleTimeString()}  ${clean(text)}`);
    this.state.activity = this.state.activity.slice(-10);
    if (!this.state.demo) void this.activity.append({ action: this.state.screen, status: tone === 'bad' ? 'failed' : tone === 'warn' ? 'warning' : 'info', message: text, target: this.state.root }).catch(() => {
      this.state.message = { text: 'Activity log could not be written. Check storage permissions.', tone: 'warn' };
    });
    this.draw();
  }

  async start() {
    if (!this.input.isTTY || !this.output.isTTY) throw new Error('The dashboard needs an interactive terminal. Use jarvis status or jarvis --snapshot.');
    this.running = true;
    this.wasRaw = this.input.isRaw;
    readline.emitKeypressEvents(this.input);
    this.keyHandler = (text, key) => this.onKey(text, key || {}).catch(error => this.note(friendlyError(error), 'bad'));
    this.resizeHandler = () => { this.frame = ''; this.draw(); };
    this.signalHandler = () => this.close();
    this.output.write('\x1b[?1049h\x1b[?25l');
    this.input.setRawMode(true);
    this.input.resume();
    this.input.on('keypress', this.keyHandler);
    this.output.on('resize', this.resizeHandler);
    process.on('SIGINT', this.signalHandler);
    process.on('SIGTERM', this.signalHandler);
    this.done = new Promise(resolve => { this.resolveDone = resolve; });
    this.draw();
    void this.refresh();
    this.timer = setInterval(() => {
      if (!this.state.busy && !this.state.modal && !this.refreshing) {
        if (this.state.tail && this.state.preview) void this.refreshPreview();
        else if (['overview', 'git'].includes(this.state.screen)) void this.refresh(true);
      }
    }, 3000);
    return this.done;
  }

  close() {
    if (!this.running) return;
    this.running = false;
    this.epoch++;
    this.controller?.abort();
    void this.webServer?.close();
    clearInterval(this.timer);
    this.input.off('keypress', this.keyHandler);
    this.output.off('resize', this.resizeHandler);
    this.input.setRawMode(Boolean(this.wasRaw));
    this.input.pause();
    process.off('SIGINT', this.signalHandler);
    process.off('SIGTERM', this.signalHandler);
    this.output.write('\x1b[0m\x1b[?25h\x1b[?1049l');
    this.resolveDone?.();
  }

  async refresh(quiet = false) {
    if (this.refreshing || this.state.busy) return;
    if (this.state.demo) { this.state.lastRefresh = new Date().toISOString(); this.draw(); return; }
    const screen = this.state.screen;
    const token = ++this.epoch;
    this.refreshing = true;
    if (!quiet) { this.state.message = { text: `Reading ${NAV.find(v => v[0] === screen)?.[1] || 'workspace'}...`, tone: 'accent' }; this.draw(); }
    try {
      let value;
      if (screen === 'overview' || screen === 'git') value = await getGitStatus(this.state.root);
      else if (screen === 'files') {
        if (this.state.preview) { await this.refreshPreview(); return; }
        value = await listDirectory(this.state.root, this.state.files.path);
      } else if (screen === 'processes') value = await listProcesses();
      else if (screen === 'ports') value = await listPorts();
      else if (screen === 'scripts') value = await getProjectScripts(this.state.root);
      else if (screen === 'disk') { this.refreshing = false; return this.scanDisk(); }
      else if (screen === 'search' && this.state.search.query) { this.refreshing = false; return this.search(); }
      if (token !== this.epoch || !this.running) return;
      if (screen === 'overview' || screen === 'git') { this.state.git = value; this.state.system = getSystemInfo(); }
      else if (value !== undefined) this.state[screen] = value;
      this.state.lastRefresh = new Date().toISOString();
      if (!quiet) this.note('Workspace refreshed.');
    } catch (error) { if (token === this.epoch) this.note(friendlyError(error), 'bad'); }
    finally { this.refreshing = false; this.draw(); }
  }

  async open(screen) {
    if (this.state.busy) return;
    this.epoch++;
    this.state.modal = null;
    this.state.tail = false;
    this.state.preview = null;
    this.state.screen = screen;
    this.refreshing = false;
    this.draw();
    if (screen !== 'recipes' && screen !== 'search') await this.refresh();
  }

  prompt(title, label, value, submit, detail = '') {
    this.state.modal = { type: 'input', title, label, value, submit, detail };
    this.draw();
  }
  confirm(title, detail, submit) {
    this.state.modal = { type: 'confirm', title, detail, submit };
    this.draw();
  }
  showText(title, content) {
    this.state.modal = { type: 'text', title, content, offset: 0 };
    this.draw();
  }

  palette() {
    const choices = [
      ...NAV.map(([screen, title, description]) => ({ title, description, screen })),
      ...RECIPES.map(recipe => ({ ...recipe, title: recipe.title }))
    ];
    this.state.modal = { type: 'palette', title: 'What do you want to do?', label: 'Search tools and tasks', value: '', choices, choice: 0 };
    this.draw();
  }

  async runTask(label, fn) {
    if (this.state.busy) return;
    if (this.state.demo) { this.note('Demo only. No files or remote repositories were changed.'); return; }
    const controller = new AbortController();
    this.controller = controller;
    this.state.busy = label;
    this.state.modal = null;
    this.epoch++;
    this.state.operationLog = [];
    let pending = '';
    const onOutput = chunk => {
      pending += chunk;
      const records = pending.split(/[\r\n]+/);
      pending = records.pop() || '';
      for (const line of records.filter(Boolean)) {
        this.state.operationLog.push(clean(line));
        this.state.operationLog = this.state.operationLog.slice(-120);
        this.state.busy = `${label}: ${clean(line).slice(-180)}`;
      }
      this.draw();
    };
    this.draw();
    try {
      const value = await fn({ signal: controller.signal, onOutput });
      if (pending) onOutput('\n');
      if (controller.signal.aborted && !value?.cancelled) throw new Error('Operation cancelled.');
      if (value && typeof value.code === 'number' && value.code !== 0) throw new Error(`${label} exited with code ${value.code}. Review the task output.`);
      if (this.running) this.note(value?.cancelled ? `${label} cancelled; partial results preserved.` : `${label} completed.`, value?.cancelled ? 'warn' : 'good');
      return value;
    } catch (error) {
      if (pending) onOutput('\n');
      this.note(controller.signal.aborted ? 'Cancelled. Any completed changes remain; refresh to review them.' : friendlyError(error), controller.signal.aborted ? 'warn' : 'bad');
      return undefined;
    } finally {
      if (this.controller === controller) this.controller = null;
      this.state.busy = null;
      this.state.lastRefresh = new Date().toISOString();
      this.draw();
    }
  }

  async search() {
    const query = this.state.search.query;
    if (!query) return;
    if (this.state.demo) { this.note('Demo search results. Run without --demo to search your files.'); return; }
    const result = await this.runTask('Searching', options => searchContent(this.state.root, query, { ...this.state.search, ...options }));
    if (result) {
      this.state.search = { ...this.state.search, ...result };
      this.state.selected.search = 0;
      this.note(`${plural(result.matches.length, 'matching line')}${result.truncated ? '; scan limit reached' : ''}.`);
    }
  }

  async scanDisk() {
    if (this.state.demo) return this.draw();
    const result = await this.runTask('Measuring disk usage', options => analyzeDisk(this.state.root, options));
    if (result) { this.state.disk = result; this.state.selected.disk = 0; this.draw(); }
  }

  async chooseStorageLocation() {
    if (this.state.demo) return this.note('Demo storage is simulated. Real scans are available outside demo mode.');
    const { listScanLocations } = await import('./storage.js');
    const locations = await listScanLocations();
    this.state.modal = { type: 'palette', title: 'Choose what to scan', label: 'Drive or folder', value: '', choice: 0,
      detail: 'This reads file sizes and timestamps, not file contents. Inaccessible folders are reported as skipped.',
      choices: [{ title: 'Current workspace', description: this.state.root, run: () => this.fullStorageScan(this.state.root) },
        ...locations.map(location => ({ title: `${location.label}  ${location.path}`, description: location.kind, run: () => this.fullStorageScan(location.path) }))] };
    this.draw();
  }

  async fullStorageScan(root) {
    const { scanStorage } = await import('./storage.js');
    const result = await this.runTask('Scanning storage', options => scanStorage(root, { ...options, activePaths: [this.state.root, this.activity.directory].filter(Boolean),
      onProgress: progress => {
        this.state.busy = `Scanning storage: ${progress.totalFiles ?? progress.files ?? 0} files examined`;
        this.draw();
      } }));
    if (result) { this.state.disk = result; this.state.selected.disk = 0; this.draw(); }
  }

  async reviewCleanup() {
    const candidates = this.state.disk?.cleanupCandidates || [];
    if (!candidates.length) return this.note('No eligible old temporary files were found. Press S to choose a storage scan.', 'muted');
    const { planCleanup, executeCleanup } = await import('./storage.js');
    const plan = await planCleanup(candidates.slice(0, 500).map(item => item.path), { activePaths: [this.state.root, this.activity.directory].filter(Boolean) });
    this.showText('Review every selected temporary file', `${plan.entries.length} files, ${formatStorageBytes(plan.totalBytes)}.\nUse the browser dashboard to select individual files.\n\n${plan.entries.map(item => `${formatStorageBytes(item.bytes)}  ${item.path}`).join('\n')}`);
    this.state.modal.continue = () => this.confirm('Confirm temporary-file cleanup', `${plan.entries.length} reviewed temporary files, ${formatStorageBytes(plan.totalBytes)}.\n\nFiles move to recoverable quarantine first; this does not free disk space yet. Use H to restore or permanently empty a reviewed quarantine.`, async () => {
      const result = await this.runTask('Quarantining temporary files', options => executeCleanup(plan, { ...options, confirmed: true }));
      if (result) this.showText('Cleanup result', `Transaction: ${result.id}\nMoved: ${formatStorageBytes(result.movedBytes)}\nSpace reclaimed: ${formatStorageBytes(result.reclaimedBytes)}\n\nPress H in Disk usage to restore or empty this quarantine.\n${(result.errors || []).map(error => typeof error === 'string' ? error : error.message || JSON.stringify(error)).join('\n')}`);
    });
    this.draw();
  }

  async recoveryHistory() {
    if (this.state.demo) return this.note('Demo mode has no recovery transactions.');
    const storage = await import('./storage.js');
    const history = await storage.listCleanupHistory();
    if (!history.length) return this.note('No cleanup transactions have been recorded.');
    this.state.modal = { type: 'palette', title: 'Recovery history', label: 'Select a transaction', value: '', choice: 0,
      choices: history.map(item => ({ title: `${item.id}  ${item.status || ''}`, description: item.createdAt || '', run: () => {
        this.state.modal = { type: 'palette', title: 'Recovery action', label: 'Choose restore or empty', value: '', choice: 0, choices: [
          { title: 'Review files in this transaction', run: () => this.showText('Recovery contents', `${item.id}\n${(item.entries || []).map(entry => `${entry.state}  ${formatStorageBytes(entry.bytes)}  ${entry.path}`).join('\n')}`) },
          { title: 'Restore files to their original locations', run: () => this.confirm('Restore quarantined files', `Transaction ${item.id}\nExisting destination files will never be overwritten.`, async () => {
            const result = await this.runTask('Restoring files', options => storage.restoreCleanup(item.id, options));
            if (result) this.showText('Recovery result', JSON.stringify(result, null, 2));
          }) },
          { title: 'Permanently empty this quarantine to reclaim space', run: () => this.confirm('Permanently delete quarantined files', `Transaction ${item.id}\n\nThis permanently deletes only the files in this quarantine. It cannot be undone. Review the transaction before continuing.`, async () => {
            const result = await this.runTask('Emptying quarantine', options => storage.purgeCleanup(item.id, { ...options, confirmed: true }));
            if (result) this.showText('Space reclaimed', JSON.stringify(result, null, 2));
          }) }
        ] }; this.draw();
      } })) };
    this.draw();
  }

  async refreshPreview() {
    if (this.state.demo || !this.state.preview) return;
    const file = this.state.preview.path;
    try {
      const value = await readPreview(this.state.root, file, { tail: this.state.tail });
      if (this.state.preview?.path === file) {
        this.state.preview = value;
        if (this.state.tail) this.state.selected.preview = Math.max(0, value.lines.length - (this.output.rows || 32) + 15);
        this.draw();
      }
    } catch (error) { this.state.tail = false; this.note(friendlyError(error), 'bad'); }
  }

  async viewFile(file, atLine) {
    this.state.previewOrigin = this.state.screen;
    if (this.state.demo) {
      this.state.preview = { path: file, totalBytes: 224, lines: [
        { number: 1, text: '// Demo preview: your real files are unchanged.' }, { number: 2, text: 'export const hello = "Welcome to Jarvis";' }
      ] };
    } else {
      this.state.preview = await readPreview(this.state.root, file, { maxLines: 1000 });
    }
    this.state.screen = 'files'; this.state.tail = false;
    const index = atLine ? this.state.preview.lines.findIndex(v => v.number === atLine) : 0;
    this.state.selected.preview = Math.max(0, index - 3);
    if (atLine && index < 0) this.note('Match lies beyond the bounded preview; its text remains in Search.', 'warn');
    this.draw();
  }

  async chooseRecipe(recipe) {
    if (!recipe) return;
    await this.open(recipe.screen);
    if (recipe.query && recipe.screen === 'search') {
      this.state.search.query = recipe.query;
      await this.search();
    } else this.note(recipe.description, 'muted');
  }

  async enter() {
    const s = this.state;
    const index = selection(s);
    if (s.screen === 'files' && !s.preview) {
      const item = visibleFiles(s)[index];
      if (!item) return;
      if (item.type === 'directory') {
        if (s.demo) return this.note('Demo folder. Open a real workspace to browse its contents.');
        s.files = await listDirectory(s.root, item.path); s.selected.files = 0;
      } else await this.viewFile(item.path);
    } else if (s.screen === 'search') {
      const match = s.search.matches?.[index];
      if (match) await this.viewFile(match.path, match.line);
    } else if (s.screen === 'git') {
      if (s.demo) return this.showText('Change preview', '- previous search\n+ streaming, bounded search');
      const change = s.git?.changes?.[index];
      if (change) this.showText('Review changes: ' + change.path, await getGitDiff(s.git.root, change.path));
      else this.note('There are no file changes to review.');
    } else if (s.screen === 'disk') {
      const item = s.disk?.entries[index];
      if (item && !s.demo) {
        if (item.type === 'directory' && s.disk.root) await this.fullStorageScan(item.path);
        else if (item.type === 'directory') { s.screen = 'files'; s.files = await listDirectory(s.root, item.path); s.selected.files = 0; }
        else if (s.disk.root) this.showText('File information', `${item.path}\n${formatStorageBytes(item.bytes)}\n\nLarge files are informational. They are never automatically marked safe to delete.`);
        else await this.viewFile(item.path);
      }
    } else if (s.screen === 'recipes') await this.chooseRecipe(s.recipes[index]);
    else if (s.screen === 'scripts') {
      const script = s.scripts[index];
      if (script) this.confirm(`Run ${script.name}`, `Folder: ${s.root}\n\n${script.command}\n\nThis runs the project's npm script and its lifecycle hooks. Use scripts from projects you trust. Esc cancels a running task.`, async () => {
        await this.runTask(`Running ${script.name}`, options => runProjectScript(s.root, script.name, options));
        this.showText(`${script.name} output`, s.operationLog?.join('\n') || s.message?.text || 'No output.');
      });
    }
    this.draw();
  }

  move(delta) {
    const s = this.state;
    const key = s.preview && s.screen === 'files' ? 'preview' : s.screen;
    const lengths = { files: visibleFiles(s).length, search: s.search.matches?.length || 0, git: s.git?.changes?.length || 0,
      processes: visibleProcesses(s).length, ports: visiblePorts(s).length, disk: s.disk?.entries?.length || 0,
      scripts: s.scripts.length, recipes: s.recipes.length, preview: s.preview?.lines?.length || 0 };
    s.selected[key] = Math.max(0, Math.min((lengths[key] || 1) - 1, selection(s, key) + delta));
    this.draw();
  }

  async gitAction(action) {
    const s = this.state;
    if (!s.git?.isRepo) return this.note('Open a Git repository first.', 'warn');
    const repo = s.git.root || s.root;
    if (action === 'fetch') {
      const result = await this.runTask('Checking remote', options => fetchRemote(repo, options));
      if (result) s.lastFetch = new Date().toISOString();
      await this.refresh(true);
      return;
    }
    if (action === 'commit') {
      if (!s.git.changes.length) return this.note('No file changes need a snapshot.');
      const fileList = s.git.changes.slice(0, 7).map(v => v.path).join('\n');
      this.prompt('Save a local snapshot', 'Describe what changed', '', message => {
        if (!message.trim()) return this.note('A commit message is required.', 'warn');
        this.confirm('Review snapshot', `Repository: ${repo}\nBranch: ${s.git.branch}\n${s.git.changes.length} changed files will be staged and committed.\n${fileList}${s.git.changes.length > 7 ? '\n...' : ''}\nMessage: ${message}`, async () => {
          await this.runTask('Saving snapshot', options => commitAll(repo, message.trim(), options));
          await this.refresh(true);
        });
      }, 'This records a local commit. Upload is a separate action.');
    } else if (action === 'push') {
      this.confirm('Upload saved commits', `Repository: ${repo}\nDestination: ${safeRemote(s.git.remoteUrl)}\nLocal branch: ${s.git.branch}\nRemote branch: ${s.git.upstream || `${s.git.remoteName}/${s.git.branch}`}\n\nOnly saved commits are sent. The push never overwrites remote history.`, async () => {
        await this.runTask('Uploading', options => pushCurrent(repo, options));
        await this.refresh(true);
      });
    } else if (action === 'pull') {
      this.confirm('Download updates', `Repository: ${repo}\nSource: ${safeRemote(s.git.remoteUrl)}\n\nThis downloads changes with a fast-forward-only pull. It requires a clean working tree and stops if histories diverge.`, async () => {
        const result = await this.runTask('Downloading', options => pullCurrent(repo, options));
        if (result) s.lastFetch = new Date().toISOString();
        await this.refresh(true);
      });
    }
  }

  async onModal(text, key) {
    const m = this.state.modal;
    if (key.name === 'escape') { this.state.modal = null; this.draw(); return; }
    if (m.type === 'text') {
      if (key.name === 'return' && m.continue) { this.state.modal = null; await m.continue(); this.draw(); return; }
      if (['up', 'down', 'pageup', 'pagedown'].includes(key.name)) m.offset = Math.max(0, (m.offset || 0) + (['up', 'pageup'].includes(key.name) ? -1 : 1) * (key.name.startsWith('page') ? 10 : 1));
      this.draw(); return;
    }
    if (m.type === 'confirm') {
      if (text?.toLowerCase() === 'y') { this.state.modal = null; await m.submit(); }
      else if (text?.toLowerCase() === 'n' || key.name === 'return') this.state.modal = null;
      this.draw(); return;
    }
    if (key.name === 'return') {
      this.state.modal = null;
      if (m.type === 'palette') {
        const choices = m.choices.filter(v => `${v.title} ${v.description || ''}`.toLowerCase().includes(m.value.toLowerCase()));
        const chosen = choices[m.choice || 0];
        if (chosen?.run) await chosen.run();
        else await this.chooseRecipe(chosen);
      } else await m.submit(m.value);
    } else if (m.type === 'palette' && ['up', 'down'].includes(key.name)) {
      const count = m.choices.filter(v => `${v.title} ${v.description || ''}`.toLowerCase().includes(m.value.toLowerCase())).length;
      m.choice = Math.max(0, Math.min(count - 1, (m.choice || 0) + (key.name === 'up' ? -1 : 1)));
    } else if (key.name === 'backspace') { m.value = [...m.value].slice(0, -1).join(''); m.choice = 0; }
    else if (key.ctrl && key.name === 'u') { m.value = ''; m.choice = 0; }
    else if (text && !key.ctrl && !key.meta && !['tab', 'up', 'down', 'left', 'right'].includes(key.name)) {
      m.value = (m.value + clean(text)).slice(0, 4000); m.choice = 0;
    }
    this.draw();
  }

  async onKey(text, key) {
    if (key.ctrl && key.name === 'c') return this.close();
    if (this.state.busy) {
      if (key.name === 'escape') this.controller?.abort();
      return;
    }
    if (this.state.modal) return this.onModal(text, key);
    const s = this.state;
    const name = text?.toLowerCase();
    if (name === 'q') return this.close();
    if (name === 'b') {
      if (!this.webServer) {
        const { startServer } = await import('./server.js');
        this.webServer = await startServer({ root: s.root, demo: s.demo, activity: this.activity });
      }
      try { await openBrowser(this.webServer.url); this.note('Browser dashboard opened. It closes when this Jarvis session exits.'); }
      catch { this.showText('Open the local dashboard', this.webServer.url); }
      return;
    }
    if (name === 'a') {
      const events = s.demo ? s.activity.map(message => ({ time: '', status: 'info', message })) : await this.activity.list();
      this.showText('Activity history', events.map(event => `${event.time}  ${event.status}\n${event.message}\n`).join('\n') || 'No activity has been recorded yet.');
      return;
    }
    if (key.ctrl && key.name === 'p') return this.palette();
    if (/^[1-9]$/.test(text || '')) return this.open(NAV[Number(text) - 1][0]);
    if (key.name === 'tab') {
      const current = NAV.findIndex(v => v[0] === s.screen);
      return this.open(NAV[(current + (key.shift ? NAV.length - 1 : 1)) % NAV.length][0]);
    }
    if (name === '?') return this.open('recipes');
    if (['up', 'down', 'pageup', 'pagedown'].includes(key.name)) return this.move((['up', 'pageup'].includes(key.name) ? -1 : 1) * (key.name.startsWith('page') ? 10 : 1));
    if (key.name === 'return') return this.enter();
    if (name === 'r') return this.refresh();
    if (key.name === 'escape') {
      if (s.preview) { s.preview = null; s.tail = false; s.screen = s.previewOrigin || 'files'; }
      else { s.fileFilter = ''; s.processFilter = ''; s.portFilter = ''; }
      this.draw(); return;
    }
    if (s.screen === 'files') {
      if (key.name === 'backspace' && !s.preview && s.files.parent !== null && !s.demo) {
        s.files = await listDirectory(s.root, s.files.parent); s.selected.files = 0;
      } else if (name === 't' && s.preview) { s.tail = !s.tail; await this.refreshPreview(); }
      else if (text === '/') {
        if (s.preview) this.prompt('Find in this preview', 'Text to find', '', value => {
          const i = s.preview.lines.findIndex(line => line.text.toLowerCase().includes(value.toLowerCase()));
          if (i >= 0) s.selected.preview = i; else this.note('Not found in this preview.', 'warn');
        });
        else this.prompt('Filter files', 'Part of the filename', s.fileFilter || '', value => { s.fileFilter = value; s.selected.files = 0; });
      }
    } else if (s.screen === 'search') {
      if (text === '/') this.prompt('Search project contents', 'Word, phrase or pattern', s.search.query, async value => { s.search.query = value; await this.search(); });
      else if (name === 'm') { s.search.regex = !s.search.regex; await this.search(); }
      else if (name === 'c') { s.search.caseSensitive = !s.search.caseSensitive; await this.search(); }
      else if (name === 'g') this.prompt('Limit search files', 'Filename pattern (blank for all)', s.search.glob, async value => { s.search.glob = value; await this.search(); }, 'Examples: *.js, *.md, src/**/*.ts');
    } else if (s.screen === 'git') {
      if (name === 'f') return this.gitAction('fetch');
      if (name === 'c') return this.gitAction('commit');
      if (name === 'p') return this.gitAction('push');
      if (name === 'l') return this.gitAction('pull');
    } else if (s.screen === 'disk') {
      if (name === 's') return this.chooseStorageLocation();
      if (name === 'c') return this.reviewCleanup();
      if (name === 'h') return this.recoveryHistory();
    } else if (s.screen === 'overview' && name === 'f') return this.gitAction('fetch');
    else if (s.screen === 'processes') {
      if (name === 's') s.processSort = s.processSort === 'memory' ? 'cpu' : 'memory';
      if (text === '/') this.prompt('Filter processes', 'Name or PID', s.processFilter || '', value => { s.processFilter = value; s.selected.processes = 0; });
    } else if (s.screen === 'ports' && text === '/') this.prompt('Find a listener', 'Port, PID or address', s.portFilter || '', value => { s.portFilter = value; s.selected.ports = 0; });
    else if (s.screen === 'recipes' && name === 'e') {
      const recipe = s.recipes[selection(s)];
      if (recipe) this.showText(recipe.title, recipe.explanation + '\n\n' + recipe.examples.map(v => `${v.command}\n${v.explanation}`).join('\n\n'));
    }
    this.draw();
  }
}

function formatStorageBytes(value = 0) {
  return `${(Number(value) / (1024 ** 2)).toFixed(1)} MB`;
}

