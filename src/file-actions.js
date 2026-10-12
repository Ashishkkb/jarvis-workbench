import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, stat, realpath, readdir, opendir, mkdir, open, rename, link, unlink, rmdir, chmod, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dataDirectory } from './activity.js';

const issued = new WeakSet();
const runtime = fileURLToPath(new URL('..', import.meta.url));
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const same = (a, b) => normalize(a) === normalize(b);
const inside = (base, target) => { const rel = path.relative(normalize(base), normalize(target)); return !rel || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep)); };
const abort = signal => { if (signal?.aborted) throw Object.assign(new Error('File operation cancelled.'), { name: 'AbortError' }); };
const exists = async value => { try { return await lstat(value); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
const identity = info => [info.dev, info.ino, info.mode, info.size, info.mtimeNs ?? info.mtimeMs, info.ctimeNs ?? info.ctimeMs].join(':');
const inode = info => [info.dev, info.ino].join(':');

async function noLinks(target) {
  const absolute = path.resolve(target), base = path.parse(absolute).root;
  let current = base, info = await lstat(base, { bigint: true });
  for (const part of absolute.slice(base.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part); info = await lstat(current, { bigint: true });
    if (info.isSymbolicLink()) throw new Error('File operations do not follow symbolic links or junctions.');
  }
  return info;
}
async function privateDir(target) {
  let current = path.parse(target).root;
  for (const part of target.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { await mkdir(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Recovery storage must use regular directories.');
  }
}
function relative(root, input, { destination = false } = {}) {
  if (typeof input !== 'string' || !input || input.includes('\0') || path.isAbsolute(input) || /^[a-z]:/i.test(input)) throw new Error('Choose a relative path inside this workspace.');
  if (process.platform === 'win32') {
    const segments = input.split(/[\\/]/);
    if (segments.some(part => /[<>:"|?*\x00-\x1f]/.test(part) || (part !== '.' && part !== '..' && /[. ]$/.test(part)) ||
      /^(con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i.test(part))) {
      throw new Error('Windows device names, alternate data streams, and path aliases cannot be changed.');
    }
  }
  const target = path.resolve(root, input);
  if (!inside(root, target) || same(root, target)) throw new Error('The workspace root and paths outside it cannot be changed.');
  const parts = path.relative(root, target).split(path.sep);
  if (parts.some(part => ['.git', '.jarvis-recovery', '.jarvis-workbench-recovery'].includes(part.toLowerCase()))) throw new Error('Git metadata and recovery storage are protected.');
  if (inside(runtime, target) || inside(target, runtime) || same(target, process.execPath) || inside(dataDirectory(), target) || inside(target, dataDirectory())) throw new Error('The running Jarvis application is protected. Choose another project.');
  if (destination && /[\x00-\x1f]/.test(input)) throw new Error('The destination contains a control character.');
  return target;
}
async function snapshot(target, signal) {
  const entries = [], pending = [{ target, rel: '' }];
  const start = Date.now();
  while (pending.length) {
    abort(signal);
    if (entries.length >= 20000 || Date.now() - start > 15000) throw new Error('This selection exceeds the file-operation review limit. Choose a smaller folder.');
    const item = pending.pop();
    if (item.rel.split(path.sep).some(part => ['.git', '.jarvis-recovery', '.jarvis-workbench-recovery'].includes(part.toLowerCase()))) throw new Error('Folders containing Git metadata or recovery storage are protected.');
    const info = await noLinks(item.target);
    if (!info.isFile() && !info.isDirectory()) throw new Error('Only regular files and folders can be changed.');
    if (info.isFile() && info.nlink !== 1n) throw new Error('Files with additional hard links cannot be changed through this view.');
    const entry = { rel: item.rel, type: info.isDirectory() ? 'directory' : 'file', identity: identity(info), mode: Number(info.mode) & 0o777, bytes: info.isFile() ? Number(info.size) : 0 };
    entries.push(Object.freeze(entry));
    if (info.isDirectory()) {
      const children = [];
      const directory = await opendir(item.target);
      for await (const child of directory) {
        abort(signal);
        if (entries.length + pending.length + children.length >= 20000) throw new Error('This selection exceeds the file-operation review limit. Choose a smaller folder.');
        children.push(child.name);
      }
      for (const name of children.sort().reverse()) pending.push({ target: path.join(item.target, name), rel: path.join(item.rel, name) });
    }
  }
  return Object.freeze(entries.sort((a, b) => a.rel.localeCompare(b.rel)));
}
async function unchanged(source, reviewed, signal) {
  const now = await snapshot(source, signal);
  if (JSON.stringify(now) !== JSON.stringify(reviewed)) throw new Error('The selected file or folder changed after review. Refresh and review it again.');
}
async function recoveryStore(root, override) {
  if (override) {
    const selected = path.resolve(override);
    if (inside(root, selected) || inside(selected, root) || same(selected, path.parse(selected).root)) throw new Error('Recovery storage must be a separate folder outside this workspace.');
    return selected;
  }
  const hash = createHash('sha256').update(normalize(root)).digest('hex').slice(0, 24);
  const local = path.join(dataDirectory(), 'file-recovery', hash);
  if (process.platform === 'win32' && !same(path.parse(local).root, path.parse(root).root)) {
    const user = createHash('sha256').update(os.homedir()).digest('hex').slice(0, 16);
    return path.join(path.parse(root).root, '.jarvis-workbench-recovery', user, hash);
  }
  if (inside(root, local)) throw new Error('Recovery storage would be inside this workspace. Choose a narrower workspace folder.');
  return local;
}
async function manifestWrite(folder, value) {
  await noLinks(folder);
  const temp = path.join(folder, '.manifest-' + randomUUID());
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2)); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, path.join(folder, 'manifest.json'));
}
async function loadRecovery(root, id, store) {
  if (typeof id !== 'string' || !UUID.test(id)) throw new Error('Choose a valid recovery item.');
  const folder = path.join(store, id);
  await noLinks(folder);
  const metadata = path.join(folder, 'manifest.json');
  const info = await noLinks(metadata);
  if (!info.isFile() || info.nlink !== 1n || info.size > 8 * 1024 * 1024) throw new Error('Recovery metadata is invalid.');
  const value = JSON.parse(await readFile(metadata, 'utf8'));
  if (value.version !== 1 || value.id !== id || !same(value.root || '', root) || !['moving', 'held', 'restoring', 'restored'].includes(value.status)) throw new Error('Recovery metadata does not match this workspace.');
  const original = relative(root, value.original, { destination: true });
  return { folder, value, original, held: path.join(folder, 'item') };
}
export async function listFileRecovery(root, { recoveryDir } = {}) {
  if (process.platform === 'win32' && typeof root === 'string' && /^[\\/]{2}/.test(root)) throw new Error('Use a local drive folder; network and device namespaces are not supported for file operations.');
  root = await realpath(path.resolve(root));
  const store = await recoveryStore(root, recoveryDir);
  if (!await exists(store)) return [];
  await noLinks(store);
  const records = [];
  for (const name of (await readdir(store)).filter(name => UUID.test(name)).slice(0, 1000)) {
    try {
      const { value, held, original } = await loadRecovery(root, name, store);
      const info = await exists(held);
      const originalExists = Boolean(await exists(original));
      const safeHeld = Boolean(info && !info.isSymbolicLink() && (!info.isFile() || info.nlink === 1));
      const available = safeHeld && !originalExists;
      records.push({ id: name, original: value.original, originalPath: value.original,
        status: available ? 'held' : !info && value.status === 'restored' ? 'restored' : 'needs-review',
        createdAt: value.createdAt, bytes: value.bytes, files: value.files, available,
        ...(info && originalExists ? { warning: 'Both the original location and a recovery item exist. Review both before restoring.' } : {}) });
    } catch { records.push({ id: name, status: 'unavailable', available: false }); }
  }
  return records.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}
export async function planFileAction(root, input, { signal, recoveryDir } = {}) {
  abort(signal);
  if (process.platform === 'win32' && typeof root === 'string' && /^[\\/]{2}/.test(root)) throw new Error('Use a local drive folder; network and device namespaces are not supported for file operations.');
  root = await realpath(path.resolve(root));
  if (!(await lstat(root)).isDirectory()) throw new Error('Choose a workspace folder.');
  const action = input?.action;
  if (!['mkdir', 'copy', 'move', 'rename', 'trash', 'restore'].includes(action)) throw new Error('Choose a supported file action.');
  let source = null, destination = null, entries = [], recovery = null;
  if (action === 'restore') {
    const store = await recoveryStore(root, recoveryDir);
    recovery = await loadRecovery(root, input.recoveryId, store);
    if (!await exists(recovery.held)) throw new Error('This item is no longer in recovery.');
    source = recovery.held; destination = recovery.original;
  } else if (action === 'mkdir') {
    if (input.name !== undefined) {
      if (typeof input.name !== 'string' || !input.name || input.name === '.' || input.name === '..' || /[\\/]/.test(input.name)) throw new Error('Enter a single folder name, without separators.');
      if (input.path !== undefined && (typeof input.path !== 'string' || path.isAbsolute(input.path) || /^[a-z]:/i.test(input.path))) throw new Error('Choose a relative folder path.');
      destination = relative(root, path.join(input.path || '', input.name), { destination: true });
    } else destination = relative(root, input.path || input.destination, { destination: true });
  }
  else {
    source = relative(root, input.path);
    if (action === 'rename') {
      if (typeof input.name !== 'string' || !input.name || input.name === '.' || input.name === '..' || /[\\/]/.test(input.name)) throw new Error('Enter a single new name, without folder separators.');
      destination = relative(root, path.relative(root, path.join(path.dirname(source), input.name)), { destination: true });
    } else if (['copy', 'move'].includes(action)) destination = relative(root, input.destination, { destination: true });
  }
  if (source) entries = await snapshot(source, signal);
  if (process.platform !== 'win32' && ['move', 'rename', 'trash', 'restore'].includes(action) && entries.find(entry => entry.rel === '')?.type === 'directory') {
    throw new Error('Atomic folder moves and folder recovery are not supported on this platform yet. Copy the folder instead; no files were changed.');
  }
  if (action === 'trash') await recoveryStore(root, recoveryDir);
  if (destination) {
    if (source && inside(source, destination)) throw new Error('A folder cannot be moved or copied into itself.');
    await noLinks(path.dirname(destination));
    if (!inside(root, await realpath(path.dirname(destination)))) throw new Error('The destination resolves outside the workspace.');
    if (await exists(destination)) throw new Error('The destination already exists. Nothing will be overwritten.');
  }
  if (recovery) recovery = Object.freeze({ ...recovery, value: Object.freeze({ ...recovery.value }) });
  const plan = Object.freeze({ id: randomUUID(), action, root, source, destination, entries, recovery, recoveryDir,
    files: entries.filter(entry => entry.type === 'file').length, bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    warning: action === 'trash' ? 'Move this selection to recoverable storage. It will still use disk space.' : action === 'restore' ? 'Restore to the original location. Existing files will not be overwritten.' : 'Changes apply to the reviewed selection only. Existing destinations will not be overwritten.',
    expiresAt: new Date(Date.now() + 60000).toISOString() });
  issued.add(plan); return plan;
}
async function moveEntry(source, destination, type) {
  if (await exists(destination)) throw new Error('The destination already exists. Nothing was overwritten.');
  if (type === 'file') {
    await link(source, destination);
    try { await noLinks(source); await noLinks(path.dirname(destination)); await unlink(source); }
    catch (error) {
      // Undo only our own newly created hard link if the original could not be removed.
      try {
        const original = await noLinks(source), added = await noLinks(destination);
        if (inode(original) === inode(added)) await unlink(destination);
        else error.partial = true;
      } catch { error.partial = true; }
      throw error;
    }
  } else {
    if (process.platform !== 'win32') throw new Error('Atomic folder moves are not supported on this platform yet.');
    // On Windows an existing directory causes MoveFileEx to fail, even with replace flags.
    await rename(source, destination);
  }
}
async function copyReviewed(plan, signal, onOutput) {
  const rootEntry = plan.entries.find(entry => entry.rel === '');
  // Exclusive mkdir prevents POSIX rename from replacing an empty destination directory.
  const temporary = rootEntry.type === 'directory' ? plan.destination
    : path.join(path.dirname(plan.destination), '.jarvis-copy-' + randomUUID());
  const created = [];
  async function remember(target, type) {
    const info = await noLinks(target);
    created.push({ target, type, inode: inode(info) });
  }
  async function cleanupCreated() {
    let leftovers = false;
    for (const item of [...created].reverse()) {
      try {
        await noLinks(path.dirname(item.target));
        const info = await lstat(item.target, { bigint: true });
        if (info.isSymbolicLink() || inode(info) !== item.inode) { leftovers = true; continue; }
        if (item.type === 'directory') await rmdir(item.target);
        else if (info.isFile()) await unlink(item.target);
        else leftovers = true;
      } catch (error) { if (error.code !== 'ENOENT') leftovers = true; }
    }
    return leftovers;
  }
  try {
    if (rootEntry.type === 'directory') { await mkdir(temporary, { mode: 0o700 }); await remember(temporary, 'directory'); }
    const directories = plan.entries.filter(entry => entry.type === 'directory' && entry.rel)
      .sort((a, b) => a.rel.split(path.sep).length - b.rel.split(path.sep).length);
    for (const entry of directories) {
      abort(signal);
      const destination = path.join(temporary, entry.rel);
      await noLinks(path.dirname(destination));
      await mkdir(destination, { mode: 0o700 }); await remember(destination, 'directory');
    }
    for (const entry of plan.entries.filter(entry => entry.type === 'file')) {
      abort(signal);
      const from = path.join(plan.source, entry.rel), to = path.join(temporary, entry.rel);
      await noLinks(from); await noLinks(path.dirname(to));
      const input = await open(from, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW));
      let output;
      try {
        if (identity(await input.stat({ bigint: true })) !== entry.identity) throw new Error('A source file changed during the copy.');
        output = await open(to, 'wx', entry.mode); await remember(to, 'file');
        const buffer = Buffer.alloc(1024 * 1024); let position = 0;
        while (true) {
          abort(signal);
          const { bytesRead } = await input.read(buffer, 0, buffer.length, position);
          if (!bytesRead) break;
          let offset = 0;
          while (offset < bytesRead) {
            const { bytesWritten } = await output.write(buffer, offset, bytesRead - offset, position + offset);
            if (!bytesWritten) throw new Error('The destination stopped accepting data.');
            offset += bytesWritten;
          }
          position += bytesRead;
        }
        await output.sync();
        if (identity(await input.stat({ bigint: true })) !== entry.identity) throw new Error('A source file changed during the copy.');
      } finally { await input.close(); await output?.close(); }
      onOutput?.('Copied ' + (entry.rel || path.basename(plan.source)) + '\n');
    }
    await unchanged(plan.source, plan.entries, signal); abort(signal);
    await noLinks(path.dirname(plan.destination));
    if (rootEntry.type === 'file') await moveEntry(temporary, plan.destination, 'file');
    else {
      for (const entry of [...directories].reverse()) await chmod(path.join(temporary, entry.rel), entry.mode);
      await chmod(temporary, rootEntry.mode);
    }
  } catch (error) {
    if (await cleanupCreated()) error.partial = true;
    throw error;
  }
}

export async function executeFileAction(plan, { confirmed = false, signal, onOutput } = {}) {
  if (confirmed !== true) throw new Error('Review and confirm the file operation first.');
  if (!issued.has(plan) || Date.parse(plan.expiresAt) < Date.now()) throw new Error('This review is missing, already used, or expired. Review the selection again.');
  issued.delete(plan); abort(signal);
  if (plan.source) await unchanged(plan.source, plan.entries, signal);
  if (plan.destination) { await noLinks(path.dirname(plan.destination)); if (await exists(plan.destination)) throw new Error('The destination already exists. Nothing was overwritten.'); }
  if (plan.action === 'mkdir') await mkdir(plan.destination);
  else if (plan.action === 'copy') {
    try { await copyReviewed(plan, signal, onOutput); }
    catch (error) {
      if (error.partial) return { status: 'partial', action: 'copy', cancelled: Boolean(signal?.aborted), errors: [error.message], destination: plan.destination, message: 'Copy did not complete. The original is unchanged. Some new destination items remain; review them before retrying.' };
      throw error;
    }
  }
  else if (['move', 'rename'].includes(plan.action)) {
    try { await moveEntry(plan.source, plan.destination, plan.entries.find(entry => entry.rel === '').type); }
    catch (error) { if (error.code === 'EXDEV') throw new Error('This move crosses filesystems. Copy it first, verify the result, then move the original to recovery.'); throw error; }
  } else if (plan.action === 'trash') {
    const store = await recoveryStore(plan.root, plan.recoveryDir); await privateDir(store);
    if ((await stat(store)).dev !== (await stat(plan.source)).dev) throw new Error('Recovery storage is on another filesystem. The original was left in place.');
    const folder = path.join(store, plan.id); await mkdir(folder, { mode: 0o700 });
    const value = { version: 1, id: plan.id, root: plan.root, original: path.relative(plan.root, plan.source), status: 'moving', createdAt: new Date().toISOString(), bytes: plan.bytes, files: plan.files };
    await manifestWrite(folder, value); await unchanged(plan.source, plan.entries, signal); abort(signal);
    try { await moveEntry(plan.source, path.join(folder, 'item'), plan.entries.find(entry => entry.rel === '').type); }
    catch (error) {
      if (await exists(path.join(folder, 'item'))) return { status: 'partial', action: plan.action, recoveryId: plan.id, errors: [error.message], message: 'Recovery needs review. The original and recovery item may both exist; nothing was permanently deleted.' };
      throw error;
    }
    value.status = 'held';
    try { await manifestWrite(folder, value); }
    catch (error) { return { status: 'partial', action: plan.action, recoveryId: plan.id, errors: [error.message], message: 'The item is in recovery, but the final history update failed. Refresh recovery history before retrying.' }; }
    return { status: 'completed', action: plan.action, recoveryId: plan.id, message: 'Moved to recovery. Disk space has not been freed.' };
  } else if (plan.action === 'restore') {
    const { folder } = plan.recovery;
    const value = { ...plan.recovery.value };
    value.status = 'restoring'; await manifestWrite(folder, value); abort(signal);
    await moveEntry(plan.source, plan.destination, plan.entries.find(entry => entry.rel === '').type);
    value.status = 'restored';
    try { await manifestWrite(folder, value); }
    catch (error) { return { status: 'partial', action: plan.action, recoveryId: value.id, errors: [error.message], message: 'The item was restored, but the history update failed. Check its original location before retrying.' }; }
  }
  return { status: 'completed', action: plan.action, message: plan.action === 'mkdir' ? 'Folder created.' : plan.action === 'restore' ? 'Restored to its original location.' : 'File operation completed.' };
}
