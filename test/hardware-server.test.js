import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from '../src/server.js';

const sample = () => ({ sampledAt: '2026-10-12T12:00:00.000Z', platform: 'win32', demo: false,
  summary: { attention: 0, observed: 1, unknown: 1 }, limitations: ['Partial readings'],
  components: [{ id: 'cpu', title: 'Processor', status: 'ok', metrics: [{ label: 'Load', value: '8%' }] },
    { id: 'cooling', title: 'Cooling', status: 'unknown', metrics: [{ label: 'Temperature', value: null }] }] });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function setup(t, provider, demo = false) {
  const events = [];
  const app = await startServer({ root: process.cwd(), demo,
    hardware: { getHardwareSnapshot: provider }, activity: { append: async event => events.push(event), list: async () => events } });
  t.after(() => app.close());
  const base = new URL(app.url).origin;
  const read = (route = '/api/hardware', options = {}) => fetch(base + route, {
    headers: { authorization: `Bearer ${app.token}` }, ...options,
  });
  return { ...app, base, read, events };
}

test('hardware API is authenticated, read-only, strict about inputs and preserves unknown values', async t => {
  let calls = 0;
  const app = await setup(t, async () => { calls++; return sample(); });
  assert.equal((await app.read('/api/hardware', { headers: {} })).status, 401);
  assert.equal((await app.read('/api/hardware', { headers: { authorization: `Bearer ${app.token}`, origin: 'https://attacker.invalid' } })).status, 403);
  assert.equal((await app.read('/api/hardware?force=true')).status, 400);
  assert.equal((await app.read('/api/hardware', { method: 'POST', headers: { authorization: `Bearer ${app.token}`, 'content-type': 'application/json' }, body: '{}' })).status, 404);
  assert.equal(calls, 0);
  const response = await app.read();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), sample());
  assert.equal(app.events.filter(event => event.action === 'hardware-read').length, 1);
  const css = await app.read('/hardware.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
});

test('hardware API shares concurrent collections and reuses their actual sample time', async t => {
  const started = deferred(), finish = deferred();
  let calls = 0;
  const app = await setup(t, async () => { calls++; started.resolve(); await finish.promise; return sample(); });
  const first = app.read();
  await started.promise;
  const second = app.read();
  finish.resolve();
  const responses = await Promise.all([first, second]);
  for (const response of responses) assert.deepEqual(await response.json(), sample());
  assert.deepEqual(await (await app.read()).json(), sample());
  assert.equal(calls, 1);
});

test('failed hardware collections are not cached and later reads can recover', async t => {
  let calls = 0;
  const app = await setup(t, async () => { if (++calls === 1) throw new Error('Sensor provider unavailable'); return sample(); });
  assert.equal((await app.read()).status, 400);
  assert.deepEqual(await (await app.read()).json(), sample());
  assert.equal(calls, 2);
  assert.equal(app.events.filter(event => event.action === 'hardware-read').length, 1);
});

test('disconnecting a hardware reader leaves the shared read available to another tab', async t => {
  const started = deferred(), finish = deferred();
  let nativeSignal, calls = 0;
  const app = await setup(t, async ({ signal }) => { nativeSignal = signal; calls++; started.resolve(); await finish.promise; return sample(); });
  const abandoned = http.get(app.base + '/api/hardware', { headers: { authorization: `Bearer ${app.token}` } });
  abandoned.on('error', () => {});
  await started.promise;
  abandoned.destroy();
  const next = app.read();
  finish.resolve();
  assert.deepEqual(await (await next).json(), sample());
  assert.equal(nativeSignal.aborted, false);
  assert.equal(calls, 1);
});

test('server shutdown aborts and drains an active hardware collection', async t => {
  const started = deferred();
  let aborted = false, finished = false;
  const app = await setup(t, ({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; finished = true; reject(new Error('Cancelled')); }, { once: true });
    started.resolve();
  }));
  const request = app.read().catch(() => null);
  await started.promise;
  await app.close();
  await request;
  assert.equal(aborted, true);
  assert.equal(finished, true);
  assert.equal(app.events.filter(event => event.action === 'hardware-read').length, 0);
});

test('demo hardware never invokes a real device provider', async t => {
  const app = await setup(t, async () => { throw new Error('Real hardware must not be read in demo'); }, true);
  const response = await app.read();
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.demo, true);
  assert.equal(data.components.length, 9);
});
