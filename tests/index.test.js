import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-boot-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@localhost'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
  writeFileSync(join(dir, 'a.txt'), 'x\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

function stubCtx(text = 'hi') {
  const replies = [];
  return {
    replies,
    chat: { id: 42 },
    message: { text },
    async reply(part) {
      replies.push(part);
      return { message_id: 1 };
    },
    telegram: { async editMessageText() {} },
  };
}

test('runAI melepas busy lock meski opencode gagal', async () => {
  const dir = makeRepo();
  process.env.BOT_TOKEN = '123:fake';
  process.env.ALLOWED_USER_IDS = '1484782778';
  process.env.REPO_PATH = dir;
  process.env.OPENCODE_BIN = '/nonexistent/opencode';
  process.env.AI_TIMEOUT_MS = '5000';

  const { runAI, currentRun } = await import('../index.js');
  assert.equal(currentRun.active, false);

  const ctx = stubCtx('/ai hi');
  await runAI(ctx, 'hi');

  assert.equal(currentRun.active, false, 'busy lock harus lepas setelah opencode gagal');
  assert.ok(
    ctx.replies.some((r) => r.includes('Gagal setelah')),
    `harus melaporkan kegagalan, dapat: ${JSON.stringify(ctx.replies)}`,
  );
});

test('runAI melepas busy lock meski ada error tak tertangani setelah opencode', async () => {
  const dir = makeRepo();
  const stubDir = mkdtempSync(join(tmpdir(), 'bridge-ok-'));
  const stub = join(stubDir, 'ok.sh');
  writeFileSync(stub, '#!/bin/sh\nprintf \'{"sessionID":"sess-1"}\\n\'\n');
  chmodSync(stub, 0o755);

  const dataDir = join(process.cwd(), 'data');
  mkdirSync(dataDir, { recursive: true });
  const sessionPath = join(dataDir, 'session.json');
  rmSync(sessionPath, { force: true, recursive: true });
  mkdirSync(sessionPath, { recursive: true });

  process.env.BOT_TOKEN = '123:fake';
  process.env.ALLOWED_USER_IDS = '1484782778';
  process.env.REPO_PATH = dir;
  process.env.OPENCODE_BIN = stub;
  process.env.AI_TIMEOUT_MS = '5000';

  const { runAI, currentRun } = await import('../index.js');
  const ctx = stubCtx('/ai hi');

  let threw = null;
  try {
    await runAI(ctx, 'hi');
  } catch (error) {
    threw = error;
  }
  rmSync(sessionPath, { force: true, recursive: true });

  assert.ok(threw, 'test harus memicu error tak tertangani');
  assert.equal(currentRun.active, false, 'busy lock HARUS lepas meski ada throw');
});
