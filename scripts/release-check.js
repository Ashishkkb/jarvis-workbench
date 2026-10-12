import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('..', import.meta.url));
for (const args of [['--test'], ['scripts/check.js'], ['scripts/verify-package.js']]) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit', shell: false, windowsHide: true });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0 || result.error) process.exit(result.status || 1);
}
