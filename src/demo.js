import { RECIPES } from './recipes.js';

export function demoState() {
  return {
    demo: true, root: '~/projects/orbit', screen: 'overview', selected: {}, activity: ['14:32  Workspace refreshed', '14:31  Found 12 matching lines in 4 files'],
    lastRefresh: new Date().toISOString(), message: { text: 'Demo workspace. Explore freely; actions do not change files.', tone: 'good' },
    system: { platform: 'linux', hostname: 'workstation', node: '24.14.0', cpus: 12, memoryTotal: 32 * 1024 ** 3, memoryFree: 19 * 1024 ** 3, uptime: 12600 },
    git: { isRepo: true, root: '~/projects/orbit', branch: 'feature/search', upstream: 'origin/feature/search', ahead: 2, behind: 0,
      staged: 1, modified: 2, untracked: 1, conflicts: 0, clean: false, remoteName: 'origin', remoteUrl: 'https://github.com/example/orbit.git',
      lastCommit: { hash: 'a7d3e81', subject: 'Add streaming search results' }, changes: [
        { path: 'src/search.js', kind: 'modified', index: '.', worktree: 'M' },
        { path: 'src/ui.js', kind: 'modified', index: 'M', worktree: '.' },
        { path: 'test/search.test.js', kind: 'modified', index: '.', worktree: 'M' },
        { path: 'docs/guide.md', kind: 'untracked', index: '?', worktree: '?' }
      ] },
    files: { path: '', parent: null, entries: [
      { name: 'docs', path: 'docs', type: 'directory', size: 0 }, { name: 'src', path: 'src', type: 'directory', size: 0 },
      { name: 'test', path: 'test', type: 'directory', size: 0 }, { name: 'package.json', path: 'package.json', type: 'file', size: 1430 },
      { name: 'README.md', path: 'README.md', type: 'file', size: 6450 }
    ] },
    search: { query: 'TODO', regex: false, caseSensitive: false, glob: '*.js', backend: 'ripgrep', matches: [
      { path: 'src/search.js', line: 42, column: 3, text: '// TODO: add a file type filter' },
      { path: 'src/ui.js', line: 126, column: 3, text: '// TODO: explain what a clean working tree means' },
      { path: 'test/search.test.js', line: 18, column: 3, text: '// TODO: verify filenames with spaces' }
    ] },
    processes: { cpuLabel: '% CPU', processes: [
      { pid: 14280, name: 'node', cpu: 12.4, memory: 264 * 1024 ** 2 },
      { pid: 10930, name: 'code', cpu: 4.8, memory: 680 * 1024 ** 2 },
      { pid: 15041, name: 'postgres', cpu: 1.2, memory: 142 * 1024 ** 2 }
    ] },
    ports: { ports: [{ protocol: 'tcp', address: '127.0.0.1', port: 3000, pid: 14280, process: 'node' },
      { protocol: 'tcp', address: '127.0.0.1', port: 5432, pid: 15041, process: 'postgres' }] },
    disk: { totalBytes: 360 * 1024 ** 2, totalFiles: 2194, elapsedMs: 142, skipped: 0, truncated: false, entries: [
      { name: 'node_modules', path: 'node_modules', type: 'directory', bytes: 290 * 1024 ** 2, files: 2000 },
      { name: '.git', path: '.git', type: 'directory', bytes: 54 * 1024 ** 2, files: 160 },
      { name: 'src', path: 'src', type: 'directory', bytes: 16 * 1024 ** 2, files: 34 }
    ] },
    scripts: [{ name: 'dev', command: 'vite --host 127.0.0.1' }, { name: 'test', command: 'node --test' }, { name: 'build', command: 'vite build' }],
    recipes: RECIPES
  };
}
