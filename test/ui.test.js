import test from 'node:test';
import assert from 'node:assert/strict';
import { Dashboard, safeRemote } from '../src/app.js';
import { demoState } from '../src/demo.js';
import { friendlyError, width } from '../src/format.js';
import { NAV, renderDashboard } from '../src/ui.js';

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
  for (let index = 0; index < 18; index++) await app.onKey(undefined, { name: 'down' });
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
