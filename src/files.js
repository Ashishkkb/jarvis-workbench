import { lstat, opendir, open, realpath } from 'node:fs/promises';
import path from 'node:path';

const PREVIEW_BYTES = 512 * 1024;
const portable = value => value.split(path.sep).join('/');

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('Operation cancelled.', 'AbortError');
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

/** Resolve both lexical and real paths, so symlinks cannot escape the project. */
async function resolveContained(root, relative = '') {
  const base = await realpath(path.resolve(root));
  if (typeof relative !== 'string' || relative.includes('\0')) throw new Error('Choose a valid project path.');
  const candidate = path.resolve(base, relative || '.');
  if (!isInside(base, candidate)) throw new Error('That path is outside the project folder.');
  const resolved = await realpath(candidate);
  if (!isInside(base, resolved)) throw new Error('That symbolic link points outside the project folder.');
  return { base, candidate, resolved, relative: portable(path.relative(base, candidate)) };
}

export async function listDirectory(root, relative = '') {
  const location = await resolveContained(root, relative);
  const directory = await opendir(location.resolved);
  const entries = [];
  for await (const entry of directory) {
    try {
      const info = await lstat(path.join(location.resolved, entry.name));
      entries.push({
        name: entry.name,
        path: portable(path.join(location.relative, entry.name)),
        type: info.isSymbolicLink() ? 'symlink' : info.isDirectory() ? 'directory' : 'file',
        size: info.size,
        modified: info.mtime.toISOString(),
      });
    } catch (error) {
      // Files can disappear between listing and reading their metadata.
      if (!['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) throw error;
    }
  }
  entries.sort((a, b) => (a.type === 'directory' ? 0 : 1) - (b.type === 'directory' ? 0 : 1) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const parent = location.relative ? portable(path.dirname(location.relative)) : null;
  return { path: location.relative, entries, parent: parent === '.' ? '' : parent };
}

/** Lines use null numbers when a large tail has no known absolute line number. */
export async function readPreview(root, relative, { tail = false, maxLines = 160 } = {}) {
  const location = await resolveContained(root, relative);
  const lineLimit = Math.max(1, Math.min(1000, Math.floor(Number(maxLines) || 160)));
  // Check before opening: opening a FIFO can block before handle.stat() is possible.
  if (!(await lstat(location.resolved)).isFile()) throw new Error('Choose a regular file to preview.');
  const handle = await open(location.resolved, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('Choose a regular file to preview.');
    const length = Math.min(PREVIEW_BYTES, info.size);
    const offset = tail ? Math.max(0, info.size - length) : 0;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    const content = buffer.subarray(0, bytesRead);
    // Check the beginning as well as the tail for binary file signatures.
    let binary = content.includes(0);
    if (offset > 0 && !binary) {
      const header = Buffer.alloc(Math.min(8192, info.size));
      const result = await handle.read(header, 0, header.length, 0);
      binary = header.subarray(0, result.bytesRead).includes(0);
    }
    if (binary) return { path: location.relative, lines: [], binary: true, truncated: false, totalBytes: info.size };
    let textLines = content.toString('utf8').split(/\r?\n/);
    if (textLines.at(-1) === '') textLines.pop();
    if (offset > 0) {
      const previousByte = Buffer.alloc(1);
      await handle.read(previousByte, 0, 1, offset - 1);
      if (previousByte[0] !== 10) {
        if (textLines.length > 1) textLines.shift(); // Discard a partial first line.
        else if (textLines.length) textLines[0] = `…${textLines[0]}`; // Keep the end of a giant single line visible.
      }
    }
    const start = tail ? Math.max(0, textLines.length - lineLimit) : 0;
    const selected = textLines.slice(start, start + lineLimit);
    return {
      path: location.relative,
      lines: selected.map((text, index) => ({
        number: offset > 0 ? null : start + index + 1,
        text: text.length > 4000 ? (tail ? `…${text.slice(-4000)}` : `${text.slice(0, 4000)}…`) : text,
      })),
      binary: false,
      truncated: info.size > bytesRead || textLines.length > lineLimit || selected.some(text => text.length > 4000),
      totalBytes: info.size,
    };
  } finally {
    await handle.close();
  }
}

/** Bounded size analysis includes hidden/dependency folders, without following links. */
export async function analyzeDisk(root, { maxEntries = 30000, timeBudgetMs = 8000, signal } = {}) {
  const started = Date.now();
  const { resolved } = await resolveContained(root);
  const limit = Math.max(1, Math.floor(Number(maxEntries) || 30000));
  const deadline = started + Math.max(1, Number(timeBudgetMs) || 8000);
  const result = { entries: [], totalBytes: 0, totalFiles: 0, truncated: false, skipped: 0, elapsedMs: 0 };
  const groups = new Map();
  const pending = [{ absolute: resolved, relative: '', group: null }];
  let visited = 0;
  while (pending.length) {
    abortIfNeeded(signal);
    if (visited >= limit || Date.now() >= deadline) { result.truncated = true; break; }
    const current = pending.pop();
    try {
      const directory = await opendir(current.absolute);
      for await (const item of directory) {
        abortIfNeeded(signal);
        if (visited >= limit || Date.now() >= deadline) { result.truncated = true; break; }
        visited++;
        if (item.isSymbolicLink()) { result.skipped++; continue; }
        const relative = portable(path.join(current.relative, item.name));
        const absolute = path.join(current.absolute, item.name);
        const key = current.group ?? item.name;
        if (!groups.has(key)) groups.set(key, { name: item.name, path: relative, type: item.isDirectory() ? 'directory' : 'file', bytes: 0, files: 0 });
        if (item.isDirectory()) {
          pending.push({ absolute, relative, group: key });
        } else if (item.isFile()) {
          try {
            const info = await lstat(absolute);
            if (!info.isFile() || info.isSymbolicLink()) { result.skipped++; continue; }
            const group = groups.get(key);
            group.bytes += info.size;
            group.files++;
            result.totalBytes += info.size;
            result.totalFiles++;
          } catch (error) {
            if (['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) result.skipped++;
            else throw error;
          }
        } else result.skipped++;
      }
    } catch (error) {
      if (['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) result.skipped++;
      else throw error;
    }
    if (result.truncated) break;
  }
  result.entries = [...groups.values()].sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
  result.elapsedMs = Date.now() - started;
  return result;
}
