import { spawn } from 'node:child_process';

const MAX_CAPTURE_BYTES = 5 * 1024 * 1024;
const SIGKILL_GRACE_MS = 5000;

const SENSITIVE_BASENAMES = new Set([
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'credentials',
  '.netrc',
  '.pgpass',
]);

const SENSITIVE_PATTERNS = [
  /\.env(\.|$)/,
  /\.key$/,
  /\.pem$/,
  /\.p12$/,
  /\.pfx$/,
  /\.keystore$/,
  /credentials/i,
  /service.?account/i,
  /\bsecrets?\b/i,
  /\.npmrc$/,
];

export function screenSensitiveFiles(files) {
  return files.filter((file) => {
    const normalized = file.replaceAll('\\', '/');
    const basename = normalized.split('/').pop();
    if (basename.endsWith('.example')) return false;
    if (SENSITIVE_BASENAMES.has(basename)) return true;
    return SENSITIVE_PATTERNS.some((pattern) => pattern.test(normalized));
  });
}

function buildArgs(prompt, config, sessionId) {
  const args = ['run', prompt, '--auto', '--format', 'json'];
  if (config.opencodeModel) args.push('--model', config.opencodeModel);
  if (config.opencodeAgent) args.push('--agent', config.opencodeAgent);
  if (sessionId) args.push('--session', sessionId);
  return args;
}

export function extractAnswer(stdout) {
  const lines = stdout.split('\n').filter((line) => line.trim().startsWith('{'));
  const chunks = [];
  let sessionId = null;
  for (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!sessionId && typeof event.sessionID === 'string') sessionId = event.sessionID;
    if (typeof event.text === 'string') chunks.push(event.text);
    else if (typeof event.part?.text === 'string') chunks.push(event.part.text);
  }
  const answer = chunks.join('').trim();
  return { answer: answer.length > 0 ? answer : null, sessionId };
}

function createKiller(child) {
  let killTimer = null;

  const signal = (sig) => {
    try {
      process.kill(-child.pid, sig);
      return true;
    } catch {
      try {
        child.kill(sig);
        return true;
      } catch {
        return false;
      }
    }
  };

  return {
    interrupt() {
      if (!signal('SIGINT')) return;
      clearTimeout(killTimer);
      killTimer = setTimeout(() => signal('SIGKILL'), SIGKILL_GRACE_MS);
      killTimer.unref?.();
    },
    clear() {
      clearTimeout(killTimer);
    },
  };
}

export function runOpencode({ prompt, config, sessionId, signal }) {
  return new Promise((resolve) => {
    const child = spawn(config.opencodeBin, buildArgs(prompt, config, sessionId), {
      cwd: config.repoPath,
      shell: false,
      detached: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const killer = createKiller(child);
    const killTree = () => killer.interrupt();

    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
    }, config.aiTimeoutMs);

    const onAbort = () => killTree();
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    const finish = (code, sig) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killer.clear();
      if (signal) signal.removeEventListener('abort', onAbort);
      const { answer, sessionId: nextSessionId } = extractAnswer(stdout);
      resolve({ code, signal: sig, stdout, stderr, timedOut, answer, sessionId: nextSessionId });
    };

    child.stdout.on('data', (chunk) => {
      if (stdout.length < MAX_CAPTURE_BYTES) stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < MAX_CAPTURE_BYTES) stderr += chunk;
    });
    child.on('error', (error) => {
      stderr += `\n${error.message}`;
      finish(null, null);
    });
    child.on('close', (code, sig) => finish(code, sig));
  });
}

export function git(args, config) {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd: config.repoPath, shell: false, detached: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const killer = createKiller(child);
    const timer = setTimeout(() => {
      timedOut = true;
      killer.interrupt();
    }, config.gitTimeoutMs ?? 120000);

    const finish = (code, sig) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killer.clear();
      resolve({ code, signal: sig, stdout, stderr, timedOut });
    };

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      stderr += `\n${error.message}`;
      finish(-1, null);
    });
    child.on('close', (code, sig) => finish(code, sig));
  });
}

function parsePorcelain(stdout) {
  return stdout
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => `${line.slice(0, 2).trim()} ${line.slice(3).trim()}`);
}

function firstLine(text) {
  return text.split('\n').find((line) => line.trim().length > 0) ?? '';
}

async function shortSha(config) {
  const result = await git(['rev-parse', '--short=7', 'HEAD'], config);
  return firstLine(result.stdout).trim();
}

export async function pipelineGit({ config, isCancelled, force = false }) {
  const abort = (code, message, extra = {}) => ({
    ok: false,
    code,
    message,
    files: extra.files ?? [],
    branch: extra.branch ?? null,
    sha: extra.sha ?? null,
    bypassedSensitiveFiles: extra.bypassedSensitiveFiles ?? [],
  });

  const timeoutHint = `Fase git melewati batas waktu ${config.gitTimeoutMs} ms dan prosesnya dihentikan.`;

  const timeoutAbort = (stage, extra = {}) => {
    const message = extra.afterCommit
      ? `${timeoutHint}\nTahap: ${stage}\nCommit sudah dibuat, tapi push belum selesai. Jalankan manual: git -C ${config.repoPath} push origin ${extra.branch}`
      : `${timeoutHint}\nTahap: ${stage}\nTidak ada yang di-push.`;
    return abort('git-timeout', message, extra);
  };

  if (isCancelled()) return abort('cancelled', 'Dibatalkan sebelum git dimulai.');

  const status = await git(['status', '--porcelain'], config);
  if (status.timedOut) return timeoutAbort('git status');
  const files = parsePorcelain(status.stdout);
  if (files.length === 0) {
    return abort('clean', 'Selesai, tapi AI tidak mengubah file apa pun. Tidak ada commit yang dibuat.');
  }

  const branchResult = await git(['rev-parse', '--abbrev-ref', 'HEAD'], config);
  if (branchResult.timedOut) return timeoutAbort('deteksi branch', { files });
  if (branchResult.code !== 0) {
    return abort('detached', 'Gagal membaca branch git.', { files });
  }
  const detected = firstLine(branchResult.stdout).trim();
  if (detected === 'HEAD' || detected === '') {
    return abort('detached', 'HEAD sedang detached, tidak aman untuk push otomatis.', { files });
  }
  const branch = config.gitBranch || detected;

  if (isCancelled()) return abort('cancelled', 'Dibatalkan sebelum staging.', { files, branch });

  const add = await git(['add', '-A'], config);
  if (add.timedOut) {
    await git(['reset', '-q'], config);
    return timeoutAbort('git add', { files, branch });
  }
  if (add.code !== 0) {
    return abort('add-failed', `git add gagal: ${firstLine(add.stderr)}`, { files, branch });
  }

  const staged = await git(['diff', '--cached', '--name-only'], config);
  if (staged.timedOut) {
    await git(['reset', '-q'], config);
    return timeoutAbort('git diff --cached', { files, branch });
  }
  const sensitive = screenSensitiveFiles(staged.stdout.split('\n').filter(Boolean));
  let bypassedSensitiveFiles = [];
  if (sensitive.length > 0 && force) {
    bypassedSensitiveFiles = sensitive;
  } else if (sensitive.length > 0) {
    await git(['reset', '-q'], config);
    return abort(
      'sensitive',
      `Push dibatalkan — file sensitif terdeteksi:\n${sensitive.map((file) => `  ${file}`).join('\n')}\n\nStaging dibatalkan (git reset). Tidak ada yang di-push. Perbaiki .gitignore lalu ulangi.`,
      { files, branch, bypassedSensitiveFiles },
    );
  }

  if (isCancelled()) {
    await git(['reset', '-q'], config);
    return abort('cancelled', 'Dibatalkan sebelum commit.', { files, branch });
  }

  const subject = `${config.commitPrefix}: ${config.commitSubject ?? ''}`.trimEnd();
  const commit = await git(['commit', '-m', subject], config);
  if (commit.timedOut) {
    await git(['reset', '-q'], config);
    return timeoutAbort('git commit', { files, branch });
  }
  if (commit.code !== 0) {
    await git(['reset', '-q'], config);
    return abort('commit-failed', `git commit gagal: ${firstLine(commit.stderr)}`, { files, branch });
  }

  const upstream = await git(
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
    config,
  );
  if (upstream.timedOut) {
    const sha = await shortSha(config);
    return timeoutAbort('cek upstream', { files, branch, sha, afterCommit: true });
  }
  if (upstream.code !== 0) {
    const sha = await shortSha(config);
    return abort(
      'no-upstream',
      `Commit ${sha} sudah dibuat di branch ${branch}, tapi branch ini belum punya upstream — push dibatalkan.\nJalankan manual: git -C ${config.repoPath} push -u origin ${branch}`,
      { files, branch, sha },
    );
  }

  if (isCancelled()) {
    const sha = await shortSha(config);
    return abort(
      'cancelled',
      `Dibatalkan sebelum push. Commit sudah dibuat: git -C ${config.repoPath} push -u origin ${branch}`,
      { files, branch, sha },
    );
  }

  const push = await git(['push', 'origin', branch], config);
  const sha = await shortSha(config);
  if (push.timedOut) return timeoutAbort('git push', { files, branch, sha, afterCommit: true });
  if (push.code !== 0) {
    return abort(
      'push-failed',
      `Commit ${sha} sudah dibuat, tapi push gagal.\nJalankan manual: git -C ${config.repoPath} push origin ${branch}\n${firstLine(push.stderr)}`,
      { files, branch, sha },
    );
  }

  return {
    ok: true,
    code: 'pushed',
    message: `Berhasil push ke ${branch}`,
    files,
    branch,
    sha,
    bypassedSensitiveFiles,
  };
}
