import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startServer } from '../src/server.js';

async function session(t, options = {}) {
  const events = [];
  const app = await startServer({ demo: true, activity: { append: async event => events.push(event), list: async () => events }, ...options });
  t.after(() => app.close());
  const origin = new URL(app.url).origin;
  async function request(route, { method = 'GET', headers = {}, body, authenticated = true } = {}) {
    const data = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = http.request(`${origin}${route}`, {
        method,
        headers: {
          ...(authenticated ? { Authorization: `Bearer ${app.token}` } : {}),
          ...(data !== undefined ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
          ...headers,
        },
      }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try { json = JSON.parse(text); } catch { /* static responses */ }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      });
      req.on('error', reject);
      if (data !== undefined) req.write(data);
      req.end();
    });
  }
  return { ...app, origin, request, events };
}

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'jarvis-server-test-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  await mkdir(path.join(root, 'nested'));
  await writeFile(path.join(root, 'hello space.txt'), 'first\nneedle\nlast\n');
  await writeFile(path.join(root, 'nested', 'source.js'), 'const answer = 42;\n');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --version' } }));
  return root;
}

async function finished(request, id) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await request(`/api/jobs/${id}`);
    if (response.json.status !== 'running') return response.json;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('The test job did not finish.');
}

test('server binds only loopback and generates a session-specific bootstrap fragment', async t => {
  await assert.rejects(startServer({ host: '0.0.0.0', demo: true }), /only to 127/);
  await assert.rejects(startServer({ host: 'localhost', demo: true }), /only to 127/);
  await assert.rejects(startServer({ port: -1, demo: true }), /valid local port/);
  const first = await session(t, { root: 'not-a-real-folder' });
  const second = await session(t);
  assert.notEqual(first.token, second.token);
  assert.equal(new URL(first.url).hash, `#token=${first.token}`);
  assert.equal(first.server.address().address, '127.0.0.1');
  const response = await first.request('/api/overview');
  assert.equal(response.status, 200);
  assert.equal(response.json.demo, true);
  assert.ok(!response.text.includes(first.token));
});

test('every API route requires bearer authentication and rejects hostile origin/host', async t => {
  const { request, origin } = await session(t);
  for (const route of ['/api/overview', '/api/files', '/api/preview', '/api/search', '/api/git', '/api/diff', '/api/processes', '/api/ports', '/api/disk', '/api/scripts', '/api/recipes', '/api/activity', '/api/actions', '/api/jobs/missing']) {
    assert.equal((await request(route, { authenticated: false })).status, 401, route);
  }
  assert.equal((await request('/api/overview', { headers: { Authorization: 'Bearer incorrect' } })).status, 401);
  assert.equal((await request('/api/overview', { headers: { Origin: 'https://attacker.invalid' } })).status, 403);
  assert.equal((await request('/api/overview', { headers: { Origin: 'null' } })).status, 403);
  assert.equal((await request('/api/overview', { headers: { Host: 'attacker.invalid' } })).status, 403);
  assert.equal((await request('/api/overview', { headers: { Host: `localhost:${new URL(origin).port}` } })).status, 403);
  assert.equal((await request('/api/overview', { headers: { Origin: origin } })).status, 200);
});

test('static serving has security headers and cannot expose source files or tokens', async t => {
  const { request, token } = await session(t);
  for (const route of ['/src/server.js', '/package.json', '/../package.json', '/%2e%2e/package.json', '/app.js/../src/server.js']) {
    assert.equal((await request(route, { authenticated: false })).status, 404, route);
  }
  const response = await request('/', { authenticated: false });
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /text\/html/);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-frame-options'], 'DENY');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.match(response.headers['content-security-policy'], /script-src 'self'/);
  assert.doesNotMatch(response.headers['content-security-policy'], /unsafe-eval|unsafe-inline/);
  assert.ok(!response.text.includes(token));
  assert.equal((await request('/api/overview', { method: 'DELETE' })).status, 405);
  assert.equal((await request('/', { method: 'POST', body: {} })).status, 405);
});

test('read-only project APIs preserve paths, preview lines, and bounded search data', async t => {
  const root = await fixture(t);
  const { request } = await session(t, { root, demo: false });
  const overview = await request('/api/overview');
  assert.equal(overview.status, 200);
  assert.equal(overview.json.git.isRepo, false);
  const files = await request('/api/files');
  assert.ok(files.json.entries.some(file => file.path === 'hello space.txt'));
  const nested = await request('/api/files?path=nested');
  assert.equal(nested.json.entries[0].path, 'nested/source.js');
  const preview = await request('/api/preview?path=hello%20space.txt&tail=true');
  assert.deepEqual(preview.json.lines.map(line => line.text), ['first', 'needle', 'last']);
  const search = await request('/api/search?q=needle&caseSensitive=true&glob=*.txt');
  assert.deepEqual(search.json.matches.map(match => [match.path, match.line]), [['hello space.txt', 2]]);
  const scripts = await request('/api/scripts');
  assert.deepEqual(scripts.json, [{ name: 'test', command: 'node --version' }]);
  const activity = await request('/api/activity');
  assert.ok(Array.isArray(activity.json));
});

test('request schema validation rejects traversal, unknown fields and oversized payloads', async t => {
  const { request } = await session(t);
  for (const route of ['/api/files?path=../outside', '/api/preview?path=..%5coutside', '/api/diff?path=../../outside', '/api/files?root=/', '/api/files?path=a&path=b', '/api/search?q=x&regex=maybe']) {
    assert.equal((await request(route)).status, 400, route);
  }
  for (const body of [null, [], {}, { action: 'shell', confirmed: true }, { action: 'fetch' }, { action: 'fetch', confirmed: 'true' }, { action: 'fetch', confirmed: true, command: 'echo unexpected' }, { action: 'commit', confirmed: true, message: '' }, { action: 'script', confirmed: true, name: 42 }]) {
    assert.equal((await request('/api/actions', { method: 'POST', body: JSON.stringify(body) })).status, 400, JSON.stringify(body));
  }
  assert.equal((await request('/api/actions', { method: 'POST', body: '{broken' })).status, 400);
  assert.equal((await request('/api/actions', { method: 'POST', body: {}, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await request('/api/actions', { method: 'POST', body: ' '.repeat(65537) })).status, 413);
});

test('confirmed demo jobs finish without executing project or network actions', async t => {
  const { request } = await session(t);
  for (const action of ['fetch', 'commit', 'push', 'pull', 'script']) {
    const body = { action, confirmed: true, ...(action === 'commit' ? { message: 'Demo commit' } : {}), ...(action === 'script' ? { name: 'test' } : {}) };
    const response = await request('/api/actions', { method: 'POST', body });
    assert.equal(response.status, 202);
    const job = await finished(request, response.json.id);
    assert.equal(job.status, 'completed');
    assert.equal(job.result.code, 0);
    assert.match(job.logs.join('\n'), /Demo only/);
    assert.equal(job.controller, undefined);
    assert.equal(job.promise, undefined);
  }
});

test('jobs serialize operations and support authenticated cancellation before execution', async t => {
  const root = await fixture(t);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const events = [];
  const activity = { append: async event => { events.push(event); if (event.action === 'fetch' && event.status === 'started') await gate; }, list: async () => events };
  const { request } = await session(t, { root, demo: false, activity });
  try {
    const first = await request('/api/actions', { method: 'POST', body: { action: 'fetch', confirmed: true } });
    assert.equal(first.status, 202);
    const second = await request('/api/actions', { method: 'POST', body: { action: 'fetch', confirmed: true } });
    assert.equal(second.status, 409);
    assert.equal((await request(`/api/jobs/${first.json.id}/cancel`, { method: 'POST', body: {}, authenticated: false })).status, 401);
    assert.equal((await request(`/api/jobs/${first.json.id}/cancel`, { method: 'POST', body: {} })).status, 200);
    release();
    const job = await finished(request, first.json.id);
    assert.equal(job.status, 'cancelled');
    assert.match(job.error, /completed changes remain/);
    assert.ok(events.some(event => event.action === 'fetch' && event.status === 'cancelled'));
  } finally { release(); }
});

test('storage plans stay server-side and execution uses the exact reviewed object', async t => {
  const root = await fixture(t);
  let issuedPlan, executed = false;
  const storage = {
    listScanLocations: async () => [{ id: 'fixture', path: root, label: 'Fixture', kind: 'temp' }],
    listCleanupHistory: async () => [],
    planCleanup: async paths => {
      issuedPlan = Object.freeze({ id: randomUUID(), expiresAt: new Date(Date.now() + 60_000).toISOString(), entries: paths.map(file => ({ path: file, bytes: 15 })), totalBytes: 15, mode: 'quarantine' });
      return issuedPlan;
    },
    executeCleanup: async (plan, options) => {
      assert.equal(plan, issuedPlan);
      assert.equal(options.confirmed, true);
      executed = true;
      return { id: plan.id, movedBytes: 15, freedBytes: 0, status: 'quarantined' };
    },
  };
  const { request } = await session(t, { root, demo: false, storage });
  assert.equal((await request('/api/storage/locations')).json[0].path, root);
  assert.deepEqual((await request('/api/storage/history')).json, []);
  assert.equal((await request('/api/storage/plan', { method: 'POST', body: { paths: [] } })).status, 400);
  assert.equal((await request('/api/storage/plan', { method: 'POST', body: { paths: ['relative.txt'] } })).status, 400);
  const plan = await request('/api/storage/plan', { method: 'POST', body: { paths: [path.join(root, 'hello space.txt')] } });
  assert.equal(plan.status, 200);
  assert.equal(executed, false);
  assert.equal((await request('/api/storage/execute', { method: 'POST', body: { planId: plan.json.id } })).status, 400);
  assert.equal((await request('/api/storage/execute', { method: 'POST', body: { planId: plan.json.id, confirmed: true, quarantineDir: root } })).status, 400);
  const execution = await request('/api/storage/execute', { method: 'POST', body: { planId: plan.json.id, confirmed: true } });
  assert.equal(execution.status, 202);
  const job = await finished(request, execution.json.id);
  assert.equal(job.status, 'completed');
  assert.equal(job.result.id, plan.json.id);
  assert.equal(job.result.freedBytes, 0);
  assert.equal(executed, true);
  assert.equal((await request('/api/storage/execute', { method: 'POST', body: { planId: plan.json.id, confirmed: true } })).status, 400);
});

test('storage scan limits are validated and cancellation retains partial results', async t => {
  const root = await fixture(t);
  const storage = {
    scanStorage: async (scanPath, { signal, onProgress }) => new Promise(resolve => {
      assert.equal(scanPath, root);
      onProgress({ totalFiles: 7, totalBytes: 123 });
      signal.addEventListener('abort', () => resolve({ root, totalFiles: 7, totalBytes: 123, cancelled: true, truncated: true }), { once: true });
    }),
  };
  const { request } = await session(t, { root, demo: false, storage });
  for (const body of [{ path: root, maxEntries: 1_000_001 }, { path: root, timeBudgetMs: 300_001 }, { path: root, maxEntries: -1 }, { path: '.', maxEntries: 20 }]) {
    assert.equal((await request('/api/storage/scan', { method: 'POST', body })).status, 400);
  }
  const scan = await request('/api/storage/scan', { method: 'POST', body: { path: root, maxEntries: 100, timeBudgetMs: 1000 } });
  assert.equal(scan.status, 202);
  const running = await request(`/api/jobs/${scan.json.id}`);
  assert.match(running.json.logs.join('\n'), /7 files/);
  await request(`/api/jobs/${scan.json.id}/cancel`, { method: 'POST', body: {} });
  const job = await finished(request, scan.json.id);
  assert.equal(job.status, 'cancelled');
  assert.equal(job.result.totalFiles, 7);
  assert.equal(job.result.cancelled, true);
  assert.match(job.error, /Partial results/);
});

test('expired cleanup plans and unconfirmed recovery actions are rejected', async t => {
  const root = await fixture(t);
  const storage = { planCleanup: async paths => Object.freeze({ id: randomUUID(), expiresAt: new Date(0).toISOString(), entries: paths.map(file => ({ path: file, bytes: 1 })), totalBytes: 1 }) };
  const { request } = await session(t, { root, demo: false, storage });
  const plan = await request('/api/storage/plan', { method: 'POST', body: { paths: [path.join(root, 'hello space.txt')] } });
  assert.equal((await request('/api/storage/execute', { method: 'POST', body: { planId: plan.json.id, confirmed: true } })).status, 400);
  for (const action of ['restore', 'purge']) {
    assert.equal((await request(`/api/storage/${action}`, { method: 'POST', body: { id: randomUUID() } })).status, 400);
    assert.equal((await request(`/api/storage/${action}`, { method: 'POST', body: { id: '../outside', confirmed: true } })).status, 400);
  }
});

test('activity write failures are visible without undoing successful operations', async t => {
  const root = await fixture(t);
  let loggingAvailable = false;
  const activity = { append: async () => { if (!loggingAvailable) throw new Error('History folder is read-only. ' + 'x'.repeat(2000)); }, list: async () => [] };
  const storage = { scanStorage: async () => ({ root, totalFiles: 2, totalBytes: 9, truncated: false }) };
  const { request } = await session(t, { root, demo: false, activity, storage });
  const overview = await request('/api/overview');
  assert.match(overview.json.activityWarning, /could not be saved/);
  assert.ok(overview.json.activityWarning.length <= 500);
  const scan = await request('/api/storage/scan', { method: 'POST', body: { path: root } });
  const job = await finished(request, scan.json.id);
  assert.equal(job.status, 'completed');
  assert.equal(job.result.totalFiles, 2);
  assert.match(job.activityWarning, /read-only/);
  loggingAvailable = true;
  const next = await request('/api/storage/scan', { method: 'POST', body: { path: root } });
  const nextJob = await finished(request, next.json.id);
  assert.equal(nextJob.activityWarning, null);
  assert.equal((await request('/api/overview')).json.activityWarning, null);
});

test('partial storage outcomes preserve errors and clearly expose job warnings', async t => {
  const root = await fixture(t);
  const events = [];
  const activity = { append: async event => events.push(event), list: async () => events };
  const storage = {
    planCleanup: async paths => Object.freeze({ id: randomUUID(), expiresAt: new Date(Date.now() + 60_000).toISOString(), entries: paths.map(file => ({ path: file, bytes: 1 })), totalBytes: 1 }),
    executeCleanup: async plan => ({ id: plan.id, status: 'partial', movedBytes: 0, errors: [{ path: plan.entries[0].path, message: 'File changed after review.' }] }),
    scanStorage: async () => ({ root, totalFiles: 3, truncated: true, cancelled: false }),
  };
  const { request } = await session(t, { root, demo: false, activity, storage });
  const plan = await request('/api/storage/plan', { method: 'POST', body: { paths: [path.join(root, 'hello space.txt')] } });
  const cleanup = await request('/api/storage/execute', { method: 'POST', body: { planId: plan.json.id, confirmed: true } });
  const job = await finished(request, cleanup.json.id);
  assert.equal(job.status, 'completed');
  assert.equal(job.result.status, 'partial');
  assert.equal(job.result.errors.length, 1);
  assert.match(job.warnings.join(' '), /could not be completed/);
  assert.ok(events.some(event => event.action === 'cleanup' && event.status === 'warning'));
  const scan = await request('/api/storage/scan', { method: 'POST', body: { path: root } });
  const scanJob = await finished(request, scan.json.id);
  assert.match(scanJob.warnings.join(' '), /time or entry limit/);
});

test('demo storage exercises scan, exact sample review, quarantine and recovery without filesystem actions', async t => {
  const { request } = await session(t);
  const locations = await request('/api/storage/locations');
  const scan = await request('/api/storage/scan', { method: 'POST', body: { path: locations.json[0].path } });
  const scanned = await finished(request, scan.json.id);
  assert.ok(scanned.result.largestFiles.length >= 3);
  assert.equal(scanned.result.cleanupCandidates.length, 2);
  assert.equal((await request('/api/storage/plan', { method: 'POST', body: { paths: ['/not-a-demo-candidate.tmp'] } })).status, 400);
  const candidates = scanned.result.cleanupCandidates;
  const plan = await request('/api/storage/plan', { method: 'POST', body: { paths: candidates.map(file => file.path) } });
  assert.equal(plan.status, 200);
  assert.equal(plan.json.totalBytes, candidates.reduce((sum, file) => sum + file.bytes, 0));
  const execute = await request('/api/storage/execute', { method: 'POST', body: { planId: plan.json.id, confirmed: true } });
  const moved = await finished(request, execute.json.id);
  assert.equal(moved.result.movedBytes, plan.json.totalBytes);
  assert.equal(moved.result.reclaimedBytes, 0);
  assert.equal(moved.result.freedBytes, undefined);
  const history = await request('/api/storage/history');
  assert.equal(history.json[0].files, 2);
  const restore = await request('/api/storage/restore', { method: 'POST', body: { id: plan.json.id, confirmed: true } });
  const restored = await finished(request, restore.json.id);
  assert.equal(restored.result.restoredBytes, plan.json.totalBytes);
  assert.equal(restored.result.reclaimedBytes, 0);
  assert.equal(restored.result.status, 'restored');
});
