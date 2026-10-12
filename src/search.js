import { spawn } from 'node:child_process';
import { opendir, readFile, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const EXCLUDED = ['.git', 'node_modules', '.cache', '.venv', 'venv', '__pycache__', 'build', 'dist', '.next', 'coverage'];
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const SEARCH_BUDGET_MS = 8000;
const portable = value => value.split(path.sep).join('/');
const abortError = signal => signal?.reason instanceof Error ? signal.reason : new DOMException('Search cancelled.', 'AbortError');

function normalizeOptions(query, options) {
  if (typeof query !== 'string' || !query.length) throw new Error('Enter some text to search for.');
  if (query.length > 2048) throw new Error('Keep your search under 2,048 characters.');
  if (query.includes('\0') || /[\r\n]/.test(query)) throw new Error('Search for one line of text at a time.');
  if (options.regex) {
    try { new RegExp(query, options.caseSensitive ? '' : 'i'); }
    catch { throw new Error('That regular expression is invalid. Check brackets and escape characters.'); }
  }
  const glob = String(options.glob || '').replaceAll('\\', '/');
  if (glob.length > 500 || glob.includes('\0')) throw new Error('Choose a shorter valid file pattern.');
  return {
    query, regex: Boolean(options.regex), caseSensitive: Boolean(options.caseSensitive), glob,
    maxResults: Math.max(1, Math.min(2000, Math.floor(Number(options.maxResults) || 250))),
  };
}

/** Portable glob subset: *, ?, **; a pattern without / matches the basename. */
function globMatcher(glob) {
  if (!glob) return () => true;
  let expression = '';
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index];
    if (char === '*') {
      if (glob[index + 1] === '*') {
        index++;
        if (glob[index + 1] === '/') { expression += '(?:.*/)?'; index++; }
        else expression += '.*';
      } else expression += '[^/]*';
    } else if (char === '?') expression += '[^/]';
    else expression += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  const regex = new RegExp(`^${expression}$`);
  return filename => regex.test(glob.includes('/') ? filename : path.posix.basename(filename));
}

function makeMatch(filename, number, column, text) {
  return { path: filename.replace(/^\.\//, ''), line: number, column, text: text.length > 1000 ? `${text.slice(0, 1000)}…` : text };
}

async function nativeSearch(root, options, signal) {
  // Filter globs ourselves so native and fallback pattern behavior stays identical.
  const args = ['--no-config', '--crlf', '--json', '--hidden', '--no-ignore', '--line-number', '--column', '--max-filesize', String(MAX_FILE_BYTES)];
  // Most user patterns can also prune the native traversal. The result filter
  // remains authoritative for literal characters outside our portable subset.
  if (options.glob && !/[\[\]{}!]/.test(options.glob)) args.push('--glob', options.glob);
  for (const folder of EXCLUDED) args.push('--glob', `!**/${folder}/**`);
  if (!options.regex) args.push('--fixed-strings');
  if (!options.caseSensitive) args.push('--ignore-case');
  args.push('--regexp', options.query, '--', '.');
  const accepts = globMatcher(options.glob);
  return new Promise((resolve, reject) => {
    let child;
    let pending = '';
    let outputBytes = 0;
    let settled = false;
    let stopped = false;
    const result = { matches: [], truncated: false, backend: 'ripgrep', skipped: 0 };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value);
    };
    const stop = () => { stopped = true; result.truncated = true; child?.kill(); };
    const abort = () => { child?.kill(); finish(abortError(signal)); };
    const timer = setTimeout(stop, SEARCH_BUDGET_MS);
    try { child = spawn('rg', args, { cwd: root, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { finish(null, null); return; }
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (stopped || settled) return;
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > 16 * 1024 * 1024) { stop(); return; }
      pending += chunk;
      let newline;
      while ((newline = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event.type !== 'match') continue;
        const data = event.data;
        if (!data.path?.text || !data.lines?.text) continue;
        const filename = portable(data.path.text).replace(/^\.\//, '');
        if (!accepts(filename)) continue;
        if (result.matches.length >= options.maxResults) { stop(); break; }
        const text = data.lines.text.replace(/\r?\n$/, '');
        const byteColumn = data.submatches?.[0]?.start ?? 0;
        const column = Buffer.from(text).subarray(0, byteColumn).toString('utf8').length + 1;
        result.matches.push(makeMatch(filename, data.line_number, column, text));
      }
    });
    // Drain stderr without echoing file contents or accumulating unbounded output.
    child.stderr.resume();
    child.on('error', () => finish(null, null));
    child.on('close', code => {
      if (stopped || code === 0 || code === 1) finish(null, result);
      else finish(null, null); // Unsupported regexes and unavailable rg use the worker.
    });
  });
}

async function scanFallback(root, options, onProgress = () => {}) {
  const result = { matches: [], truncated: false, backend: 'javascript', skipped: 0 };
  const accepts = globMatcher(options.glob);
  const regex = options.regex ? new RegExp(options.query, options.caseSensitive ? '' : 'i') : null;
  const needle = options.caseSensitive ? options.query : options.query.toLowerCase();
  const queue = [{ absolute: root, relative: '' }];
  let visited = 0;
  while (queue.length) {
    const current = queue.pop();
    try {
      const directory = await opendir(current.absolute);
      for await (const item of directory) {
        if (++visited > 30000) { result.truncated = true; return result; }
        if (item.isSymbolicLink()) { result.skipped++; continue; }
        const relative = portable(path.join(current.relative, item.name));
        const absolute = path.join(current.absolute, item.name);
        if (item.isDirectory()) {
          if (EXCLUDED.includes(item.name)) result.skipped++;
          else queue.push({ absolute, relative });
          continue;
        }
        if (!item.isFile() || !accepts(relative)) continue;
        try {
          const info = await lstat(absolute);
          if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_FILE_BYTES) { result.skipped++; continue; }
          const buffer = await readFile(absolute);
          if (buffer.length > MAX_FILE_BYTES || buffer.includes(0)) { result.skipped++; continue; }
          const lines = buffer.toString('utf8').split(/\r?\n/);
          if (lines.at(-1) === '') lines.pop();
          for (let index = 0; index < lines.length; index++) {
            const text = lines[index];
            const haystack = options.caseSensitive ? text : text.toLowerCase();
            const column = regex ? text.search(regex) : haystack.indexOf(needle);
            if (column < 0) continue;
            if (result.matches.length >= options.maxResults) { result.truncated = true; return result; }
            result.matches.push(makeMatch(relative, index + 1, column + 1, text));
          }
          onProgress(result);
        } catch (error) {
          if (['ENOENT', 'EACCES', 'EPERM', 'EISDIR'].includes(error.code)) result.skipped++;
          else throw error;
        }
      }
    } catch (error) {
      if (['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) result.skipped++;
      else throw error;
    }
  }
  return result;
}

function fallbackSearch(root, options, signal) {
  // A worker lets us terminate pathological regular expressions without freezing the UI.
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { task: 'jarvis-content-search', root, options },
      resourceLimits: { maxOldGenerationSizeMb: 96 },
      // The standalone ESM worker needs no caller loaders or CLI-only Node flags.
      execArgv: [],
    });
    let latest = { matches: [], truncated: true, backend: 'javascript', skipped: 0 };
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      void worker.terminate();
      if (error) reject(error); else resolve(value);
    };
    const abort = () => finish(abortError(signal));
    const timer = setTimeout(() => finish(null, { ...latest, truncated: true }), SEARCH_BUDGET_MS);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    worker.on('message', message => {
      if (message.error) finish(new Error(message.error));
      else if (message.done) finish(null, message.result);
      else latest = message.result;
    });
    worker.on('error', error => finish(error));
    worker.on('exit', code => { if (!done) finish(new Error(`Search stopped unexpectedly (${code}).`)); });
  });
}

export async function searchContent(root, query, { regex = false, caseSensitive = false, glob = '', maxResults = 250, signal, preferRipgrep = true } = {}) {
  const options = normalizeOptions(query, { regex, caseSensitive, glob, maxResults });
  if (signal?.aborted) throw abortError(signal);
  const resolved = await realpath(path.resolve(root));
  if (!(await lstat(resolved)).isDirectory()) throw new Error('Choose a folder to search.');
  const native = preferRipgrep ? await nativeSearch(resolved, options, signal) : null;
  return native ?? fallbackSearch(resolved, options, signal);
}

if (!isMainThread && workerData?.task === 'jarvis-content-search') {
  let lastUpdate = 0;
  scanFallback(workerData.root, workerData.options, result => {
    if (Date.now() - lastUpdate > 150) {
      lastUpdate = Date.now();
      parentPort.postMessage({ result });
    }
  }).then(result => parentPort.postMessage({ done: true, result }), error => parentPort.postMessage({ error: error.message }));
}
