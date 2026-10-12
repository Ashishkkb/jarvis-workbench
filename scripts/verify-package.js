import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output')) throw new Error('Usage: node scripts/verify-package.js [--output directory]');
const output = args.length ? path.resolve(args[1]) : null;
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const temporaryParent = await realpath(os.tmpdir());
const temporary = await mkdtemp(path.join(temporaryParent, 'jarvis-package-'));
const prefix = path.join(temporary, 'isolated prefix');
const cache = path.join(temporary, 'npm-cache');
const workspace = path.join(temporary, 'workspace with spaces');
let server;
let npmCli;
let environment;
let installed = false;
let success = false;

async function command(file, values, options = {}) {
  try {
    const pending = exec(file, values, { cwd: workspace, env: environment, timeout: 60_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, shell: false, ...options });
    pending.child.stdin?.end();
    return await pending;
  } catch (error) {
    throw new Error(`${path.basename(file)} failed: ${error.stderr || error.stdout || error.message}`, { cause: error });
  }
}
async function findNpm() {
  const candidates = [process.env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')].filter(Boolean);
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    try {
      const launcher = await realpath(path.join(directory, process.platform === 'win32' ? 'npm.cmd' : 'npm'));
      candidates.push(launcher.endsWith('.js') ? launcher : path.join(path.dirname(launcher), 'node_modules/npm/bin/npm-cli.js'));
    } catch { /* Try the next executable directory. */ }
  }
  for (const candidate of candidates) {
    try { if ((await lstat(candidate)).isFile() && candidate.endsWith('npm-cli.js')) return candidate; } catch { /* Continue. */ }
  }
  throw new Error('Cannot locate npm-cli.js. Run this check with npm run test:package.');
}
async function npm(values, options = {}) {
  return command(process.execPath, [npmCli, ...values, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', cache,
    '--userconfig', path.join(temporary, 'user.npmrc'), '--globalconfig', path.join(temporary, 'global.npmrc')], options);
}
async function runShim(name, values) {
  const shim = path.join(prefix, process.platform === 'win32' ? `${name}.ps1` : `bin/${name}`);
  await access(shim);
  if (process.platform !== 'win32') return command(shim, values);
  // Use npm's PowerShell shim with literal arguments; do not construct a cmd.exe command string.
  await access(path.join(prefix, `${name}.cmd`));
  return command('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', shim, ...values]);
}
async function listFiles(directory, relative = '') {
  const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const name = [relative, entry.name].filter(Boolean).join('/');
    if (entry.isDirectory()) files.push(...await listFiles(directory, name));
    else files.push(name);
  }
  return files;
}

try {
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/);
  assert.equal(lock.version, manifest.version, 'package-lock version must match package.json');
  assert.equal(lock.packages[''].version, manifest.version, 'package-lock root version must match');
  if (process.env.JARVIS_RELEASE_TAG) assert.equal(process.env.JARVIS_RELEASE_TAG, `v${manifest.version}`, 'Release tag must match package.json');
  assert.equal(Object.keys(manifest.dependencies || {}).length, 0, 'Review this offline package gate before adding runtime dependencies');
  assert.equal(Object.keys(manifest.optionalDependencies || {}).length, 0, 'Optional dependencies must not be silently skipped by offline validation');
  for (const name of ['preinstall', 'install', 'postinstall']) assert.equal(manifest.scripts?.[name], undefined, 'Installation must not require lifecycle scripts');
  await mkdir(workspace);
  await writeFile(path.join(workspace, 'hello world.txt'), 'Jarvis packaged consumer fixture\n');
  await writeFile(path.join(temporary, 'user.npmrc'), '');
  await writeFile(path.join(temporary, 'global.npmrc'), '');
  environment = { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}`, JARVIS_DATA_DIR: path.join(temporary, 'activity'), NO_COLOR: '1' };
  // Inherited registry credentials/config are unnecessary for an entirely offline tarball installation.
  for (const key of Object.keys(environment)) if (/^npm_config_/i.test(key) || /^(?:npm_token|node_auth_token)$/i.test(key)) delete environment[key];
  npmCli = await findNpm();
  console.log('Packing the release and checking its file list...');
  const { stdout: packOutput } = await npm(['pack', '--json', '--pack-destination', temporary], { cwd: root });
  const [packed] = JSON.parse(packOutput);
  assert.equal(packed.name, manifest.name);
  assert.equal(packed.version, manifest.version);
  assert.equal(path.basename(packed.filename), packed.filename);
  const archive = path.join(temporary, packed.filename);
  const packedPaths = new Set(packed.files.map(file => file.path));
  const required = ['package.json', 'bin/jarvis.js', 'src/index.js', 'src/ui.js', 'web/index.html', 'web/app.js', 'web/styles.css', 'support.json', 'README.md', 'LICENSE', 'SECURITY.md', 'CONTRIBUTING.md'];
  for (const name of ['src', 'web', 'bin']) required.push(...(await listFiles(path.join(root, name))).map(file => `${name}/${file}`));
  for (const name of required) assert(packedPaths.has(name), `Required package file missing: ${name}`);
  for (const name of packedPaths) assert(!/(?:^|\/)(?:\.git|\.github|\.artifacts|node_modules|test|coverage|\.env(?:\..*)?|\.npmrc|\.pypirc|id_(?:rsa|ed25519)|[^/]+\.(?:tgz|pem|key))(?:\/|$)/.test(name), `Private/development file included in archive: ${name}`);
  console.log('Installing the archive into an isolated prefix...');
  await npm(['install', '--global', '--prefix', prefix, archive]);
  installed = true;
  const installedRoot = path.join(prefix, ...(process.platform === 'win32' ? [] : ['lib']), 'node_modules', ...manifest.name.split('/'));
  assert(!(await lstat(installedRoot)).isSymbolicLink(), 'Tarball installation must be a real consumer copy, not the checkout link');
  assert.equal(JSON.parse(await readFile(path.join(installedRoot, 'package.json'), 'utf8')).version, manifest.version);
  for (const name of packedPaths) {
    assert.deepEqual(await readFile(path.join(installedRoot, name)), await readFile(path.join(root, name)), `Installed content differs from source: ${name}`);
  }
  console.log('Checking installed commands and public library exports...');
  for (const name of ['jarvis', 'jv']) assert.equal((await runShim(name, ['--version'])).stdout.trim(), manifest.version);
  assert.match((await runShim('jarvis', ['--help'])).stdout, /No API key/);
  await assert.rejects(runShim('jarvis', ['--definitely-invalid-option']), /Unknown option/);
  const snapshot = (await runShim('jv', ['--demo', '--snapshot', '--ascii', '--no-color', '--width', '80'])).stdout;
  assert.match(snapshot, /Jarvis/i);
  const files = JSON.parse((await runShim('jarvis', ['files', '--json', '--path', workspace])).stdout);
  assert(files.entries.some(file => file.name === 'hello world.txt'), 'Installed CLI must read the requested workspace');
  const require = createRequire(path.join(installedRoot, 'package.json'));
  const api = await import(pathToFileURL(require.resolve(manifest.name)).href);
  const ui = await import(pathToFileURL(require.resolve(`${manifest.name}/ui`)).href);
  for (const name of ['searchContent', 'listDirectory', 'scanStorage', 'startServer', 'ActivityLog', 'planFileAction', 'executeFileAction', 'getNetworkStatus', 'getAudioStatus', 'getSecurityStatus', 'getSystemSettings']) assert.equal(typeof api[name], 'function', `Missing library export ${name}`);
  assert.equal(typeof ui.renderDashboard, 'function');
  assert.equal(api.getAbout().version, manifest.version);
  assert((await api.listDirectory(workspace)).entries.some(file => file.name === 'hello world.txt'));
  console.log('Checking packaged browser assets and API authentication...');
  server = await api.startServer({ root: workspace, demo: true, activity: { append: async () => {}, read: async () => [] } });
  const base = new URL(server.url).origin;
  for (const [route, type] of [['/', 'text/html'], ['/app.js', 'javascript'], ['/styles.css', 'text/css']]) {
    const response = await fetch(base + route, { signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200, `Installed browser asset ${route} must load`);
    assert(response.headers.get('content-type')?.includes(type));
    assert((await response.text()).length > 100);
  }
  assert.equal((await fetch(`${base}/api/about`, { signal: AbortSignal.timeout(10_000) })).status, 401);
  const about = await fetch(`${base}/api/about`, { headers: { authorization: `Bearer ${server.token}` }, signal: AbortSignal.timeout(10_000) });
  assert.equal(about.status, 200);
  assert.equal((await about.json()).version, manifest.version);
  await server.close(); server = null;
  const helpers = [...packedPaths].filter(file => file.endsWith('.ps1'));
  assert(helpers.length >= 4, 'Native Windows helpers must be included');
  if (process.platform === 'win32') {
    const parser = path.join(temporary, 'parse-helpers.ps1');
    await writeFile(parser, "$ErrorActionPreference='Stop'\nforeach ($sourcePath in $args) { $tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile($sourcePath,[ref]$tokens,[ref]$errors) | Out-Null; if ($errors.Count) { throw ($errors | Out-String) } }\n");
    await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', parser, ...helpers.map(file => path.join(installedRoot, file))]);
    console.log('Checking native read-only status from the installed package...');
    const native = await command(process.execPath, [path.join(root, 'scripts/verify-native.js'), installedRoot], { timeout: 150_000 });
    process.stdout.write(native.stdout);
  }
  console.log('Checking native helper syntax and uninstalling the isolated copy...');
  await npm(['uninstall', '--global', '--prefix', prefix, manifest.name]);
  installed = false;
  await assert.rejects(access(installedRoot), { code: 'ENOENT' });
  for (const name of ['jarvis', 'jv']) {
    const shims = process.platform === 'win32' ? [name, `${name}.cmd`, `${name}.ps1`] : [`bin/${name}`];
    for (const shim of shims) await assert.rejects(access(path.join(prefix, shim)), { code: 'ENOENT' });
  }
  const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
  if (output) {
    await mkdir(output, { recursive: true });
    await copyFile(archive, path.join(output, packed.filename), constants.COPYFILE_EXCL);
    await writeFile(path.join(output, 'SHA256SUMS'), `${digest}  ${packed.filename}\n`, { flag: 'wx' });
    await writeFile(path.join(output, 'release-manifest.json'), JSON.stringify({ name: manifest.name, version: manifest.version,
      archive: packed.filename, sha256: digest, npmIntegrity: packed.integrity, files: packed.files.map(({ path: name, size }) => ({ path: name, size })),
      validation: { node: process.version, platform: process.platform, architecture: process.arch, offlineInstall: true, uninstall: true, commandShims: ['jarvis', 'jv'], library: true, browser: true, nativeHelpersParsed: process.platform === 'win32', nativeReadOnlyStatus: process.platform === 'win32' },
      ...(process.env.GITHUB_SHA ? { commit: process.env.GITHUB_SHA } : {}) }, null, 2) + '\n', { flag: 'wx' });
  }
  console.log(`Package verified: ${manifest.name}@${manifest.version}; ${packedPaths.size} files; offline install/uninstall, both commands, library, browser and ${helpers.length} native helpers. SHA-256 ${digest}`);
  success = true;
} finally {
  await server?.close();
  if (installed) await npm(['uninstall', '--global', '--prefix', prefix, manifest.name]).catch(() => {});
  // Only remove the unique temporary directory created by this invocation; never a user/global prefix.
  const resolved = await realpath(temporary);
  assert.equal(path.dirname(resolved), temporaryParent);
  assert(path.basename(resolved).startsWith('jarvis-package-'));
  await rm(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  if (!success) process.exitCode = 1;
}
