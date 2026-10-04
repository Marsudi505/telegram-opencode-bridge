import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runOpencode } from '../src/git.js';

function makeSleeper() {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-sleep-'));
  const script = join(dir, 'sleeper.sh');
  writeFileSync(script, '#!/bin/sh\nsleep 60\n');
  chmodSync(script, 0o755);
  return script;
}

function makeConfig(overrides = {}) {
  return {
    opencodeBin: '/bin/echo',
    opencodeModel: null,
    opencodeAgent: null,
    aiTimeoutMs: 5000,
    repoPath: process.cwd(),
    ...overrides,
  };
}

test('runOpencode meneruskan prompt sebagai argumen terpisah, bukan string shell', async () => {
  const result = await runOpencode({ prompt: 'tambah endpoint "users"', config: makeConfig() });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /tambah endpoint "users"/);
  assert.match(result.stdout, /--auto/);
  assert.match(result.stdout, /--format/);
});

test('runOpencode menambahkan flag --model dan --agent hanya bila diisi', async () => {
  const result = await runOpencode({
    prompt: 'hi',
    config: makeConfig({ opencodeModel: '9router/Kombo1', opencodeAgent: 'build' }),
  });
  assert.match(result.stdout, /--model 9router\/Kombo1/);
  assert.match(result.stdout, /--agent build/);
});

test('runOpencode meneruskan sessionId sebagai flag --session', async () => {
  const result = await runOpencode({
    prompt: 'hi',
    config: makeConfig(),
    sessionId: 'ses_lama',
  });
  assert.match(result.stdout, /--session ses_lama/);
});

test('runOpencode melaporkan kode exit non-zero', async () => {
  const result = await runOpencode({ prompt: 'hi', config: makeConfig({ opencodeBin: '/bin/false' }) });
  assert.notEqual(result.code, 0);
});

test('runOpencode menandai cancel saat proses dibunuh SIGINT', async () => {
  const controller = new AbortController();
  const promise = runOpencode({
    prompt: 'hi',
    config: makeConfig({ opencodeBin: makeSleeper(), aiTimeoutMs: 60000 }),
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 150);
  const result = await promise;
  assert.equal(result.code, null);
  assert.equal(result.signal, 'SIGINT');
});

test('runOpencode menandai timeout dan membunuh proses', async () => {
  const result = await runOpencode({
    prompt: 'hi',
    config: makeConfig({ opencodeBin: makeSleeper(), aiTimeoutMs: 300 }),
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.signal, 'SIGINT');
});

test('runOpencode tidak melempar error saat binary tidak ditemukan', async () => {
  const result = await runOpencode({
    prompt: 'hi',
    config: makeConfig({ opencodeBin: '/bin/tidak-ada-xyz' }),
  });
  assert.match(result.stderr, /ENOENT|tidak-ada-xyz/);
});

function makeSleeperWithPidFile(pidFile) {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-sleep-pid-'));
  const script = join(dir, 'sleeper.sh');
  writeFileSync(script, `#!/bin/sh\nsleep 30 &\necho $! > ${pidFile}\nwait\n`);
  chmodSync(script, 0o755);
  return script;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('runOpencode memastikan proses cucu ikut mati, bukan hanya proses utama', async () => {
  const pidFile = join(mkdtempSync(join(tmpdir(), 'bridge-pidfile-')), 'child.pid');
  const script = makeSleeperWithPidFile(pidFile);
  const controller = new AbortController();
  const promise = runOpencode({
    prompt: 'hi',
    config: makeConfig({ opencodeBin: script, aiTimeoutMs: 60000 }),
    signal: controller.signal,
  });
  await new Promise((r) => setTimeout(r, 250));
  const childPid = Number(readFileSync(pidFile, 'utf8').trim());
  assert.ok(Number.isInteger(childPid) && childPid > 0, 'fixture harus menulis PID cucu');

  setTimeout(() => controller.abort(), 50);
  const result = await promise;
  assert.equal(result.signal, 'SIGINT');

  await new Promise((r) => setTimeout(r, 250));
  assert.equal(isAlive(childPid), false, 'proses cucu harus ikut mati setelah group kill');
});

function makeStubborn() {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-stubborn-'));
  const script = join(dir, 'stubborn.sh');
  writeFileSync(script, "#!/bin/sh\ntrap '' INT\nsleep 60\n");
  chmodSync(script, 0o755);
  return script;
}

test('runOpencode menaikkan SIGINT ke SIGKILL kalau proses mengabaikannya', async () => {
  const promise = runOpencode({
    prompt: 'hi',
    config: makeConfig({ opencodeBin: makeStubborn(), aiTimeoutMs: 200 }),
  });
  const result = await promise;
  assert.equal(result.timedOut, true);
  assert.equal(result.signal, 'SIGKILL');
});

test('runOpencode menutup stdin agar opencode tidak menunggu EOF', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-stdin-'));
  const script = join(dir, 'needs-stdin.sh');
  writeFileSync(script, '#!/bin/sh\ncat > /dev/null\nexit 0\n');
  chmodSync(script, 0o755);

  const result = await runOpencode({
    prompt: 'hi',
    config: makeConfig({ opencodeBin: script, aiTimeoutMs: 5000 }),
  });

  assert.equal(result.timedOut, false, 'proses yang butuh EOF stdin tidak boleh menggantung');
  assert.equal(result.code, 0);
});

test('runOpencode menyebutkan direktori kerja di dalam prompt', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-cwd-'));
  const dump = join(dir, 'argv.txt');
  const script = join(dir, 'dump.sh');
  writeFileSync(script, `#!/bin/sh\nprintf '%s' "$2" > ${dump}\n`);
  chmodSync(script, 0o755);

  await runOpencode({
    prompt: 'bikin file hello.txt',
    config: makeConfig({ opencodeBin: script, repoPath: dir, aiTimeoutMs: 5000 }),
  });

  const sent = readFileSync(dump, 'utf8');
  assert.match(
    sent,
    new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `prompt harus menyebut direktori kerja, dapat: ${JSON.stringify(sent)}`,
  );
});
