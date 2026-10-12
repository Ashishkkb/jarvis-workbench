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
  close() { this.open = false; this.document.activeElement = this.opener; }
}

async function browserFixture() {
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
  const context = vm.createContext({ document, Node: Element, URLSearchParams, console });
  vm.runInContext(source.slice(0, source.lastIndexOf(boot)) + `
    // Isolate palette dispatch from network loading; keep the production DOM and key handlers.
    navigate = async screen => { state.screen = screen; };
    globalThis.testClient = { el, setPage, openPalette, screen: () => state.screen };
  `, context);
  return { document, client: context.testClient, modal: document.querySelector('#modal'), page: document.querySelector('#page') };
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
