const REQUIRED = ['BOT_TOKEN', 'ALLOWED_USER_IDS', 'REPO_PATH'];

const DEFAULTS = {
  OPENCODE_BIN: 'opencode',
  AI_TIMEOUT_MS: '1800000',
  PROGRESS_EVERY_MS: '15000',
  COMMIT_PREFIX: 'Update via AI',
  COMMIT_SUBJECT: 'update via bot Telegram',
  MAX_OUTPUT_CHARS: '3500',
  GIT_TIMEOUT_MS: '120000',
};

export function isAllowed(userId, allowedUserIds) {
  if (!Array.isArray(allowedUserIds) || allowedUserIds.length === 0) return false;
  if (typeof userId !== 'number' || !Number.isInteger(userId) || userId <= 0) return false;
  return allowedUserIds.includes(userId);
}

export function loadConfig(env = process.env) {
  const missing = REQUIRED.filter((key) => !env[key] || !env[key].trim());
  if (missing.length > 0) {
    throw new Error(`Variabel env wajib belum diisi: ${missing.join(', ')}`);
  }
  return {
    botToken: env.BOT_TOKEN.trim(),
    allowedUserIds: env.ALLOWED_USER_IDS.split(',')
      .map((part) => Number(part.trim()))
      .filter((value) => Number.isInteger(value) && value > 0),
    repoPath: env.REPO_PATH.trim(),
    opencodeBin: env.OPENCODE_BIN?.trim() || DEFAULTS.OPENCODE_BIN,
    opencodeModel: env.OPENCODE_MODEL?.trim() || null,
    opencodeAgent: env.OPENCODE_AGENT?.trim() || null,
    aiTimeoutMs: Number(env.AI_TIMEOUT_MS) || Number(DEFAULTS.AI_TIMEOUT_MS),
    progressEveryMs: Number(env.PROGRESS_EVERY_MS) || Number(DEFAULTS.PROGRESS_EVERY_MS),
    gitBranch: env.GIT_BRANCH?.trim() || null,
    commitPrefix: env.COMMIT_PREFIX?.trim() || DEFAULTS.COMMIT_PREFIX,
    commitSubject: env.COMMIT_SUBJECT?.trim() || DEFAULTS.COMMIT_SUBJECT,
    maxOutputChars: Number(env.MAX_OUTPUT_CHARS) || Number(DEFAULTS.MAX_OUTPUT_CHARS),
    gitTimeoutMs: Number(env.GIT_TIMEOUT_MS) || Number(DEFAULTS.GIT_TIMEOUT_MS),
  };
}
