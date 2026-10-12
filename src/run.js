import { spawn } from 'node:child_process';

export class ToolError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ToolError';
    Object.assign(this, details);
  }
}

/** Run an executable with literal arguments. Never evaluates a shell command. */
export function run(command, args = [], options = {}) {
  const { cwd, timeout = 20000, maxOutput = 16 * 1024 * 1024,
    allowFailure = false, signal, onOutput, env = {}, killTree = true } = options;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ToolError('Operation cancelled.', { code: 'ABORT_ERR' }));
    let stdout = '', stderr = '', size = 0, failure, timer, watchdog, settled = false;
    const child = spawn(command, args, {
      cwd, shell: false, windowsHide: true, detached: killTree && process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never', ...env }
    });
    const stop = (message, code) => {
      if (failure) return;
      failure = new ToolError(message, { code });
      if (killTree && child.pid) {
        if (process.platform === 'win32') {
          const terminator = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
          terminator.once('error', () => child.kill());
          terminator.once('close', code => { if (code !== 0) child.kill(); });
        } else {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
        }
      } else child.kill();
      // A descendant with inherited pipes must never keep cancellation pending.
      watchdog = setTimeout(() => {
        child.stdout.destroy(); child.stderr.destroy(); child.kill();
        finish(Object.assign(failure, { stdout, stderr }));
      }, 2500);
    };
    const abort = () => stop('Operation cancelled.', 'ABORT_ERR');
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    if (timeout > 0) timer = setTimeout(() => stop('The command took too long. Try again or narrow the scope.', 'TIMEOUT'), timeout);
    for (const stream of ['stdout', 'stderr']) {
      child[stream].setEncoding('utf8');
      child[stream].on('data', chunk => {
        if (failure) return;
        const incoming = Buffer.byteLength(chunk);
        const accepted = size + incoming > maxOutput ? Buffer.from(chunk).subarray(0, Math.max(0, maxOutput - size)).toString('utf8') : chunk;
        size += incoming;
        if (stream === 'stdout') stdout += accepted;
        else stderr += accepted;
        try { onOutput?.(accepted, stream); }
        catch (error) { return stop(error.message || 'Output handler failed.', 'OUTPUT_HANDLER'); }
        if (size > maxOutput) return stop('Command output exceeded the display limit.', 'OUTPUT_LIMIT');
      });
    }
    const cleanup = () => { clearTimeout(timer); clearTimeout(watchdog); signal?.removeEventListener('abort', abort); };
    function finish(error, value) {
      if (settled) return;
      settled = true; cleanup();
      if (error) reject(error); else resolve(value);
    }
    child.on('error', error => {
      finish(new ToolError(error.code === 'ENOENT' ? `${command} is not installed or is not on PATH.` : error.message,
        { code: error.code, stdout, stderr }));
    });
    child.on('close', code => {
      if (failure) return finish(Object.assign(failure, { stdout, stderr }));
      const result = { stdout, stderr, code: code ?? 1 };
      if (code !== 0 && !allowFailure) {
        return finish(new ToolError(stderr.trim() || `${command} exited with code ${code}.`, result));
      }
      finish(null, result);
    });
  });
}
