import { constants } from 'node:fs';
import { link, lstat, mkdir, open, opendir, realpath, rename, statfs, unlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { run } from './run.js';
import { dataDirectory } from './activity.js';
import { privateRecoveryDirectory, lockRecovery, syncDirectory } from './recovery-safety.js';

const DAY = 86400000;
const PLAN_LIFETIME = 15 * 60000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const issuedPlans = new WeakSet();
const runtimeRoot = fileURLToPath(new URL('..', import.meta.url));
const knownStates = new Set(['pending', 'moving', 'quarantined', 'restoring', 'restored', 'purging', 'purged', 'skipped', 'error']);

const normalized = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const samePath = (a, b) => normalized(a) === normalized(b);
const inside = (base, candidate) => {
  const relative = path.relative(normalized(base), normalized(candidate));
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
};
const cancelled = () => Object.assign(new Error('Storage operation cancelled.'), { name: 'AbortError', code: 'ABORT_ERR' });
const checkAbort = signal => { if (signal?.aborted) throw cancelled(); };
const message = error => error?.code === 'EXDEV' ? 'This file is on another volume; it was left in place.' : error?.message || String(error);
const missing = error => error?.code === 'ENOENT';

export function defaultQuarantineDir() {
  return process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Jarvis', 'quarantine')
    : path.join(os.homedir(), '.local', 'share', 'jarvis', 'quarantine');
}

async function exists(target) {
  try { return await lstat(target); } catch (error) { if (missing(error)) return null; throw error; }
}

/** Resolve only the OS-provided temp prefix; inspect user-controlled descendants separately. */
async function resolveTempAlias(target) {
  const absolute = path.resolve(target);
  const lexicalTemp = path.resolve(os.tmpdir());
  if (!inside(lexicalTemp, absolute)) return absolute;
  return path.join(await realpath(lexicalTemp), path.relative(lexicalTemp, absolute));
}

/** Reject links in every component, including junctions reported as links on Windows. */
async function inspectPath(target, { base, file = false, directory = false } = {}) {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  const segments = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let info = await lstat(current);
  for (let index = 0; index < segments.length; index++) {
    current = path.join(current, segments[index]);
    info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error('Symbolic links and junctions are not eligible for cleanup.');
    if (index < segments.length - 1 && !info.isDirectory()) throw new Error('A parent path is not a directory.');
  }
  if (file && !info.isFile()) throw new Error('Only regular temporary files are eligible for cleanup.');
  if (directory && !info.isDirectory()) throw new Error('Choose a regular folder.');
  const canonical = await realpath(absolute);
  if (base && !inside(await realpath(base), canonical)) throw new Error('The path resolves outside its allowed location.');
  return { path: canonical, info };
}

async function ensurePrivateDirectory(target) {
  const absolute = await resolveTempAlias(target);
  await privateRecoveryDirectory(absolute);
  return (await inspectPath(absolute, { directory: true })).path;
}

async function identity(target) {
  const info = await lstat(target, { bigint: true });
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('The selected item is no longer a regular file.');
  const bytes = Number(info.size);
  if (!Number.isSafeInteger(bytes)) throw new Error('This file is too large to measure safely.');
  return {
    dev: String(info.dev), ino: String(info.ino), bytes,
    mtimeNs: String(info.mtimeNs), ctimeNs: String(info.ctimeNs), mtimeMs: Number(info.mtimeNs) / 1e6, links: Number(info.nlink),
  };
}

function sameIdentity(expected, actual, { afterRename = false } = {}) {
  return expected && expected.dev === actual.dev && expected.ino === actual.ino && expected.bytes === actual.bytes
    && expected.mtimeNs === actual.mtimeNs && (afterRename || expected.ctimeNs === actual.ctimeNs);
}

async function temporaryRoot(requested) {
  const actual = await realpath(os.tmpdir());
  const selected = requested ? await resolveTempAlias(requested) : actual;
  if (!inside(actual, await realpath(selected))) throw new Error('Cleanup is restricted to the operating system temporary folder.');
  return (await inspectPath(selected, { base: actual, directory: true })).path;
}

async function protectedPaths(options = {}) {
  const selected = [runtimeRoot, process.execPath, dataDirectory(), defaultQuarantineDir(), options.quarantineDir, ...(options.activePaths || [])].filter(Boolean);
  return Promise.all(selected.map(async value => { try { return await realpath(value); } catch { return path.resolve(value); } }));
}

function isProtected(target, protectedRoots) {
  return protectedRoots.some(protectedRoot => inside(protectedRoot, target));
}

async function diskCapacity(location) {
  try {
    const info = await statfs(location);
    return { availableBytes: Number(info.bavail) * Number(info.bsize), totalBytes: Number(info.blocks) * Number(info.bsize) };
  } catch { return {}; }
}

export async function listScanLocations() {
  const locations = [];
  if (process.platform === 'win32') {
    try {
      const script = 'Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -in 2,3 } | Select-Object DeviceID,VolumeName,FreeSpace,Size | ConvertTo-Json -Compress';
      const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 10000, maxOutput: 65536 });
      const parsed = JSON.parse(result.stdout.replace(/^\uFEFF/, '') || '[]');
      for (const drive of Array.isArray(parsed) ? parsed : [parsed]) {
        if (!/^[a-z]:$/i.test(drive?.DeviceID || '')) continue;
        locations.push({ id: `drive:${drive.DeviceID}`, label: `${drive.DeviceID}${drive.VolumeName ? ` (${drive.VolumeName})` : ''}`, path: `${drive.DeviceID}\\`, kind: 'drive', availableBytes: Number(drive.FreeSpace) || 0, totalBytes: Number(drive.Size) || 0 });
      }
    } catch { /* Home/current drive remain available when WMI is unavailable. */ }
    if (!locations.length) {
      for (const drive of new Set([path.parse(process.cwd()).root, path.parse(os.homedir()).root])) {
        locations.push({ id: `drive:${drive}`, label: drive, path: drive, kind: 'drive', ...await diskCapacity(drive) });
      }
    }
  } else locations.push({ id: 'drive:/', label: 'Computer /', path: '/', kind: 'drive', ...await diskCapacity('/') });
  for (const [kind, label, location] of [['home', 'Home folder', os.homedir()], ['temp', 'Temporary files', os.tmpdir()]]) {
    locations.push({ id: kind, label, path: location, kind, ...await diskCapacity(location) });
  }
  return locations;
}

class LargestItems {
  constructor(limit) { this.limit = limit; this.values = []; }
  add(value) {
    const items = this.values;
    if (items.length >= this.limit && value.bytes <= items[0].bytes) return;
    if (items.length < this.limit) {
      items.push(value);
      let index = items.length - 1;
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (items[parent].bytes <= items[index].bytes) break;
        [items[parent], items[index]] = [items[index], items[parent]];
        index = parent;
      }
    } else {
      items[0] = value;
      let index = 0;
      while (true) {
        let smallest = index;
        for (const child of [index * 2 + 1, index * 2 + 2]) if (child < items.length && items[child].bytes < items[smallest].bytes) smallest = child;
        if (smallest === index) break;
        [items[index], items[smallest]] = [items[smallest], items[index]];
        index = smallest;
      }
    }
  }
  sorted() { return [...this.values].sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path)); }
}

/** Metadata only: no file contents are opened. Sizes are logical bytes, not allocated blocks. */
export async function scanStorage(root, { signal, onProgress, maxEntries = 250000, timeBudgetMs = 120000, tempRoot, quarantineDir, activePaths = [] } = {}) {
  checkAbort(signal);
  const started = Date.now();
  const selectedRoot = path.resolve(root);
  const selectedInfo = await lstat(selectedRoot);
  const selectedCanonical = await realpath(selectedRoot);
  const systemAlias = process.platform === 'darwin'
    && [['/tmp', '/private/tmp'], ['/var', '/private/var']].some(([alias, destination]) => samePath(selectedRoot, alias) && samePath(selectedCanonical, destination));
  if (selectedInfo.isSymbolicLink() && !systemAlias) throw new Error('Choose a real scan folder, not a symbolic link or junction.');
  const canonicalRoot = (await inspectPath(selectedCanonical, { directory: true })).path;
  const limit = Math.max(1, Math.floor(Number(maxEntries) || 250000));
  const deadline = started + Math.max(1, Number(timeBudgetMs) || 120000);
  const safeTemp = await temporaryRoot(tempRoot);
  const protectedRoots = await protectedPaths({ quarantineDir, activePaths });
  const result = { root: canonicalRoot, entries: [], totalBytes: 0, totalFiles: 0, totalDirectories: 0, skipped: 0, truncated: false, cancelled: false, elapsedMs: 0, largestFiles: [], cleanupCandidates: [] };
  const groups = new Map();
  const largest = new LargestItems(100);
  const candidates = new LargestItems(2000);
  const pending = [{ absolute: canonicalRoot, group: null }];
  let visited = 0;
  let lastProgress = 0;
  const progress = force => {
    if (force || Date.now() - lastProgress >= 150) {
      lastProgress = Date.now();
      result.elapsedMs = Date.now() - started;
      onProgress?.({ root: canonicalRoot, totalBytes: result.totalBytes, totalFiles: result.totalFiles, totalDirectories: result.totalDirectories, skipped: result.skipped, visited, elapsedMs: result.elapsedMs });
    }
  };
  while (pending.length) {
    if (signal?.aborted || visited >= limit || Date.now() >= deadline) {
      result.truncated = true; result.cancelled = Boolean(signal?.aborted); break;
    }
    const current = pending.pop();
    try {
      await inspectPath(current.absolute, { base: canonicalRoot, directory: true });
      const directory = await opendir(current.absolute);
      for await (const item of directory) {
        if (signal?.aborted || visited >= limit || Date.now() >= deadline) { result.truncated = true; result.cancelled = Boolean(signal?.aborted); break; }
        visited++;
        const absolute = path.join(current.absolute, item.name);
        if (item.isSymbolicLink()) { result.skipped++; continue; }
        const key = current.group ?? item.name;
        try {
          const info = await lstat(absolute);
          if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) { result.skipped++; continue; }
          if (!inside(canonicalRoot, await realpath(absolute))) { result.skipped++; continue; }
          if (!groups.has(key)) groups.set(key, { name: item.name, path: absolute, type: info.isDirectory() ? 'directory' : 'file', bytes: 0, files: 0 });
          if (info.isDirectory()) {
            result.totalDirectories++;
            pending.push({ absolute, group: key });
          } else {
            const group = groups.get(key);
            group.bytes += info.size; group.files++;
            result.totalBytes += info.size; result.totalFiles++;
            const file = { path: absolute, bytes: info.size, modified: info.mtime.toISOString(), mtimeMs: info.mtimeMs };
            largest.add(file);
            if (inside(safeTemp, absolute) && !isProtected(absolute, protectedRoots) && info.mtimeMs <= started - 7 * DAY) {
              candidates.add({ ...file, reason: 'Temporary file not modified in at least 7 days' });
            }
          }
        } catch (error) {
          if (['ENOENT', 'EACCES', 'EPERM', 'EBUSY', 'ENOTDIR', 'ELOOP'].includes(error.code)) result.skipped++;
          else throw error;
        }
        progress(false);
      }
    } catch (error) {
      if (['ENOENT', 'EACCES', 'EPERM', 'EBUSY', 'ENOTDIR', 'ELOOP'].includes(error.code) || /symbolic links|allowed folder|allowed location/.test(error.message)) result.skipped++;
      else throw error;
    }
    if (result.truncated) break;
  }
  result.entries = [...groups.values()].sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
  result.largestFiles = largest.sorted();
  result.cleanupCandidates = candidates.sorted();
  result.elapsedMs = Date.now() - started;
  progress(true);
  return result;
}

export async function planCleanup(paths, { baseRoot, retentionDays = 7, tempRoot, quarantineDir, activePaths = [], now = Date.now() } = {}) {
  if (!Array.isArray(paths) || !paths.length) throw new Error('Select at least one temporary file to review.');
  if (paths.length > 5000) throw new Error('Review at most 5,000 temporary files in one cleanup.');
  if (!Number.isFinite(now) || now > Date.now() + 1000 || !Number.isFinite(retentionDays) || retentionDays < 7) throw new Error('Cleanup only supports files at least 7 days old.');
  const safeTemp = await temporaryRoot(tempRoot);
  const allowedRoot = baseRoot ? (await inspectPath(await resolveTempAlias(baseRoot), { directory: true })).path : safeTemp;
  const protectedRoots = await protectedPaths({ quarantineDir, activePaths });
  const entries = [];
  const seen = new Set();
  for (const input of paths) {
    if (typeof input !== 'string' || !path.isAbsolute(input)) throw new Error('Cleanup requires an absolute file path from the scan.');
    const absolute = (await inspectPath(await resolveTempAlias(input), { file: true })).path;
    if (!inside(safeTemp, absolute) || !inside(allowedRoot, absolute)) throw new Error('Cleanup is restricted to temporary files within the selected scan.');
    if (isProtected(absolute, protectedRoots)) throw new Error('The running application and recovery files cannot be cleaned up.');
    if (seen.has(normalized(absolute))) continue;
    await inspectPath(absolute, { base: safeTemp, file: true });
    const fileIdentity = await identity(absolute);
    if (fileIdentity.links !== 1) throw new Error('Files with additional hard links are not eligible for cleanup.');
    if (fileIdentity.mtimeMs > now - retentionDays * DAY) throw new Error('A selected file was modified too recently. Only files at least 7 days old are eligible.');
    seen.add(normalized(absolute));
    entries.push(Object.freeze({ id: randomUUID(), path: absolute, bytes: fileIdentity.bytes, mtimeMs: fileIdentity.mtimeMs, modified: new Date(fileIdentity.mtimeMs).toISOString(), identity: Object.freeze(fileIdentity) }));
  }
  const plan = Object.freeze({ id: randomUUID(), createdAt: new Date(now).toISOString(), expiresAt: new Date(now + PLAN_LIFETIME).toISOString(), entries: Object.freeze(entries), totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0), mode: 'quarantine', root: allowedRoot, tempRoot: safeTemp, retentionDays });
  issuedPlans.add(plan);
  return plan;
}

async function atomicManifest(folder, manifest) {
  await inspectPath(folder, { directory: true });
  const temporary = path.join(folder, `.manifest-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'); await handle.sync(); }
  finally { await handle.close(); }
  try {
    const target = path.join(folder, 'manifest.json');
    const existing = await exists(target);
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error('Recovery manifest is not a regular file.');
    await rename(temporary, target);
    await syncDirectory(folder);
  } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
}

function validIdentity(value) {
  return value && ['dev', 'ino', 'mtimeNs', 'ctimeNs'].every(key => typeof value[key] === 'string' && /^\d+$/.test(value[key])) && Number.isSafeInteger(value.bytes) && value.bytes >= 0;
}

function validateManifest(manifest, id, safeTemp) {
  if (manifest?.version !== 1 || manifest.id !== id || !UUID.test(id) || manifest.mode !== 'quarantine' || !Array.isArray(manifest.entries) || manifest.entries.length > 5000) throw new Error('This recovery manifest is invalid.');
  if (typeof manifest.tempRoot !== 'string' || !path.isAbsolute(manifest.tempRoot) || !inside(safeTemp, manifest.tempRoot)) throw new Error('The recovery manifest points outside temporary storage.');
  const seen = new Set();
  for (const entry of manifest.entries) {
    if (!UUID.test(entry?.id || '') || seen.has(entry.id) || typeof entry.path !== 'string' || !path.isAbsolute(entry.path) || !inside(manifest.tempRoot, entry.path)
      || entry.quarantineName !== `${entry.id}.bin` || !knownStates.has(entry.state) || !validIdentity(entry.identity)
      || (entry.quarantinedIdentity && !validIdentity(entry.quarantinedIdentity))) throw new Error('The recovery manifest contains an unsafe file entry.');
    seen.add(entry.id);
  }
}

async function loadTransaction(id, quarantineDir, { lock = true } = {}) {
  if (typeof id !== 'string' || !UUID.test(id)) throw new Error('Choose a valid cleanup recovery ID.');
  const store = await resolveTempAlias(quarantineDir || defaultQuarantineDir());
  await inspectPath(store, { directory: true });
  const folder = path.join(store, id);
  await inspectPath(folder, { base: store, directory: true });
  await inspectPath(path.join(folder, 'files'), { base: folder, directory: true });
  const release = lock ? await lockRecovery(folder) : async () => {};
  try {
    const manifestPath = path.join(folder, 'manifest.json');
    const { info } = await inspectPath(manifestPath, { base: folder, file: true });
    if (info.size > 8 * 1024 * 1024) throw new Error('The recovery manifest exceeds its safety limit.');
    const handle = await open(manifestPath, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW || 0));
    let manifest;
    try { manifest = JSON.parse(await handle.readFile('utf8')); } finally { await handle.close(); }
    validateManifest(manifest, id, await realpath(os.tmpdir()));
    return { store, folder, manifest, release };
  } catch (error) { await release(); throw error; }
}

const quarantinePath = (folder, entry) => path.join(folder, 'files', entry.quarantineName);

function summary(manifest, additions = {}) {
  return {
    id: manifest.id, createdAt: manifest.createdAt, status: manifest.status, mode: 'quarantine', entries: manifest.entries.map(entry => ({ ...entry })),
    movedBytes: 0, restoredBytes: 0, reclaimedBytes: 0, cancelled: false,
    errors: manifest.entries.filter(entry => entry.error).map(entry => ({ path: entry.path, message: entry.error })), ...additions,
  };
}

/** Quarantine is reversible and intentionally reports zero reclaimed bytes. */
export async function executeCleanup(plan, { confirmed = false, signal, onProgress, quarantineDir } = {}) {
  if (confirmed !== true) throw new Error('Review the cleanup plan and explicitly confirm before moving files.');
  if (!issuedPlans.has(plan)) throw new Error('Create a fresh cleanup plan before continuing.');
  if (Date.now() > Date.parse(plan.expiresAt)) throw new Error('This cleanup plan has expired. Scan and review the files again.');
  checkAbort(signal);
  issuedPlans.delete(plan);
  const store = await ensurePrivateDirectory(quarantineDir || defaultQuarantineDir());
  const folder = path.join(store, plan.id);
  await mkdir(folder, { mode: 0o700 });
  await mkdir(path.join(folder, 'files'), { mode: 0o700 });
  const release = await lockRecovery(folder);
  const manifest = {
    version: 1, id: plan.id, mode: 'quarantine', createdAt: plan.createdAt, updatedAt: new Date().toISOString(), status: 'preparing', root: plan.root, tempRoot: plan.tempRoot,
    entries: plan.entries.map(entry => ({ ...entry, identity: { ...entry.identity }, quarantineName: `${entry.id}.bin`, state: 'pending' })),
  };
  let movedBytes = 0;
  let wasCancelled = false;
  try {
    await atomicManifest(folder, manifest);
    for (const entry of manifest.entries) {
      if (signal?.aborted) { wasCancelled = true; break; }
      try {
        if (inside(store, entry.path)) throw new Error('Recovery files cannot be selected for cleanup.');
        await inspectPath(entry.path, { base: plan.tempRoot, file: true });
        if (!sameIdentity(entry.identity, await identity(entry.path))) throw new Error('This file changed after review and was left in place.');
        const target = quarantinePath(folder, entry);
        if (await exists(target)) throw new Error('The recovery destination already exists.');
        entry.state = 'moving';
        await atomicManifest(folder, manifest);
        // Recheck after recording intent; a restart can reconcile a completed rename.
        await inspectPath(entry.path, { base: plan.tempRoot, file: true });
        if (!sameIdentity(entry.identity, await identity(entry.path))) throw new Error('This file changed after review and was left in place.');
        await inspectPath(path.dirname(target), { base: store, directory: true });
        await rename(entry.path, target); // EXDEV is intentionally not replaced with copy/delete.
        entry.state = 'quarantined'; // Preserve a recovery record even if post-move inspection fails.
        const movedIdentity = await identity(target);
        entry.quarantinedIdentity = movedIdentity;
        entry.state = 'quarantined';
        entry.quarantinedAt = new Date().toISOString();
        movedBytes += movedIdentity.bytes;
        if (!sameIdentity(entry.identity, movedIdentity, { afterRename: true })) entry.error = 'The file changed while it was being moved; it is preserved in recovery for inspection.';
      } catch (error) {
        entry.error = message(error);
        if (entry.state !== 'quarantined') entry.state = 'skipped';
      }
      manifest.updatedAt = new Date().toISOString();
      await atomicManifest(folder, manifest);
      onProgress?.({ id: manifest.id, path: entry.path, state: entry.state, movedBytes, reclaimedBytes: 0 });
    }
    manifest.status = wasCancelled ? 'cancelled' : manifest.entries.some(entry => entry.state !== 'quarantined' || entry.error) ? 'partial' : 'quarantined';
    manifest.updatedAt = new Date().toISOString();
    await atomicManifest(folder, manifest);
    return summary(manifest, { movedBytes, cancelled: wasCancelled });
  } finally { await release(); }
}

async function verifiedQuarantineFile(folder, entry) {
  const target = quarantinePath(folder, entry);
  await inspectPath(target, { base: path.join(folder, 'files'), file: true });
  const current = await identity(target);
  if (!sameIdentity(entry.quarantinedIdentity || entry.identity, current, { afterRename: !entry.quarantinedIdentity || entry.state === 'restoring' })) throw new Error('The recovery file changed and was left untouched.');
  return { target, current };
}

async function operateRecovery(id, { quarantineDir, signal, onProgress } = {}, purge) {
  checkAbort(signal);
  const transaction = await loadTransaction(id, quarantineDir);
  const { folder, manifest, release } = transaction;
  let affectedBytes = 0;
  let wasCancelled = false;
  try {
    for (const entry of manifest.entries) {
      if (signal?.aborted) { wasCancelled = true; break; }
      if (!['moving', 'quarantined', 'restoring', 'purging'].includes(entry.state)) continue;
      try {
        let verified;
        try { verified = await verifiedQuarantineFile(folder, entry); }
        catch (error) {
          if (!missing(error)) throw error;
          if (entry.state === 'purging') { entry.state = 'purged'; continue; }
          if (entry.state === 'restoring') {
            await inspectPath(entry.path, { base: manifest.tempRoot, file: true });
            if (sameIdentity(entry.identity, await identity(entry.path), { afterRename: true })) { entry.state = 'restored'; continue; }
          }
          if (entry.state === 'moving') {
            await inspectPath(entry.path, { base: manifest.tempRoot, file: true });
            if (sameIdentity(entry.identity, await identity(entry.path))) { entry.state = 'skipped'; continue; }
          }
          throw error;
        }
        const { target, current } = verified;
        if (purge) {
          if (current.links !== 1) throw new Error('This recovery file has another hard link. Restore the interrupted transaction before trying to empty it.');
          entry.state = 'purging';
          await atomicManifest(folder, manifest);
          await verifiedQuarantineFile(folder, entry);
          await unlink(target); // Deletes exactly one validated regular file, never a directory.
          entry.state = 'purged';
          entry.purgedAt = new Date().toISOString();
        } else {
          await inspectPath(path.dirname(entry.path), { base: manifest.tempRoot, directory: true });
          if (await exists(entry.path)) {
            // Recover a crash between the exclusive hard-link creation and unlink.
            if (entry.state !== 'restoring') throw new Error('The original path already exists; nothing was overwritten.');
            await inspectPath(entry.path, { base: manifest.tempRoot, file: true });
            if (!sameIdentity(current, await identity(entry.path), { afterRename: true })) throw new Error('The original path already exists; nothing was overwritten.');
            await unlink(target);
          } else {
            entry.state = 'restoring';
            await atomicManifest(folder, manifest);
            await inspectPath(path.dirname(entry.path), { base: manifest.tempRoot, directory: true });
            await verifiedQuarantineFile(folder, entry);
            // link() is atomic and fails if anything exists at the destination.
            // rename() can silently overwrite a newly created file on POSIX.
            await link(target, entry.path);
            await unlink(target);
          }
          entry.state = 'restored';
          entry.restoredAt = new Date().toISOString();
        }
        delete entry.error;
        affectedBytes += current.bytes;
      } catch (error) {
        entry.error = message(error);
      }
      manifest.updatedAt = new Date().toISOString();
      await atomicManifest(folder, manifest);
      onProgress?.({ id, path: entry.path, state: entry.state, [purge ? 'reclaimedBytes' : 'restoredBytes']: affectedBytes });
    }
    const pending = manifest.entries.some(entry => ['moving', 'quarantined', 'restoring', 'purging'].includes(entry.state));
    manifest.status = wasCancelled ? 'cancelled' : pending ? 'partial' : purge ? 'purged' : 'restored';
    manifest.updatedAt = new Date().toISOString();
    await atomicManifest(folder, manifest);
    return summary(manifest, { [purge ? 'reclaimedBytes' : 'restoredBytes']: affectedBytes, cancelled: wasCancelled });
  } finally { await release(); }
}

export async function restoreCleanup(id, options = {}) {
  return operateRecovery(id, options, false);
}

export async function purgeCleanup(id, { confirmed = false, ...options } = {}) {
  if (confirmed !== true) throw new Error('Explicitly confirm permanent deletion of these recovery files.');
  return operateRecovery(id, options, true);
}

export async function listCleanupHistory({ quarantineDir } = {}) {
  const store = await resolveTempAlias(quarantineDir || defaultQuarantineDir());
  if (!await exists(store)) return [];
  await inspectPath(store, { directory: true });
  const records = [];
  const directory = await opendir(store);
  for await (const item of directory) {
    if (!item.isDirectory() || item.isSymbolicLink() || !UUID.test(item.name)) continue;
    try {
      const { manifest } = await loadTransaction(item.name, store, { lock: false });
      const held = manifest.entries.filter(entry => ['moving', 'quarantined', 'restoring', 'purging'].includes(entry.state));
      records.push({ id: manifest.id, createdAt: manifest.createdAt, updatedAt: manifest.updatedAt, status: manifest.status, files: held.length, bytes: held.reduce((total, entry) => total + entry.identity.bytes, 0), entries: manifest.entries });
    } catch (error) { records.push({ id: item.name, status: 'unavailable', files: 0, bytes: 0, error: message(error) }); }
  }
  return records.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}
