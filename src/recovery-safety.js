import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, lstat, open, readFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { run } from './run.js';

const helper = fileURLToPath(new URL('./file-recovery.ps1', import.meta.url));
const powershell = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const signature = value => `${value.dev}:${value.ino}`;
const busy = message => Object.assign(new Error(message), { code: 'RECOVERY_BUSY' });
async function lockInfo(filename) {
  try { return await lstat(filename, { bigint: true }); }
  catch (error) { if (error.code === 'ENOENT') throw busy('Recovery lock changed; retry after the other operation finishes.'); throw error; }
}

/** Make only the dedicated recovery directory private; never change ancestor permissions. */
export async function privateRecoveryDirectory(target) {
  const absolute = path.resolve(target);
  if (absolute === path.parse(absolute).root) throw new Error('A drive root cannot be recovery storage.');
  let current = path.parse(absolute).root;
  for (const segment of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let present;
    try { present = await lstat(current); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (process.platform === 'win32' && (!present || current === absolute)) {
      const response = await run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper,
        '-PathBase64', Buffer.from(current).toString('base64')], { cwd: path.win32.dirname(powershell), timeout: 15000, maxOutput: 65536 });
      let result;
      try { result = JSON.parse(response.stdout.replace(/^\uFEFF/, '').trim()); } catch { /* Fail closed if Windows cannot verify privacy. */ }
      if (!result?.private) throw new Error('Windows could not verify private recovery storage. No selected files were moved.');
    } else {
      try { await mkdir(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Recovery storage must use regular directories.');
    if (current === absolute && process.platform !== 'win32' && ((info.mode & 0o077) || (typeof process.getuid === 'function' && info.uid !== process.getuid()))) {
      throw new Error('Existing recovery storage is not private to this user. Choose a new recovery folder; its permissions were left unchanged.');
    }
  }
  return absolute;
}

/** Persist directory entries on platforms where Node supports directory fsync. */
export async function syncDirectory(target) {
  if (process.platform === 'win32') return; // Node cannot fsync Windows directories; file data/manifests are still flushed.
  const handle = await open(target, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

/** Exclusive per-transaction lease. A verified dead owner may be reclaimed after a restart. */
export async function lockRecovery(folder) {
  const filename = path.join(folder, '.lock');
  let handle;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { handle = await open(filename, 'wx', 0o600); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const before = await lockInfo(filename);
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > 4096n) throw new Error('Recovery lock needs manual review.');
      let owner;
      try { owner = JSON.parse(await readFile(filename, 'utf8')); } catch { throw Object.assign(new Error('Recovery is busy or its interrupted lock needs review.'), { code: 'RECOVERY_BUSY' }); }
      if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw new Error('Recovery lock needs manual review.');
      let alive = true;
      try { process.kill(owner.pid, 0); } catch (cause) { if (cause.code === 'ESRCH') alive = false; }
      if (alive || attempt) throw Object.assign(new Error('This recovery item is already being changed by another Jarvis process.'), { code: 'RECOVERY_BUSY' });
      // Two restarters must not both remove the same stale pathname. Claim this exact
      // stale inode before rechecking; a contender then sees either this claim or the new lease.
      const claimPath = path.join(folder, `.lock-reclaim-${before.dev}-${before.ino}-${before.mtimeNs}`);
      let claim;
      try { claim = await open(claimPath, 'wx', 0o600); }
      catch (cause) {
        if (cause.code === 'EEXIST') throw Object.assign(new Error('Another process is recovering this interrupted lock.'), { code: 'RECOVERY_BUSY' });
        throw cause;
      }
      try {
        const after = await lockInfo(filename);
        if (signature(before) !== signature(after) || before.mtimeNs !== after.mtimeNs) throw Object.assign(new Error('Recovery lock changed; retry after the other operation finishes.'), { code: 'RECOVERY_BUSY' });
        await unlink(filename);
      } finally { await claim.close(); await unlink(claimPath).catch(() => {}); }

    }
  }
  const token = randomUUID();
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, token })); await handle.sync(); }
  catch (error) { await handle.close(); await unlink(filename).catch(() => {}); throw error; }
  const held = signature(await handle.stat({ bigint: true }));
  return async () => {
    await handle.close();
    try {
      const actual = await lstat(filename, { bigint: true });
      if (!actual.isSymbolicLink() && signature(actual) === held && JSON.parse(await readFile(filename, 'utf8')).token === token) await unlink(filename);
    } catch { /* Leave a changed lock untouched. */ }
  };
}
