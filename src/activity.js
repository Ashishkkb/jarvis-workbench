import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, rm, stat, lstat } from 'node:fs/promises';
import { clean, safeRemote } from './format.js';

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
    this.maxBytes = Math.max(1024, maxBytes);
    this.queue = Promise.resolve();
  }
  async ensure() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const candidate of [this.file, this.file + '.1', this.file + '.2']) {
      try { if ((await lstat(candidate)).isSymbolicLink()) throw new Error('Activity log path must not be a symbolic link.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  append(event) {
    const record = { id: randomUUID(), time: new Date().toISOString(),
      action: redact(event.action || 'workspace').slice(0, 100), status: redact(event.status || 'info').slice(0, 24),
      message: redact(event.message || '').slice(0, 1500), target: redact(event.target || '').slice(0, 1500) };
    const task = this.queue.catch(() => {}).then(async () => {
      await this.ensure();
      let size = 0;
      try { size = (await stat(this.file)).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (size >= this.maxBytes) {
        await rm(this.file + '.2', { force: true });
        try { await rename(this.file + '.1', this.file + '.2'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        await rename(this.file, this.file + '.1');
      }
      await appendFile(this.file, JSON.stringify(record) + '\n', { encoding: 'utf8', mode: 0o600 });
      return record;
    });
    this.queue = task;
    return task;
  }
  async list({ limit = 100 } = {}) {
    await this.queue.catch(() => {});
    const count = Math.max(1, Math.min(1000, Number(limit) || 100));
    const records = [];
    for (const file of [this.file, this.file + '.1', this.file + '.2']) {
      try {
        if ((await lstat(file)).isSymbolicLink()) continue;
        const text = await readFile(file, 'utf8');
        for (const line of text.trim().split('\n').reverse()) {
          try { const record = JSON.parse(line); if (record.id && record.time) records.push(record); } catch { /* incomplete line from another process */ }
          if (records.length >= count) return records;
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return records;
  }
}
