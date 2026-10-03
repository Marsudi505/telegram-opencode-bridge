import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Telegraf } from 'telegraf';
import { loadConfig, isAllowed } from './src/config.js';
import { runOpencode, git, pipelineGit } from './src/git.js';
import { splitText, formatReport } from './src/report.js';

const CHUNK_LIMIT = 4000;
const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(ROOT, 'data');
const SESSION_FILE = join(DATA_DIR, 'session.json');

const currentRun = {
  active: false,
  startedAt: 0,
  chatId: null,
  statusMessageId: null,
  controller: null,
  editSeq: 0,
  progressTimer: null,
  progressEveryMs: 15000,
};

function loadSession() {
  try {
    return JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
  } catch {
    return { sessionId: null };
  }
}

function saveSession(sessionId) {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${SESSION_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify({ sessionId }, null, 2));
  renameSync(tmp, SESSION_FILE);
}

function formatDuration(ms) {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

async function sendChunked(ctx, text, extra = {}) {
  for (const part of splitText(text, CHUNK_LIMIT)) {
    try {
      await ctx.reply(part, extra);
    } catch (error) {
      console.error(`[sendChunked] gagal mengirim: ${error.message}`);
    }
  }
}

async function updateStatus(ctx, text) {
  try {
    await ctx.telegram.editMessageText(text, currentRun.statusMessageId);
  } catch (error) {
    if (!error.message.includes('message to edit not found')) {
      console.error(`[updateStatus] ${error.message}`);
    }
  }
}

function startProgress(ctx) {
  currentRun.editSeq += 1;
  const seq = currentRun.editSeq;
  const timer = setInterval(() => {
    if (!currentRun.active || seq !== currentRun.editSeq) return;
    const elapsed = Date.now() - currentRun.startedAt;
    void updateStatus(ctx, `⏳ opencode sedang jalan… sudah ${formatDuration(elapsed)}\nTahap: Menjalankan opencode`);
  }, currentRun.progressEveryMs);
  timer.unref?.();
  return timer;
}

function stopProgress() {
  currentRun.editSeq += 1;
  if (currentRun.progressTimer) {
    clearInterval(currentRun.progressTimer);
    currentRun.progressTimer = null;
  }
}

async function runAI(ctx, prompt) {
  const config = loadConfig();
  const previousSession = loadSession().sessionId;

  currentRun.active = true;
  currentRun.startedAt = Date.now();
  currentRun.chatId = ctx.chat.id;
  currentRun.controller = new AbortController();

  try {
    return await runAIBody(ctx, prompt, config, previousSession);
  } finally {
    currentRun.active = false;
    currentRun.controller = null;
    currentRun.chatId = null;
    stopProgress();
  }
}

async function runAIBody(ctx, prompt, config, previousSession) {
  let statusMessageId;
  try {
    const status = await ctx.reply('⏳ Memproses… opencode sedang menjalankan tugas.');
    statusMessageId = status.message_id;
  } catch (error) {
    await sendChunked(ctx, `❌ Gagal mengirim pesan status: ${error.message}`);
    return;
  }
  currentRun.statusMessageId = statusMessageId;
  currentRun.progressTimer = startProgress(ctx);

  let result;
  try {
    result = await runOpencode({
      prompt,
      config,
      sessionId: previousSession,
      signal: currentRun.controller.signal,
    });
  } finally {
    stopProgress();
  }

  const elapsed = formatDuration(Date.now() - currentRun.startedAt);

  if (result.timedOut) {
    await updateStatus(ctx, `❌ Dihentikan setelah melewati batas waktu ${config.aiTimeoutMs} ms.`);
    await sendChunked(ctx, `⏱️ opencode terlalu lama (batas ${config.aiTimeoutMs} ms). Tidak ada yang di-push.`);
    return;
  }

  if (result.code === null && result.signal === 'SIGINT') {
    await updateStatus(ctx, '🚫 Dibatalkan.');
    await sendChunked(ctx, 'Dibatalkan. Tidak ada yang di-push.');
    return;
  }

  if (result.code !== 0) {
    await updateStatus(ctx, `❌ Gagal setelah ${elapsed}`);
    await sendChunked(
      ctx,
      `❌ Gagal setelah ${elapsed}\n\nTahap: Menjalankan opencode\nopencode keluar dengan kode ${result.code}:\n${result.stderr.trim() || '(tidak ada stderr)'}`,
    );
    return;
  }

  if (result.sessionId) saveSession(result.sessionId);

  await updateStatus(ctx, `✅ opencode selesai dalam ${elapsed}. Menjalankan git…`);

  const gitResult = await pipelineGit({ config, isCancelled: () => !currentRun.active });

  if (gitResult.ok) {
    await updateStatus(ctx, '✅ Berhasil push.');
    await sendChunked(
      ctx,
      formatReport({
        answer: result.answer,
        changedFiles: gitResult.files,
        sha: gitResult.sha,
        branch: gitResult.branch,
        sessionId: result.sessionId,
      }),
    );
  } else if (gitResult.code === 'clean') {
    await updateStatus(ctx, '⚠️ Tidak ada perubahan.');
    await sendChunked(ctx, '⚠️ Selesai, tapi AI tidak mengubah file apa pun.\nTidak ada commit yang dibuat.');
  } else {
    await updateStatus(ctx, '❌ Git bermasalah.');
    await sendChunked(ctx, `❌ ${gitResult.message}`);
  }
}

async function main() {
  const config = loadConfig();

  if (!existsSync(config.repoPath) || !statSync(config.repoPath).isDirectory()) {
    console.error(`REPO_PATH bukan folder yang valid: ${config.repoPath}`);
    process.exit(1);
  }
  const check = await git(['rev-parse', '--git-dir'], config);
  if (check.code !== 0) {
    console.error(`REPO_PATH bukan git repo: ${config.repoPath}`);
    process.exit(1);
  }

  mkdirSync(DATA_DIR, { recursive: true });

  const bot = new Telegraf(config.botToken);
  currentRun.progressEveryMs = config.progressEveryMs;

  bot.use((ctx, next) => {
    if (!isAllowed(ctx.from?.id, config.allowedUserIds)) {
      console.warn(`[auth] tolak user id=${ctx.from?.id}`);
      return sendChunked(ctx, '🚫 Anda tidak diizinkan memakai bot ini.');
    }
    return next();
  });

  bot.command('ai', async (ctx) => {
    const text = ctx.message.text.replace(/^\/ai(@\S+)?\s*/, '').trim();
    if (text.length === 0) {
      return sendChunked(ctx, 'Cara pakai: /ai <prompt>\nContoh: /ai tambahin endpoint users di src/server.js');
    }
    if (currentRun.active) {
      const elapsed = formatDuration(Date.now() - currentRun.startedAt);
      return sendChunked(ctx, `⏳ Masih ada proses lain yang jalan (sudah ${elapsed}).\nCoba lagi nanti, atau /cancel untuk membatalkan.`);
    }
    return runAI(ctx, text);
  });

  bot.command('cancel', (ctx) => {
    if (!currentRun.active) return sendChunked(ctx, 'Tidak ada proses yang sedang jalan.');
    currentRun.controller.abort();
    return sendChunked(ctx, '🚫 Meminta pembatalan…');
  });

  bot.command('status', (ctx) => {
    if (!currentRun.active) return sendChunked(ctx, '✅ Idle. Tidak ada proses yang jalan.');
    return sendChunked(
      ctx,
      `⏳ Sedang jalan. Sudah ${formatDuration(Date.now() - currentRun.startedAt)}.\nBatalkan dengan /cancel.`,
    );
  });

  bot.command('newsession', (ctx) => {
    saveSession(null);
    return sendChunked(ctx, '🗑 Sesi dibuang. /ai berikutnya mulai dari context kosong.');
  });

  bot.catch((error) => {
    console.error(`[bot] error tidak tertangani: ${error.message}`);
  });

  await bot.launch();
  console.log('Bot aktif. Menunggu perintah.');
}

const isEntryPoint =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntryPoint) {
  main().catch((error) => {
    console.error(`Fatal: ${error.message}`);
    process.exit(1);
  });
}

export { runAI, main, currentRun };