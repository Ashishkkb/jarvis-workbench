import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { run, commandEnvironment } from '../src/run.js';

test('ordinary commands retain their requested environment without changing the parent', async () => {
  const before = process.env.PSModulePath;
  const result = await run(process.execPath, ['-e', 'process.stdout.write(process.env.PSModulePath)'], { env: { PSModulePath: 'user-selected-module-path' } });
  assert.equal(result.stdout, 'user-selected-module-path');
  assert.equal(process.env.PSModulePath, before);
});

test('only the absolute system Windows PowerShell executable receives trusted module paths', { skip: process.platform !== 'win32' }, () => {
  const native = path.win32.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const unsafe = { PSModulePath: 'wrong-one', PSMODULEPATH: 'wrong-two', psmodulepath: 'wrong-three' };
  const value = commandEnvironment(native.toUpperCase(), unsafe);
  assert.deepEqual(Object.keys(value).filter(key => key.toLowerCase() === 'psmodulepath'), ['PSModulePath']);
  assert.equal(value.PSModulePath, path.win32.join(path.win32.dirname(native), 'Modules'));
  for (const command of ['powershell.exe', 'pwsh.exe', path.win32.join(path.dirname(process.execPath), 'powershell.exe')]) {
    assert.equal(commandEnvironment(command, { PSModulePath: 'preserved' }).PSModulePath, 'preserved');
  }
});

test('Windows native helpers load system modules despite an incompatible inherited PowerShell module', { skip: process.platform !== 'win32', timeout: 45_000 }, async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'jarvis-module-environment-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const moduleRoot = path.join(root, 'incompatible modules');
  for (const [name, commands] of [['Microsoft.PowerShell.Security', ['Get-Acl', 'Get-AuthenticodeSignature']], ['Microsoft.PowerShell.Management', ['Get-Process']], ['Microsoft.PowerShell.Utility', ['ConvertTo-Json']]]) {
    const directory = path.join(moduleRoot, name);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, name + '.psd1'), `@{ ModuleVersion='1.0.0'; RootModule='broken.psm1'; FunctionsToExport=@(${commands.map(command => `'${command}'`).join(',')}) }\n`);
    await writeFile(path.join(directory, 'broken.psm1'), "throw 'INCOMPATIBLE_MODULE_FIXTURE'\n");
  }
  const native = path.win32.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const modules = path.win32.join(path.win32.dirname(native), 'Modules');
  const probe = path.join(root, 'probe.ps1');
  await writeFile(probe, "$ErrorActionPreference='Stop'\nImport-Module Microsoft.PowerShell.Security -ErrorAction Stop\n$acl=Get-Acl -LiteralPath $PSHOME\n$signature=Get-AuthenticodeSignature -LiteralPath (Join-Path $PSHOME 'powershell.exe')\n@{ownerPresent=[bool]$acl.Owner; signatureStatus=[string]$signature.Status; module=(Get-Command Get-Acl).Module.Path; modules=$env:PSModulePath; major=$PSVersionTable.PSVersion.Major} | ConvertTo-Json -Compress\n");
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', probe];
  const polluted = `${moduleRoot};${modules}`;
  const rawEnv = { ...process.env };
  for (const key of Object.keys(rawEnv)) if (key.toLowerCase() === 'psmodulepath') delete rawEnv[key];
  rawEnv.PSModulePath = polluted;
  const execute = promisify(execFile);
  await assert.rejects(execute(native, args, { cwd: path.win32.dirname(native), env: rawEnv, windowsHide: true, timeout: 10_000 }), error => /INCOMPATIBLE_MODULE_FIXTURE/.test(error.stderr || ''));
  const result = await run(native, args, { cwd: path.win32.dirname(native), env: { PSModulePath: polluted, PSMODULEPATH: polluted }, timeout: 15_000 });
  const value = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim());
  assert.equal(value.major, 5);
  assert.equal(value.ownerPresent, true);
  assert.ok(value.signatureStatus);
  assert.ok(value.module.toLowerCase().startsWith(modules.toLowerCase() + path.win32.sep));
  assert.ok(!value.modules.toLowerCase().includes(moduleRoot.toLowerCase()));
  // Launch the public inventory APIs through Node, as happens from a PowerShell 7 terminal.
  // A fake PATH executable must also be bypassed by their fixed Windows executable paths.
  await writeFile(path.join(root, 'powershell.exe'), 'This fixture must never execute.');
  const systemUrl = new URL('../src/system.js', import.meta.url).href;
  const storageUrl = new URL('../src/storage.js', import.meta.url).href;
  const source = `import { listProcesses, listPorts } from ${JSON.stringify(systemUrl)}; import { listScanLocations } from ${JSON.stringify(storageUrl)}; const processes=await listProcesses(); const ports=await listPorts(); const drives=await listScanLocations(); console.log(JSON.stringify({self:processes.processes.some(item=>item.pid===process.pid),processWarning:processes.warning,ports:Array.isArray(ports.ports),locations:drives.length}));`;
  const inventory = await run(process.execPath, ['--input-type=module', '-e', source], { env: { PSModulePath: polluted, PATH: root }, timeout: 25_000 });
  const inspected = JSON.parse(inventory.stdout.trim());
  assert.equal(inspected.self, true, inspected.processWarning);
  assert.equal(inspected.ports, true);
  assert.ok(inspected.locations > 0);
});
