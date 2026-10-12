import test from 'node:test';
import assert from 'node:assert/strict';
import { Dashboard, safeRemote } from '../src/app.js';
import { demoState } from '../src/demo.js';
import { clean, friendlyError, width } from '../src/format.js';
import { NAV, renderDashboard, hardwareComponentText, hardwareReportText } from '../src/ui.js';
import { OperationCoordinator } from '../src/operations.js';

function dashboard({ demo = false } = {}) {
  const frames = [];
  const output = { columns: 110, rows: 33, write: value => frames.push(value) };
  const app = new Dashboard('.', { demo, output, activity: { append: async () => {}, list: async () => [] } });
  app.running = true;
  return { app, frames };
}

for (const columns of [56, 80, 110]) {
  test(`all dashboard screens fit a ${columns} by 32 terminal`, () => {
    for (const [screen] of NAV) {
      const state = demoState();
      state.screen = screen;
      const frame = renderDashboard(state, columns, 32, { color: false });
      const lines = frame.split('\r\n');
      assert.equal(lines.length, 32, screen);
      assert.ok(lines.every(line => width(line) === columns), `${screen}: every row fills exactly ${columns} terminal cells`);
    }
  });
}

test('untrusted filenames and text cannot inject terminal controls', () => {
  const state = demoState();
  const injected = 'bad\x1b[2J\x1b]0;injected-title\x07name.txt';
  state.root = injected;
  state.screen = 'files';
  state.files.entries = [{ name: injected, path: injected, type: 'file', size: 1 }];
  state.message = { text: injected, tone: 'normal' };
  let frame = renderDashboard(state, 110, 32, { color: false });
  assert.doesNotMatch(frame, /[\x00-\x09\x0b\x0c\x0e-\x1f\x7f-\x9f]/);
  assert.doesNotMatch(frame, /injected-title/);
  state.modal = { type: 'text', title: injected, content: injected };
  frame = renderDashboard(state, 110, 32, { color: true });
  assert.ok(!frame.includes('\x1b[2J'));
  assert.ok(!frame.includes('\x1b]0;'));
});

test('remote display redacts URL credentials in both helpers and live frames', () => {
  const url = 'https://account:private-password@example.com/team/repo.git?access_token=private-token&key=private-key';
  const redacted = safeRemote(url);
  for (const secret of ['private-password', 'private-token', 'private-key']) assert.ok(!redacted.includes(secret));
  assert.match(redacted, /example\.com\/team\/repo\.git/);
  assert.equal(safeRemote('git@example.com:team/repo.git'), 'git@example.com:team/repo.git');
  assert.equal(safeRemote(null), '(none)');
  assert.ok(!safeRemote('\x1b[2Jhttps://example.com/repo').includes('\x1b'));
  const state = demoState();
  state.screen = 'git';
  state.git.remoteUrl = url;
  const frame = renderDashboard(state, 160, 32, { color: false });
  for (const secret of ['private-password', 'private-token', 'private-key']) assert.ok(!frame.includes(secret));
});

test('friendly errors distinguish credential files from Git authentication failures', () => {
  const sensitive = 'Potential credential files were found: .env. Review them and add private files to .gitignore before committing.';
  assert.equal(friendlyError(new Error(sensitive)), sensitive);
  assert.match(friendlyError(new Error('fatal: Authentication failed for repository')), /sign-in is needed/);
  assert.match(friendlyError(new Error('fatal: could not read Username: terminal prompts disabled')), /sign-in is needed/);
  assert.match(friendlyError(new Error('fatal: Unable to create index.lock: File exists')), /Another Git operation/);
});

test('demo navigation, prompts, and confirmations use explicit keyboard choices', async () => {
  const { app } = dashboard({ demo: true });
  await app.onKey('4', { name: '4' });
  assert.equal(app.state.screen, 'git');
  await app.onKey('\t', { name: 'tab' });
  assert.equal(app.state.screen, 'processes');
  await app.onKey('\t', { name: 'tab', shift: true });
  assert.equal(app.state.screen, 'git');
  let submitted = false;
  app.prompt('Message', 'Type text', '', () => { submitted = true; });
  await app.onKey('hello', {});
  assert.equal(app.state.modal.value, 'hello');
  await app.onKey(undefined, { name: 'escape' });
  assert.equal(app.state.modal, null);
  assert.equal(submitted, false);
  app.confirm('Review', 'No implicit execution', () => { submitted = true; });
  await app.onKey('\r', { name: 'return' });
  assert.equal(submitted, false);
  assert.equal(app.state.modal, null);
  app.confirm('Review', 'Explicit choice', () => { submitted = true; });
  await app.onKey('y', { name: 'y' });
  assert.equal(submitted, true);
  let executed = false;
  await app.runTask('Demo operation', async () => { executed = true; });
  assert.equal(executed, false);
});

test('palette keeps a lower selected task visible and opens the selected screen', async () => {
  const { app } = dashboard({ demo: true });
  await app.onKey(undefined, { name: 'p', ctrl: true });
  const lastScreen = app.state.modal.choices.findLastIndex(choice => choice.screen);
  for (let index = 0; index < lastScreen; index++) await app.onKey(undefined, { name: 'down' });
  const selected = app.state.modal.choices[app.state.modal.choice];
  const frame = renderDashboard(app.state, 110, 32, { color: false });
  assert.ok(frame.includes(`> ${selected.title}`), 'the selected task stays inside the palette viewport');
  await app.onKey('\r', { name: 'return' });
  assert.equal(app.state.screen, selected.screen);
  assert.equal(app.state.modal, null);
});

test('closing a preview opened from search returns to its existing results', async () => {
  const { app } = dashboard({ demo: true });
  await app.open('search');
  const matches = app.state.search.matches;
  await app.onKey('\r', { name: 'return' });
  assert.equal(app.state.screen, 'files');
  assert.ok(app.state.preview);
  await app.onKey(undefined, { name: 'escape' });
  assert.equal(app.state.preview, null);
  assert.equal(app.state.screen, 'search');
  assert.equal(app.state.search.matches, matches);
});

test('task failures preserve unterminated output and never report success', async () => {
  const { app } = dashboard();
  const result = await app.runTask('Build', async ({ onOutput }) => {
    onOutput('first line\n');
    onOutput('last line without newline');
    return { code: 7, stdout: '', stderr: '' };
  });
  assert.equal(result, undefined);
  assert.deepEqual(app.state.operationLog, ['first line', 'last line without newline']);
  assert.match(app.state.message.text, /code 7/);
  assert.notEqual(app.state.message.tone, 'good');
  assert.equal(app.state.busy, null);
});

test('successful and cancelled tasks clean up state and preserve output', async () => {
  const { app } = dashboard();
  const result = await app.runTask('Build', async ({ onOutput }) => {
    onOutput('finished');
    return { code: 0 };
  });
  assert.equal(result.code, 0);
  assert.deepEqual(app.state.operationLog, ['finished']);
  assert.equal(app.state.message.tone, 'good');
  const pending = app.runTask('Waiting', ({ signal }) => new Promise(resolve => {
    signal.addEventListener('abort', () => resolve({ code: 0 }), { once: true });
  }));
  await app.onKey(undefined, { name: 'escape' });
  await pending;
  assert.match(app.state.message.text, /Cancelled/);
  assert.equal(app.state.busy, null);
  assert.equal(app.controller, null);
});

test('cancelled storage scans keep their partial result and a warning', async () => {
  const { app } = dashboard();
  const pending = app.runTask('Storage scan', ({ signal }) => new Promise(resolve => {
    signal.addEventListener('abort', () => resolve({ cancelled: true, truncated: true, totalFiles: 42 }), { once: true });
  }));
  await app.onKey(undefined, { name: 'escape' });
  const result = await pending;
  assert.equal(result.totalFiles, 42);
  assert.equal(app.state.message.tone, 'warn');
  assert.match(app.state.message.text, /partial results preserved/);
});

test('full review text must be followed by explicit confirmation', async () => {
  const { app } = dashboard();
  let ran = false;
  app.showText('Review every file', 'Very long path '.repeat(100));
  app.state.modal.continue = () => app.confirm('Confirm cleanup', 'Reviewed files', () => { ran = true; });
  const frame = renderDashboard(app.state, 80, 32, { color: false });
  assert.match(frame, /\[Enter\] Continue/);
  await app.onKey('\r', { name: 'return' });
  assert.equal(app.state.modal.type, 'confirm');
  assert.equal(ran, false);
  await app.onKey('\r', { name: 'return' });
  assert.equal(ran, false);
});


test('process stop reviews the selected identity and requires explicit Y', async () => {
  const { app } = dashboard();
  const plan = Object.freeze({ pid: 321, name: 'fixture', owner: 'test user', startedAt: '2026-01-01', warning: 'Unsaved work may be lost.' });
  let stopped = 0;
  app.options.processControl = {
    planProcessStop: async pid => { assert.equal(pid, 321); return plan; },
    stopProcess: async (received, options) => {
      assert.equal(received, plan); assert.equal(options.confirmed, true); stopped++;
      return { status: 'requested', message: 'Request sent; process is still running.' };
    }
  };
  app.refresh = async () => {};
  app.state.screen = 'processes';
  app.state.processes = { processes: [{ pid: 321, name: 'fixture', cpu: 1, memory: 1024 }] };
  await app.onKey('k', { name: 'k' });
  assert.equal(app.state.modal.type, 'confirm');
  assert.match(app.state.modal.detail, /PID: 321/);
  assert.match(app.state.modal.detail, /Unsaved work/);
  await app.onKey('\r', { name: 'return' });
  assert.equal(stopped, 0);
  await app.onKey('k', { name: 'k' });
  app.state.processes.processes = [{ pid: 999, name: 'different process', cpu: 1, memory: 1024 }];
  await app.onKey('y', { name: 'y' });
  assert.equal(stopped, 1);
  assert.equal(app.state.message.tone, 'warn');
  assert.match(app.state.message.text, /still running/);
});

test('demo process stop confirmation never invokes the real backend', async () => {
  const { app } = dashboard({ demo: true });
  let touched = false;
  app.options.processControl = { planProcessStop: async () => { touched = true; }, stopProcess: async () => { touched = true; } };
  app.state.screen = 'processes';
  await app.onKey('k', { name: 'k' });
  assert.match(app.state.modal.detail, /Demo only/);
  await app.onKey('y', { name: 'y' });
  assert.equal(touched, false);
});


test('Control Center uses 0, preserves existing numbered tools, and exposes Support', async () => {
  const { app } = dashboard({ demo: true });
  app.options.nativeControl = new Proxy({}, { get() { throw new Error('Demo must not call a native backend'); } });
  await app.onKey('0', { name: '0' });
  assert.equal(app.state.screen, 'control');
  let frame = renderDashboard(app.state, 110, 32, { color: false });
  assert.match(frame, /CONTROL CENTER/);
  assert.match(frame, /55%/);
  assert.match(frame, /\$ Support/);
  await app.onKey('9', { name: '9' });
  assert.equal(app.state.screen, 'recipes');
  await app.onKey('$', { name: '$' });
  assert.match(app.state.modal.title, /Support Ashish/);
  await app.onKey(undefined, { name: 'escape' });
  app.palette();
  assert.ok(app.state.modal.choices.some(item => item.title === 'Full malware scan'));
  await app.securityAction('full');
  assert.match(app.state.modal.content, /Real scans use Microsoft Defender/);
});

function controlMocks(app, changes = {}) {
  const records = [];
  app.options.nativeControl = {
    network: { getNetworkStatus: async () => ({ available: true, adapters: [{ id: 'fixture', name: 'Wi-Fi', wifi: true, profile: 'Home', dns: ['1.1.1.1'] }], profiles: [{ name: 'Home', adapterId: 'fixture' }] }) },
    audio: { getAudioStatus: async () => ({ available: true, volume: 25, muted: false }), setAudioSettings: async value => { records.push(value); return { available: true, volume: value.volume ?? 25, muted: value.muted ?? false }; } },
    security: { getSecurityStatus: async () => ({ available: false, reason: 'Fixture unavailable' }) },
    settings: { getSystemSettings: async () => ({ available: true, powerPlans: [], items: [] }) }, ...changes,
  };
  return records;
}

test('terminal sound changes need explicit review and are sent only after Y', async () => {
  const { app } = dashboard();
  const records = controlMocks(app);
  await app.audioAction('volume');
  assert.equal(app.state.modal.type, 'input');
  app.state.modal.value = '70';
  await app.onKey('\r', { name: 'return' });
  assert.equal(app.state.modal.type, 'confirm');
  assert.equal(records.length, 0);
  await app.onKey('y', { name: 'y' });
  assert.deepEqual(records, [{ volume: 70, confirmed: true }]);
  assert.match(app.state.message.text, /70%/);
});

test('saved Wi-Fi passwords are ephemeral, absent from activity and operation logs, and erased on Esc', async () => {
  const { app } = dashboard();
  const events = [];
  app.activity = { append: async event => events.push(event), list: async () => events };
  const secret = 'fixture-super-private-password';
  let reads = 0;
  controlMocks(app, { network: {
    getNetworkStatus: async () => ({ available: true, adapters: [{ id: 'fixture', name: 'Wi-Fi', wifi: true }], profiles: [{ name: 'Home', adapterId: 'fixture' }] }),
    getWifiPassword: async input => { reads++; assert.equal(input.confirmed, true); return { profile: input.profile, password: secret }; },
  } });
  await app.networkAction('password');
  await app.onKey('\r', { name: 'return' });
  assert.equal(app.state.modal.type, 'confirm');
  assert.equal(reads, 0);
  await app.onKey('y', { name: 'y' });
  assert.equal(reads, 1);
  assert.equal(app.state.modal.sensitive, true);
  assert.match(app.state.modal.content, new RegExp(secret));
  assert.ok(!JSON.stringify(events).includes(secret));
  assert.ok(!JSON.stringify(app.state.activity).includes(secret));
  assert.ok(!JSON.stringify(app.state.operationLog).includes(secret));
  await app.onKey(undefined, { name: 'escape' });
  assert.equal(app.state.modal, null);
  assert.ok(!JSON.stringify(app.state).includes(secret));
  assert.ok(!app.frame.includes(secret));
});

test('Defender monitoring cancellation keeps its continuation warning in the terminal', async () => {
  const { app } = dashboard();
  let invoked = false;
  controlMocks(app, { security: {
    planSecurityScan: async () => ({ title: 'Quick Defender scan', warning: 'May quarantine files. Stopping monitoring does not stop Defender.', path: null }),
    runSecurityScan: async (plan, { confirmed }) => { invoked = confirmed; return { cancelled: true, scanMayContinue: true, message: 'Defender may still be scanning.' }; },
  } });
  await app.securityAction('quick');
  assert.match(app.state.modal.detail, /does not stop Defender/);
  assert.equal(invoked, false);
  await app.onKey('y', { name: 'y' });
  assert.equal(invoked, true);
  assert.match(app.state.modal.content, /Defender may still be scanning/);
  assert.equal(app.state.message.tone, 'warn');
  assert.equal(app.state.scanMonitoring, false);
});

test('file-manager actions review exact source and destination before execution', async () => {
  const { app } = dashboard();
  let executed = 0;
  const issued = Object.freeze({ root: 'fixture', source: 'fixture/hello.txt', destination: 'fixture/copy.txt', files: 1, bytes: 10, warning: 'No overwrites.' });
  app.options.fileActions = {
    planFileAction: async (root, input) => { assert.equal(input.action, 'copy'); assert.equal(input.path, 'hello.txt'); assert.equal(input.destination, 'copy.txt'); return issued; },
    executeFileAction: async (plan, { confirmed }) => { assert.equal(plan, issued); assert.equal(confirmed, true); executed++; return { message: 'File copied.' }; },
  };
  app.refresh = async () => {};
  app.state.screen = 'files';
  app.state.files.entries = [{ name: 'hello.txt', path: 'hello.txt', type: 'file', size: 10 }];
  await app.onKey('c', { name: 'c' });
  app.state.modal.value = 'copy.txt';
  await app.onKey('\r', { name: 'return' });
  assert.match(app.state.modal.detail, /fixture\/hello.txt/);
  assert.match(app.state.modal.detail, /fixture\/copy.txt/);
  assert.equal(executed, 0);
  await app.onKey('y', { name: 'y' });
  assert.equal(executed, 1);
});


test('partial file operations remain warnings and expose the remaining destination', async () => {
  const { app } = dashboard();
  app.options.fileActions = {
    planFileAction: async () => ({ root: 'fixture', source: 'fixture/file', destination: 'fixture/copy', files: 1, bytes: 1, warning: 'Review' }),
    executeFileAction: async () => ({ status: 'partial', destination: 'fixture/copy', message: 'Copy cleanup needs review.', errors: ['A new external item prevented cleanup.'] }),
  };
  app.state.screen = 'files';
  app.state.files.entries = [{ name: 'file', path: 'file', type: 'file', size: 1 }];
  app.refresh = async () => {};
  await app.fileAction('trash');
  await app.onKey('y', { name: 'y' });
  assert.equal(app.state.message.tone, 'warn');
  assert.match(app.state.modal.content, /fixture\/copy/);
  assert.match(app.state.modal.content, /external item prevented cleanup/);
});

test('unknown protection values are not rendered as disabled in Control Center', () => {
  const { app } = dashboard({ demo: true });
  app.state.screen = 'control';
  app.state.control.security.enabled = null;
  app.state.control.security.realtimeEnabled = null;
  const frame = renderDashboard(app.state, 110, 32, { color: false });
  assert.match(frame, /Defender unknown/);
  assert.match(frame, /Real-time unknown/);
  assert.doesNotMatch(frame, /Defender disabled/);
});

test('long confirmation text remains scrollable on a small terminal', async () => {
  const { app } = dashboard();
  app.output.rows = 18;
  app.confirm('Review details', Array.from({ length: 20 }, (_, index) => `Line ${index + 1} to review`).join('\n'), () => {});
  let frame = renderDashboard(app.state, 56, 17, { color: false });
  assert.match(frame, /Up\/Down/);
  await app.onKey(undefined, { name: 'pagedown' });
  frame = renderDashboard(app.state, 56, 17, { color: false });
  assert.match(frame, /Line 11 to review/);
  assert.match(frame, /Continue\?/);
});


test('terminal task output stays bounded even when a program never emits a newline', async () => {
  for (const failure of [false, true]) {
    const { app } = dashboard();
    await app.runTask('Noisy program', async ({ onOutput }) => {
      onOutput('x'.repeat(200 * 1024));
      onOutput('y'.repeat(200 * 1024));
      onOutput('z'.repeat(200 * 1024));
      if (failure) throw new Error('Fixture failure after output');
      return { code: 0 };
    });
    assert.equal(app.state.operationLog.at(-1), '[Output truncated at 256 KB.]');
    assert.ok(Buffer.byteLength(app.state.operationLog.join('\n')) <= 256 * 1024 + 100);
    assert.ok(!app.state.operationLog.join('').includes('z'));
    assert.equal(app.state.busy, null);
    assert.equal(app.controller, null);
    assert.equal(app.state.message.tone, failure ? 'bad' : 'good');
  }
});

test('the terminal retains only recent output rows and strips injected control sequences', async () => {
  const { app } = dashboard();
  await app.runTask('Many lines', async ({ onOutput }) => {
    for (let index = 0; index < 300; index++) onOutput(`\x1b[31mline-${index}\x1b[0m\n`);
    return { code: 0 };
  });
  assert.equal(app.state.operationLog.length, 120);
  assert.equal(app.state.operationLog[0], 'line-180');
  assert.equal(app.state.operationLog.at(-1), 'line-299');
  assert.ok(app.state.operationLog.every(line => !line.includes('\x1b')));
});

test('an operation owned by the browser blocks terminal execution without cancelling the other view', async () => {
  const { app } = dashboard();
  const shared = new OperationCoordinator();
  app.operations = shared;
  const browserController = new AbortController();
  const releaseBrowser = shared.acquire('browser file move', browserController);
  let invoked = false;
  const rejected = await app.runTask('terminal cleanup', async () => { invoked = true; });
  assert.equal(rejected, undefined);
  assert.equal(invoked, false);
  assert.match(app.state.message.text, /browser file move/);
  assert.equal(app.state.message.tone, 'warn');
  assert.equal(app.controller, null);
  assert.equal(Boolean(app.state.busy), false);
  await app.onKey(undefined, { name: 'escape' });
  assert.equal(browserController.signal.aborted, false);
  releaseBrowser();
  const result = await app.runTask('terminal next operation', async () => ({ status: 'completed', message: 'fixture complete' }));
  assert.equal(result.status, 'completed');
  assert.equal(shared.active, null);
});

test('terminal cancellation preserves an uncertain native result and releases the shared operation slot', async () => {
  const { app } = dashboard();
  const shared = new OperationCoordinator(); app.operations = shared;
  let ready;
  const entered = new Promise(resolve => { ready = resolve; });
  const result = { status: 'uncertain', cancelled: true, before: { value: 1 }, after: { value: 2 },
    message: 'The command stopped while applying. Refresh before retrying.' };
  const pending = app.runTask('Changing fixture setting', ({ signal, onOutput }) => new Promise(resolve => {
    onOutput('native command started\n');
    signal.addEventListener('abort', () => resolve(result), { once: true }); ready();
  }));
  await entered;
  assert.throws(() => shared.acquire('browser action', new AbortController()), error => error.code === 'OPERATION_BUSY');
  await app.onKey(undefined, { name: 'escape' });
  assert.equal(await pending, result);
  assert.equal(app.state.message.tone, 'warn');
  assert.match(app.state.message.text, /Refresh before retrying/);
  assert.deepEqual(app.state.operationLog, ['native command started']);
  assert.equal(shared.active, null);
  assert.equal(app.controller, null);
  assert.equal(app.state.busy, null);
  const release = shared.acquire('browser action after cancellation', new AbortController());
  release();
});


function hardwareFixture() {
  return {
    sampledAt: '2026-10-12T10:00:00.000Z', platform: 'fixture', demo: false,
    summary: { attention: 1, observed: 1, unknown: 1 },
    components: [
      { id: 'cpu', title: 'Processor', status: 'warning', summary: 'Readings require review.',
        metrics: [{ label: 'Usage', value: '0%' }, { label: 'Temperature', value: null, note: 'No exposed sensor.' }],
        details: [{ label: 'Sockets', value: 0 }],
        findings: [{ severity: 'warning', title: 'Fixture warning', explanation: 'A measured condition needs review.', recommendation: 'Review the reported value.' }],
        devices: [{ name: 'Fixture device', details: [{ label: 'Speed', value: null }] }],
        limitations: ['This is not a physical fault test.'], actions: [{ label: 'Review processes', screen: 'processes' }] },
      { id: 'gpu', title: 'Graphics', status: 'unknown', summary: 'No provider is available.', metrics: [], details: [], findings: [], devices: [], limitations: [], actions: [] },
      { id: 'memory', title: 'Memory', status: 'ok', summary: 'Usage was reported.', metrics: [], details: [], findings: [], devices: [], limitations: [], actions: [] },
    ],
    limitations: ['A reading does not certify component health.'],
  };
}

test('hardware details preserve zero, explain unknown sensors, and include findings and device limits', () => {
  const snapshot = hardwareFixture();
  const details = hardwareComponentText(snapshot.components[0]);
  assert.match(details, /Usage: 0%/);
  assert.match(details, /Sockets: 0/);
  assert.match(details, /Temperature: Unknown/);
  assert.match(details, /No exposed sensor/);
  assert.match(details, /Speed: Unknown/);
  assert.match(details, /Fixture warning/);
  assert.match(details, /Next step: Review the reported value/);
  assert.match(details, /This is not a physical fault test/);
  assert.doesNotMatch(details, /\bnull\b|\bundefined\b|\[object Object\]/);
  const report = hardwareReportText(snapshot);
  assert.match(report, /1 need attention \/ 1 observed \/ 1 unknown/);
  assert.match(report, /Status: Unknown/);
  assert.match(report, /Status: Observed/);
  assert.match(report, /REPORT LIMITATIONS/);
  assert.match(report, /does not certify hardware health/);
});

test('hardware terminal navigation exposes details and related tools without changing numeric shortcuts', async () => {
  const { app } = dashboard({ demo: true });
  await app.onKey('i', { name: 'i' });
  assert.equal(app.state.screen, 'hardware');
  app.state.hardware = hardwareFixture();
  await app.onKey('\r', { name: 'return' });
  assert.equal(app.state.modal.type, 'text');
  assert.match(app.state.modal.content, /Sampled: 2026-10-12/);
  assert.match(app.state.modal.content, /Temperature: Unknown/);
  await app.onKey('\r', { name: 'return' });
  assert.equal(app.state.modal.type, 'palette');
  assert.equal(app.state.modal.choices[0].screen, 'processes');
  await app.onKey('\r', { name: 'return' });
  assert.equal(app.state.screen, 'processes');
  await app.onKey('0', { name: '0' });
  assert.equal(app.state.screen, 'control');
  await app.onKey('9', { name: '9' });
  assert.equal(app.state.screen, 'recipes');
});

test('hardware details and list stay bounded at small terminal sizes and sanitize provider strings', () => {
  const { app } = dashboard();
  app.state.screen = 'hardware';
  app.state.hardware = hardwareFixture();
  app.state.hardware.components[0].title = 'CPU\x1b[2J\x1b]0;owned\x07';
  app.state.hardware.components[0].devices[0].name = '\x1b[31mdevice\x1b[0m';
  for (const columns of [56, 80, 110]) {
    for (const rows of [17, 32]) {
      let frame = renderDashboard(app.state, columns, rows, { color: false });
      assert.equal(frame.split('\r\n').length, rows);
      assert.ok(frame.split('\r\n').every(line => width(line) === columns));
      assert.doesNotMatch(frame, /\x1b|owned/);
      app.state.modal = { type: 'text', title: 'Details', content: hardwareComponentText(app.state.hardware.components[0]) };
      frame = renderDashboard(app.state, columns, rows, { color: false });
      assert.equal(frame.split('\r\n').length, rows);
      assert.ok(frame.split('\r\n').every(line => width(line) === columns));
      assert.doesNotMatch(frame, /\x1b|owned/);
      app.state.modal = null;
    }
  }
});

test('hardware refresh is cancellable, retains the previous sample, and releases operation ownership', async () => {
  const { app } = dashboard();
  const old = hardwareFixture();
  app.state.screen = 'hardware';
  app.state.hardware = old;
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  let received;
  app.options.getHardwareSnapshot = ({ signal }) => new Promise((resolve, reject) => {
    received = signal;
    signal.addEventListener('abort', () => reject(new Error('Cancelled fixture')), { once: true });
    entered();
  });
  const pending = app.refresh();
  await ready;
  assert.match(app.state.busy, /Reading hardware/);
  await app.onKey(undefined, { name: 'escape' });
  await pending;
  assert.equal(received.aborted, true);
  assert.equal(app.state.hardware, old);
  assert.match(app.state.message.text, /Previous readings are still shown/);
  assert.equal(app.state.message.tone, 'warn');
  assert.equal(app.state.busy, null);
  assert.equal(app.operations.active, null);
  app.options.getHardwareSnapshot = async () => ({ ...old, sampledAt: '2026-10-12T10:01:00.000Z' });
  await app.onKey('r', { name: 'r' });
  assert.equal(app.state.hardware.sampledAt, '2026-10-12T10:01:00.000Z');
});


test('terminal theme preserves monochrome content and cell bounds across compact and wide layouts', () => {
  const { app } = dashboard({ demo: true });
  for (const columns of [56, 88, 110]) {
    for (const lines of [17, 24, 32]) {
      for (const [screen] of NAV) {
        app.state.screen = screen;
        for (const ascii of [false, true]) {
          const plain = renderDashboard(app.state, columns, lines, { color: false, ascii });
          const styled = renderDashboard(app.state, columns, lines, { color: true, ascii });
          const plainLines = plain.split('\r\n');
          const styledLines = styled.split('\r\n');
          assert.equal(plainLines.length, lines);
          assert.ok(styledLines.every(line => width(line) === columns), `${screen} at ${columns}x${lines}`);
          assert.deepEqual(styledLines.map(clean), plainLines, `${screen}: colors must not change the text`);
          assert.ok(!plain.includes('\x1b'));
          if (ascii) assert.doesNotMatch(plain, /[\u2500\u2502]/);
        }
      }
    }
  }
});

test('compact sidebars keep the active tool visible without overwriting it with utility labels', () => {
  const { app } = dashboard({ demo: true });
  for (const [screen, title] of NAV) {
    app.state.screen = screen;
    const frame = renderDashboard(app.state, 110, 17, { color: false });
    assert.ok(frame.includes(`> ${screen === 'hardware' ? 'I' : (NAV.findIndex(item => item[0] === screen) + 1) % 10}  ${title}`), title);
  }
});

test('long-running task labels leave cancellation controls visible in narrow terminals', () => {
  const { app } = dashboard({ demo: true });
  app.state.busy = 'Reading a very long name '.repeat(20);
  for (const scanMonitoring of [false, true]) {
    app.state.scanMonitoring = scanMonitoring;
    const frame = renderDashboard(app.state, 56, 17, { color: false });
    const status = frame.split('\r\n').at(-3);
    assert.match(status, /WORKING/);
    assert.ok(status.endsWith(scanMonitoring ? '[Esc] Stop monitoring ' : '[Esc] Cancel '));
    assert.equal(width(status), 56);
  }
});


test('hardware detail modals wrap long identifiers without losing their tails', () => {
  const { app } = dashboard({ demo: true });
  app.state.screen = 'hardware';
  for (const columns of [80, 110]) {
    for (const middle of ['X'.repeat(240), '\u754c'.repeat(120)]) {
      app.state.modal = { type: 'text', title: 'Hardware details', content: 'Board identifier: START-' + middle + '-END\nNext reading: available' };
      const frame = renderDashboard(app.state, columns, 32, { color: false });
      assert.ok(frame.includes('START-'));
      assert.ok(frame.includes('-END'), 'the tail of an unbroken identifier must be readable');
      assert.ok(frame.includes('Next reading: available'));
      assert.ok(frame.split('\r\n').every(line => width(line) === columns));
    }
  }
});
