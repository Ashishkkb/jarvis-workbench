import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { searchContent } from '../src/search.js';
import { listDirectory, readPreview, analyzeDisk } from '../src/files.js';

async function fixture(t) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'jarvis-files-test-'));
  const root = path.join(base, 'project');
  await mkdir(root);
  t.after(() => rm(base, { recursive: true, force: true }));
  const file = async (relative, contents) => {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
    return target;
  };
  return { root, base, file };
}

for (const preferRipgrep of [false, true]) {
  const backend = preferRipgrep ? 'automatic backend' : 'built-in fallback';

  test(`content search keeps shell syntax literal and excludes generated/binary files (${backend})`, async t => {
    const { root, file } = await fixture(t);
    await file('source/hello.txt', 'one\nHELLO; echo $(owned)\nhello other\n');
    await file('source/binary.dat', Buffer.from('hello\0secret'));
    await file('node_modules/ignored.txt', 'hello');
    await file('.git/ignored.txt', 'hello');
    await file('dist/ignored.txt', 'hello');
    await file('huge.txt', `hello${'x'.repeat(2 * 1024 * 1024)}`);
    const exact = await searchContent(root, 'hello; echo $(owned)', { preferRipgrep });
    assert.equal(exact.matches.length, 1);
    assert.deepEqual(exact.matches[0], { path: 'source/hello.txt', line: 2, column: 1, text: 'HELLO; echo $(owned)' });
    const result = await searchContent(root, 'hello', { preferRipgrep });
    assert.equal(result.matches.length, 2);
    assert.ok(result.matches.every(match => match.path === 'source/hello.txt'));
    assert.equal(result.truncated, false);
  });

  test(`content search supports case, regex, glob, Unicode columns and limits (${backend})`, async t => {
    const { root, file } = await fixture(t);
    await file('main.js', 'alpha42\nALPHA99\n💡 alpha12\n');
    await file('nested/extra.js', 'alpha13\n');
    await file('nested/extra.txt', 'alpha14\n');
    await file('node_modules/ignored.js', 'alpha15\n');
    const result = await searchContent(root, 'alpha\\d+', { regex: true, caseSensitive: true, glob: '*.js', preferRipgrep });
    assert.equal(result.matches.length, 3);
    assert.equal(result.matches.find(match => match.line === 3).column, 4);
    const nested = await searchContent(root, 'alpha', { glob: 'nested/**/*.js', preferRipgrep });
    assert.deepEqual(nested.matches.map(match => match.path), ['nested/extra.js']);
    const rootAndNested = await searchContent(root, 'alpha', { glob: '**/*.js', preferRipgrep });
    assert.equal(rootAndNested.matches.length, 4);
    const limited = await searchContent(root, 'alpha', { maxResults: 2, preferRipgrep });
    assert.equal(limited.matches.length, 2);
    assert.equal(limited.truncated, true);
  });
}

test('search gives friendly validation errors and honors cancellation', async t => {
  const { root } = await fixture(t);
  await assert.rejects(searchContent(root, '[oops', { regex: true }), /regular expression is invalid/i);
  await assert.rejects(searchContent(root, ''), /enter some text/i);
  await assert.rejects(searchContent(root, 'two\nlines'), /one line/i);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(searchContent(root, 'hello', { signal: controller.signal }), { name: 'AbortError' });
});

test('native and built-in searches agree on regex anchors for CRLF text', async t => {
  const { root, file } = await fixture(t);
  await file('windows.txt', 'needle\r\nNEEDLE\r\nlast line\r\n');
  const expected = [{ path: 'windows.txt', line: 1, column: 1, text: 'needle' }];
  for (const preferRipgrep of [false, true]) {
    const result = await searchContent(root, 'needle$', { regex: true, caseSensitive: true, preferRipgrep });
    assert.deepEqual(result.matches, expected);
  }
});

test('ripgrep user config cannot change case, binary or symlink behavior', async t => {
  const { root, base, file } = await fixture(t);
  await file('safe.txt', 'needle');
  await file('uppercase.txt', 'NEEDLE');
  await file('binary.bin', Buffer.from('\0needle'));
  const outside = path.join(base, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'secret.txt'), 'needle');
  try { await symlink(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (!['EPERM', 'EACCES'].includes(error.code)) throw error; }
  const config = path.join(base, 'ripgrep.conf');
  await writeFile(config, '--follow\n--text\n--ignore-case\n');
  const previousConfig = process.env.RIPGREP_CONFIG_PATH;
  process.env.RIPGREP_CONFIG_PATH = config;
  try {
    const result = await searchContent(root, 'needle', { caseSensitive: true });
    assert.deepEqual(result.matches, [{ path: 'safe.txt', line: 1, column: 1, text: 'needle' }]);
  } finally {
    if (previousConfig === undefined) delete process.env.RIPGREP_CONFIG_PATH;
    else process.env.RIPGREP_CONFIG_PATH = previousConfig;
  }
});

test('a running pathological regex can be cancelled without blocking the caller', async t => {
  const { root, file } = await fixture(t);
  await file('difficult.txt', `${'a'.repeat(100000)}!`);
  const controller = new AbortController();
  const pending = searchContent(root, '(a+)+$', { regex: true, preferRipgrep: false, signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 80);
  t.after(() => clearTimeout(timer));
  await assert.rejects(pending, { name: 'AbortError' });
});

test('directory browsing sorts folders first and reports contained parent paths', async t => {
  const { root, file } = await fixture(t);
  await file('z-folder/inside.txt', 'inside');
  await file('a.txt', 'abc');
  const listing = await listDirectory(root);
  assert.equal(listing.path, '');
  assert.equal(listing.parent, null);
  assert.deepEqual(listing.entries.map(item => [item.name, item.type]), [['z-folder', 'directory'], ['a.txt', 'file']]);
  assert.equal(listing.entries[1].size, 3);
  assert.equal((await listDirectory(root, 'z-folder')).parent, '');
  await assert.rejects(listDirectory(root, '..'), /outside the project/i);
  await assert.rejects(readPreview(root, '../secret.txt'), /outside the project/i);
});

test('head and tail previews preserve line numbers and flag binary/limited content', async t => {
  const { root, file } = await fixture(t);
  await file('log.txt', 'first\nsecond\nthird\nfourth\n');
  await file('binary.bin', Buffer.from([0, 1, 2, 3]));
  await file('empty.txt', '');
  const head = await readPreview(root, 'log.txt', { maxLines: 2 });
  assert.deepEqual(head.lines, [{ number: 1, text: 'first' }, { number: 2, text: 'second' }]);
  assert.equal(head.truncated, true);
  const tail = await readPreview(root, 'log.txt', { tail: true, maxLines: 2 });
  assert.deepEqual(tail.lines, [{ number: 3, text: 'third' }, { number: 4, text: 'fourth' }]);
  assert.equal(tail.totalBytes, 26);
  assert.equal((await readPreview(root, 'binary.bin')).binary, true);
  assert.deepEqual((await readPreview(root, 'empty.txt')).lines, []);
  await assert.rejects(readPreview(root, '.'), /regular file/i);
});

test('large previews bound memory and avoid invented absolute tail line numbers', async t => {
  const { root, file } = await fixture(t);
  await file('large.log', `${'some log line\n'.repeat(50000)}last line\n`);
  const tail = await readPreview(root, 'large.log', { tail: true, maxLines: 2 });
  assert.equal(tail.truncated, true);
  assert.deepEqual(tail.lines, [{ number: null, text: 'some log line' }, { number: null, text: 'last line' }]);
});

test('tail preview retains a complete line exactly at its byte boundary', async t => {
  const { root, file } = await fixture(t);
  await file('boundary.log', `x\n${'a'.repeat(524283)}\nend\n`);
  const result = await readPreview(root, 'boundary.log', { tail: true });
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].text, `…${'a'.repeat(4000)}`);
  assert.equal(result.lines[1].text, 'end');
  assert.ok(result.lines.every(line => line.number === null));
  assert.equal(result.truncated, true);
});

test('a tail made entirely of one oversized line still shows its clipped ending', async t => {
  const { root, file } = await fixture(t);
  await file('one-line.log', `${'x'.repeat(600000)}THE END`);
  const result = await readPreview(root, 'one-line.log', { tail: true });
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].text.length, 4001);
  assert.ok(result.lines[0].text.startsWith('…'));
  assert.ok(result.lines[0].text.endsWith('THE END'));
  assert.equal(result.truncated, true);
});

test('previews reject symlink escapes and scans do not follow linked directories', async t => {
  const { root, base, file } = await fixture(t);
  await file('safe.txt', 'safe');
  const outside = path.join(base, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'secret.txt'), 'outside-content');
  try { await symlink(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Symbolic links unavailable.'); return; } throw error; }
  const listing = await listDirectory(root);
  assert.equal(listing.entries.find(item => item.name === 'linked').type, 'symlink');
  await assert.rejects(listDirectory(root, 'linked'), /outside the project/i);
  await assert.rejects(readPreview(root, 'linked/secret.txt'), /outside the project/i);
  for (const preferRipgrep of [false, true]) assert.equal((await searchContent(root, 'outside-content', { preferRipgrep })).matches.length, 0);
  const disk = await analyzeDisk(root);
  assert.equal(disk.totalBytes, 4);
  assert.equal(disk.totalFiles, 1);
  assert.equal(disk.skipped, 1);
});

test('disk analysis aggregates top-level sizes and reports bounded/incomplete scans', async t => {
  const { root, file } = await fixture(t);
  await file('source/a.txt', 'abc');
  await file('source/nested/b.txt', '12345');
  await file('readme.txt', 'hello!');
  await file('node_modules/large.txt', 'included');
  await file('.cache/stored.txt', 'cache');
  await file('.git/object.txt', 'git');
  const disk = await analyzeDisk(root);
  assert.equal(disk.totalBytes, 30);
  assert.equal(disk.totalFiles, 6);
  assert.equal(disk.truncated, false);
  assert.equal(disk.skipped, 0);
  assert.deepEqual(disk.entries.map(item => [item.name, item.bytes, item.files]), [['node_modules', 8, 1], ['source', 8, 2], ['readme.txt', 6, 1], ['.cache', 5, 1], ['.git', 3, 1]]);
  assert.equal((await analyzeDisk(root, { maxEntries: 1 })).truncated, true);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(analyzeDisk(root, { signal: controller.signal }), { name: 'AbortError' });
});
