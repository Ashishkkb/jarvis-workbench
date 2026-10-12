import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitAll, fetchRemote, getGitDiff, getGitStatus, pullCurrent, pushCurrent } from '../src/git.js';

const execute = promisify(execFile);
const git = (cwd, ...args) => execute('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, windowsHide: true });

async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), 'jarvis-git-test-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return root;
}

async function configure(cwd) {
  await git(cwd, 'config', 'user.name', 'Jarvis Test');
  await git(cwd, 'config', 'user.email', 'jarvis@example.invalid');
  await git(cwd, 'config', 'commit.gpgsign', 'false');
  await git(cwd, 'config', 'core.hooksPath', '.git/no-hooks');
  await git(cwd, 'config', 'core.autocrlf', 'false');
}

async function repository(t, initial = true) {
  const root = await temporary(t);
  const cwd = join(root, 'work');
  await mkdir(cwd);
  await git(cwd, 'init', '--initial-branch=main');
  await configure(cwd);
  if (initial) {
    await writeFile(join(cwd, 'hello space.txt'), 'first version\n');
    await git(cwd, 'add', '--', 'hello space.txt');
    await git(cwd, 'commit', '-m', 'Initial test commit');
  }
  return { root, cwd };
}

async function withRemote(t) {
  const setup = await repository(t);
  const remote = join(setup.root, 'remote.git');
  await git(setup.root, 'init', '--bare', '--initial-branch=main', remote);
  await git(setup.cwd, 'remote', 'add', 'origin', remote);
  await pushCurrent(setup.cwd);
  const peer = join(setup.root, 'peer');
  await git(setup.root, 'clone', '--', remote, peer);
  await configure(peer);
  return { ...setup, remote, peer };
}

test('reports folders outside Git without inventing a branch', async t => {
  const cwd = await temporary(t);
  const status = await getGitStatus(cwd);
  assert.equal(status.isRepo, false);
  assert.equal(status.branch, null);
  await assert.rejects(commitAll(cwd, 'test'), /not a Git repository/);
});

test('handles unborn branches, ignored files, literal filenames, and first commits', async t => {
  const { cwd } = await repository(t, false);
  await writeFile(join(cwd, '.gitignore'), 'ignored.txt\n');
  await writeFile(join(cwd, 'ignored.txt'), 'ignore me');
  await writeFile(join(cwd, '[red].txt'), 'literal bracket filename\n');
  await writeFile(join(cwd, 'space ü.txt'), 'unicode filename\n');
  const status = await getGitStatus(cwd);
  assert.equal(status.branch, 'main');
  assert.equal(status.unborn, true);
  assert.equal(status.untracked, 3);
  assert.equal(status.lastCommit, null);
  assert.ok(status.changes.some(change => change.path === 'space ü.txt'));
  await commitAll(cwd, 'First commit');
  const committed = await getGitStatus(cwd);
  assert.equal(committed.clean, true);
  assert.equal(committed.unborn, false);
  assert.equal(committed.lastCommit.subject, 'First commit');
  const tracked = (await git(cwd, 'ls-files')).stdout;
  assert.ok(!tracked.includes('ignored.txt'));
  assert.ok(tracked.includes('[red].txt'));
});

test('distinguishes staged, working-tree, untracked, and renamed paths', async t => {
  const { cwd } = await repository(t);
  await writeFile(join(cwd, 'hello space.txt'), 'staged version\n');
  await git(cwd, 'add', '--', 'hello space.txt');
  await writeFile(join(cwd, 'hello space.txt'), 'unstaged version\n');
  await writeFile(join(cwd, 'new file.txt'), 'new file');
  let status = await getGitStatus(cwd);
  assert.equal(status.staged, 1);
  assert.equal(status.modified, 1);
  assert.equal(status.untracked, 1);
  const diff = await getGitDiff(cwd);
  assert.match(diff, /STAGED CHANGES/);
  assert.match(diff, /WORKING TREE CHANGES/);
  assert.match(diff, /new file\.txt/);
  await commitAll(cwd, 'All changes');
  await git(cwd, 'mv', '--', 'hello space.txt', 'renamed space.txt');
  status = await getGitStatus(cwd);
  assert.deepEqual(status.changes[0], { path: 'renamed space.txt', originalPath: 'hello space.txt', index: 'R', worktree: '.', kind: 'renamed' });
  await commitAll(cwd, 'Rename');
  assert.equal((await getGitStatus(cwd)).clean, true);
});

test('accepts staged deletions and restricts diff to a literal bracket filename', async t => {
  const { cwd } = await repository(t);
  await writeFile(join(cwd, '[red].txt'), 'bracket initial\n');
  await writeFile(join(cwd, 'r.txt'), 'single letter initial\n');
  await commitAll(cwd, 'Add names');
  await writeFile(join(cwd, '[red].txt'), 'bracket changed\n');
  await writeFile(join(cwd, 'r.txt'), 'single letter changed\n');
  const diff = await getGitDiff(cwd, '[red].txt');
  assert.match(diff, /bracket changed/);
  assert.doesNotMatch(diff, /single letter changed/);
  await git(cwd, 'rm', '--', 'hello space.txt');
  await commitAll(cwd, 'Delete and edit');
  assert.equal((await getGitStatus(cwd)).clean, true);
});

test('does not confuse newlines in filenames with porcelain records', { skip: process.platform === 'win32' }, async t => {
  const { cwd } = await repository(t);
  const filename = 'line\nbreak.txt';
  await writeFile(join(cwd, filename), 'newline filename');
  assert.ok((await getGitStatus(cwd)).changes.some(change => change.path === filename));
  await commitAll(cwd, 'Newline path');
  await rename(join(cwd, filename), join(cwd, 'renamed\nfile.txt'));
  await git(cwd, 'add', '-A');
  const change = (await getGitStatus(cwd)).changes[0];
  assert.equal(change.path, 'renamed\nfile.txt');
  assert.equal(change.originalPath, filename);
});

test('refuses credential filenames before staging and accepts env examples', async t => {
  const { cwd } = await repository(t);
  await writeFile(join(cwd, '.env'), 'EXAMPLE_SECRET=do-not-commit');
  await writeFile(join(cwd, 'safe.txt'), 'safe');
  await assert.rejects(commitAll(cwd, 'Unsafe'), /credential files.*\.env/);
  assert.equal((await git(cwd, 'diff', '--cached', '--name-only')).stdout, '');
  await rename(join(cwd, '.env'), join(cwd, '.env.example'));
  await commitAll(cwd, 'Safe example');
  assert.equal((await getGitStatus(cwd)).clean, true);
  await assert.rejects(commitAll(cwd, '   '), /commit message/);
  await assert.rejects(commitAll(cwd, 'No changes'), /no changes/);
});

test('push sets upstream and fetch/pull safely synchronize a local bare remote', async t => {
  const { cwd, peer } = await withRemote(t);
  let status = await getGitStatus(cwd);
  assert.equal(status.upstream, 'origin/main');
  assert.equal(status.remoteName, 'origin');
  assert.equal(status.ahead, 0);
  await writeFile(join(peer, 'peer.txt'), 'from peer\n');
  await commitAll(peer, 'Peer commit');
  await pushCurrent(peer);
  await fetchRemote(cwd);
  status = await getGitStatus(cwd);
  assert.equal(status.behind, 1);
  await assert.rejects(pushCurrent(cwd), /behind/);
  await writeFile(join(cwd, 'dirty.txt'), 'local work');
  await assert.rejects(pullCurrent(cwd), /local changes/);
  await rm(join(cwd, 'dirty.txt'));
  await pullCurrent(cwd);
  assert.equal(await readFile(join(cwd, 'peer.txt'), 'utf8'), 'from peer\n');
  await writeFile(join(cwd, 'mine.txt'), 'my commit\n');
  await commitAll(cwd, 'My commit');
  assert.equal((await getGitStatus(cwd)).ahead, 1);
  await pushCurrent(cwd);
  status = await getGitStatus(cwd);
  assert.equal(status.ahead, 0);
  assert.equal(status.behind, 0);
});

test('refuses to force a divergent branch or mutate detached/conflicted states', async t => {
  const { cwd, peer, remote } = await withRemote(t);
  await writeFile(join(cwd, 'hello space.txt'), 'local conflicting edit\n');
  await commitAll(cwd, 'Local branch');
  await writeFile(join(peer, 'hello space.txt'), 'remote conflicting edit\n');
  await commitAll(peer, 'Remote branch');
  await pushCurrent(peer);
  await fetchRemote(cwd);
  const status = await getGitStatus(cwd);
  assert.equal(status.ahead, 1);
  assert.equal(status.behind, 1);
  const before = (await git(remote, 'rev-parse', 'main')).stdout;
  await assert.rejects(pushCurrent(cwd), /behind/);
  await assert.rejects(pullCurrent(cwd));
  assert.equal((await git(remote, 'rev-parse', 'main')).stdout, before);
  await assert.rejects(git(cwd, 'merge', '--no-edit', 'origin/main'));
  const conflict = await getGitStatus(cwd);
  assert.equal(conflict.conflicts, 1);
  assert.equal(conflict.operation, 'merge');
  assert.equal(conflict.changes[0].kind, 'conflict');
  await assert.rejects(commitAll(cwd, 'Conflicted'), /conflicts/);
  await assert.rejects(pushCurrent(cwd), /conflicts/);
  await git(cwd, 'merge', '--abort');
  await git(cwd, 'checkout', '--detach', 'HEAD');
  assert.equal((await getGitStatus(cwd)).detached, true);
  await assert.rejects(commitAll(cwd, 'Detached'), /detached HEAD/);
  await assert.rejects(pushCurrent(cwd), /detached HEAD/);
  await assert.rejects(pullCurrent(cwd), /detached HEAD/);
});

test('requires deliberate remote selection when no default is available', async t => {
  const { root, cwd } = await repository(t);
  await assert.rejects(pushCurrent(cwd), /No Git remote/);
  await assert.rejects(pullCurrent(cwd), /upstream/);
  await git(cwd, 'remote', 'add', 'first', join(root, 'first.git'));
  await git(cwd, 'remote', 'add', 'second', join(root, 'second.git'));
  assert.equal((await getGitStatus(cwd)).remoteName, null);
  await assert.rejects(pushCurrent(cwd), /Several remotes/);
});

test('inherited Git repository variables cannot redirect a commit to another project', async t => {
  const target = await repository(t);
  const other = await repository(t);
  const variables = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'];
  const previous = Object.fromEntries(variables.map(name => [name, process.env[name]]));
  process.env.GIT_DIR = join(other.cwd, '.git');
  process.env.GIT_WORK_TREE = other.cwd;
  process.env.GIT_INDEX_FILE = join(other.cwd, '.git', 'index');
  try {
    await writeFile(join(target.cwd, 'target-only.txt'), 'belongs to target');
    assert.equal(await realpath((await getGitStatus(target.cwd)).root), await realpath(target.cwd));
    await commitAll(target.cwd, 'Target commit');
    assert.equal((await getGitStatus(target.cwd)).lastCommit.subject, 'Target commit');
    assert.equal((await getGitStatus(other.cwd)).lastCommit.subject, 'Initial test commit');
  } finally {
    for (const name of variables) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
