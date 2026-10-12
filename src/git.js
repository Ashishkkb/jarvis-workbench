import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './run.js';

const READ_LIMIT = 16 * 1024 * 1024;
const REPOSITORY_ENV = Object.fromEntries([
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_PREFIX', 'GIT_NAMESPACE',
].map(name => [name, undefined]));
const EMPTY_STATUS = {
  isRepo: false, root: null, branch: null, detached: false, unborn: false,
  upstream: null, ahead: 0, behind: 0, changes: [], remoteName: null,
  remoteUrl: null, remotes: [], lastCommit: null, conflicts: 0, staged: 0,
  modified: 0, untracked: 0, clean: true, operation: null,
};

function git(cwd, args, options = {}) {
  return run('git', ['--no-optional-locks', '-c', 'color.ui=false', ...args], {
    cwd, timeout: 30_000, maxOutput: READ_LIMIT, ...options,
    env: { ...options.env, ...REPOSITORY_ENV },
  });
}

const chomp = value => value.replace(/\r?\n$/, '');

function changeKind(index, worktree, unmerged = false) {
  if (unmerged) return 'conflict';
  if (index === '?') return 'untracked';
  const pair = index + worktree;
  if (pair.includes('R') || pair.includes('C')) return 'renamed';
  if (pair.includes('D')) return 'deleted';
  if (pair.includes('A')) return 'added';
  if (pair.includes('T')) return 'typechanged';
  return 'modified';
}

// Porcelain v2 separates records with NUL. A rename consumes a second NUL
// record, while the path in either record can itself contain spaces/newlines.
function parseStatus(output) {
  const result = { branch: null, detached: false, unborn: false, upstream: null, ahead: 0, behind: 0, changes: [] };
  const records = output.split('\0');
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record.startsWith('# branch.head ')) {
      const head = record.slice(14);
      result.detached = head === '(detached)';
      result.branch = result.detached ? null : head;
    } else if (record.startsWith('# branch.oid ')) {
      result.unborn = record.slice(13) === '(initial)';
    } else if (record.startsWith('# branch.upstream ')) {
      result.upstream = record.slice(18);
    } else if (record.startsWith('# branch.ab ')) {
      const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record);
      if (match) { result.ahead = Number(match[1]); result.behind = Number(match[2]); }
    } else if (record.startsWith('? ')) {
      result.changes.push({ path: record.slice(2), index: '?', worktree: '?', kind: 'untracked' });
    } else if (/^[12u] /.test(record)) {
      const type = record[0];
      const fieldCount = type === '1' ? 8 : type === '2' ? 9 : 10;
      let offset = 0;
      for (let field = 0; field < fieldCount; field++) offset = record.indexOf(' ', offset) + 1;
      const index = record[2];
      const worktree = record[3];
      const change = { path: record.slice(offset), index, worktree, kind: changeKind(index, worktree, type === 'u') };
      if (type === '2') change.originalPath = records[++i];
      result.changes.push(change);
    }
  }
  return result;
}

async function getOperation(gitDir) {
  const markers = [
    ['rebase-merge', 'rebase'], ['rebase-apply', 'rebase'], ['MERGE_HEAD', 'merge'],
    ['CHERRY_PICK_HEAD', 'cherry-pick'], ['REVERT_HEAD', 'revert'], ['BISECT_LOG', 'bisect'],
  ];
  for (const [file, operation] of markers) {
    try { await access(join(gitDir, file)); return operation; } catch { /* absent */ }
  }
  return null;
}

function upstreamRemote(status) {
  if (!status.upstream) return null;
  return [...status.remotes].sort((a, b) => b.name.length - a.name.length)
    .find(remote => status.upstream.startsWith(`${remote.name}/`)) ?? null;
}

function preferredRemote(status) {
  return upstreamRemote(status) ?? status.remotes.find(remote => remote.name === 'origin')
    ?? (status.remotes.length === 1 ? status.remotes[0] : null);
}

export async function getGitStatus(cwd) {
  const rootResult = await git(cwd, ['rev-parse', '--show-toplevel'], { allowFailure: true });
  if (rootResult.code !== 0) return { ...EMPTY_STATUS, changes: [], remotes: [] };
  const root = chomp(rootResult.stdout);
  const [statusResult, remoteResult, logResult, directoryResult] = await Promise.all([
    git(root, ['status', '--porcelain=v2', '--branch', '--untracked-files=all', '-z']),
    git(root, ['remote']),
    git(root, ['log', '-1', '--format=%h%x00%s'], { allowFailure: true }),
    git(root, ['rev-parse', '--absolute-git-dir']),
  ]);
  const status = { ...EMPTY_STATUS, ...parseStatus(statusResult.stdout), isRepo: true, root };
  const remoteNames = remoteResult.stdout.trim().split(/\r?\n/).filter(Boolean);
  status.remotes = await Promise.all(remoteNames.map(async name => {
    const result = await git(root, ['remote', 'get-url', '--', name], { allowFailure: true });
    return { name, url: result.code === 0 ? chomp(result.stdout) : '' };
  }));
  const remote = preferredRemote(status);
  status.remoteName = remote?.name ?? null;
  status.remoteUrl = remote?.url ?? null;
  if (logResult.code === 0) {
    const [hash, ...subject] = chomp(logResult.stdout).split('\0');
    status.lastCommit = { hash, subject: subject.join('\0') };
  }
  status.conflicts = status.changes.filter(change => change.kind === 'conflict').length;
  status.staged = status.changes.filter(change => change.index !== '.' && change.index !== '?' && change.kind !== 'conflict').length;
  status.modified = status.changes.filter(change => change.worktree !== '.' && change.worktree !== '?' && change.kind !== 'conflict').length;
  status.untracked = status.changes.filter(change => change.kind === 'untracked').length;
  status.clean = status.changes.length === 0;
  status.operation = await getOperation(chomp(directoryResult.stdout));
  return status;
}

function requireRepo(status) {
  if (!status.isRepo) throw new Error('This folder is not a Git repository. Open a project that uses Git.');
}

function requireReady(status) {
  requireRepo(status);
  if (status.detached) throw new Error('This repository has a detached HEAD. Switch to a branch first.');
  if (status.conflicts) throw new Error('Resolve the Git conflicts before continuing.');
  if (status.operation) throw new Error(`Finish the current ${status.operation} before continuing.`);
}

function requireRemote(status) {
  const remote = preferredRemote(status);
  if (!remote) throw new Error(status.remotes.length ? 'Several remotes are configured. Set an upstream branch first.' : 'No Git remote is configured. Add a remote before uploading or downloading.');
  return remote;
}

function looksLikeCredential(path) {
  const name = path.replaceAll('\\', '/').split('/').at(-1).toLowerCase();
  if (/^\.env(?:\.|$)/.test(name) && !/\.(?:example|sample|template)$/.test(name)) return true;
  return /\.(?:pem|p12|pfx|key)$/.test(name)
    || /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:\.pub)?$/.test(name) && !name.endsWith('.pub')
    || /^(?:credentials\.json|credentials|service[-_]?account(?:[-_].*)?\.json|\.netrc|\.npmrc)$/.test(name);
}

function refuseCredentials(status) {
  const sensitive = status.changes.filter(change => change.kind !== 'deleted' && looksLikeCredential(change.path));
  if (sensitive.length) throw new Error(`Potential credential files were found: ${sensitive.map(change => change.path).join(', ')}. Review them and add private files to .gitignore before committing.`);
}

export async function getGitDiff(cwd, path) {
  const status = await getGitStatus(cwd);
  requireRepo(status);
  const paths = path === undefined ? [] : [path];
  const options = ['--no-ext-diff', '--no-textconv', '--no-color', '--no-renames'];
  const diff = async args => {
    try { return await git(status.root, args, { maxOutput: 200_000 }); }
    catch (error) {
      if (error.code !== 'OUTPUT_LIMIT') throw error;
      return { stdout: `${(error.stdout ?? '').slice(0, 200_000)}\n[Preview truncated. Select a single file for a smaller diff.]\n` };
    }
  };
  const [staged, working] = await Promise.all([
    diff(['--literal-pathspecs', 'diff', '--cached', ...options, '--', ...paths]),
    diff(['--literal-pathspecs', 'diff', ...options, '--', ...paths]),
  ]);
  const sections = [];
  if (staged.stdout) sections.push(`STAGED CHANGES\n${staged.stdout}`);
  if (working.stdout) sections.push(`WORKING TREE CHANGES\n${working.stdout}`);
  const untracked = status.changes.filter(change => change.kind === 'untracked' && (path === undefined || change.path === path));
  if (untracked.length) sections.push(`NEW FILES (not yet tracked)\n${untracked.map(change => change.path).join('\n')}`);
  return sections.join('\n\n') || 'No changes to preview.';
}

export async function fetchRemote(cwd, options = {}) {
  const status = await getGitStatus(cwd);
  requireRepo(status);
  const remote = requireRemote(status);
  return git(status.root, ['fetch', '--progress', '--', remote.name], { timeout: 0, killTree: true, ...options });
}

export async function commitAll(cwd, message, options = {}) {
  if (typeof message !== 'string' || !message.trim()) throw new Error('Enter a commit message describing your changes.');
  const status = await getGitStatus(cwd);
  requireReady(status);
  if (status.clean) throw new Error('There are no changes to commit.');
  refuseCredentials(status);
  // Already-staged deletions and renames must not be re-added by their old,
  // absent names. Only the worktree changes still need staging.
  const paths = new Set();
  for (const change of status.changes) {
    if (change.worktree !== '.') {
      paths.add(change.path);
      if (change.originalPath && change.index !== 'R' && change.index !== 'C') paths.add(change.originalPath);
    }
  }
  if (paths.size) {
    const temporary = await mkdtemp(join(tmpdir(), 'jarvis-git-'));
    try {
      const pathspec = join(temporary, 'paths');
      await writeFile(pathspec, `${[...paths].join('\0')}\0`, { mode: 0o600 });
      await git(status.root, ['--literal-pathspecs', 'add', '-A', `--pathspec-from-file=${pathspec}`, '--pathspec-file-nul'], { timeout: 0, killTree: true, ...options });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  const staged = await getGitStatus(status.root);
  requireReady(staged);
  refuseCredentials(staged);
  return git(status.root, ['commit', '-m', message.trim()], { timeout: 0, killTree: true, ...options });
}

export async function pushCurrent(cwd, options = {}) {
  const status = await getGitStatus(cwd);
  requireReady(status);
  if (status.unborn) throw new Error('Create a commit before uploading this branch.');
  if (status.behind > 0) throw new Error('Your branch is behind its remote. Fetch and download changes before uploading; divergent branches need review.');
  const remote = requireRemote(status);
  const upstream = upstreamRemote(status);
  if (status.upstream && !upstream) throw new Error('This branch tracks a local branch. Configure a remote upstream before uploading.');
  const branch = upstream ? status.upstream.slice(upstream.name.length + 1) : status.branch;
  const args = ['-c', `remote.${remote.name}.mirror=false`, 'push', '--progress', '--no-force', '--no-follow-tags'];
  if (!status.upstream) args.push('--set-upstream');
  args.push('--', remote.name, `HEAD:refs/heads/${branch}`);
  return git(status.root, args, { timeout: 0, killTree: true, ...options });
}

export async function pullCurrent(cwd, options = {}) {
  const status = await getGitStatus(cwd);
  requireReady(status);
  if (!status.clean) throw new Error('Commit or set aside your local changes before downloading.');
  const remote = upstreamRemote(status);
  if (!status.upstream || !remote) throw new Error('This branch needs a remote upstream before downloading. Upload the branch once or configure its upstream.');
  const branch = status.upstream.slice(remote.name.length + 1);
  return git(status.root, ['pull', '--ff-only', '--no-rebase', '--no-autostash', '--no-tags', '--progress', '--', remote.name, branch], { timeout: 0, killTree: true, ...options });
}
