import path from 'node:path';
import readline from 'node:readline';
import { renderDashboard, NAV, selection, visibleFiles, visibleProcesses, visiblePorts, CONTROL_ITEMS } from './ui.js';
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
import { getAbout } from './about.js';
import { OperationCoordinator } from './operations.js';

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
    if (options.demo) this.state.control = demoControl();
    this.options = options;
    this.operations = options.operations || new OperationCoordinator();
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
    this.clearSensitiveModal();
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
      } else if (screen === 'control') value = await this.readControl();
      else if (screen === 'processes') value = await listProcesses();
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
    this.clearSensitiveModal();
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
    this.state.modal = { type: 'confirm', title, detail, submit, offset: 0 };
    this.draw();
  }
  showText(title, content) {
    this.state.modal = { type: 'text', title, content, offset: 0 };
    this.draw();
  }

  clearSensitiveModal() {
    clearTimeout(this.secretTimer);
    if (this.state.modal?.sensitive) this.state.modal.content = '';
    this.state.modal = null;
    this.frame = '';
  }

  palette() {
    const choices = [
      ...NAV.map(([screen, title, description]) => ({ title, description, screen })),
      ...this.controlChoices(),
      ...RECIPES.map(recipe => ({ ...recipe, title: recipe.title }))
    ];
    this.state.modal = { type: 'palette', title: 'What do you want to do?', label: 'Search tools and tasks', value: '', choices, choice: 0 };
    this.draw();
  }

  async runTask(label, fn) {
    if (this.state.busy) return;
    if (this.state.demo) { this.note('Demo only. No files or remote repositories were changed.'); return; }
    const controller = new AbortController();
    let release;
    try { release = this.operations.acquire(label, controller); }
    catch (error) { this.note(error.message, 'warn'); return; }
    this.controller = controller;
    this.state.busy = label;
    this.state.modal = null;
    this.epoch++;
    this.state.operationLog = [];
    let pending = '', outputBytes = 0, outputTruncated = false;
    const onOutput = chunk => {
      const buffer = Buffer.from(String(chunk));
      const available = Math.max(0, 256 * 1024 - outputBytes);
      if (buffer.length > available) outputTruncated = true;
      outputBytes += Math.min(buffer.length, available);
      pending += buffer.subarray(0, available).toString('utf8');
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
      if (pending) { this.state.operationLog.push(clean(pending)); pending = ''; }
      if (outputTruncated) this.state.operationLog.push('[Output truncated at 256 KB.]');
      this.state.operationLog = this.state.operationLog.slice(-120);
      if (controller.signal.aborted && !value?.cancelled && !value?.status) throw new Error('Operation cancelled.');
      if (value && typeof value.code === 'number' && value.code !== 0) throw new Error(`${label} exited with code ${value.code}. Review the task output.`);
      const warning = value?.cancelled || value?.scanMayContinue || value?.warnings?.length || value?.errors?.length || ['partial', 'requested', 'uncertain', 'attention-required'].includes(value?.status) || controller.signal.aborted;
      if (this.running) this.note(value?.message || (value?.cancelled ? `${label} cancelled; partial results preserved.` : `${label} completed.`), warning ? 'warn' : 'good');
      return value;
    } catch (error) {
      if (pending) { this.state.operationLog.push(clean(pending)); pending = ''; }
      if (outputTruncated) this.state.operationLog.push('[Output truncated at 256 KB.]');
      this.state.operationLog = this.state.operationLog.slice(-120);
      this.note(controller.signal.aborted ? 'Cancelled. Any completed changes remain; refresh to review them.' : friendlyError(error), controller.signal.aborted ? 'warn' : 'bad');
      return undefined;
    } finally {
      if (this.controller === controller) this.controller = null;
      this.state.busy = null;
      this.state.lastRefresh = new Date().toISOString();
      release();
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

  async stopSelectedProcess() {
    const item = visibleProcesses(this.state)[selection(this.state)];
    if (!item) return this.note('Select a running process first.', 'warn');
    const control = this.options.processControl || await import('./process-control.js');
    const plan = this.state.demo
      ? { pid: item.pid, name: item.name, warning: 'Demo only. No real process will be stopped.' }
      : await this.runTask('Reviewing process ' + item.pid, options => control.planProcessStop(item.pid, options));
    if (!plan) return;
    this.confirm('Stop running process', `Process: ${plan.name}  |  PID: ${plan.pid}\n${plan.warning || 'Unsaved work may be lost. This stops only the selected process.'}\nOwner: ${plan.owner || 'Demo'}\nStarted: ${plan.startedAt || 'Sample data'}`, async () => {
      const result = await this.runTask(`Stop request for ${plan.name} (PID ${plan.pid})`, options => control.stopProcess(plan, { ...options, confirmed: true }));
      await this.refresh(true);
      if (result) this.note(`${plan.name} (PID ${plan.pid}): ${result.message || result.status}`, result.status === 'requested' ? 'warn' : 'good');
    });
  }

  async fileAction(action, recoveryId) {
    if (this.state.demo) return this.showText('Demo file manager', 'A real workspace supports new folders, copy, move, rename and recoverable removal after review. Existing files are not overwritten. Use H to restore a held item.');
    const backend = this.options.fileActions || await import('./file-actions.js');
    if (action === 'history') {
      const items = await this.runTask('Reading file recovery', () => backend.listFileRecovery(this.state.root));
      if (!items) return;
      return this.chooseControl('Restore a file or folder', items.filter(item => item.available).map(item => ({ title: item.originalPath || item.original, description: `${item.createdAt || ''}  ${formatStorageBytes(item.bytes)}`, run: () => this.fileAction('restore', item.id) })), 'Restores the original path inside this workspace without overwriting an existing item.');
    }
    const selected = this.state.preview ? { path: this.state.preview.path, name: path.basename(this.state.preview.path) } : visibleFiles(this.state)[selection(this.state)];
    if (!['mkdir', 'restore'].includes(action) && !selected) return this.note('Select a file or folder first.', 'warn');
    const review = async input => {
      const plan = await this.runTask('Reviewing file operation', options => backend.planFileAction(this.state.root, input, options));
      if (!plan) return;
      this.confirm(`Review ${action === 'trash' ? 'move to recovery' : action}`, `Workspace: ${plan.root}\n${plan.source ? `From: ${plan.source}\n` : ''}${plan.destination ? `To: ${plan.destination}\n` : ''}Files: ${plan.files}  /  ${formatStorageBytes(plan.bytes)}\n\n${plan.warning}`, async () => {
        const result = await this.runTask('Applying file operation', options => backend.executeFileAction(plan, { ...options, confirmed: true }));
        if (result) {
          this.state.preview = null; this.state.tail = false; await this.refresh(true);
          const warning = result.status === 'partial' || result.cancelled || result.errors?.length || result.warnings?.length;
          this.note(result.message || (warning ? 'The file operation needs review.' : 'File operation completed.'), warning ? 'warn' : 'good');
          if (warning) this.showText('File operation needs review', [result.message, result.destination && `Destination: ${result.destination}`, result.recoveryId && `Recovery ID: ${result.recoveryId}`, result.recoveryPath && `Recovery path: ${result.recoveryPath}`, ...(result.errors || []).map(item => typeof item === 'string' ? item : `${item.path || ''} ${item.message || JSON.stringify(item)}`), ...(result.warnings || [])].filter(Boolean).join('\n\n'));
        }
      });
    };
    if (action === 'restore') return review({ action, recoveryId });
    if (action === 'trash') return review({ action, path: selected.path });
    if (action === 'mkdir') return this.prompt('Create a folder', 'New folder name', '', name => review({ action, path: this.state.files.path, name }), `Inside: ${this.state.files.path || 'workspace root'}`);
    if (action === 'rename') return this.prompt('Rename selection', 'New name (no folder separators)', selected.name, name => review({ action, path: selected.path, name }), `Selection: ${selected.path}`);
    return this.prompt(action === 'copy' ? 'Copy selection' : 'Move selection', 'New destination path, relative to workspace root', selected.path, destination => review({ action, path: selected.path, destination }), 'Enter the complete new path including the file/folder name. Its parent must already exist. Existing destinations are never overwritten.');
  }

  async nativeModules() {
    if (!this.nativeControl) {
      const supplied = this.options.nativeControl || {};
      const [network, audio, security, settings] = await Promise.all([
        supplied.network || import('./network.js'), supplied.audio || import('./audio.js'),
        supplied.security || import('./security.js'), supplied.settings || import('./settings.js'),
      ]);
      this.nativeControl = { network, audio, security, settings };
    }
    return this.nativeControl;
  }

  async readControl() {
    if (this.state.demo) return demoControl();
    const modules = await this.nativeModules();
    const names = ['network', 'audio', 'security', 'settings'];
    const results = await Promise.allSettled([
      modules.network.getNetworkStatus(), modules.audio.getAudioStatus(),
      modules.security.getSecurityStatus(), modules.settings.getSystemSettings(),
    ]);
    return Object.fromEntries(results.map((result, index) => [names[index], result.status === 'fulfilled' ? result.value : { available: false, warning: friendlyError(result.reason) }]));
  }

  chooseControl(title, choices, detail = '') {
    if (!choices.length) return this.note('No available items were found. Refresh or open Windows Settings.', 'warn');
    this.state.modal = { type: 'palette', title, label: 'Type to filter', value: '', choice: 0, choices, detail };
    this.draw();
  }

  controlChoices() {
    return [
      { title: 'Connect to saved Wi-Fi', description: 'Network connection', run: () => this.networkAction('connect') },
      { title: 'Disconnect Wi-Fi', description: 'Network connection', run: () => this.networkAction('disconnect') },
      { title: 'Change IPv4 DNS', description: 'Network name resolution', run: () => this.networkAction('dns') },
      { title: 'Reveal a saved Wi-Fi password', description: 'Private temporary display', run: () => this.networkAction('password') },
      { title: 'Adjust sound volume', description: 'Audio output', run: () => this.audioAction('volume') },
      { title: 'Mute or unmute sound', description: 'Audio output', run: () => this.audioAction('mute') },
      { title: 'Quick malware scan', description: 'Microsoft Defender', run: () => this.securityAction('quick') },
      { title: 'Full malware scan', description: 'Microsoft Defender', run: () => this.securityAction('full') },
      { title: 'Scan a file or folder for malware', description: 'Microsoft Defender custom scan', run: () => this.securityAction('custom') },
      { title: 'Change Windows power plan', description: 'Battery and performance', run: () => this.powerAction() },
      { title: 'Open Windows settings', description: 'Native operating-system controls', run: () => this.settingsAction() },
      { title: 'Support Ashish / About Jarvis', description: 'Free and open-source project', run: () => this.support() },
    ];
  }

  async controlCategory(id) {
    if (id === 'support') return this.support();
    if (id === 'power') return this.powerAction();
    if (id === 'settings') return this.settingsAction();
    if (id === 'network') return this.chooseControl('Network and Wi-Fi', [
      { title: 'View adapters, saved profiles and DNS', run: async () => {
        if (!this.state.control) this.state.control = await this.readControl();
        const network = this.state.control.network;
        this.showText('Network status', !network?.available ? network?.warning || 'Network controls are unavailable.' :
          network.adapters.map(item => `${item.name}  ${item.status || ''}\nAddresses: ${(item.addresses || item.ipv4 || []).join(', ') || 'Not assigned'}\nDNS: ${(item.dns || []).join(', ') || 'Automatic / unavailable'}\nWi-Fi profile: ${item.profile || 'Not connected'}`).join('\n\n'));
      } }, ...this.controlChoices().slice(0, 4),
      { title: 'Open Windows network settings', run: () => this.openNativeSettings('network', 'Network') },
    ]);
    if (id === 'audio') return this.chooseControl('Sound controls', [...this.controlChoices().slice(4, 6),
      { title: 'Choose output device in Windows Sound', run: () => this.openNativeSettings('sound', 'Sound') }]);
    if (id === 'security') return this.chooseControl('Microsoft Defender', [...this.controlChoices().slice(6, 9),
      { title: 'Review recent protection history', run: async () => {
        if (this.state.demo) return this.showText('Protection history', 'Demo: no detections in the sample protection history.');
        const { security } = await this.nativeModules();
        const status = await this.runTask('Reading protection history', options => security.getSecurityStatus(options));
        if (status) this.showText('Recent protection history', !status.available ? status.reason :
          (status.detections || []).map(item => `${item.name}  |  ${item.severity}\nDetected: ${item.detectedAt || 'Unknown'}\nAction succeeded: ${item.actionSuccess === null ? 'Unknown' : item.actionSuccess ? 'Yes' : 'No'}\n${(item.resources || []).join('\n')}`).join('\n\n') || 'No recent detections were returned. This does not establish that the computer is free of malware.');
      } }, { title: 'Open Windows Security', run: () => this.openNativeSettings('security', 'Windows Security') },
    ]);
  }

  async reviewControl(label, prepare, apply, describe) {
    const plan = await this.runTask(`Reviewing ${label}`, prepare);
    if (!plan) return;
    this.confirm(`Review ${label}`, `${describe(plan)}\n\n${plan.warning || ''}`, async () => {
      const result = await this.runTask(label, options => apply(plan, { ...options, confirmed: true }));
      this.state.control = await this.readControl();
      if (result?.message) this.note(result.message, result.status === 'requested' || result.warnings?.length ? 'warn' : 'good');
      this.draw();
    });
  }

  async networkAction(action) {
    if (this.state.demo) return this.showText('Demo network controls', 'Saved Wi-Fi, DNS and password controls use the Windows network APIs. Run Jarvis without --demo to inspect your own adapters. Every change is reviewed before applying it.');
    const { network } = await this.nativeModules();
    const status = await this.runTask('Reading network adapters', options => network.getNetworkStatus(options));
    if (!status) return;
    if (!status.available) return this.note(status.warning || 'Network controls are unavailable.', 'warn');
    if (action === 'connect' || action === 'password') {
      return this.chooseControl(action === 'password' ? 'Choose saved password to reveal' : 'Connect to saved Wi-Fi', status.profiles.map(profile => ({
        title: profile.name, description: status.adapters.find(adapter => adapter.id === profile.adapterId)?.name || profile.adapterId,
        run: async () => {
          if (action === 'password') {
            this.confirm('Reveal saved Wi-Fi password', `Profile: ${profile.name}\n\nThe password will be visible in this terminal for 45 seconds. Ensure no one is watching or recording your screen. It is never written to Jarvis activity logs.`, async () => {
              this.state.busy = 'Reading the selected saved password'; this.draw();
              const controller = new AbortController(); this.controller = controller;
              try {
                const result = await network.getWifiPassword({ profile: profile.name, adapterId: profile.adapterId, confirmed: true }, { signal: controller.signal });
                if (!this.running || controller.signal.aborted) return;
                this.showText('Saved Wi-Fi password / private', `Profile: ${result.profile}\n\n${result.password}\n\nCloses automatically in 45 seconds. Press Esc to hide now.`);
                this.state.modal.sensitive = true;
                const modal = this.state.modal;
                this.secretTimer = setTimeout(() => { if (this.state.modal === modal) { this.clearSensitiveModal(); this.draw(); } }, 45_000);
                this.secretTimer.unref?.();
              } catch { this.note('The saved password could not be revealed. Check Windows permissions or use Windows Settings.', 'warn'); }
              finally { if (this.controller === controller) this.controller = null; this.state.busy = null; this.draw(); }
            });
          } else await this.reviewControl('Wi-Fi connection', options => network.planNetworkChange({ action, adapterId: profile.adapterId, profile: profile.name }, options),
            (plan, options) => network.applyNetworkChange(plan, options), plan => `Adapter: ${plan.adapterName}\nConnect to saved profile: ${plan.profile}`);
        },
      })), 'Only profiles already saved in Windows are offered.');
    }
    const adapters = status.adapters.filter(adapter => action === 'dns' || adapter.wifi);
    this.chooseControl(action === 'dns' ? 'Choose adapter for IPv4 DNS' : 'Choose Wi-Fi to disconnect', adapters.map(adapter => ({ title: adapter.name, description: adapter.profile || adapter.status || '', run: async () => {
      const review = dns => this.reviewControl(action === 'dns' ? 'IPv4 DNS change' : 'Wi-Fi disconnection',
        options => network.planNetworkChange({ action, adapterId: adapter.id, ...(action === 'dns' ? { dns } : {}) }, options),
        (plan, options) => network.applyNetworkChange(plan, options), plan => `Adapter: ${plan.adapterName}\n${action === 'dns' ? `Current DNS: ${(plan.before.dns || []).join(', ') || 'Automatic'}\nNew DNS: ${plan.dns === null ? 'Automatic' : plan.dns.join(', ')}` : `Disconnect profile: ${plan.before.profile || 'Current connection'}`}`);
      if (action === 'dns') this.prompt('Set IPv4 DNS servers', 'Comma-separated addresses; leave blank for Automatic', (adapter.dns || []).join(', '), value => review(value.trim() ? value.split(/[,\s]+/).filter(Boolean) : null), 'Changes IPv4 DNS only. Windows may require administrator permission.');
      else await review();
    } })));
  }

  async audioAction(action) {
    if (this.state.demo) return this.showText('Demo sound controls', 'Demo output: 55%, unmuted. Real volume and mute controls are available without --demo.');
    const { audio } = await this.nativeModules();
    const status = await this.runTask('Reading sound output', options => audio.getAudioStatus(options));
    if (!status) return;
    if (!status.available) return this.note(status.warning || 'No sound output is available.', 'warn');
    const apply = settings => this.confirm('Change sound output', `${settings.volume === undefined ? `${settings.muted ? 'Mute' : 'Unmute'} the default output.` : `Volume: ${Math.round(status.volume)}% -> ${settings.volume}%`}\nThis affects the current default Windows output device.`, async () => {
      const result = await this.runTask('Changing sound output', options => audio.setAudioSettings({ ...settings, ...(status.defaultDeviceId ? { deviceId: status.defaultDeviceId } : {}), confirmed: true }, options));
      if (result) { this.state.control ||= {}; this.state.control.audio = result; this.note(result.message || `Sound: ${Math.round(result.volume)}%${result.muted ? ', muted' : ', unmuted'}.`, result.warnings?.length || ['partial', 'uncertain', 'requested'].includes(result.status) ? 'warn' : 'good'); }
    });
    if (action === 'mute') apply({ muted: !status.muted });
    else this.prompt('Adjust sound volume', 'Volume from 0 to 100', String(Math.round(status.volume)), value => {
      const volume = Number(value);
      if (!value.trim() || !Number.isInteger(volume) || volume < 0 || volume > 100) return this.note('Enter a whole-number volume from 0 to 100.', 'warn');
      apply({ volume });
    });
  }

  async securityAction(type, target) {
    if (this.state.demo) return this.showText('Demo Defender controls', 'Real scans use Microsoft Defender on Windows. Quick, full and custom scans require explicit review. Defender can quarantine detections; stopping Jarvis monitoring does not stop the scan.');
    if (type === 'custom' && target === undefined) return this.prompt('Scan a local file or folder', 'Absolute local path', this.state.root, value => this.securityAction(type, value.trim()), 'Defender may quarantine detected threats according to your protection settings.');
    const { security } = await this.nativeModules();
    const plan = await this.runTask('Reviewing Defender scan', options => security.planSecurityScan({ type, ...(type === 'custom' ? { path: target } : {}) }, options));
    if (!plan) return;
    this.confirm(plan.title, `Scope: ${plan.path || (type === 'full' ? 'Full computer scan' : 'Quick scan of common threat locations')}\n\n${plan.warning}`, async () => {
      this.state.scanMonitoring = true;
      try {
        const result = await this.runTask('Monitoring Defender scan', options => security.runSecurityScan(plan, { ...options, confirmed: true }));
        if (result) this.showText('Defender scan result', `${result.message}\n\n${result.scanMayContinue ? 'Defender may still be running. Review Windows Security.' : 'Review Windows Security protection history for detection details.'}\n\n${this.state.operationLog?.join('\n') || ''}`);
      } finally { this.state.scanMonitoring = false; this.draw(); }
    });
  }

  async powerAction() {
    if (this.state.demo) return this.showText('Demo power controls', 'Sample power plan: Balanced. Run outside demo mode to choose one of your existing Windows power plans.');
    const { settings } = await this.nativeModules();
    const status = await this.runTask('Reading power plans', options => settings.getSystemSettings(options));
    if (!status) return;
    if (!status.available || !status.powerPlans?.length) return this.note(status.reason || status.powerPlanError || 'Power plans are unavailable.', 'warn');
    this.chooseControl('Choose a Windows power plan', status.powerPlans.map(item => ({ title: `${item.name}${item.active ? ' (current)' : ''}`, description: item.id,
      run: () => this.reviewControl('Windows power plan', options => settings.planSettingChange({ action: 'power-plan', id: item.id }, options),
        (plan, options) => settings.applySettingChange(plan, options), plan => `Use: ${plan.name}\nPrevious plan ID: ${plan.previousPlanId}`) })));
  }

  async settingsAction() {
    if (this.state.demo) return this.showText('Demo Windows Settings', 'Open Windows Security, updates, storage, installed apps, startup apps, display, sound, network, privacy and power settings from a real Jarvis session.');
    const { settings } = await this.nativeModules();
    const status = await this.runTask('Reading settings shortcuts', options => settings.getSystemSettings(options));
    if (!status) return;
    if (!status.available) return this.note(status.reason || 'Windows settings are unavailable.', 'warn');
    this.chooseControl('Open Windows Settings', status.items.map(item => ({ title: item.title, description: item.description, run: () => this.openNativeSettings(item.id, item.title) })));
  }

  async openNativeSettings(id, title) {
    if (this.state.demo) return this.showText('Demo settings shortcut', `A real session opens ${title} in Windows Settings after confirmation.`);
    const { settings } = await this.nativeModules();
    this.confirm(`Open ${title}`, 'This opens a visible Windows Settings window. Any setting changes are made there by you.', async () => {
      await this.runTask(`Opening ${title}`, options => settings.openSettingsPage(id, { ...options, confirmed: true }));
    });
  }

  support() {
    const about = getAbout();
    const donations = about.donations;
    this.showText('Support Ashish / About Jarvis', `${about.name} ${about.version}\nBy ${about.author}\n${about.license} / Free and open source\n${about.repository}\n\n${donations ? Object.entries(donations).map(([key, value]) => `${({ accountHolder: 'Account holder', accountNumber: 'Account number', ifsc: 'IFSC', upi: 'UPI', paymentUrl: 'Payment link' })[key]}: ${value}`).join('\n') : 'Donation details have not been configured.'}\n\nBank placeholders are not payment instructions. Contributions and bug reports are welcome.`);
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
    if (s.screen === 'control') return this.controlCategory(CONTROL_ITEMS[index]?.id);
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
      scripts: s.scripts.length, recipes: s.recipes.length, control: CONTROL_ITEMS.length, preview: s.preview?.lines?.length || 0 };
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
    if (key.name === 'escape') { this.clearSensitiveModal(); this.draw(); return; }
    if (m.type === 'text') {
      if (key.name === 'return' && m.continue) { this.state.modal = null; await m.continue(); this.draw(); return; }
      if (['up', 'down', 'pageup', 'pagedown'].includes(key.name)) m.offset = Math.max(0, (m.offset || 0) + (['up', 'pageup'].includes(key.name) ? -1 : 1) * (key.name.startsWith('page') ? 10 : 1));
      this.draw(); return;
    }
    if (m.type === 'confirm') {
      if (['up', 'down', 'pageup', 'pagedown'].includes(key.name)) m.offset = Math.max(0, (m.offset || 0) + (['up', 'pageup'].includes(key.name) ? -1 : 1) * (key.name.startsWith('page') ? 10 : 1));
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
    if (text === '$') return this.support();
    if (text === '0') return this.open('control');
    if (name === 'b') {
      if (!this.webServer) {
        const { startServer } = await import('./server.js');
        this.webServer = await startServer({ root: s.root, demo: s.demo, activity: this.activity, operations: this.operations });
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
    if (s.screen === 'control') {
      const category = { w: 'network', v: 'audio', s: 'security', p: 'power', o: 'settings' }[name];
      if (category) return this.controlCategory(category);
    } else if (s.screen === 'files') {
      const fileAction = { n: 'mkdir', c: 'copy', m: 'move', e: 'rename', x: 'trash', h: 'history' }[name];
      if (fileAction) return this.fileAction(fileAction);
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
      if (name === 'k') return this.stopSelectedProcess();
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


function demoControl() {
  return {
    network: { available: true, adapters: [{ id: 'demo', name: 'Wi-Fi', status: 'Connected', wifi: true, profile: 'Home network', ipv4: ['192.168.1.25'], dns: ['192.168.1.1'] }], profiles: [{ name: 'Home network', adapterId: 'demo' }] },
    audio: { available: true, volume: 55, muted: false, devices: [{ name: 'Speakers', isDefault: true }] },
    security: { available: true, enabled: true, realtimeEnabled: true, canScan: true, scanStatus: 'Sample protection status', definitionsUpdated: '2026-10-12T08:00:00Z', detections: [] },
    settings: { available: true, powerPlans: [{ id: 'demo', name: 'Balanced', active: true }], items: [] },
  };
}
