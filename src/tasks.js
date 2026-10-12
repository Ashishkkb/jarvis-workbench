import path from 'node:path';
import { stat } from 'node:fs/promises';
import { getProjectScripts } from './system.js';
import { run, ToolError } from './run.js';

async function npmRunner() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const candidate of candidates) {
    if (!candidate || !path.isAbsolute(candidate) || path.basename(candidate) !== 'npm-cli.js') continue;
    try {
      if ((await stat(candidate)).isFile()) return { command: process.execPath, args: [candidate] };
    } catch {
      // Try the next known npm entry point.
    }
  }
  if (process.platform !== 'win32') return { command: 'npm', args: [] };
  throw new ToolError('npm could not be found beside Node.js. Install Node.js with npm, or launch Jarvis through npm.', { code: 'NPM_UNAVAILABLE' });
}

/** Run a confirmed, explicitly selected npm script from this exact project. */
export async function runProjectScript(root, name, { signal, onOutput } = {}) {
  if (typeof name !== 'string' || !name.trim() || name.startsWith('-') || /[\x00-\x1f\x7f]/.test(name)) {
    throw new ToolError('Choose a valid script name from this project.', { code: 'INVALID_SCRIPT' });
  }
  if (signal?.aborted) throw new ToolError('Operation cancelled.', { code: 'ABORT_ERR' });
  const cwd = path.resolve(root);
  const scripts = await getProjectScripts(cwd);
  if (!scripts.some(script => script.name === name)) {
    throw new ToolError('That script is no longer available in this folder’s package.json. Refresh the script list.', { code: 'SCRIPT_NOT_FOUND' });
  }
  const runner = await npmRunner();
  return run(runner.command, [...runner.args, 'run-script', '--', name], {
    cwd,
    signal,
    onOutput,
    timeout: 0,
    maxOutput: 256 * 1024,
    allowFailure: true,
    killTree: true,
  });
}
