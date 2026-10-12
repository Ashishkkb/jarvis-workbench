import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// A deliberately small DOM fixture: it models text conversion, dialog focus
// restoration, and the browser's remaining Enter action without a browser dependency.
class Element {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase();
    this.document = document;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.value = '';
    this.open = false;
    this._text = '';
  }
  set textContent(value) { this.children = []; this._text = String(value); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  get childNodes() { return this.children; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name); }
  append(...children) {
    for (const child of children) {
      const node = child instanceof Element ? child : this.document.createTextNode(String(child));
      node.parentElement = this;
      this.children.push(node);
    }
  }
  replaceChildren(...children) { this._text = ''; this.children = []; this.append(...children); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  querySelector(selector) {
    const name = selector.toUpperCase();
    for (const child of this.children) {
      if (child.tagName === name) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
  dispatch(type, properties = {}) {
    const event = {
      target: this, defaultPrevented: false, propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      ...properties,
    };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
  click() { this.dispatch('click'); }
  focus() { this.document.activeElement = this; }
  showModal() { this.opener = this.document.activeElement; this.open = true; }
  close() { this.open = false; this.document.activeElement = this.opener; this.dispatch('close'); }
}

async function browserFixture(respond = () => { throw new Error("Unexpected request"); }) {
  const requests = [];
  const nodes = new Map();
  const document = {
    activeElement: null,
    createElement(tag) { return new Element(tag, document); },
    createElementNS(namespace, tag) { return new Element(tag, document); },
    createTextNode(text) { const node = new Element('#text', document); node.textContent = text; return node; },
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, new Element(selector === '#modal' ? 'dialog' : 'div', document));
      return nodes.get(selector);
    },
  };
  const source = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  const boot = '\nvoid init().catch(error => renderError(error));';
  assert.ok(source.endsWith(`${boot}\n`) || source.endsWith(boot), 'The browser startup must remain an explicit final call.');
  const context = vm.createContext({ document, Node: Element, URLSearchParams, URL, AbortController, console, window: { scrollTo() {} },
    setTimeout: () => 1, clearTimeout: () => {},
    fetch: async (url, options) => {
      const request = { url, method: options.method, body: options.body ? JSON.parse(options.body) : undefined };
      requests.push(request);
      const response = await respond(request);
      return { ok: response.status === undefined || response.status < 400, status: response.status || 200, json: async () => response.body };
    },
  });
  vm.runInContext(source.slice(0, source.lastIndexOf(boot)) + `
    // Isolate palette dispatch from network loading; keep the production DOM and key handlers.
    const navigateActual = navigate;
    navigate = async screen => { state.screen = screen; };
    token = 'test-token';
    modal.addEventListener('close', onModalClose);
    globalThis.testClient = { el, setPage, openPalette, screen: () => state.screen,
      state, navigateActual, renderProcesses, reviewProcessStop, pollJob, jobWarnings, renderJobDock, fillJobModal,
      renderNetwork, renderAudio, renderSecurity, renderSettings, reviewWifiPassword, reviewDns,
      reviewSecurityScan, customSecurityScan, openAbout, openModal, fileActions, editFileAction, reviewFileAction, fileRecovery, renderFiles };

  `, context);
  return { document, requests, client: context.testClient, modal: document.querySelector('#modal'), page: document.querySelector('#page') };
}

test('browser rendering omits absent nodes without displaying null or false', async () => {
  const { client, page } = await browserFixture();
  const child = client.el('span', {}, 'Included');
  client.setPage(null, false, undefined, child, 0);
  assert.equal(page.textContent, 'Included0');
  assert.equal(page.children.length, 2);
  assert.equal(client.el('div', {}, null, false, undefined, 'Hello ', client.el('strong', {}, 'world')).textContent, 'Hello world');
});

test('Enter selects a palette result once and cannot reactivate the restored opener', async () => {
  const { document, client, modal } = await browserFixture();
  const opener = document.createElement('button');
  opener.addEventListener('click', client.openPalette);
  opener.focus();
  opener.click();
  const input = modal.querySelector('input');
  input.value = 'storage';
  input.dispatch('input');
  assert.equal(modal.querySelector('button').textContent.includes('Storage'), true);
  const key = input.dispatch('keydown', { key: 'Enter' });
  // Model the default activation that caused the real browser regression.
  if (!key.defaultPrevented) document.activeElement?.click();
  assert.equal(key.defaultPrevented, true);
  assert.equal(key.propagationStopped, true);
  assert.equal(client.screen(), 'storage');
  assert.equal(modal.open, false);
});

test('palette ArrowDown focuses the result and an empty Enter search stays in the dialog', async () => {
  const { document, client, modal } = await browserFixture();
  client.openPalette();
  const input = modal.querySelector('input');
  input.value = 'storage';
  input.dispatch('input');
  const down = input.dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(down.defaultPrevented, true);
  assert.equal(document.activeElement, modal.querySelector('button'));
  input.focus();
  input.value = 'no-such-tool';
  input.dispatch('input');
  const enter = input.dispatch('keydown', { key: 'Enter' });
  assert.equal(enter.defaultPrevented, true);
  assert.equal(modal.open, true);
  assert.equal(client.screen(), 'overview');
});

function findButton(node, text) {
  if (node.tagName === 'BUTTON' && node.textContent === text) return node;
  for (const child of node.children) {
    const found = findButton(child, text);
    if (found) return found;
  }
}
async function clickButton(button) {
  assert.ok(button, 'Expected the action button to exist');
  await Promise.all((button.listeners.get('click') || []).map(listener => listener({ target: button })));
}
const stopPlan = {
  id: 'review-token', pid: 321, name: 'my-app', owner: 'test-user', platform: 'win32',
  startedAt: '2026-10-12T09:00:00Z', expiresAt: '2026-10-12T09:05:00Z', method: 'Stop-Process',
  warning: 'Windows terminates this process immediately.',
};

test('process Stop first reviews identity; cancelling sends no stop request', async () => {
  const { client, page, modal, requests } = await browserFixture(request => {
    assert.equal(request.url, '/api/processes/plan');
    return { body: stopPlan };
  });
  client.state.processes = { processes: [{ pid: 321, name: 'my-app', cpu: 0, memory: 4096 }], cpuLabel: 'CPU seconds' };
  client.renderProcesses();
  const stop = findButton(page, 'Stop');
  assert.equal(stop.getAttribute('aria-label'), 'Review stopping my-app (PID 321)');
  await clickButton(stop);
  assert.deepEqual(requests, [{ url: '/api/processes/plan', method: 'POST', body: { pid: 321 } }]);
  assert.equal(modal.open, true);
  assert.match(modal.textContent, /Unsaved work can be lost/);
  assert.match(modal.textContent, /Windows terminates this process immediately/);
  assert.match(modal.textContent, /test-user/);
  assert.match(modal.textContent, /321/);
  await clickButton(findButton(modal, 'Cancel'));
  assert.equal(modal.open, false);
  assert.equal(requests.length, 1);
});

test('process stop confirmation submits only the issued plan and refreshes after a job failure', async () => {
  const { client, modal, requests } = await browserFixture(request => {
    if (request.url === '/api/processes/plan') return { body: stopPlan };
    if (request.url === '/api/processes/stop') return { body: { id: 'stop-job' } };
    if (request.url === '/api/jobs/stop-job') return { body: { id: 'stop-job', status: 'failed', error: 'Permission denied.', logs: [] } };
    if (request.url === '/api/processes') return { body: { processes: [], cpuLabel: 'CPU' } };
    if (request.url === '/api/activity') return { body: [] };
    throw new Error(`Unexpected request: ${request.url}`);
  });
  await client.reviewProcessStop({ pid: 321 });
  assert.equal(requests.some(request => request.url.endsWith('/stop')), false);
  await clickButton(findButton(modal, 'Stop process'));
  for (let n = 0; n < 12; n++) await Promise.resolve();
  assert.deepEqual(requests.find(request => request.url === '/api/processes/stop'), {
    url: '/api/processes/stop', method: 'POST', body: { planId: 'review-token', confirmed: true },
  });
  assert.ok(requests.some(request => request.url === '/api/processes'), 'Refresh process state after failure');
  assert.equal(client.state.activeJob, null);
  assert.equal(modal.open, false);
});

test('protected process errors appear without opening a stop confirmation', async () => {
  const { client, page, modal, document, requests } = await browserFixture(() => ({ status: 403, body: { error: 'This process is protected.' } }));
  client.state.processes = { processes: [{ pid: 4, name: 'System' }], cpuLabel: 'CPU' };
  client.renderProcesses();
  await clickButton(findButton(page, 'Stop'));
  assert.equal(modal.open, false);
  assert.equal(document.querySelector('#toast').textContent, 'This process is protected.');
  assert.equal(requests.length, 1);
});

test('a process still running after SIGTERM has warning presentation and never claims it stopped', async () => {
  const result = { pid: 321, name: 'my-app', status: 'requested', message: 'Stop requested; the process is still running.' };
  const { client, document } = await browserFixture(request => request.url.startsWith('/api/jobs/')
    ? { body: { id: 'stop-job', status: 'completed', result, logs: [] } } : { body: [] });
  const job = { id: 'stop-job', kind: 'process-stop', title: 'Stop my-app', startedAt: new Date().toISOString() };
  client.state.activeJob = job;
  await client.pollJob(job);
  assert.equal(document.querySelector('#toast').className, 'toast warning');
  assert.equal(document.querySelector('#toast').textContent, result.message);
  assert.match(document.querySelector('#job-dock').textContent, /still running/);
  assert.doesNotMatch(document.querySelector('#job-dock').textContent, /Completed on your computer/);
  client.fillJobModal(job);
  const detail = document.querySelector('#job-modal-content');
  assert.match(detail.textContent, /Stop requested/);
  assert.doesNotMatch(detail.textContent, /completed/);
  assert.equal(client.jobWarnings(job).length, 1);
});


test('unsupported native controls explain their platform limit without rendering active controls', async () => {
  const { client, page, requests } = await browserFixture();
  for (const [key, render] of [['network', client.renderNetwork], ['audio', client.renderAudio], ['security', client.renderSecurity], ['settings', client.renderSettings]]) {
    client.state[key] = { available: false, reason: 'These controls require Windows.' };
    render();
    assert.match(page.textContent, /These controls require Windows/);
  }
  assert.equal(requests.length, 0);
});

test('donation placeholders are summarized once, with account holder displayed normally', async () => {
  const { client, modal } = await browserFixture(() => ({ body: { name: 'Jarvis Workbench', author: 'Ashish', donations: { accountHolder: 'Ashish', accountNumber: 'YOUR_ACCOUNT_NUMBER', ifsc: 'YOUR_IFSC_CODE' } } }));
  await client.openAbout();
  assert.match(modal.textContent, /Account holder: Ashish/);
  assert.match(modal.textContent, /Donation details coming soon/);
  assert.doesNotMatch(modal.textContent, /YOUR_|Not available|Not configured/);
  assert.equal((modal.textContent.match(/coming soon/g) || []).length, 1);
});

test('Wi-Fi password requires one-profile confirmation and is masked then cleared on close', async () => {
  const secret = 'fixture-only-password';
  const { client, modal, requests } = await browserFixture(() => ({ body: { password: secret } }));
  client.reviewWifiPassword({ name: 'My Wi-Fi', adapterId: 'adapter-1', interfaceName: 'Wireless' });
  assert.equal(requests.length, 0);
  await clickButton(findButton(modal, 'Load saved password'));
  assert.deepEqual(requests[0].body, { profile: 'My Wi-Fi', adapterId: 'adapter-1', confirmed: true });
  assert.equal(modal.open, true, 'The replacement secret dialog remains open');
  const input = modal.querySelector('input');
  assert.equal(input.getAttribute('type'), 'password');
  assert.equal(input.value, secret);
  assert.doesNotMatch(JSON.stringify(client.state), /fixture-only-password/);
  await clickButton(findButton(modal, 'Show password'));
  assert.equal(input.getAttribute('type'), 'text');
  modal.close();
  assert.equal(input.value, '');
});

test('a dismissed password request never reopens a secret dialog when its response arrives', async () => {
  let respond;
  const response = new Promise(resolve => { respond = resolve; });
  const { client, modal } = await browserFixture(() => response);
  client.reviewWifiPassword({ name: 'My Wi-Fi', adapterId: 'adapter-1' });
  const pending = clickButton(findButton(modal, 'Load saved password'));
  modal.close();
  const body = { password: 'transient-secret' };
  respond({ body });
  await pending;
  assert.equal(modal.open, false);
  assert.equal(body.password, '');
});

test('DNS form advances to review without closing it or applying a network mutation', async () => {
  const { client, modal, requests } = await browserFixture(() => ({ body: { id: 'dns-plan', warning: 'May interrupt connections.' } }));
  const adapter = { id: 'adapter-1', name: 'Wi-Fi', dns: ['192.168.1.1'] };
  client.state.network = { adapters: [adapter] };
  client.reviewDns(adapter);
  const select = modal.querySelector('select'); select.value = 'manual'; select.dispatch('change');
  modal.querySelector('input').value = '1.1.1.1, 8.8.8.8';
  await clickButton(findButton(modal, 'Review change'));
  assert.equal(modal.open, true);
  assert.ok(findButton(modal, 'Apply network change'));
  assert.deepEqual(requests, [{ url: '/api/network/plan', method: 'POST', body: { action: 'dns', adapterId: 'adapter-1', dns: ['1.1.1.1', '8.8.8.8'] } }]);
  await clickButton(findButton(modal, 'Cancel'));
  assert.equal(requests.length, 1);
});

test('audio slider changes locally until Apply is explicitly clicked', async () => {
  const status = { available: true, volume: 32, muted: false, devices: [] };
  const { client, page, requests } = await browserFixture(() => ({ body: status }));
  client.state.audio = status;
  client.renderAudio();
  const slider = page.querySelector('input'); slider.value = '45'; slider.dispatch('input');
  assert.equal(requests.length, 0);
  assert.match(page.textContent, /45%/);
  await clickButton(findButton(page, 'Apply volume'));
  assert.deepEqual(requests[0], { url: '/api/audio', method: 'POST', body: { volume: 45, confirmed: true } });
});

test('file rename reviews the exact new name without executing from the form', async () => {
  const { client, modal, requests } = await browserFixture(() => ({ body: { id: 'file-plan', destination: 'D:/project/new.txt', files: 1, bytes: 27 } }));
  client.state.root = 'D:/project';
  client.editFileAction('rename', { name: 'old.txt', path: 'old.txt' });
  modal.querySelector('input').value = 'new.txt';
  await clickButton(findButton(modal, 'Review change'));
  assert.equal(modal.open, true);
  assert.match(modal.textContent, /D:\/project\/new.txt/);
  assert.deepEqual(requests, [{ url: '/api/files/plan', method: 'POST', body: { action: 'rename', path: 'old.txt', name: 'new.txt' } }]);
  assert.ok(findButton(modal, 'Rename item'));
});

test('Defender scan review names the actual engine and cancellation remains monitoring-only', async () => {
  const { client, modal, document, requests } = await browserFixture(request => {
    if (request.url === '/api/security/plan') return { body: { id: 'scan-plan', title: 'Quick scan' } };
    if (request.url.startsWith('/api/jobs/')) return { body: { status: 'cancelled', result: { scanMayContinue: true, status: 'monitoring-stopped' }, logs: [] } };
    return { body: [] };
  });
  await client.reviewSecurityScan('quick');
  assert.equal(requests.length, 1);
  assert.match(modal.textContent, /Microsoft Defender/);
  assert.match(modal.textContent, /may leave the Defender scan running/);
  const job = { id: 'scan-job', title: 'Quick scan', kind: 'security-scan', startedAt: new Date().toISOString() };
  await client.pollJob(job);
  assert.match(document.querySelector('#toast').textContent, /may still be scanning/);
  assert.equal(document.querySelector('#toast').className, 'toast warning');
});


test('opening another view before Overview finishes still initializes workspace identity and version', async () => {
  const { client, document } = await browserFixture(request => {
    if (request.url === '/api/overview') return { body: { root: 'D:/project', git: { isRepo: false }, system: { platform: 'win32' } } };
    if (request.url === '/api/about') return { body: { name: 'Jarvis Workbench', version: '0.2.0' } };
    if (request.url.startsWith('/api/files')) return { body: { path: '', parent: null, entries: [] } };
    throw new Error(`Unexpected request: ${request.url}`);
  });
  await client.navigateActual('files');
  assert.equal(client.state.root, 'D:/project');
  assert.equal(document.querySelector('#workspace-name').textContent, 'project');
  assert.equal(document.querySelector('#footer-version').textContent, 'Jarvis Workbench v0.2.0');
});
