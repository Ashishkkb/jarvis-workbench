import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
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
  for (const route of ['/api/overview', '/api/files', '/api/preview', '/api/search', '/api/git', '/api/diff', '/api/processes', '/api/processes/plan', '/api/processes/stop', '/api/ports', '/api/disk', '/api/scripts', '/api/recipes', '/api/activity', '/api/actions', '/api/jobs/missing']) {
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


function fakeProcessPlan(pid, fields = {}) {
  return Object.freeze({ id: randomUUID(), pid, name: 'fixture-worker', startedAt: new Date(0).toISOString(), owner: 'fixture-user',
    platform: process.platform, method: 'Fixture stop', warning: 'Unsaved work may be lost.', expiresAt: new Date(Date.now() + 60_000).toISOString(), ...fields });
}

test('process stop requires the exact reviewed server-side plan and explicit confirmation', async t => {
  const root = await fixture(t);
  let issuedPlan, stopped = 0;
  const processControl = {
    planProcessStop: async (pid, { signal }) => { assert.ok(signal instanceof AbortSignal); issuedPlan = fakeProcessPlan(pid); return issuedPlan; },
    stopProcess: async (plan, { confirmed, signal, onOutput }) => {
      assert.equal(plan, issuedPlan);
      assert.equal(confirmed, true);
      assert.ok(signal instanceof AbortSignal);
      stopped++;
      onOutput('Fixture process exited.\n');
      return { pid: plan.pid, name: plan.name, status: 'stopped', message: 'The selected process exited.' };
    },
  };
  const { request, events } = await session(t, { root, demo: false, processControl });
  const review = await request('/api/processes/plan', { method: 'POST', body: { pid: 54321 } });
  assert.equal(review.status, 200);
  assert.equal(review.json.pid, 54321);
  assert.equal(stopped, 0);
  for (const body of [{ pid: 54321, confirmed: true }, { planId: review.json.id }, { planId: review.json.id, confirmed: 'true' }, { planId: review.json.id, confirmed: true, pid: 54321 }, { planId: randomUUID(), confirmed: true }]) {
    assert.equal((await request('/api/processes/stop', { method: 'POST', body })).status, 400);
  }
  const stop = await request('/api/processes/stop', { method: 'POST', body: { planId: review.json.id, confirmed: true } });
  assert.equal(stop.status, 202);
  const job = await finished(request, stop.json.id);
  assert.equal(job.status, 'completed');
  assert.equal(job.result.status, 'stopped');
  assert.equal(stopped, 1);
  assert.match(job.logs.join(' '), /Fixture process exited/);
  assert.equal((await request('/api/processes/stop', { method: 'POST', body: { planId: review.json.id, confirmed: true } })).status, 400);
  assert.ok(events.some(event => event.action === 'process-stop-plan' && event.status === 'review' && /fixture-worker.*54321/.test(event.message)));
  assert.ok(events.some(event => event.action === 'process-stop' && event.status === 'completed' && /fixture-worker.*54321/.test(event.message)));
});

test('process schemas reject invalid IDs and execution rejects expired or evicted plans', async t => {
  const root = await fixture(t);
  let expiresAt = new Date(0).toISOString(), stops = 0;
  const processControl = { planProcessStop: async pid => fakeProcessPlan(pid, { expiresAt }), stopProcess: async () => { stops++; } };
  const { request } = await session(t, { root, demo: false, processControl });
  for (const body of [{}, { pid: 0 }, { pid: 1 }, { pid: -1 }, { pid: 2_147_483_648 }, { pid: 2.5 }, { pid: '54321' }, { pid: 54321, force: true }, { pid: 54321, command: 'shell' }, null, []]) {
    assert.equal((await request('/api/processes/plan', { method: 'POST', body: JSON.stringify(body) })).status, 400, JSON.stringify(body));
  }
  assert.equal((await request('/api/processes/plan?pid=54321', { method: 'POST', body: { pid: 54321 } })).status, 400);
  const expired = await request('/api/processes/plan', { method: 'POST', body: { pid: 54321 } });
  assert.equal((await request('/api/processes/stop', { method: 'POST', body: { planId: expired.json.id, confirmed: true } })).status, 400);
  expiresAt = new Date(Date.now() + 60_000).toISOString();
  let oldest;
  for (let index = 0; index < 21; index++) {
    const response = await request('/api/processes/plan', { method: 'POST', body: { pid: 54321 } });
    assert.equal(response.status, 200);
    if (!oldest) oldest = response.json;
  }
  assert.equal((await request('/api/processes/stop', { method: 'POST', body: { planId: oldest.id, confirmed: true } })).status, 400);
  assert.equal(stops, 0);
});

test('process plan and stop routes reject missing authentication and foreign origins', async t => {
  const { request } = await session(t);
  for (const route of ['/api/processes/plan', '/api/processes/stop']) {
    const body = route.endsWith('/plan') ? { pid: 14280 } : { planId: randomUUID(), confirmed: true };
    assert.equal((await request(route, { method: 'POST', body, authenticated: false })).status, 401);
    assert.equal((await request(route, { method: 'POST', body, headers: { Origin: 'https://attacker.invalid' } })).status, 403);
    assert.equal((await request(route, { method: 'POST', body, headers: { Host: 'attacker.invalid' } })).status, 403);
  }
});

test('process stop jobs serialize with other work and may be cancelled before execution', async t => {
  const root = await fixture(t);
  let release, stopped = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const events = [];
  const activity = { append: async event => { events.push(event); if (event.action === 'process-stop' && event.status === 'started') await gate; }, list: async () => events };
  const processControl = { planProcessStop: async pid => fakeProcessPlan(pid), stopProcess: async () => { stopped++; return { status: 'stopped' }; } };
  const { request } = await session(t, { root, demo: false, processControl, activity });
  try {
    const review = await request('/api/processes/plan', { method: 'POST', body: { pid: 54321 } });
    const stop = await request('/api/processes/stop', { method: 'POST', body: { planId: review.json.id, confirmed: true } });
    assert.equal(stop.status, 202);
    assert.equal((await request('/api/actions', { method: 'POST', body: { action: 'fetch', confirmed: true } })).status, 409);
    await request(`/api/jobs/${stop.json.id}/cancel`, { method: 'POST', body: {} });
    release();
    const job = await finished(request, stop.json.id);
    assert.equal(job.status, 'cancelled');
    assert.equal(stopped, 0);
  } finally { release(); }
});

test('a process that has not yet exited produces a visible warning, not a false success', async t => {
  const root = await fixture(t);
  const processControl = { planProcessStop: async pid => fakeProcessPlan(pid), stopProcess: async plan => ({ pid: plan.pid, name: plan.name, status: 'requested', message: 'Stop requested; the process is still running. Refresh to check.' }) };
  const { request, events } = await session(t, { root, demo: false, processControl });
  const review = await request('/api/processes/plan', { method: 'POST', body: { pid: 54321 } });
  const stop = await request('/api/processes/stop', { method: 'POST', body: { planId: review.json.id, confirmed: true } });
  const job = await finished(request, stop.json.id);
  assert.equal(job.status, 'completed');
  assert.equal(job.result.status, 'requested');
  assert.match(job.warnings.join(' '), /still running/);
  assert.ok(events.some(event => event.action === 'process-stop' && event.status === 'warning' && /54321/.test(event.message)));
});

test('demo process stops only affect the current server sample list', async t => {
  let realCalls = 0;
  const processControl = { planProcessStop: async () => { realCalls++; throw new Error('Must not inspect a real process in demo.'); }, stopProcess: async () => { realCalls++; throw new Error('Must not stop a real process in demo.'); } };
  const first = await session(t, { processControl });
  const other = await session(t, { processControl });
  const processList = await first.request('/api/processes');
  const pid = processList.json.processes[0].pid;
  assert.equal((await first.request('/api/processes/plan', { method: 'POST', body: { pid: 2147483647 } })).status, 400);
  const plan = await first.request('/api/processes/plan', { method: 'POST', body: { pid } });
  const stop = await first.request('/api/processes/stop', { method: 'POST', body: { planId: plan.json.id, confirmed: true } });
  const job = await finished(first.request, stop.json.id);
  assert.equal(job.result.demo, true);
  assert.equal(job.result.status, 'stopped');
  assert.equal((await first.request('/api/processes')).json.processes.some(item => item.pid === pid), false);
  assert.equal((await first.request('/api/ports')).json.ports.some(item => item.pid === pid), false);
  assert.equal((await other.request('/api/processes')).json.processes.some(item => item.pid === pid), true);
  assert.equal(realCalls, 0);
});


test('native control routes enforce authentication, schema, review identity, and confirmation', async t => {
  const root = await fixture(t); let received;
  const plan = Object.freeze({ id: randomUUID(), action: 'dns', expiresAt: new Date(Date.now() + 60000).toISOString() });
  const { request } = await session(t, { root, demo: false, network: {
    getNetworkStatus: async () => ({ available: true, adapters: [], profiles: [] }),
    planNetworkChange: async () => plan,
    applyNetworkChange: async (value, options) => { received = value; assert.equal(options.confirmed, true); return { status: 'applied' }; },
  } });
  for (const route of ['/api/control', '/api/network', '/api/audio', '/api/security', '/api/settings', '/api/files/recovery', '/api/network/password', '/api/files/plan']) {
    assert.equal((await request(route, { authenticated: false })).status, 401);
  }
  assert.equal((await request('/api/network')).json.available, true);
  const post = (route, body) => request(route, { method: 'POST', body });
  assert.equal((await post('/api/network/plan', { action: 'dns', command: 'arbitrary' })).status, 400);
  assert.equal((await post('/api/network/plan', { action: 'dns' })).json.id, plan.id);
  assert.equal((await post('/api/network/execute', { planId: plan.id })).status, 400);
  assert.equal((await post('/api/settings/execute', { planId: plan.id, confirmed: true })).status, 400);
  const started = await post('/api/network/execute', { planId: plan.id, confirmed: true });
  assert.equal(started.status, 202);
  assert.equal((await finished(request, started.json.id)).status, 'completed');
  assert.equal(received, plan);
  assert.equal((await post('/api/network/execute', { planId: plan.id, confirmed: true })).status, 400);
  assert.equal((await request('/api/network/plan', { method: 'POST', body: {}, headers: { Origin: 'https://foreign.invalid' } })).status, 403);
});

test('a Wi-Fi password is returned exactly once per explicit request and never enters activity or jobs', async t => {
  const root = await fixture(t); let reads = 0;
  const secret = 'https://name:fixture-secret@example.invalid/password?token=fixture-test';
  const { request, events } = await session(t, { root, demo: false, network: {
    getWifiPassword: async value => { assert.equal(value.confirmed, true); reads++; return { password: secret }; },
  } });
  const post = body => request('/api/network/password', { method: 'POST', body });
  assert.equal((await post({ profile: 'fixture' })).status, 400);
  assert.equal((await post({ profile: 'fixture', confirmed: true, all: true })).status, 400);
  const response = await post({ profile: 'fixture', adapterId: 'fixture', confirmed: true });
  assert.equal(response.status, 200); assert.equal(response.json.password, secret);
  assert.equal(response.headers['cache-control'], 'no-store'); assert.equal(reads, 1);
  assert.doesNotMatch(JSON.stringify(events), /fixture-secret|password/);
  assert.doesNotMatch((await request('/api/activity')).text, /fixture-secret/);
});

test('native scan warnings and monitoring cancellation remain explicit in jobs', async t => {
  const root = await fixture(t); let cancelled = false;
  const { request } = await session(t, { root, demo: false, security: {
    planSecurityScan: async () => Object.freeze({ id: randomUUID(), expiresAt: new Date(Date.now() + 60000).toISOString() }),
    runSecurityScan: async (_, { signal }) => {
      if (!cancelled) return { status: 'attention-required', exitCode: 2, warnings: ['Defender requires review.'], message: 'Review Windows Security.' };
      await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true }); });
      return { status: 'monitoring-stopped', cancelled: true, scanMayContinue: true, warnings: ['Defender may continue scanning.'] };
    },
  } });
  const start = async () => {
    const plan = await request('/api/security/plan', { method: 'POST', body: { type: 'quick' } });
    return (await request('/api/security/scan', { method: 'POST', body: { planId: plan.json.id, confirmed: true } })).json.id;
  };
  const first = await finished(request, await start());
  assert.equal(first.result.status, 'attention-required'); assert.match(first.warnings.join(' '), /requires review/);
  cancelled = true; const id = await start();
  await request(`/api/jobs/${id}/cancel`, { method: 'POST', body: {} });
  const result = await finished(request, id);
  assert.equal(result.status, 'cancelled'); assert.equal(result.result.scanMayContinue, true);
  assert.match(result.error, /Monitoring stopped/);
});

test('immediate sound changes serialize with jobs and report failures without false success', async t => {
  const root = await fixture(t); let release, started, changes = 0;
  const began = new Promise(resolve => { started = resolve; });
  const { request } = await session(t, { root, demo: false, audio: {
    setAudioSettings: async () => { changes++; started(); await new Promise(resolve => { release = resolve; }); return { available: true, volume: 20 }; },
  } });
  const pending = request('/api/audio', { method: 'POST', body: { volume: 20, confirmed: true } });
  await began;
  assert.equal((await request('/api/audio', { method: 'POST', body: { volume: 30, confirmed: true } })).status, 409);
  assert.equal((await request('/api/audio', { method: 'POST', body: { volume: 30 } })).status, 400);
  release(); assert.equal((await pending).json.volume, 20); assert.equal(changes, 1);
});

test('file API exposes a minimal review and performs a confirmed fixture folder operation', async t => {
  const root = await fixture(t); const { request } = await session(t, { root, demo: false });
  const post = (route, body) => request(route, { method: 'POST', body });
  const response = await post('/api/files/plan', { action: 'mkdir', path: 'nested', name: 'new folder' });
  assert.equal(response.status, 200, response.text);
  assert.equal(response.json.destination, path.join(await realpath(root), 'nested', 'new folder'));
  assert.equal(response.json.entries, undefined); assert.equal(response.json.recovery, undefined); assert.equal(response.json.root, undefined);
  assert.equal((await post('/api/files/execute', { planId: response.json.id })).status, 400);
  const started = await post('/api/files/execute', { planId: response.json.id, confirmed: true });
  assert.equal((await finished(request, started.json.id)).status, 'completed');
  assert.ok((await request('/api/files?path=nested')).json.entries.some(item => item.name === 'new folder'));
  for (const body of [{ action: 'trash', path: '../outside' }, { action: 'mkdir', path: 'nested', name: '../escape' }, { action: 'mkdir', path: '.git', name: 'unsafe' }]) assert.equal((await post('/api/files/plan', body)).status, 400);
});

test('demo native controls never inspect or modify the host computer', async t => {
  const unexpected = () => { throw new Error('Real native controls must not execute in demo'); };
  const { request } = await session(t, { network: { getNetworkStatus: unexpected, getWifiPassword: unexpected }, audio: { getAudioStatus: unexpected, setAudioSettings: unexpected } });
  assert.equal((await request('/api/network')).json.available, false);
  assert.equal((await request('/api/audio')).json.available, false);
  assert.deepEqual((await request('/api/files/recovery')).json, []);
  assert.equal((await request('/api/network/password', { method: 'POST', body: { confirmed: true } })).status, 400);
  assert.equal((await request('/api/audio', { method: 'POST', body: { volume: 10, confirmed: true } })).status, 400);
});
