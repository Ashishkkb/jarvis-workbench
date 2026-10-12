import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from '../src/run.js';
import { ActivityLog } from '../src/activity.js';

test('runner passes literal arguments and bounds output', async () => {
  const literal = '$(whoami) & echo anything; `pwd`';
  const result = await run(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', literal]);
  assert.equal(result.stdout, literal);
  await assert.rejects(run(process.execPath, ['-e', 'process.stdout.write("x".repeat(20000))'], { maxOutput: 1000 }), error => error.code === 'OUTPUT_LIMIT' && error.stdout.length <= 1000);
});

test('runner timeout terminates an owned process tree promptly', { timeout: 10000 }, async () => {
  const started = Date.now();
  const code = `const {spawn}=require('node:child_process');spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{stdio:'inherit'});setTimeout(()=>{},30000);`;
  await assert.rejects(run(process.execPath, ['-e', code], { timeout: 500, killTree: true }), error => error.code === 'TIMEOUT');
  assert.ok(Date.now() - started < 5000);
});

test('persistent activity logs redact credentials and rotate only their own files', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'jarvis-activity-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const log = new ActivityLog({ directory, maxBytes: 1024 });
  await log.append({ action: 'push', status: 'completed', message: 'https://user:secret@example.com/repo?token=hidden Bearer very-private', target: 'project' });
  const records = await log.list();
  assert.equal(records.length, 1);
  assert.doesNotMatch(JSON.stringify(records), /secret|hidden|very-private/);
  await Promise.all(Array.from({ length: 30 }, (_, i) => log.append({ action: 'test', message: `${i} ${'text '.repeat(30)}` })));
  const files = await readdir(directory);
  assert.ok(files.length <= 3);
  for (const file of files) {
    const text = await readFile(path.join(directory, file), 'utf8');
    for (const line of text.trim().split('\n')) assert.doesNotThrow(() => JSON.parse(line));
  }
  assert.equal((await new ActivityLog({ directory }).list({ limit: 1 }))[0].action, 'test');
});
