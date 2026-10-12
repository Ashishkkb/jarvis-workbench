import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runProjectScript } from '../src/tasks.js';

async function fixture(t, scripts) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jarvis-tasks-'));
  t.after(async () => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(root).startsWith('jarvis-tasks-'));
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'jarvis-task-fixture', version: '1.0.0', private: true, scripts }));
  await writeFile(path.join(root, 'output.cjs'), "process.stdout.write('JARVIS_FIXTURE_OUTPUT\\n');\n");
  return root;
}

test('runs an explicitly selected fixture script and streams its output', async t => {
  const root = await fixture(t, { inspect: 'node output.cjs' });
  const chunks = [];
  const result = await runProjectScript(root, 'inspect', { onOutput: (chunk, stream) => chunks.push({ chunk, stream }) });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /JARVIS_FIXTURE_OUTPUT/);
  assert.ok(chunks.some(item => item.stream === 'stdout' && item.chunk.includes('JARVIS_FIXTURE_OUTPUT')));
});

test('script names containing shell metacharacters stay literal arguments', async t => {
  const scriptName = 'report & node marker.cjs';
  const root = await fixture(t, { [scriptName]: 'node output.cjs' });
  await writeFile(path.join(root, 'marker.cjs'), "require('node:fs').writeFileSync('unwanted-marker', 'unexpected');\n");
  const result = await runProjectScript(root, scriptName);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /JARVIS_FIXTURE_OUTPUT/);
  await assert.rejects(access(path.join(root, 'unwanted-marker')));
});

test('rejects missing scripts and invalid names before running npm', async t => {
  const root = await fixture(t, { inspect: 'node output.cjs' });
  for (const name of ['', ' ', '-inspect', '--version', 'inspect\0', 'inspect\n', null, 12]) {
    await assert.rejects(runProjectScript(root, name), error => error.code === 'INVALID_SCRIPT');
  }
  await assert.rejects(runProjectScript(root, 'missing & node marker.cjs'), error => error.code === 'SCRIPT_NOT_FOUND');
});

test('re-reads package.json so a removed script cannot run from a stale selection', async t => {
  const root = await fixture(t, { inspect: 'node output.cjs' });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: {} }));
  await assert.rejects(runProjectScript(root, 'inspect'), error => error.code === 'SCRIPT_NOT_FOUND');
});

test('preserves a script’s nonzero exit status for the dashboard', async t => {
  const root = await fixture(t, { fail: 'node fail.cjs' });
  await writeFile(path.join(root, 'fail.cjs'), "process.stderr.write('FIXTURE_FAILURE\\n'); process.exitCode = 7;\n");
  const result = await runProjectScript(root, 'fail');
  assert.equal(result.code, 7);
  assert.match(result.stderr, /FIXTURE_FAILURE/);
});

test('a pre-cancelled script never starts', async t => {
  const root = await fixture(t, { inspect: 'node output.cjs' });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runProjectScript(root, 'inspect', { signal: controller.signal }), error => error.code === 'ABORT_ERR');
});
