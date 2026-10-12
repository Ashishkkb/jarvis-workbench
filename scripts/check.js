import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
let checked = 0;
for (const folder of ['src', 'bin', 'web', 'scripts', 'test']) {
  const entries = await readdir(path.join(root, folder)).catch(error => {
    if (folder === 'test' && error.code === 'ENOENT') return [];
    throw error;
  });
  for (const file of entries) {
    if (!file.endsWith('.js')) continue;
    const result = spawnSync(process.execPath, ['--check', path.join(root, folder, file)], { stdio: 'inherit', shell: false, windowsHide: true });
    if (result.status !== 0 || result.error) process.exit(1);
    checked++;
  }
}
console.log(`Syntax checked ${checked} JavaScript files.`);
