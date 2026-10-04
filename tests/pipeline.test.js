import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { git, pipelineGit } from '../src/git.js';

function gitSh(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-test-'));
  gitSh(dir, ['init', '-q']);
  gitSh(dir, ['config', 'user.email', 'test@localhost']);
  gitSh(dir, ['config', 'user.name', 'Test']);
  gitSh(dir, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'README.md'), '# fixture\n');
  writeFileSync(join(dir, 'a.txt'), 'awal\n');
  gitSh(dir, ['add', '-A']);
  gitSh(dir, ['commit', '-qm', 'init']);
  return dir;
}

function configFor(dir, overrides = {}) {
  return {
    repoPath: dir,
    gitBranch: null,
    commitPrefix: 'Update via AI',
    ...overrides,
  };
}

test('git mengembalikan objek hasil, tidak pernah throw saat gagal', async () => {
  const dir = makeRepo();
  const result = await git(['rev-parse', '--abbrev-ref', 'HEAD'], configFor(dir));
  assert.equal(result.code, 0);
  const bad = await git(['submodule-status', '/tidak/ada'], configFor(dir));
  assert.equal(typeof bad.code, 'number');
});

test('pipelineGit melewati repo yang bersih tanpa membuat commit', async () => {
  const dir = makeRepo();
  const before = gitSh(dir, ['rev-parse', 'HEAD']).trim();
  const result = await pipelineGit({ config: configFor(dir), isCancelled: () => false });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'clean');
  assert.equal(gitSh(dir, ['rev-parse', 'HEAD']).trim(), before);
});

test('pipelineGit membatalkan staging saat file sensitif terdeteksi', async () => {
  const dir = makeRepo();
  writeFileSync(join(dir, '.env'), 'BOT_TOKEN=rahasia\n');
  const result = await pipelineGit({ config: configFor(dir), isCancelled: () => false });
  assert.equal(result.code, 'sensitive');
  assert.equal(gitSh(dir, ['status', '--porcelain']).includes('.env'), true);
});

test('pipelineGit menolak HEAD detached', async () => {
  const dir = makeRepo();
  const sha = gitSh(dir, ['rev-parse', 'HEAD']).trim();
  gitSh(dir, ['checkout', '-q', '--detach', sha]);
  writeFileSync(join(dir, 'a.txt'), 'ubah\n');
  const result = await pipelineGit({ config: configFor(dir), isCancelled: () => false });
  assert.equal(result.code, 'detached');
});

test('pipelineGit menolak branch tanpa upstream', async () => {
  const dir = makeRepo();
  writeFileSync(join(dir, 'a.txt'), 'ubah\n');
  const result = await pipelineGit({ config: configFor(dir), isCancelled: () => false });
  assert.equal(result.code, 'no-upstream');
  assert.equal(gitSh(dir, ['rev-parse', '--verify', 'HEAD']).trim().length > 0, true);
  assert.match(gitSh(dir, ['log', '-1', '--pretty=%s']), /Update via AI/);
});

test('pipelineGit berhenti sebelum commit saat dibatalkan', async () => {
  const dir = makeRepo();
  writeFileSync(join(dir, 'a.txt'), 'ubah\n');
  const result = await pipelineGit({ config: configFor(dir), isCancelled: () => true });
  assert.equal(result.ok, false);
  assert.equal(gitSh(dir, ['log', '-1', '--pretty=%s']).includes('Update via AI'), false);
});

test('pipelineGit membuat commit dan push dengan sukses', async () => {
  const dir = makeRepo();
  const origin = mkdtempSync(join(tmpdir(), 'bridge-origin-'));
  gitSh(origin, ['init', '-q', '--bare']);
  gitSh(dir, ['remote', 'add', 'origin', origin]);
  gitSh(dir, ['checkout', '-qb', 'test-branch']);
  gitSh(dir, ['push', '-q', '-u', 'origin', 'test-branch']);
  writeFileSync(join(dir, 'a.txt'), 'ubah\n');
  const result = await pipelineGit({ config: configFor(dir), isCancelled: () => false });
  assert.equal(result.ok, true);
  assert.equal(result.branch, 'test-branch');
  assert.equal(result.sha.length, 7);
  assert.match(result.message, /test-branch/);
  assert.deepEqual(result.files, ['M a.txt']);
});

test('git() menandai timeout saat proses git menggantung', async () => {
  const dir = makeRepo();
  const shimDir = mkdtempSync(join(tmpdir(), 'bridge-hang-'));
  const shim = join(shimDir, 'git');
  writeFileSync(shim, "#!/bin/sh\nsleep 60\n");
  chmodSync(shim, 0o755);
  const realPath = process.env.PATH;
  process.env.PATH = `${shimDir}:${realPath}`;
  try {
    const result = await git(['status'], configFor(dir, { gitTimeoutMs: 1500 }));
    assert.equal(result.timedOut, true);
    assert.equal(result.code, null);
  } finally {
    process.env.PATH = realPath;
  }
});

test('git() menaikkan ke SIGKILL saat proses git mengabaikan SIGINT', async () => {
  const dir = makeRepo();
  const shimDir = mkdtempSync(join(tmpdir(), 'bridge-shim-'));
  const shim = join(shimDir, 'git');
  writeFileSync(shim, "#!/bin/sh\ntrap '' INT\nsleep 60\n");
  chmodSync(shim, 0o755);
  const realPath = process.env.PATH;
  process.env.PATH = `${shimDir}:${realPath}`;
  try {
    const result = await git(['status'], configFor(dir, { gitTimeoutMs: 200 }));
    assert.equal(result.timedOut, true);
    assert.equal(result.signal, 'SIGKILL');
  } finally {
    process.env.PATH = realPath;
  }
});

const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

function installGitShim(hangOn) {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-shim-'));
  const shim = join(dir, 'git');
  writeFileSync(
    shim,
    `#!/bin/sh\nif [ "$1" = "${hangOn}" ]; then trap '' INT; sleep 60; fi\nexec ${realGit} "$@"\n`,
  );
  chmodSync(shim, 0o755);
  process.env.PATH = `${dir}:${realGit.replace(/\/[^/]+$/, '')}`;
  return () => {
    process.env.PATH = realGit.replace(/\/[^/]+$/, '');
  };
}

test('pipelineGit membatalkan staging dan melapor saat git add timeout', async () => {
  const dir = makeRepo();
  writeFileSync(join(dir, 'a.txt'), 'ubah\n');
  const restore = installGitShim('add');
  const result = await pipelineGit({
    config: configFor(dir, { gitTimeoutMs: 1500 }),
    isCancelled: () => false,
  });
  restore();
  assert.equal(result.ok, false);
  assert.equal(result.code, 'git-timeout');
  assert.equal(gitSh(dir, ['diff', '--cached', '--name-only']).trim(), '', 'staging harus dibersihkan');
});

test('pipelineGit memberi perintah manual saat git push timeout', async () => {
  const dir = makeRepo();
  const origin = mkdtempSync(join(tmpdir(), 'bridge-origin-'));
  gitSh(origin, ['init', '-q', '--bare']);
  gitSh(dir, ['remote', 'add', 'origin', origin]);
  gitSh(dir, ['checkout', '-qb', 'test-branch']);
  gitSh(dir, ['push', '-q', '-u', 'origin', 'test-branch']);
  writeFileSync(join(dir, 'a.txt'), 'ubah\n');

  const restore = installGitShim('push');
  const result = await pipelineGit({
    config: configFor(dir, { gitTimeoutMs: 1500 }),
    isCancelled: () => false,
  });
  restore();
  assert.equal(result.ok, false);
  assert.equal(result.code, 'git-timeout');
  assert.match(result.message, /git -C .* push/);
});

test('pipelineGit melewati screening file sensitif bila force aktif', async () => {
  const dir = makeRepo();
  const origin = mkdtempSync(join(tmpdir(), 'bridge-origin-'));
  gitSh(origin, ['init', '-q', '--bare']);
  gitSh(dir, ['remote', 'add', 'origin', origin]);
  gitSh(dir, ['checkout', '-qb', 'test-branch']);
  gitSh(dir, ['push', '-q', '-u', 'origin', 'test-branch']);
  writeFileSync(join(dir, '.env'), 'BOT_TOKEN=rahasia\n');

  const result = await pipelineGit({
    config: configFor(dir),
    isCancelled: () => false,
    force: true,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.bypassedSensitiveFiles, ['.env']);
});

test('pipelineGit tanpa force tetap memblokir file sensitif', async () => {
  const dir = makeRepo();
  writeFileSync(join(dir, '.env'), 'BOT_TOKEN=rahasia\n');
  const result = await pipelineGit({ config: configFor(dir), isCancelled: () => false });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'sensitive');
  assert.deepEqual(result.bypassedSensitiveFiles, []);
});
