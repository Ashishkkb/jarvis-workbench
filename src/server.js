import http from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, realpath, stat, lstat } from 'node:fs/promises';
import path from 'node:path';
import { getGitStatus, getGitDiff, fetchRemote, commitAll, pushCurrent, pullCurrent } from './git.js';
import { listDirectory, readPreview, analyzeDisk } from './files.js';
import { searchContent } from './search.js';
import { getSystemInfo, listProcesses, listPorts, getProjectScripts } from './system.js';
import { runProjectScript } from './tasks.js';
import { RECIPES } from './recipes.js';
import { demoState } from './demo.js';
import { clean, friendlyError, safeRemote } from './format.js';
import { ActivityLog } from './activity.js';
import { getAbout } from './about.js';
import * as storageFunctions from './storage.js';
import * as processFunctions from './process-control.js';
import { createControlApi } from './control-api.js';

const BODY_LIMIT = 64 * 1024;
const LOG_LIMIT = 256 * 1024;
const STATIC = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function redactText(value) {
  return String(value).replace(/https?:\/\/[^\s<>"']+/gi, url => safeRemote(url));
}
function publicData(value) {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(publicData);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, publicData(item)]));
  return value;
}
const safeError = error => redactText(friendlyError(error)).slice(0, 2000);

function queryParameters(url, allowed) {
  const values = {};
  for (const [key, value] of url.searchParams) {
    if (!allowed.includes(key) || Object.hasOwn(values, key)) throw new HttpError(400, 'Unknown or repeated query parameter.');
    if (value.includes('\0') || value.length > 4096) throw new HttpError(400, 'Invalid query parameter.');
    values[key] = value;
  }
  return values;
}
function boolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new HttpError(400, 'Boolean parameters must be true or false.');
}
function objectFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'A JSON object is required.');
  if (Object.keys(value).some(key => !fields.includes(key))) throw new HttpError(400, 'Unknown JSON field.');
}
function relativePath(value = '') {
  if (typeof value !== 'string' || value.includes('\0') || path.isAbsolute(value) || /^[a-z]:/i.test(value)) throw new HttpError(400, 'Choose a relative project path.');
  const parts = value.replaceAll('\\', '/').split('/');
  let depth = 0;
  for (const part of parts) {
    if (part === '..') { if (--depth < 0) throw new HttpError(400, 'That path is outside the project folder.'); }
    else if (part && part !== '.') depth++;
  }
  return value;
}

function readJson(req) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '')) {
    req.resume();
    throw new HttpError(415, 'Send JSON with Content-Type: application/json.');
  }
  if (Number(req.headers['content-length']) > BODY_LIMIT) { req.resume(); throw new HttpError(413, 'JSON payload is too large.'); }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0, rejected = false;
    req.on('data', chunk => {
      if (rejected) return;
      length += chunk.length;
      if (length > BODY_LIMIT) { rejected = true; chunks.length = 0; reject(new HttpError(413, 'JSON payload is too large.')); }
      else chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      if (rejected) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'The request body is not valid JSON.')); }
    });
  });
}

/** Start a loopback-only browser dashboard. No project commands run at startup. */
export async function startServer({ root = process.cwd(), port = 0, host = '127.0.0.1', demo = false, activity, storage, processControl, network, audio, security, settings, fileActions } = {}) {
  if (host !== '127.0.0.1') throw new Error('The dashboard binds only to 127.0.0.1.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Choose a valid local port.');
  const sample = demo ? demoState() : null;
  const workspace = demo ? sample.root : await realpath(path.resolve(root));
  if (!demo && !(await stat(workspace)).isDirectory()) throw new Error('Choose a workspace directory.');
  const token = randomBytes(32).toString('hex');
  const expectedAuthorization = Buffer.from(`Bearer ${token}`);
  const jobs = new Map();
  const plans = new Map();
  const processPlans = new Map();
  const processApi = { ...processFunctions, ...processControl };
  const storageApi = { ...storageFunctions, ...storage };
  const activityLog = demo ? null : activity || new ActivityLog();
  const demoEvents = [];
  const demoHistory = [];
  const demoCandidates = new Map();
  let activeJob = null, origin, authority, closing = false, activityWarning = null;
  const audit = async event => {
    const record = { ...event, target: event.target || workspace, message: event.message || `${event.action}: ${event.status}` };
    if (demo) {
      demoEvents.unshift({ ...record, id: randomUUID(), time: new Date().toISOString() });
      demoEvents.length = Math.min(demoEvents.length, 200);
    } else if (activityLog?.append) {
      try { await activityLog.append(record); activityWarning = null; }
      catch (error) { activityWarning = `Activity history could not be saved: ${safeError(error)}`.slice(0, 500); }
    }
    return activityWarning;
  };

  const json = (res, status, value, sensitive = false) => {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(sensitive ? value : publicData(value)));
  };
  function exposeJob(job) {
    const { controller, promise, pending, bytes, ...data } = job;
    return { ...data, logs: pending ? [...data.logs, pending] : data.logs };
  }
  function appendLog(job, chunk) {
    const available = LOG_LIMIT - job.bytes;
    if (available <= 0) { job.logTruncated = true; return; }
    const buffer = Buffer.from(String(chunk));
    const accepted = buffer.subarray(0, available).toString('utf8');
    job.bytes += Math.min(available, buffer.length);
    if (buffer.length > available) job.logTruncated = true;
    const lines = (job.pending + accepted).split(/[\r\n]+/);
    job.pending = lines.pop() || '';
    for (const line of lines) if (line) job.logs.push(redactText(clean(line)));
  }
  function createJob(action, execute, { target, message } = {}) {
    if (activeJob) throw new HttpError(409, 'Another operation is running. Wait for it or cancel it first.');
    if (closing) throw new HttpError(503, 'The dashboard is closing.');
    while (jobs.size >= 50) jobs.delete(jobs.keys().next().value);
    const job = { id: randomUUID(), action, status: 'running', logs: [], logTruncated: false, result: null, error: null, warnings: [], activityWarning: null,
      startedAt: new Date().toISOString(), finishedAt: null, controller: new AbortController(), pending: '', bytes: 0 };
    jobs.set(job.id, job);
    activeJob = job;
    job.promise = (async () => {
      let outcome = 'running';
      try {
        job.activityWarning = await audit({ action, status: 'started', jobId: job.id, target, message });
        if (job.controller.signal.aborted) throw new Error('Operation cancelled.');
        const result = await execute({ signal: job.controller.signal, onOutput: chunk => appendLog(job, chunk) });
        if (Array.isArray(result?.warnings)) job.warnings.push(...result.warnings.map(item => safeError(new Error(String(item)))));
        if (Array.isArray(result?.errors) && result.errors.length) job.warnings.push(`${result.errors.length} file operation${result.errors.length === 1 ? '' : 's'} could not be completed. Review the per-file errors and recovery history.`);
        else if (result?.status === 'partial') job.warnings.push('This operation completed only partly. Review the result and recovery history before continuing.');
        if (action === 'process-stop' && result?.status === 'requested') job.warnings.push(result.message || 'A stop was requested, but the process has not exited yet. Refresh the process list to check.');
        if (result?.truncated && !result?.cancelled) job.warnings.push('The scan reached its time or entry limit. These results cover only the scanned portion.');
        if (job.controller.signal.aborted || result?.cancelled) {
          job.result = result ?? null;
          outcome = 'cancelled';
          job.error = result?.scanMayContinue ? 'Monitoring stopped. Microsoft Defender may still be scanning. Check Windows Security for the result.' : 'Cancelled. Partial results and any completed changes remain available for review.';
          return;
        }
        if (typeof result?.code === 'number' && result.code !== 0) throw new Error(`The task exited with code ${result.code}. Review the output.`);
        job.result = result && typeof result.code === 'number' ? { code: result.code } : result ?? { ok: true };
        outcome = 'completed';
      } catch (error) {
        outcome = job.controller.signal.aborted ? 'cancelled' : 'failed';
        job.error = job.controller.signal.aborted ? 'Cancelled. Any completed changes remain; refresh to review them.' : safeError(error);
      } finally {
        if (job.pending) { job.logs.push(redactText(clean(job.pending))); job.pending = ''; }
        if (job.logTruncated) job.logs.push('[Output truncated at 256 KB.]');
        const warning = await audit({ action, status: outcome === 'completed' && job.warnings.length ? 'warning' : outcome,
          jobId: job.id, target, message: `${message ? `${message} ` : ''}${job.error || (job.warnings.length ? job.warnings.join(' ') : job.result?.message || `${action} completed.`)}` });
        job.activityWarning = warning || job.activityWarning;
        job.status = outcome;
        job.finishedAt = new Date().toISOString();
        if (activeJob === job) activeJob = null;
      }
    })();
    return job;
  }

  const controls = createControlApi({ workspace, demo, createJob, audit, network, audio, security, settings, fileActions });

  async function actionRequest(body) {
    objectFields(body, ['action', 'message', 'name', 'confirmed']);
    if (!['fetch', 'commit', 'push', 'pull', 'script'].includes(body.action)) throw new HttpError(400, 'Unknown action.');
    if (body.confirmed !== true) throw new HttpError(400, 'Review and explicitly confirm this action first.');
    if (body.action === 'commit' && (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 4000 || body.message.includes('\0'))) throw new HttpError(400, 'Enter a commit message of 1 to 4,000 characters.');
    if (body.action === 'script' && (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 256 || /[\x00-\x1f\x7f]/.test(body.name))) throw new HttpError(400, 'Choose a valid project script.');
    if (body.action !== 'commit' && body.message !== undefined || body.action !== 'script' && body.name !== undefined) throw new HttpError(400, 'This action does not accept those fields.');
    const actions = { fetch: options => fetchRemote(workspace, options), commit: options => commitAll(workspace, body.message, options),
      push: options => pushCurrent(workspace, options), pull: options => pullCurrent(workspace, options),
      script: options => runProjectScript(workspace, body.name, options) };
    return createJob(body.action, demo ? async ({ onOutput }) => { onOutput('Demo only. No files, processes or remote repositories were changed.\n'); return { code: 0 }; } : actions[body.action]);
  }

  async function processRequest(route, body, signal) {
    if (route === '/api/processes/plan') {
      objectFields(body, ['pid']);
      if (!Number.isInteger(body.pid) || body.pid <= 1 || body.pid > 2_147_483_647) throw new HttpError(400, 'Choose a valid process ID from the process list.');
      const now = Date.now();
      for (const [id, plan] of processPlans) if (Date.parse(plan.expiresAt) <= now) processPlans.delete(id);
      let plan;
      if (demo) {
        const selected = sample.processes.processes.find(item => item.pid === body.pid);
        if (!selected) throw new HttpError(400, 'Choose a process from the current demo list.');
        plan = Object.freeze({ id: randomUUID(), pid: selected.pid, name: selected.name, startedAt: new Date(now - 60_000).toISOString(), owner: 'demo',
          platform: sample.system.platform, method: 'Demo simulation', warning: 'Demo only. No real processes will be stopped.', expiresAt: new Date(now + 60_000).toISOString() });
      } else plan = await processApi.planProcessStop(body.pid, { signal });
      while (processPlans.size >= 20) processPlans.delete(processPlans.keys().next().value);
      processPlans.set(plan.id, plan);
      await audit({ action: 'process-stop-plan', status: 'review', target: String(plan.pid), message: `Review stopping ${plan.name} (PID ${plan.pid}).` });
      return { status: 200, value: plan };
    }
    if (route === '/api/processes/stop') {
      objectFields(body, ['planId', 'confirmed']);
      if (body.confirmed !== true) throw new HttpError(400, 'Review and explicitly confirm the process stop first.');
      const plan = typeof body.planId === 'string' ? processPlans.get(body.planId) : null;
      if (!plan || !Number.isFinite(Date.parse(plan.expiresAt)) || Date.parse(plan.expiresAt) <= Date.now()) {
        if (plan) processPlans.delete(plan.id);
        throw new HttpError(400, 'This process plan is missing or expired. Refresh the process list and review a new plan.');
      }
      const job = createJob('process-stop', demo ? async ({ onOutput }) => {
        const exists = sample.processes.processes.some(item => item.pid === plan.pid);
        sample.processes.processes = sample.processes.processes.filter(item => item.pid !== plan.pid);
        sample.ports.ports = sample.ports.ports.filter(item => item.pid !== plan.pid);
        onOutput(`Demo only. Simulated stopping ${plan.name} (PID ${plan.pid}); no real processes were changed.\n`);
        return { pid: plan.pid, name: plan.name, status: exists ? 'stopped' : 'already-exited', message: exists ? 'Demo process stopped.' : 'Demo process had already exited.', demo: true };
      } : options => processApi.stopProcess(plan, { ...options, confirmed: true }), {
        target: String(plan.pid), message: `Stop ${plan.name} (PID ${plan.pid}).`,
      });
      processPlans.delete(plan.id);
      return { status: 202, value: { id: job.id } };
    }
    throw new HttpError(404, 'This process route was not found.');
  }

  async function storageRequest(route, body) {
    if (route === '/api/storage/scan') {
      objectFields(body, ['path', 'maxEntries', 'timeBudgetMs']);
      if (typeof body.path !== 'string' || !path.isAbsolute(body.path) || body.path.includes('\0') || body.path.length > 4096) throw new HttpError(400, 'Choose an absolute scan location.');
      for (const [key, cap] of [['maxEntries', 1_000_000], ['timeBudgetMs', 300_000]]) {
        if (body[key] !== undefined && (!Number.isInteger(body[key]) || body[key] < 1 || body[key] > cap)) throw new HttpError(400, `${key} must be between 1 and ${cap}.`);
      }
      const job = createJob('storage-scan', demo ? async () => {
        const base = body.path.replaceAll('\\', '/');
        const sampleFile = (relative, bytes, days = 12) => {
          const mtimeMs = Date.now() - days * 86400_000;
          return { path: path.posix.join(base, relative), bytes, mtimeMs, modified: new Date(mtimeMs).toISOString() };
        };
        const cleanupCandidates = [
          { ...sampleFile('tmp/jarvis-demo-old-build.tmp', 12 * 1024 ** 2), reason: 'Sample temporary file, unmodified for 12 days' },
          { ...sampleFile('tmp/jarvis-demo-old-download.tmp', 4 * 1024 ** 2, 20), reason: 'Sample temporary file, unmodified for 20 days' },
        ];
        demoCandidates.clear();
        for (const file of cleanupCandidates) demoCandidates.set(file.path, file);
        return { ...sample.disk, root: body.path, totalDirectories: 12, cancelled: false,
          entries: sample.disk.entries.map(entry => ({ ...entry, path: path.posix.join(base, entry.path) })),
          largestFiles: [sampleFile('node_modules/demo-cache.tar.gz', 128 * 1024 ** 2), sampleFile('.git/objects/pack/demo.pack', 54 * 1024 ** 2), sampleFile('src/example-data.json', 16 * 1024 ** 2), ...cleanupCandidates],
          cleanupCandidates };
      }
        : ({ signal, onOutput }) => storageApi.scanStorage(body.path, {
          maxEntries: body.maxEntries, timeBudgetMs: body.timeBudgetMs, signal,
          activePaths: [workspace, activityLog?.directory].filter(Boolean),
          onProgress: progress => onOutput(`${progress.totalFiles ?? 0} files, ${progress.totalBytes ?? 0} bytes measured\n`),
        }));
      return { status: 202, value: { id: job.id } };
    }
    if (route === '/api/storage/plan') {
      objectFields(body, ['paths']);
      if (!Array.isArray(body.paths) || !body.paths.length || body.paths.length > 500 || body.paths.some(file => typeof file !== 'string' || !path.isAbsolute(file) || file.includes('\0') || file.length > 4096)) throw new HttpError(400, 'Choose between 1 and 500 absolute file paths from a scan.');
      const now = Date.now();
      for (const [id, plan] of plans) if (Date.parse(plan.expiresAt) < now) plans.delete(id);
      if (demo && body.paths.some(file => !demoCandidates.has(file))) throw new HttpError(400, 'Choose the sample temporary files from a completed demo scan.');
      const demoEntries = demo ? [...new Set(body.paths)].map(file => ({ ...demoCandidates.get(file), id: randomUUID() })) : [];
      const plan = demo ? Object.freeze({ id: randomUUID(), createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 15 * 60_000).toISOString(),
        entries: demoEntries, totalBytes: demoEntries.reduce((sum, file) => sum + file.bytes, 0), mode: 'quarantine', retentionDays: 7 })
        : await storageApi.planCleanup(body.paths, { activePaths: [workspace, activityLog?.directory].filter(Boolean) });
      while (plans.size >= 20) plans.delete(plans.keys().next().value);
      plans.set(plan.id, plan);
      await audit({ action: 'cleanup-plan', status: 'review', message: `${plan.entries.length} files selected for review.` });
      return { status: 200, value: plan };
    }
    if (route === '/api/storage/execute') {
      objectFields(body, ['planId', 'confirmed']);
      if (body.confirmed !== true) throw new HttpError(400, 'Review and explicitly confirm the cleanup plan first.');
      const plan = typeof body.planId === 'string' ? plans.get(body.planId) : null;
      if (!plan || Date.parse(plan.expiresAt) < Date.now()) throw new HttpError(400, 'This cleanup plan is missing or expired. Create and review a new plan.');
      const job = createJob('cleanup', demo ? async () => {
        const record = { ...plan, files: plan.entries.length, bytes: plan.totalBytes, status: 'quarantined', updatedAt: new Date().toISOString(), entries: plan.entries.map(entry => ({ ...entry, state: 'quarantined' })) };
        demoHistory.unshift(record);
        return { ...record, movedBytes: plan.totalBytes, reclaimedBytes: 0, restoredBytes: 0, cancelled: false, errors: [], demo: true };
      } : ({ signal, onOutput }) => storageApi.executeCleanup(plan, { confirmed: true, signal, onProgress: progress => onOutput(`${progress.path || progress.status || 'Cleanup progress'}\n`) }));
      plans.delete(plan.id);
      return { status: 202, value: { id: job.id } };
    }
    if (['/api/storage/restore', '/api/storage/purge'].includes(route)) {
      objectFields(body, ['id', 'confirmed']);
      if (body.confirmed !== true) throw new HttpError(400, 'Review and explicitly confirm this recovery action first.');
      if (typeof body.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.id)) throw new HttpError(400, 'Choose a recovery transaction from history.');
      const purge = route.endsWith('/purge');
      const job = createJob(purge ? 'cleanup-purge' : 'cleanup-restore', demo ? async () => {
        const record = demoHistory.find(item => item.id === body.id);
        if (!record) throw new Error('This recovery transaction was not found.');
        const affectedBytes = record.bytes;
        record.status = purge ? 'purged' : 'restored';
        record.entries = record.entries.map(entry => ({ ...entry, state: record.status }));
        record.files = 0; record.bytes = 0;
        return { ...record, movedBytes: 0, reclaimedBytes: purge ? affectedBytes : 0, restoredBytes: purge ? 0 : affectedBytes, cancelled: false, errors: [], demo: true };
      } : ({ signal, onOutput }) => storageApi[purge ? 'purgeCleanup' : 'restoreCleanup'](body.id, {
        ...(purge ? { confirmed: true } : {}), signal, onProgress: progress => onOutput(`${progress.path || progress.status || 'Recovery progress'}\n`),
      }));
      return { status: 202, value: { id: job.id } };
    }
    throw new HttpError(404, 'This storage route was not found.');
  }

  async function getRoute(url, signal) {
    const pathname = url.pathname;
    if (pathname === '/api/overview') {
      queryParameters(url, []);
      return { root: workspace, demo, activityWarning, git: demo ? sample.git : await getGitStatus(workspace), system: demo ? sample.system : getSystemInfo() };
    }
    if (pathname === '/api/files') {
      const query = queryParameters(url, ['path']);
      const file = relativePath(query.path);
      return demo ? sample.files : listDirectory(workspace, file);
    }
    if (pathname === '/api/preview') {
      const query = queryParameters(url, ['path', 'tail']);
      if (!query.path) throw new HttpError(400, 'Choose a file to preview.');
      const file = relativePath(query.path), tail = boolean(query.tail);
      return demo ? { path: file, lines: [{ number: 1, text: '// Demo preview. Your real files are unchanged.' }], binary: false, truncated: false, totalBytes: 224 }
        : readPreview(workspace, file, { tail, maxLines: 1000 });
    }
    if (pathname === '/api/search') {
      const query = queryParameters(url, ['q', 'regex', 'caseSensitive', 'glob']);
      if (!query.q || query.q.length > 2048 || /[\r\n]/.test(query.q)) throw new HttpError(400, 'Enter one line of search text, up to 2,048 characters.');
      const options = { regex: boolean(query.regex), caseSensitive: boolean(query.caseSensitive), glob: query.glob || '', signal };
      if (demo) return { ...sample.search, truncated: false, skipped: 0, backend: 'demo' };
      return searchContent(workspace, query.q, options);
    }
    if (pathname === '/api/diff') {
      const query = queryParameters(url, ['path']);
      const file = query.path === undefined ? undefined : relativePath(query.path);
      return { diff: demo ? '- previous search\n+ streaming, bounded search' : await getGitDiff(workspace, file) };
    }
    queryParameters(url, []);
    if (controls.getRoutes.has(pathname)) return controls.get(pathname, signal);
    if (pathname === '/api/git') return demo ? sample.git : getGitStatus(workspace);
    if (pathname === '/api/processes') return demo ? sample.processes : listProcesses({ signal });
    if (pathname === '/api/ports') return demo ? sample.ports : listPorts({ signal });
    if (pathname === '/api/disk') return demo ? sample.disk : analyzeDisk(workspace, { signal });
    if (pathname === '/api/scripts') return demo ? sample.scripts : getProjectScripts(workspace);
    if (pathname === '/api/recipes') return RECIPES;
    if (pathname === '/api/activity') return demo ? demoEvents : activityLog?.list ? activityLog.list() : [];
    if (pathname === '/api/about') return getAbout();
    if (pathname === '/api/storage/locations') return demo ? [{ id: 'demo', label: 'Demo storage', path: '/', kind: 'drive', totalBytes: 500 * 1024 ** 3, availableBytes: 300 * 1024 ** 3 }] : storageApi.listScanLocations();
    if (pathname === '/api/storage/history') return demo ? demoHistory : storageApi.listCleanupHistory();
    const match = /^\/api\/jobs\/([a-f0-9-]{36})$/.exec(pathname);
    if (match && jobs.has(match[1])) return exposeJob(jobs.get(match[1]));
    throw new HttpError(404, 'This API route was not found.');
  }

  const server = http.createServer({ maxHeaderSize: 16 * 1024 }, async (req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    const controller = new AbortController();
    req.on('aborted', () => controller.abort());
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      if (req.headers.host !== authority) throw new HttpError(403, 'The request host is not allowed.');
      if (req.headers.origin !== undefined && req.headers.origin !== origin) throw new HttpError(403, 'The request origin is not allowed.');
      if (!req.url?.startsWith('/') || req.url.startsWith('//') || req.url.length > 8192) throw new HttpError(400, 'Invalid request URL.');
      const url = new URL(req.url, origin);
      if (url.pathname.startsWith('/api/') || url.pathname === '/api') {
        const actual = Buffer.from(req.headers.authorization || '');
        if (actual.length !== expectedAuthorization.length || !timingSafeEqual(actual, expectedAuthorization)) throw new HttpError(401, 'This dashboard session requires its access token.');
        if (req.method === 'GET') {
          if (Number(req.headers['content-length']) > 0 || req.headers['transfer-encoding']) throw new HttpError(400, 'GET requests do not accept a body.');
          json(res, 200, await getRoute(url, controller.signal));
        } else if (req.method === 'POST') {
          queryParameters(url, []);
          if (controls.postRoutes.has(url.pathname)) {
            const result = await controls.post(url.pathname, await readJson(req), controller.signal);
            json(res, result.status, result.value, result.sensitive);
          } else if (url.pathname === '/api/actions') {
            const job = await actionRequest(await readJson(req));
            json(res, 202, { id: job.id });
          } else if (url.pathname.startsWith('/api/processes/')) {
            const result = await processRequest(url.pathname, await readJson(req), controller.signal);
            json(res, result.status, result.value);
          } else if (url.pathname.startsWith('/api/storage/')) {
            const result = await storageRequest(url.pathname, await readJson(req));
            json(res, result.status, result.value);
          } else {
            const match = /^\/api\/jobs\/([a-f0-9-]{36})\/cancel$/.exec(url.pathname);
            if (!match || !jobs.has(match[1])) throw new HttpError(404, 'This API route was not found.');
            objectFields(await readJson(req), []);
            const job = jobs.get(match[1]);
            if (job.status === 'running') job.controller.abort();
            json(res, 200, { id: job.id, status: job.status });
          }
        } else throw new HttpError(405, 'This request method is not allowed.');
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, 'This request method is not allowed.');
      if (!STATIC.has(url.pathname) || url.search) throw new HttpError(404, 'This page was not found.');
      const [filename, mime] = STATIC.get(url.pathname);
      const file = new URL(`../web/${filename}`, import.meta.url);
      const [directoryInfo, fileInfo] = await Promise.all([lstat(new URL('../web/', import.meta.url)), lstat(file)]);
      if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || !fileInfo.isFile() || fileInfo.isSymbolicLink()) throw new HttpError(404, 'This asset is not available.');
      const content = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': content.length });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      req.resume();
      json(res, error.status || (error.code === 'ENOENT' ? 404 : error.code === 'EACCES' || error.code === 'EPERM' ? 403 : 400), { error: safeError(error) });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 2000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  authority = `127.0.0.1:${server.address().port}`;
  origin = `http://${authority}`;
  await audit({ action: 'dashboard', status: 'started' });
  const close = async () => {
    if (closing) return;
    closing = true;
    activeJob?.controller.abort();
    const stopped = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await stopped;
    if (activeJob?.promise) await activeJob.promise;
    await audit({ action: 'dashboard', status: 'stopped' });
  };
  return { url: `${origin}/#token=${token}`, server, close, token };
}
