import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, lstat, open } from 'node:fs/promises';
import { clean, safeRemote } from './format.js';
import { constants } from 'node:fs';
import { lockRecovery, syncDirectory } from './recovery-safety.js';

export function dataDirectory() {
  if (process.env.JARVIS_DATA_DIR) return path.resolve(process.env.JARVIS_DATA_DIR);
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'JarvisWorkbench');
  return path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'jarvis-workbench');
}

export function redact(value) {
  return safeRemote(clean(value)).replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{15,}|github_pat_[A-Za-z0-9_]{15,}|sk-(?:proj-)?[A-Za-z0-9_-]{15,})\b/g, '[redacted]');
}

/** Persistent bounded audit trail; records actions and outcomes, never file contents. */
export class ActivityLog {
  constructor({ directory = dataDirectory(), maxBytes = 2 * 1024 * 1024 } = {}) {
    this.directory = path.resolve(directory);
    this.file = path.join(this.directory, 'activity.jsonl');
    this.maxBytes = Math.max(1024, Math.min(16 * 1024 * 1024, Number(maxBytes) || 2 * 1024 * 1024));
    this.queue = Promise.resolve();
  }
  async ensure() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const directory = await lstat(this.directory);
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Activity history must use a regular directory.');
    for (const candidate of [this.file, this.file + '.1', this.file + '.2']) {
      try {
        const info = await lstat(candidate);
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('Activity history cannot use linked or non-file paths.');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  async locked(fn) {
    await this.ensure();
    const deadline = Date.now() + 5000;
    let release;
    while (!release) {
      try { release = await lockRecovery(this.directory); }
      catch (error) {
        if (error.code !== 'RECOVERY_BUSY' || Date.now() >= deadline) throw new Error('Activity history is busy or needs recovery: ' + error.message);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    try { await this.ensure(); return await fn(); } finally { await release(); }
  }
  append(event) {
    const record = { id: randomUUID(), time: new Date().toISOString(),
      action: redact(event.action || 'workspace').slice(0, 100), status: redact(event.status || 'info').slice(0, 24),
      message: redact(event.message || '').slice(0, 1500), target: redact(event.target || '').slice(0, 1500),
      ...(typeof event.jobId === 'string' ? { jobId: redact(event.jobId).slice(0, 80) } : {}) };
    const task = this.queue.catch(() => {}).then(() => this.locked(async () => {
      let size = 0;
      try { size = (await lstat(this.file)).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const line = JSON.stringify(record) + '\n';
      if (size && size + Buffer.byteLength(line) > this.maxBytes) {
        await rm(this.file + '.2', { force: true });
        try { await rename(this.file + '.1', this.file + '.2'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        await rename(this.file, this.file + '.1');
        await syncDirectory(this.directory);
      }
      const handle = await open(this.file, constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW), 0o600);
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.nlink !== 1) throw new Error('Activity history cannot use a linked or non-file path.');
        let prefix = '';
        if (info.size) {
          const last = Buffer.alloc(1);
          await handle.read(last, 0, 1, info.size - 1);
          if (last[0] !== 10) prefix = '\n';
        }
        await handle.writeFile(prefix + line, 'utf8');
        await handle.sync();
      } finally { await handle.close(); }
      return record;
    }));
    this.queue = task;
    return task;
  }
  async list({ limit = 100 } = {}) {
    await this.queue.catch(() => {});
    return this.locked(async () => {
      const count = Math.max(1, Math.min(1000, Math.floor(Number(limit)) || 100));
      const records = [];
      for (const file of [this.file, this.file + '.1', this.file + '.2']) {
        let handle;
        try {
          handle = await open(file, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW));
          const info = await handle.stat();
          if (!info.isFile() || info.nlink !== 1) throw new Error('Activity history cannot use a linked or non-file path.');
          // A manually enlarged log must not make a dashboard read unbounded memory.
          const length = Math.min(info.size, this.maxBytes + 16384);
          const buffer = Buffer.alloc(length);
          const { bytesRead } = await handle.read(buffer, 0, length, info.size - length);
          const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
          if (info.size > length) lines.shift();
          for (const line of lines.reverse()) {
            try {
              const entry = JSON.parse(line);
              if (typeof entry.id !== 'string' || typeof entry.time !== 'string') continue;
              records.push({ id: redact(entry.id).slice(0, 80), time: redact(entry.time).slice(0, 40),
                action: redact(entry.action || '').slice(0, 100), status: redact(entry.status || '').slice(0, 24),
                message: redact(entry.message || '').slice(0, 1500), target: redact(entry.target || '').slice(0, 1500),
                ...(typeof entry.jobId === 'string' ? { jobId: redact(entry.jobId).slice(0, 80) } : {}) });
            } catch { /* An incomplete final line is ignored without hiding intact records. */ }
            if (records.length >= count) return records;
          }
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        finally { await handle?.close(); }
      }
      return records;
    });
  }
}
