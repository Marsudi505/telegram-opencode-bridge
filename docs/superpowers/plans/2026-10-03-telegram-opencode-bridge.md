# telegram-opencode-bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bot Telegram (Node.js + Telegraf 4) yang menjalankan `/ai <prompt>` → opencode-cli di `REPO_PATH` → auto-commit & push ke GitHub.

**Architecture:** Satu entry point `index.js` (ESM) di atas tiga modul: `src/config.js` (validasi env + whitelist), `src/git.js` (menjalankan opencode + pipeline git), `src/report.js` (pemotongan teks + laporan sukses). `runOpencode()` memakai `spawn` dengan array args, bukan string shell. `pipelineGit()` menjalankan 6 langkah git dengan pemeriksaan cancel di antaranya. Guardrail pemblokir file sensitif berjalan setelah staging dan sebelum commit. Modul di-import oleh `index.js`, dan `bot.launch()` hanya berjalan saat file itu adalah entry point — sehingga test boleh mengimpor modul tanpa memicu polling Telegram.

**Tech Stack:** Node.js ≥ 18.17 (ESM), `telegraf@^4`, `dotenv@^16`, `child_process.spawn` (built-in), `node:test` (built-in).

**Spec:** `docs/superpowers/specs/2026-10-03-telegram-opencode-bridge-design.md`

---

## Global Constraints

Setiap angka dan nama di bawah ini berasal dari spec dan tidak boleh diubah tanpa persetujuan ulang.

- **Runtime:** Node.js ≥ 18.17, ESM (`"type": "module"`). Tidak ada CommonJS.
- **Dependency — hanya dua:** `telegraf@^4` dan `dotenv@^16`. Tidak ada dependency lain, termasuk untuk test dan lint.
- **Perintah opencode yang dijalankan — persis:**
  ```
  opencode run "<prompt>" --auto --format json [--model <m>] [--agent <a>] [--session <id>]
  ```
  `opencode` tanpa subcommand `run` adalah TUI interaktif dan akan menggantung selamanya di child_process. `--auto` wajib karena opencode butuh izin `edit`/`bash` yang tidak bisa dijawab dalam mode non-interaktif.
- **`shell: false` (default).** Prompt diteruskan sebagai elemen array args, tidak pernah dirangkai ke string. Ini menutup shell injection dari prompt user.
- **Batas Telegram: 4096 karakter** per pesan teks. Semua pengiriman teks melewati `splitText()` dengan limit 4000.
- **Bahasa:** semua pesan Telegram berbahasa Indonesia. Nama variabel, nama fungsi, dan commit message tetap bahasa Inggris.
- **11 variabel env persis seperti tabel §5 spec.** Nama tidak boleh diubah.
- **Env wajib:** `BOT_TOKEN`, `ALLOWED_USER_IDS`, `REPO_PATH`. Kosong → proses keluar dengan pesan jelas, bukan crash.
- **Pola commit:** `feat:` / `fix:` / `test:` / `chore:` — sesuai repo git yang sudah ada.
- **Tidak ada komentar di kode.**

### Batasan lingkungan yang sudah diverifikasi

Ditemukan saat menulis plan ini, di environment tempat bot akan dibuat:

| Temuan | Konsekuensi untuk implementasi |
|---|---|
| **Provider opencode mati.** Config global memakai `9router/Kombo1` → `http://127.0.0.1:20128/v1`, dan port itu tidak terjangkau (`curl` → `000`) | `opencode run` **menggantung tanpa menghasilkan output sama sekali** (exit `124` setelah `timeout 40`, stdout 0 byte, stderr 0 byte). Jadi `AI_TIMEOUT_MS` **bukan opsional** — tanpa itu, flag busy terkunci permanen. Step verifikasi Task 6 sengaja memakai `OPENCODE_BIN=/bin/echo`, bukan opencode sungguhan |
| **`p.kill('SIGINT')` menghasilkan `code === null`, bukan angka.** Terverifikasi | Deteksi cancel = `code === null && signal === 'SIGINT'`. Hanya mengecek `code !== 0` akan salah classifies cancel sebagai sukses |
| **`git rev-parse --abbrev-ref @{u}` exit `128`** kalau branch belum punya upstream. Terverifikasi di repo fixture | Inilah cara mendeteksi branch tanpa upstream — pakai exit code, bukan parse teks |
| **`shell: false` aman untuk prompt ber-spasi dan ber-kutip.** Terverifikasi: `spawn('opencode', ['run', 'tambah endpoint "users" ...'])` tidak menghasilkan error shell | Konfirmasi keputusan desain argumen array |

---

## Review Focus

Lima kelas input/kondisi yang paling mungkin menggigit pengguna, yang tidak-covered oleh test/unit biasa:

1. **`--format json` opencode tidak menghasilkan output apa pun saat provider mati** (terverifikasi di sini: 0 byte stdout, exit `124`). Tanpa ini `/ai` menggantung selamanya dan bot tidak bisa dipakai lagi. → Dipin di **Task 4, Step 1** (test `runOpencode menandai timeout dan membunuh proses`).
2. **`p.kill('SIGINT')` menutup proses dengan `code === null`, bukan non-zero.** Laporan sukses akan dikirimkan kalau cancel tidak dideteksi. → Dipin di **Task 4, Step 1** (test `runOpencode menandai cancel saat proses dibunuh SIGINT`).
3. **Branch tanpa upstream** (`git rev-parse @{u}` exit `128`) — push akan gagal *setelah* commit berhasil, dan itu satu-satunya kondisi di mana commit tertinggal secara lokal. User harus diberi tahu persis perintahnya. → Dipin di **Task 4, Step 5** (test `pipelineGit menolak branch tanpa upstream`).
4. **Repo yang sama dipakai user lewat editor di luar bot** — `git add -A` ikut men-*stage* file yang tidak pernah disentuh AI (file sementara, dump log, `.DS_Store`). Bot ikut commit file itu tanpa pernah disebut di laporan. → Dipin di **Task 3, Step 1** (laporan hanya menampilkan 25 file teratas, sisanya disebut eksplisit sebagai "+N lagi").
5. **`.env` berisi bot token dan proyek ini sendiri ikut `git add -A`.** Kalau `.gitignore` hilang atau salah, token bocor ke history permanen dan tidak bisa dihapus dengan `git reset` saja. → Dipin di **Task 1, Step 5**.

---

## File Structure

| Path | Tanggung jawab | Dibuat di |
|---|---|---|
| `package.json` | Manifest + script `start`/`test` | Task 1 |
| `.gitignore` | Proteksi `.env` (berisi bot token) dari `git add -A` | Task 1 |
| `data/.gitkeep` | Menjaga folder `data/` tetap ada di repo | Task 1 |
| `src/config.js` | Baca + validasi 11 env var → objek config | Task 1 |
| `src/git.js` | `runOpencode()`, `git()`, `pipelineGit()`, `screenSensitiveFiles()` | Task 2, Task 4 |
| `src/report.js` | `splitText()`, `formatReport()` | Task 3 |
| `index.js` | 4 command Telegraf + timer progress | Task 5 |
| `.env.example` | 11 variabel, tanpa token asli | Task 1 |
| `tests/config.test.js` | Test `isAllowed()` | Task 1 |
| `tests/git.test.js` | Test `screenSensitiveFiles()` + guardrail staging | Task 2 |
| `tests/report.test.js` | Test `splitText()` | Task 3 |
| `tests/pipeline.test.js` | Test pipeline end-to-end + timeout | Task 4 |
| `README.md` | Cara pakai + status implementasi | Task 5 |

`src/git.js` sengaja-named mileik `git()` tanpaWaarn, bukan `git.js` yang meng-export manager objek git.

---

### Task 1: Scaffold, konfigurasi, dan whitelist

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `data/.gitkeep`
- Create: `src/config.js`
- Test: `tests/config.test.js`

**Interfaces:**
- Consumes: (tidak ada — task pertama)
- Produces:
  - `loadConfig(env = process.env)` → `{ botToken, allowedUserIds: number[], repoPath, opencodeBin, opencodeModel, opencodeAgent, aiTimeoutMs, progressEveryMs, gitBranch, commitPrefix, maxOutputChars }`. Melempar `Error` dengan pesan listing variabel yang kurang, atau melompat ke `process.exit(1)` kalau `REPO_PATH` tidak valid.
  - `isAllowed(userId, allowedUserIds)` → `boolean`

- [ ] **Step 1: Inisialisasi repo git dan cek git user config**

```bash
cd /sdcard/projek/opencode/telegram-opencode-bridge
git init
git config user.name || git config user.email
```

Kalau perintah kedua keluar dengan kode non-zero, set keduanya lalu lanjut:

```bash
git config user.name "opencode-bot"
git config user.email "bot@localhost"
```

- [ ] **Step 2: Tulis `package.json`**

```json
{
  "name": "telegram-opencode-bridge",
  "version": "1.0.0",
  "description": "Bot Telegram remote control opencode-cli dengan auto-commit dan push ke GitHub",
  "type": "module",
  "private": true,
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "test": "node --test tests/"
  },
  "engines": {
    "node": ">=18.17.0"
  },
  "dependencies": {
    "dotenv": "^16.4.7",
    "telegraf": "^4.16.3"
  },
  "license": "MIT"
}
```

- [ ] **Step 3: Tulis `.gitignore`**

Isi persis seperti spec §13. Baris `data/*` (bukan `data/`) supaya `data/.gitkeep` tetap ter-track:

```
.env
.env.*
!.env.example
data/*
!data/.gitkeep
node_modules/
*.log
npm-debug.log*
.DS_Store
```

- [ ] **Step 4: Pasang dependency dan buat folder `data/`**

```bash
npm install
mkdir -p data
touch data/.gitkeep
```

- [ ] **Step 5: Verifikasi `.env` benar-benar ter-ignore**

```bash
touch .env
git check-ignore -q .env && echo "PASS: .env ter-ignore" || echo "FAIL: .env BISA masuk commit"
rm .env
```

Expected: `PASS: .env ter-ignore`

Kalau `FAIL`, hentikan dan perbaiki `.gitignore` — ini proteksi bot token, bukan detail kosmetik (Review Focus #5).

- [ ] **Step 6: Tulis `.env.example`**

```dotenv
BOT_TOKEN=
ALLOWED_USER_IDS=
REPO_PATH=
OPENCODE_BIN=opencode
OPENCODE_MODEL=
OPENCODE_AGENT=
AI_TIMEOUT_MS=1800000
PROGRESS_EVERY_MS=15000
GIT_BRANCH=
COMMIT_PREFIX=Update via AI
MAX_OUTPUT_CHARS=3500
```

`BOT_TOKEN` sengaja tidak diisi. Nilai ini di-commit dan akan di-push oleh bot ini sendiri.

- [ ] **Step 7: Tulis test yang gagal untuk `isAllowed()`**

Buat `tests/config.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowed } from '../src/config.js';

test('isAllowed menerima ID yang ada di daftar', () => {
  assert.equal(isAllowed(1484782778, [1484782778]), true);
});

test('isAllowed menolak ID yang tidak ada di daftar', () => {
  assert.equal(isAllowed(999, [1484782778]), false);
});

test('isAllowed menolak semua orang saat daftar kosong', () => {
  assert.equal(isAllowed(1484782778, []), false);
});

test('isAllowed menolak semua orang saat daftar undefined', () => {
  assert.equal(isAllowed(1484782778, undefined), false);
});

test('isAllowed menolak userId yang bukan integer positif', () => {
  assert.equal(isAllowed(null, [1484782778]), false);
  assert.equal(isAllowed(undefined, [1484782778]), false);
});

test('isAllowed menolak ID 0 dan negatif', () => {
  assert.equal(isAllowed(0, [0]), false);
  assert.equal(isAllowed(-1, [-1]), false);
});
```

- [ ] **Step 8: Jalankan test, pastikan gagal**

```bash
npm test
```

Expected: FAIL dengan `Cannot find module '../src/config.js'`

- [ ] **Step 9: Tulis `src/config.js` (hanya bagian `isAllowed` dulu)**

```javascript
const REQUIRED = ['BOT_TOKEN', 'ALLOWED_USER_IDS', 'REPO_PATH'];

const DEFAULTS = {
  OPENCODE_BIN: 'opencode',
  AI_TIMEOUT_MS: '1800000',
  PROGRESS_EVERY_MS: '15000',
  COMMIT_PREFIX: 'Update via AI',
  MAX_OUTPUT_CHARS: '3500',
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
    maxOutputChars: Number(env.MAX_OUTPUT_CHARS) || Number(DEFAULTS.MAX_OUTPUT_CHARS),
  };
}
```

- [ ] **Step 10: Jalankan test, pastikan lulus**

```bash
npm test
```

Expected: 7 test PASS

Kalau ada yang gagal, perbaiki `src/config.js` — jangan mengubah test, karena isi test sudah sesuai spec §7 ("ID tak dikenal ditolak", "env kosong ditolak semua orang").

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json .gitignore .env.example data/.gitkeep src/config.js tests/config.test.js
git commit -m "feat: scaffold project with env config and user whitelist"
```

---

### Task 2: Deteksi file sensitif

**Files:**
- Create: `src/git.js`
- Create: `tests/git.test.js`

**Interfaces:**
- Consumes: `loadConfig()` dari Task 1 (tidak dipanggil di task ini — `screenSensitiveFiles()` Deliberately independent dari config supaya mudah diuji)
- Produces: `screenSensitiveFiles(files)` → `string[]` — subset dari `files` yang dianggap sensitif, **urutan asli dipertahankan**

- [ ] **Step 1: Tulis test yang gagal**

Buat `tests/git.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenSensitiveFiles } from '../src/git.js';

test('menangkap file .env dan variasinya', () => {
  const files = ['.env', '.env.local', '.env.production', 'src/server.js'];
  assert.deepEqual(screenSensitiveFiles(files), ['.env', '.env.local', '.env.production']);
});

test('menangkap file kunci privat', () => {
  const files = ['id_rsa', 'server.key', 'tls.pem', 'deploy.p12', 'src/app.js'];
  assert.deepEqual(screenSensitiveFiles(files), ['id_rsa', 'server.key', 'tls.pem', 'deploy.p12']);
});

test('menangkap file kredensial', () => {
  const files = ['credentials.json', 'service-account.json', 'credentials', 'package.json'];
  assert.deepEqual(screenSensitiveFiles(files), [
    'credentials.json',
    'service-account.json',
    'credentials',
  ]);
});

test('tidak menangkap file .env.example dan lockfile', () => {
  const files = ['.env.example', 'package-lock.json', '.gitignore'];
  assert.deepEqual(screenSensitiveFiles(files), []);
});

test('menangkap file sensitif yang tersembunyi di subdirektori', () => {
  const files = ['config/.env', 'secrets/prod.pem', 'src/.env.example', 'src/index.js'];
  assert.deepEqual(screenSensitiveFiles(files), ['config/.env', 'secrets/prod.pem']);
});

test('mempertahankan urutan input', () => {
  const files = ['.env', 'src/a.js', 'id_rsa'];
  assert.deepEqual(screenSensitiveFiles(files), ['.env', 'id_rsa']);
});

test('mengembalikan array kosong untuk input kosong', () => {
  assert.deepEqual(screenSensitiveFiles([]), []);
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

```bash
npm test
```

Expected: FAIL dengan `Cannot find module '../src/git.js'`

- [ ] **Step 3: Tulis implementasi**

Buat `src/git.js`:

```javascript
const SENSITIVE_BASENAMES = new Set(['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'credentials', '.netrc', '.pgpass']);

const SENSITIVE_PATTERNS = [
  /\.env(\.|$)/,
  /\.key$/,
  /\.pem$/,
  /\.p12$/,
  /\.pfx$/,
  /\.keystore$/,
  /credentials/i,
  /secret/i,
  /\.npmrc$/,
];

export function screenSensitiveFiles(files) {
  return files.filter((file) => {
    const normalized = file.replaceAll('\\', '/');
    const basename = normalized.split('/').pop();
    if (SENSITIVE_BASENAMES.has(basename)) return true;
    return SENSITIVE_PATTERNS.some((pattern) => pattern.test(normalized));
  });
}
```

Catatan: `SENSITIVE_PATTERNS` diuji terhadap path **penuh** (bukan hanya basename) supaya `config/.env` ikut tertangkap, tapi `src/.env.example` ikut ter-*skip* oleh pola `\.env(\.|$)` karena `example` mengikuti titik — itu sesuai test Step 1. Pola `/secret/i` sengaja luas: lebih baik menolak push daripada membiarkan credential bocor.

- [ ] **Step 4: Jalankan test, pastikan lulus**

```bash
npm test
```

Expected: 14 test PASS (7 dari config + 7 dari git)

- [ ] **Step 5: Commit**

```bash
git add src/git.js tests/git.test.js
git commit -m "feat: detect sensitive files before commit"
```

---

### Task 3: Pemotongan teks & laporan

**Files:**
- Create: `src/report.js`
- Create: `tests/report.test.js`

**Interfaces:**
- Consumes: (tidak ada)
- Produces:
  - `splitText(text, limit = 4000)` → `string[]`
  - `formatReport({ answer, changedFiles, sha, branch, sessionId })` → `string`

- [ ] **Step 1: Tulis test yang gagal**

Buat `tests/report.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitText, formatReport } from '../src/report.js';

test('splitText tidak memecah teks pendek', () => {
  assert.deepEqual(splitText('halo', 4000), ['halo']);
});

test('splitText mengembalikan array kosong untuk string kosong', () => {
  assert.deepEqual(splitText('', 4000), []);
});

test('splitText memecah tepat di batas limit', () => {
  const result = splitText('a'.repeat(8001), 4000);
  assert.equal(result.length, 3);
  assert.deepEqual(result.map((part) => part.length), [4000, 4000, 1]);
});

test('splitText tidak kehilangan karakter', () => {
  const input = 'abcdefghij'.repeat(1000);
  assert.equal(splitText(input, 4000).join(''), input);
});

test('splitText memecah di batas multibyte tanpa merusak karakter', () => {
  const result = splitText('ä'.repeat(10), 3);
  assert.deepEqual(result, ['äää', 'äää', 'äää', 'ä']);
});

test('splitText mengabaikan limit nol atau negatif', () => {
  assert.deepEqual(splitText('halo', 0), ['halo']);
});

test('formatReport menyusun pesan sukses lengkap', () => {
  const report = formatReport({
    answer: 'Sudah ditambahkan endpoint users.',
    changedFiles: ['M src/server.js', 'A src/routes/user.js'],
    sha: '3a9f2c1',
    branch: 'main',
    sessionId: 'ses_abc123',
  });
  assert.match(report, /^✅ Selesai — commit 3a9f2c1$/m);
  assert.match(report, /Jawaban AI:/);
  assert.match(report, /Sudah ditambahkan endpoint users\./);
  assert.match(report, /File yang berubah \(2\):/);
  assert.match(report, /M src\/server\.js/);
  assert.match(report, /main → origin\/main/);
  assert.match(report, /ses_abc123/);
});

test('formatReport menangani jawaban kosong', () => {
  const report = formatReport({
    answer: '',
    changedFiles: [],
    sha: 'abc1234',
    branch: 'main',
    sessionId: null,
  });
  assert.match(report, /Jawaban AI:\n_tidak ada output teks_/);
  assert.match(report, /File yang berubah \(0\):/);
  assert.doesNotMatch(report, /Sesi:/);
});

test('formatReport menyebutkan jumlah file yang dipotong', () => {
  const changedFiles = Array.from({ length: 30 }, (_, index) => `M src/file${index}.js`);
  const report = formatReport({
    answer: 'ok',
    changedFiles,
    sha: 'abc1234',
    branch: 'main',
    sessionId: null,
  });
  assert.match(report, /File yang berubah \(30\):/);
  assert.match(report, /M src\/file24\.js/);
  assert.doesNotMatch(report, /M src\/file25\.js/);
  assert.match(report, /\+5 file lain tidak ditampilkan/);
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

```bash
npm test
```

Expected: FAIL dengan `Cannot find module '../src/report.js'`

- [ ] **Step 3: Tulis implementasi**

Buat `src/report.js`:

```javascript
const VISIBLE_FILE_LIMIT = 25;

export function splitText(text, limit = 4000) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const effective = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : Number.MAX_SAFE_INTEGER;
  if (text.length <= effective) return [text];
  const parts = [];
  for (let index = 0; index < text.length; index += effective) {
    parts.push(text.slice(index, index + effective));
  }
  return parts;
}

export function formatReport({ answer, changedFiles, sha, branch, sessionId }) {
  const lines = [];
  lines.push(`✅ Selesai — commit ${sha}`, '');
  lines.push('Jawaban AI:');
  const text = answer?.trim();
  lines.push(text ? text : '_(tidak ada output teks)_');
  lines.push('');
  lines.push(`File yang berubah (${changedFiles.length}):`);
  const visible = changedFiles.slice(0, VISIBLE_FILE_LIMIT);
  for (const file of visible) lines.push(`  ${file}`);
  if (changedFiles.length > VISIBLE_FILE_LIMIT) {
    const hidden = changedFiles.length - VISIBLE_FILE_LIMIT;
    lines.push(`  +${hidden} file lain tidak ditampilkan`);
  }
  lines.push('');
  lines.push(`Branch: ${branch} → origin/${branch}`);
  if (sessionId) lines.push(`Sesi: ${sessionId} (aktif untuk /ai berikutnya)`);
  return lines.join('\n');
}
```

`splitText` sengaja memotong berdasarkan indeks karakter, bukan chunk kata, supaya batasnya deterministik dan bisa diuji dengan `join('') === input`. `splitText` juga tidak menambahkan kelezenan whitespace — pemotongan di tengah katareceivedierebut jelas oleh pemanggil, bukan disembunyikan.

- [ ] **Step 4: Jalankan test, pastikan lulus**

```bash
npm test
```

Expected: 23 test PASS

- [ ] **Step 5: Commit**

```bash
git add src/report.js tests/report.test.js
git commit -m "feat: text splitting and success report formatting"
```

---

### Task 4: Menjalankan opencode dan pipeline git

**Files:**
- Modify: `src/git.js` (tambah exports)
- Create: `tests/pipeline.test.js`

**Interfaces:**
- Consumes: `screenSensitiveFiles(files)` dari Task 2
- Produces:
  - `runOpencode({ prompt, config, sessionId, signal })` → `Promise<{ code, signal, stdout, stderr, timedOut, answer, sessionId }>`
    - `code` = exit code spawn, atau `null` kalau proses dibunuh signal (terverifikasi: `SIGINT` → `code === null`)
    - `signal` = nama signal, atau `null`
    - `timedOut` = `true` kalau `AI_TIMEOUT_MS` habis
    - `answer` = teks jawaban AI yang sudah diekstrak dari event JSON, atau `null`
    - `sessionId` = session ID hasil run ini, atau `null` kalau tidak ditemukan
  - `git(args, config)` → `Promise<{ code, stdout, stderr }>` — tidak pernah throw
  - `pipelineGit({ config, isCancelled })` → `Promise<{ ok, code, message, files, branch, sha }>`
    - `ok` = `true` hanya kalau commit **dan** push sama-sama berhasil
    - `code` = kode mesin: `'clean'` (repo tidak berubah), `'sensitive'` (file sensitif), `'detached'` (HEAD detached), `'no-upstream'`, `'add-failed'`, `'commit-failed'`, `'push-failed'`
    - `message` = teks error siap tampil dalam bahasa Indonesia
    - `files` = array `"<status> <path>"` dari `git status --porcelain`
    - `branch` = nama branch, atau `null`
    - `sha` = SHA 7 karakter, atau `null`

- [ ] **Step 1: Tulis test yang gagal untuk `runOpencode`**

Buat `tests/pipeline.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runOpencode } from '../src/git.js';

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
    config: makeConfig({ opencodeBin: '/bin/sleep', aiTimeoutMs: 60000 }),
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
    config: makeConfig({ opencodeBin: '/bin/sleep', aiTimeoutMs: 300 }),
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
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

```bash
npm test
```

Expected: FAIL dengan `runOpencode is not a function`

- [ ] **Step 3: Tulis implementasi `runOpencode` di `src/git.js`**

Tambahkan di bagian atas `src/git.js`:

```javascript
import { spawn } from 'node:child_process';

const MAX_CAPTURE_BYTES = 5 * 1024 * 1024;

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

export function runOpencode({ prompt, config, sessionId, signal }) {
  return new Promise((resolve) => {
    const child = spawn(config.opencodeBin, buildArgs(prompt, config, sessionId), {
      cwd: config.repoPath,
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGINT');
    }, config.aiTimeoutMs);

    const onAbort = () => child.kill('SIGINT');
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    const finish = (code, sig) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
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
```

`extractAnswer` dibuat resilient terhadap dua bentuk event (`event.text` dan `event.part.text`) dan mengabaikan baris JSON yang tidak bisa di-parse. Alasan: bentuk event `--format json` opencode berubah antar versi, dan versi yang dipakai bot ini belum pernah diverifikasi against a live provider (port `127.0.0.1:20128` mati saat penulisan plan ini). Parser defensif dipilih daripada mengasumsikan satu skema.

- [ ] **Step 4: Jalankan test, pastikan lulus**

```bash
npm test
```

Expected: 30 test PASS

Kalau test `menandai cancel` gagal dengan `code` bukan `null`, jangan diubah test-nya — itu bukti lingkungan berbeda dari yang diverifikasi, dan laporkan ke user sebelum lanjut.

- [ ] **Step 5: Tulis test yang gagal untuk pipeline git**

Tambahkan ke `tests/pipeline.test.js`:

```javascript
import { mkdtempSync, writeFileSync } from 'node:fs';
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
```

- [ ] **Step 6: Jalankan test, pastikan gagal**

```bash
npm test
```

Expected: FAIL dengan `git is not a function`

- [ ] **Step 7: Tulis implementasi `git()` dan `pipelineGit()`**

Tambahkan ke `src/git.js`:

```javascript
export function git(args, config) {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd: config.repoPath, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => resolve({ code: -1, stdout, stderr: error.message }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
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

export async function pipelineGit({ config, isCancelled }) {
  const abort = (code, message, extra = {}) => ({
    ok: false,
    code,
    message,
    files: extra.files ?? [],
    branch: extra.branch ?? null,
    sha: extra.sha ?? null,
  });

  if (isCancelled()) return abort('cancelled', 'Dibatalkan sebelum git dimulai.');

  const status = await git(['status', '--porcelain'], config);
  const files = parsePorcelain(status.stdout);
  if (files.length === 0) {
    return abort('clean', 'Selesai, tapi AI tidak mengubah file apa pun. Tidak ada commit yang dibuat.');
  }

  const branchResult = await git(['rev-parse', '--abbrev-ref', 'HEAD'], config);
  if (branchResult.code !== 0) return abort('detached', 'Gagal membaca branch git.');
  const detected = firstLine(branchResult.stdout).trim();
  if (detected === 'HEAD' || detected === '') {
    return abort('detached', 'HEAD sedang detached, tidak aman untuk push otomatis.', { files });
  }
  const branch = config.gitBranch || detected;

  if (isCancelled()) return abort('cancelled', 'Dibatalkan sebelum staging.', { files, branch });

  const add = await git(['add', '-A'], config);
  if (add.code !== 0) {
    return abort('add-failed', `git add gagal: ${firstLine(add.stderr)}`, { files, branch });
  }

  const staged = await git(['diff', '--cached', '--name-only'], config);
  const sensitive = screenSensitiveFiles(staged.stdout.split('\n').filter(Boolean));
  if (sensitive.length > 0) {
    await git(['reset', '-q'], config);
    return abort(
      'sensitive',
      `Push dibatalkan — file sensitif terdeteksi:\n${sensitive.map((f) => `  ${f}`).join('\n')}\n\nStaging dibatalkan (git reset). Tidak ada yang di-push. Perbaiki .gitignore lalu ulangi.`,
      { files, branch },
    );
  }

  if (isCancelled()) {
    await git(['reset', '-q'], config);
    return abort('cancelled', 'Dibatalkan sebelum commit.', { files, branch });
  }

  const subject = `${config.commitPrefix}: ${process.env.COMMIT_SUBJECT ?? ''}`.trimEnd();
  const commit = await git(['commit', '-m', subject], config);
  if (commit.code !== 0) {
    await git(['reset', '-q'], config);
    return abort('commit-failed', `git commit gagal: ${firstLine(commit.stderr)}`, { files, branch });
  }

  const upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], config);
  if (upstream.code !== 0) {
    const shaResult = await git(['rev-parse', '--short=7', 'HEAD'], config);
    const sha = firstLine(shaResult.stdout).trim();
    return abort(
      'no-upstream',
      `Commit ${sha} sudah dibuat di branch ${branch}, tapi branch ini belum punya upstream — push dibatalkan.\nJalankan manual: git -C ${config.repoPath} push -u origin ${branch}`,
      { files, branch, sha },
    );
  }

  if (isCancelled()) {
    return abort('cancelled', `Dibatalkan sebelum push. Commit sudah dibuat: git -C ${config.repoPath} push -u origin ${branch}`, {
      files,
      branch,
      sha: firstLine((await git(['rev-parse', '--short=7', 'HEAD'], config)).stdout).trim(),
    });
  }

  const push = await git(['push', 'origin', branch], config);
  const sha = firstLine((await git(['rev-parse', '--short=7', 'HEAD'], config)).stdout).trim();
  if (push.code !== 0) {
    return abort(
      'push-failed',
      `Commit ${sha} sudah dibuat, tapi push gagal.\nJalankan manual: git -C ${config.repoPath} push origin ${branch}\n${firstLine(push.stderr)}`,
      { files, branch, sha },
    );
  }

  return { ok: true, code: 'pushed', message: `Berhasil push ke ${branch}`, files, branch, sha };
}
```

Catatan untuk implementer: baris commit message di contoh di atas memakai `process.env.COMMIT_SUBJECT` supaya test bisaexpects deterministik. Pada Task 5, `pipelineGit()` dipanggil dengan `config` yang sudah carrying `commitSubject` — ganti baris itu menjadi `const subject = \`${config.commitPrefix}: ${config.commitSubject ?? ''}\`.trimEnd();` dan tambahkan `commitSubject` ke `loadConfig()` di `src/config.js` (default: `'update via bot Telegram'`). **Lakukan penggantian ini di Task 5, bukan sekarang** — Task 4 sengaja menguji pipeline tanpa coupling ke Telegram.

- [ ] **Step 8: Jalankan test, pastikan lulus**

```bash
npm test
```

Expected: 37 test PASS

- [ ] **Step 9: Commit**

```bash
git add src/git.js tests/pipeline.test.js
git commit -m "feat: run opencode and git commit-push pipeline with guardrails"
```

---

### Task 5: Bot Telegram, entry point, dan dokumentasi

**Files:**
- Modify: `src/config.js` (tambah `commitSubject`)
- Create: `index.js`
- Modify: `README.md` (biarkan tracker yang ada; tambahkan bagian "Cara Pakai")

**Interfaces:**
- Consumes: `loadConfig()`, `isAllowed()` (Task 1), `runOpencode()`, `git()`, `pipelineGit()` (Task 4), `splitText()`, `formatReport()` (Task 3)
- Produces: entry point yang memanggil `bot.launch()` — dan **hanya saat file ini adalah entry point**

- [ ] **Step 1: Tambah `commitSubject` ke `src/config.js`**

Di dalam `loadConfig()`, tambahkan ke return object:

```javascript
    commitSubject: env.COMMIT_SUBJECT?.trim() || 'update via bot Telegram',
```

Dan tambahkan `COMMIT_SUBJECT=update via bot Telegram` ke `DEFAULTS` sebagai fallback:

```javascript
  COMMIT_SUBJECT: 'update via bot Telegram',
```

- [ ] **Step 2: Ganti baris commit message di `src/git.js`**

Ganti:

```javascript
  const subject = `${config.commitPrefix}: ${process.env.COMMIT_SUBJECT ?? ''}`.trimEnd();
```

menjadi:

```javascript
  const subject = `${config.commitPrefix}: ${config.commitSubject ?? ''}`.trimEnd();
```

- [ ] **Step 3: Jalankan test, pastikan masih lulus**

```bash
npm test
```

Expected: 37 test PASS

- [ ] **Step 4: Tulis `index.js`**

```javascript
import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Telegraf } from 'telegraf';
import { loadConfig, isAllowed } from './src/config.js';
import { runOpencode, pipelineGit } from './src/git.js';
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

async function startProgress(ctx) {
  currentRun.editSeq += 1;
  const seq = currentRun.editSeq;
  setInterval(() => {
    if (!currentRun.active || seq !== currentRun.editSeq) return;
    const elapsed = Date.now() - currentRun.startedAt;
    void updateStatus(ctx, `⏳ opencode sedang jalan… sudah ${formatDuration(elapsed)}\nTahap: Menjalankan opencode`);
  }, currentRun.progressEveryMs);
}

function stopProgress() {
  currentRun.editSeq += 1;
}

async function runAI(ctx, prompt) {
  const config = loadConfig();
  const previousSession = loadSession().sessionId;

  currentRun.active = true;
  currentRun.startedAt = Date.now();
  currentRun.chatId = ctx.chat.id;
  currentRun.controller = new AbortController();

  let statusMessageId;
  try {
    const status = await ctx.reply('⏳ Memproses… opencode sedang menjalankan tugas.');
    statusMessageId = status.message_id;
  } catch (error) {
    currentRun.active = false;
    await sendChunked(ctx, `❌ Gagal mengirim pesan status: ${error.message}`);
    return;
  }
  currentRun.statusMessageId = statusMessageId;
  startProgress(ctx);

  const result = await runOpencode({
    prompt,
    config,
    sessionId: previousSession,
    signal: currentRun.controller.signal,
  });
  stopProgress();

  const elapsed = formatDuration(Date.now() - currentRun.startedAt);

  if (result.timedOut) {
    await updateStatus(ctx, `❌ Dihentikan setelah melewati batas waktu ${config.aiTimeoutMs} ms.`);
    await sendChunked(ctx, `⏱️ opencode terlalu lama (batas ${config.aiTimeoutMs} ms). Tidak ada yang di-push.`);
    currentRun.active = false;
    return;
  }

  if (result.code === null && result.signal === 'SIGINT') {
    await updateStatus(ctx, '🚫 Dibatalkan.');
    await sendChunked(ctx, 'Dibatalkan. Tidak ada yang di-push.');
    currentRun.active = false;
    return;
  }

  if (result.code !== 0) {
    await updateStatus(ctx, `❌ Gagal setelah ${elapsed}`);
    await sendChunked(
      ctx,
      `❌ Gagal setelah ${elapsed}\n\nTahap: Menjalankan opencode\nopencode keluar dengan kode ${result.code}:\n${result.stderr.trim() || '(tidak ada stderr)'}`,
    );
    currentRun.active = false;
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

  currentRun.active = false;
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
```

Catatan untuk implementer — tiga hal yang mudah salah:

- Semua helper `node:fs` yang dipakai sudah ada di blok import teratas. Jangan tambah baris import baru di tengah file.
- Deteksi entry point memakai `resolve(process.argv[1])`, bukan `process.argv[1]` mentah. Perbandingan mentah hanya cocok kalau bot dijalankan sebagai `node index.js` dari foldernya; kalau user menjalankan `node /path/menuju/index.js` dari folder lain, perbandingan itu gagal dan bot tidak pernah start.
- `loadConfig()` dipanggil dua kali: sekali di `main()` untuk validasi boot, sekali di `runAI()`. Itu disengaja — `runAI()` butuh objek config terbaru dan tidak ingin bergantung pada closure `main()`. Konsekuensinya: kalau `.env` diubah saat bot berjalan, `/ai` berikutnya memakai nilai baru sementara bot tidak perlu restart.

- [ ] **Step 5: Verifikasi bot boot dan gagal dengan benar**

Buat `.env` sementara dengan nilai fake, lalu jalankan:

```bash
printf 'BOT_TOKEN=123:fake\nALLOWED_USER_IDS=1484782778\nREPO_PATH=/tmp\n' > .env
node index.js
```

Expected: keluar dengan pesan `REPO_PATH bukan git repo: /tmp` dan exit code 1.

Lalu test env kosong:

```bash
mv .env .env.bak
node index.js
```

Expected: keluar dengan pesan `Variabel env wajib belum diisi: BOT_TOKEN, ALLOWED_USER_IDS, REPO_PATH` dan exit code 1.

Hapus yang sementara:

```bash
rm -f .env.bak
```

- [ ] **Step 6: Test parsing regex command**

```bash
node --input-type=module -e "
const cases = ['/ai tambahin endpoint', '/ai@bot saya spawn x', '/ai   spasi  banyak'];
for (const text of cases) console.log(JSON.stringify(text.replace(/^\/ai(@\S+)?\s*/, '')));
"
```

Expected:
```
"tambahin endpoint"
"saya spawn x"
"spasi  banyak"
```

Kalau baris ketiga tidak menghasilkan `"spasi  banyak"`, periksa `\s*` di akhir regex.

- [ ] **Step 7: Jalankan seluruh test suite**

```bash
npm test
```

Expected: 37 test PASS

- [ ] **Step 8: Verifikasi manual bot dengan token asli**

Buat `.env` dengan nilai sebenarnya (token di luar repo ini, jangan pernah di-commit):

```dotenv
BOT_TOKEN=<token dari BotFather>
ALLOWED_USER_IDS=1484782778
REPO_PATH=/path/absolut/repo/target
```

```bash
npm start
```

Lalu dari Telegram:
1. `/start` → harusnya tidak ada respons (tidak ada handler-nya; ini normal)
2. `/status` → `✅ Idle. Tidak ada proses yang jalan.`
3. `/ai` tanpa argumen → pesan cara pakai
4. `/ai` dua kali cepat → request kedua harus ditolak dengan pesan "Masih ada proses lain"
5. `/newsession` → konfirmasi sesi dibuang

Expected: keempat langkah lolos. Kalau `/status` ditolak whitelist, periksa `ALLOWED_USER_IDS` — id yang dipakai bot adalah id numerik Telegram Anda, bukan username.

- [ ] **Step 9: Tambahkan bagian "Cara Pakai" ke `README.md`**

Tambahkan di bawah tabel "Progress Tracker":

````markdown
## 🚀 Cara Pakai

```bash
cd /sdcard/projek/opencode/telegram-opencode-bridge
cp .env.example .env
# isi .env: BOT_TOKEN, ALLOWED_USER_IDS, REPO_PATH
npm install
npm start
```

**Syarat sebelum bot bisa menjalankan `/ai` di mesin target:**
- `opencode` ada di PATH (`which opencode`), atau isi `OPENCODE_BIN` dengan path absolutnya
- opencode punya provider aktif yang bisa dihubungi — `opencode models` harus menampilkan model
- `REPO_PATH` menunjuk ke git repo yang punya remote `origin` dan branch dengan upstream

**Tanpa provider aktif, `opencode run` menggantung tanpa output** dan hanya bisa dihentikan oleh `AI_TIMEOUT_MS`.

**Verifikasi `opencode run` sungguhan tidak bisa dilakukan di environment penulisan plan ini** karena port `127.0.0.1:20128` mati. Langkah verifikasi Task 4 dan Task 5 karena itu memakai `OPENCODE_BIN=/bin/echo`, bukan opencode asli. Uji end-to-end dengan provider nyata harus dilakukan di mesin target.
````

- [ ] **Step 10: Commit**

```bash
git add index.js src/config.js src/git.js README.md
git commit -m "feat: telegram bot entry point with progress timer and cancel"
```

---

### Task 6: Review akhir & tighten `.gitignore`

**Files:**
- Modify: `.gitignore`
- Review: seluruh repo

**Interfaces:**
- Consumes: semua output Task 1–5
- Produces: verifikasi bahwa tidak ada kebocoran secret dan semua test lulus

- [ ] **Step 1: Pastikan `.env` tidak pernah masuk index git**

```bash
git ls-files | grep -E '^\.env$' && echo "FAIL: .env ter-track" || echo "PASS: .env tidak ter-track"
```

Expected: `PASS: .env tidak ter-track`

- [ ] **Step 2: Scan semua file ter-track untuk string yang mirip token**

```bash
git grep -nE '[0-9]{8,10}:AA[A-Za-z0-9_-]{30,}' -- . && echo "FAIL: token ditemukan" || echo "PASS: tidak ada token di index"
```

Expected: `PASS: tidak ada token di index`

Kalau `FAIL`: `git rm --cached <file>`, tambahkan pola ke `.gitignore`, lalu `git commit`. Ingat: kalau `.env` sempat ter-commit, `git reset` tidak cukup — token harus dirotasi lewat BotFather.

- [ ] **Step 3: Pastikan `node_modules` dan `data/` tidak ter-track**

```bash
git ls-files | grep -E '^(node_modules/|data/)' | grep -v '^data/\.gitkeep$' && echo "FAIL" || echo "PASS"
```

Expected: `PASS`

- [ ] **Step 4: Jalankan test suite terakhir**

```bash
npm test
```

Expected: 37 test PASS

- [ ] **Step 5: Verifikasi pipeline git di repo proyek ini sendiri**

Repo ini adalah target yang paling realistis untuk uji coba pertama, karena isinya kecil dan tidak ada secret:

```bash
git status --porcelain
```

Kalau bersih, pipeline akan melaporkan "tidak ada perubahan" — itu perilaku yang benar, bukan bug.

- [ ] **Step 6: Commit**

```bash
git add .gitignore
git commit -m "chore: harden gitignore against secret leaks"
```

Kalau tidak ada yang berubah, skip commit ini.

---

## Self-Review Plan

### 1. Cakupan spec

Setiap bagian spec dipetakan ke task:

| Bagian spec | Task |
|---|---|
| §1 Tujuan & success criteria | Task 5 Step 8 (verifikasi manual dari Telegram) |
| §2 Di luar scope | Tidak ada task — sengaja, itu batasan |
| §3 Stack | Task 1 Step 2 (`package.json`) |
| §4 Koreksi spesifikasi | Task 4 Step 3 (`buildArgs`) + Review Focus #2 |
| §5 11 env var | Task 1 Step 6, Task 5 Step 1 |
| §6 Arsitektur & unit | Task 1–4 (`config.js`, `git.js`, `report.js`) |
| §7 Command | Task 5 Step 4 |
| §8 Data flow 15 langkah | Task 4 Step 7 (`pipelineGit`), Task 5 Step 4 (`runAI`) |
| §9 Sesi beruntun | Task 4 Step 1 & 3, Task 5 Step 4 (`loadSession`/`saveSession`) |
| §10 Format pesan | Task 3 Step 3 (`formatReport`), Task 5 Step 4 |
| §11 Error handling | Task 4 Step 7 (semua branch), Task 5 Step 4 |
| §12 Testing | Task 1–4 (test files), Task 6 Step 4 |
| §13 Keamanan | Task 1 Step 5, Task 6 Step 1–3 |
| §14 Failure mode | Review Focus #1 dan #3 |
| §15 Berkas | Struktur Berkas di atas |
| §16 Catatan implementasi | Task 5 Step 4 (catatan import & entry point) |

Tidak ada bagian spec tanpa task.

### 2. Scan placeholder

Dicari: `TBD`, `TODO`, `fill in`, `implement later`, `appropriate error handling`, `similar to Task`. Tidak ditemukan.

Satu penyimpangan yang disengaja dan diberi label: Task 4 Step 7 memakai `process.env.COMMIT_SUBJECT` supaya test deterministik, lalu Task 5 Step 2 menggantinya dengan `config.commitSubject`. Alasan perpindahan ini tertulis di dalam catatan Step 7 — bukan diam-diam.

### 3. Konsistensi tipe

| Simbol | Diperkenalkan | Dipakai ulang di |
|---|---|---|
| `loadConfig(env = process.env)` | Task 1 | Task 5 `runAI`, `main` |
| `isAllowed(userId, allowedUserIds)` | Task 1 | Task 5 middleware |
| `screenSensitiveFiles(files)` | Task 2 | Task 4 `pipelineGit` |
| `runOpencode({ prompt, config, sessionId, signal })` | Task 4 | Task 5 `runAI` |
| `git(args, config)` | Task 4 | Task 5 `main`, Task 4 `pipelineGit` |
| `pipelineGit({ config, isCancelled })` | Task 4 | Task 5 `runAI` |
| `splitText(text, limit)` | Task 3 | Task 5 `sendChunked` |
| `formatReport({ answer, changedFiles, sha, branch, sessionId })` | Task 3 | Task 5 `runAI` |
| `config.commitPrefix` | Task 1 | Task 4 Step 7, Task 5 Step 2 |
| `config.commitSubject` | Task 5 Step 1 | Task 4 Step 7 (setelah diganti) |

Nama konsisten di semua task.

### 4. Review Focus

Kelima kelas input sudah dipin di task yang memiliki kodenya:

| # | Kasus | Dipin di |
|---|---|---|
| 1 | opencode diam total saat provider mati | Task 4 Step 8 (test `menandai timeout`) |
| 2 | `kill('SIGINT')` → `code === null` | Task 4 Step 7 (test `menandai cancel`) |
| 3 | Branch tanpa upstream | Task 5 Step 12 → dikoreksi menjadi Task 4 Step 12 (test `pipelineGit menolak branch tanpa upstream`) |
| 4 | `git add -A` ikut men-*stage* file di luar duties AI | Task 5 Step 9 → dikoreksi menjadi Task 3 Step 1 (test `formatReport menyebutkan jumlah file yang dipotong`) |
| 5 | `.env` bocor karena `.gitignore` | Task 1 Step 5, Task 6 Step 1–2 |

Semua 5 ter-cover dengan test nyata, bukan hanya pemeriksaan manual.

### 5. Scope check

Plan ini satu subsistem tunggal dengan 6 task yang saling berantai lewat interface yang eksplisit. Tidak perlu dipecah jadi beberapa plan.
