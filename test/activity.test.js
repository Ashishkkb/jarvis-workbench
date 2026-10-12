import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, writeFile, readFile, readdir, lstat, link, unlink, rm } from 'node:fs/promises';
import { ActivityLog } from '../src/activity.js';

async function fixture(t) {
  const temp = await realpath(os.tmpdir());
  const directory = await realpath(await mkdtemp(path.join(temp, 'jarvis-activity-hardening-')));
  t.after(async () => {
    const relative = path.relative(temp, directory);
    assert.ok(relative.startsWith('jarvis-activity-hardening-') && !relative.includes(path.sep));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}
async function rawRecords(directory) {
  const names = (await readdir(directory)).filter(name => /^activity\.jsonl(?:\.[12])?$/.test(name));
  const values = [];
  for (const name of names) {
    const contents = await readFile(path.join(directory, name), 'utf8');
    for (const line of contents.split('\n').filter(Boolean)) values.push(JSON.parse(line));
  }
  return values;
}

async function writer(directory, label, maxBytes, count) {
  const moduleUrl = new URL('../src/activity.js', import.meta.url).href;
  const script = `import { ActivityLog } from ${JSON.stringify(moduleUrl)};
    const [directory,label,maxBytes,count]=JSON.parse(process.argv[1]);
    const log=new ActivityLog({directory,maxBytes});
    for(let i=0;i<count;i++) await log.append({action:'parallel',message:label+':'+i,jobId:label+'-'+i});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, JSON.stringify([directory, label, maxBytes, count])], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.equal(code, 0, stderr);
}

test('independent log instances serialize rotation without malformed or duplicate records', async t => {
  const directory = await fixture(t);
  await writeFile(path.join(directory, 'unrelated.txt'), 'unrelated user data');
  const logs = [new ActivityLog({ directory, maxBytes: 1024 }), new ActivityLog({ directory, maxBytes: 1024 })];
  await Promise.all(Array.from({ length: 24 }, (_, index) => logs[index % 2].append({ action: 'rotation', message: `${index}:` + 'x'.repeat(80), jobId: `job-${index}` })));
  const last = await logs[0].append({ action: 'rotation', message: 'last committed record', jobId: 'last-job' });
  const records = await new ActivityLog({ directory, maxBytes: 1024 }).list({ limit: 1000 });
  assert.equal(records[0].id, last.id);
  assert.equal(records[0].jobId, 'last-job');
  assert.equal(new Set(records.map(record => record.id)).size, records.length);
  const raw = await rawRecords(directory);
  assert.deepEqual(new Set(raw.map(record => record.id)), new Set(records.map(record => record.id)));
  const files = (await readdir(directory)).filter(name => name.startsWith('activity.jsonl'));
  assert.equal(files.length, 3);
  for (const file of files) assert.ok((await lstat(path.join(directory, file))).size <= 1024);
  assert.equal(await readFile(path.join(directory, 'unrelated.txt'), 'utf8'), 'unrelated user data');
  assert.equal((await logs[1].list({ limit: 2 })).length, 2);
});

test('separate processes retain every acknowledged append when no rotation is needed', async t => {
  const directory = await fixture(t);
  await Promise.all(['first', 'second', 'third'].map(label => writer(directory, label, 128 * 1024, 8)));
  const records = await new ActivityLog({ directory }).list({ limit: 1000 });
  assert.equal(records.length, 24);
  assert.equal(new Set(records.map(record => record.id)).size, 24);
  const expected = ['first', 'second', 'third'].flatMap(label => Array.from({ length: 8 }, (_, index) => `${label}:${index}`));
  assert.deepEqual(records.map(record => record.message).sort(), expected.sort());
  for (const record of records) assert.equal(record.jobId, record.message.replace(':', '-'));
  assert.equal((await rawRecords(directory)).length, 24);
  assert.ok(!(await readdir(directory)).includes('.lock'));
});

test('separate processes rotate a shared log within its three-file retention bound', async t => {
  const directory = await fixture(t);
  await Promise.all(['one', 'two', 'three'].map(label => writer(directory, label, 1024, 8)));
  const raw = await rawRecords(directory);
  assert.ok(raw.length > 0 && raw.length < 24);
  assert.equal(new Set(raw.map(record => record.id)).size, raw.length);
  assert.ok(raw.every(record => /^(one|two|three):[0-7]$/.test(record.message)));
  const files = (await readdir(directory)).filter(name => /^activity\.jsonl/.test(name));
  assert.equal(files.length, 3);
  for (const file of files) assert.ok((await lstat(path.join(directory, file))).size <= 1024);
  const listed = await new ActivityLog({ directory, maxBytes: 1024 }).list({ limit: 1000 });
  assert.deepEqual(new Set(listed.map(record => record.id)), new Set(raw.map(record => record.id)));
});

test('main and rotated history hard links are refused without changing their external target', async t => {
  for (const name of ['activity.jsonl', 'activity.jsonl.1', 'activity.jsonl.2']) {
    const directory = await fixture(t);
    const external = path.join(directory, 'external.txt');
    const linked = path.join(directory, name);
    await writeFile(external, 'must remain unchanged');
    await link(external, linked);
    const log = new ActivityLog({ directory });
    await assert.rejects(log.append({ action: 'refused' }), /linked/);
    await assert.rejects(log.list(), /linked/);
    assert.equal(await readFile(external, 'utf8'), 'must remain unchanged');
    await unlink(linked);
    const appended = await log.append({ action: 'recovered', jobId: 'after-failed-append' });
    assert.equal((await log.list())[0].id, appended.id);
  }
});

test('job correlation survives reload while secrets, control characters and unknown fields do not', async t => {
  const directory = await fixture(t);
  const log = new ActivityLog({ directory });
  const secret = 'ghp_' + 'a'.repeat(30);
  const entry = await log.append({ action: '\x1b[31mnetwork\x1b[0m', status: 'completed', message: 'Token ' + secret,
    target: 'https://name:password@example.test/path?token=private-token', jobId: 'job-123\nfinished', password: 'never-store-this', stdout: 'never-store-output' });
  assert.equal(entry.action, 'network');
  assert.equal(entry.jobId, 'job-123 finished');
  assert.doesNotMatch(await readFile(path.join(directory, 'activity.jsonl'), 'utf8'), /ghp_aaa|private-token|name:password|never-store/);
  const [loaded] = await new ActivityLog({ directory }).list();
  assert.equal(loaded.id, entry.id);
  assert.equal(loaded.jobId, 'job-123 finished');
  assert.deepEqual(Object.keys(loaded).sort(), ['action', 'id', 'jobId', 'message', 'status', 'target', 'time']);
  await log.append({ action: 'no-job', jobId: 42 });
  assert.ok(!Object.hasOwn((await log.list())[0], 'jobId'));
});

test('bounded readers recover recent complete records from a manually oversized log', async t => {
  const directory = await fixture(t);
  const record = index => JSON.stringify({ id: `id-${index}`, time: '2026-10-12T00:00:00.000Z', action: 'fixture', message: `entry-${index}`, jobId: `job-${index}` });
  const valid = Array.from({ length: 1100 }, (_, index) => record(index)).join('\n');
  await writeFile(path.join(directory, 'activity.jsonl'), 'malformed-prefix-'.repeat(150_000) + '\n' + valid + '\n{"id":"incomplete"');
  const log = new ActivityLog({ directory, maxBytes: 1024 });
  const records = await log.list({ limit: 50000 });
  assert.ok(records.length > 0 && records.length < 200);
  assert.equal(records[0].id, 'id-1099');
  assert.ok(records.every(entry => entry.action === 'fixture'));
  assert.equal((await log.list({ limit: 1 })).length, 1);
  assert.equal((await lstat(path.join(directory, 'activity.jsonl'))).size > 2 * 1024 * 1024, true);
});

test('oversized event fields are capped before persistence and retained history stays bounded', async t => {
  const directory = await fixture(t);
  const log = new ActivityLog({ directory, maxBytes: 1024 });
  for (let index = 0; index < 4; index++) await log.append({ action: 'a'.repeat(1000), status: 's'.repeat(1000), message: '?'.repeat(5000), target: '?'.repeat(5000), jobId: 'j'.repeat(500) });
  const records = await log.list({ limit: 1000 });
  assert.equal(records.length, 3);
  for (const record of records) {
    assert.ok(record.action.length <= 100 && record.status.length <= 24 && record.message.length <= 1500 && record.target.length <= 1500 && record.jobId.length <= 80);
  }
  for (const filename of (await readdir(directory)).filter(name => /^activity\.jsonl/.test(name))) {
    assert.ok((await lstat(path.join(directory, filename))).size <= 1024 + 16384);
  }
});

test('a crashed partial final line cannot swallow the next acknowledged activity event', async t => {
  const directory = await fixture(t);
  const old = { id: 'old', time: '2026-10-12T00:00:00.000Z', action: 'previous', message: 'preserved' };
  await writeFile(path.join(directory, 'activity.jsonl'), JSON.stringify(old) + '\n{"id":"interrupted","message":"half a record');
  const log = new ActivityLog({ directory });
  const next = await log.append({ action: 'new-operation', status: 'completed', jobId: 'new-job', message: 'durably acknowledged' });
  const records = await new ActivityLog({ directory }).list();
  assert.equal(records[0].id, next.id);
  assert.equal(records[0].jobId, 'new-job');
  assert.ok(records.some(record => record.id === 'old'));
});
