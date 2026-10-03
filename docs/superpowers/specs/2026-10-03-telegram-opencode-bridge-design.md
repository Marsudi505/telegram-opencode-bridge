# Desain: telegram-opencode-bridge

**Tanggal:** 2026-10-03
**Status:** Disetujui (chat, 2026-10-03) — menunggu review dokumen
**Lokasi proyek:** `/sdcard/projek/opencode/telegram-opencode-bridge/`

---

## 1. Tujuan

Bot Telegram sebagai remote control mesin dev. Dari HP, user mengirim `/ai <prompt>`; opencode-cli mengerjakan di repo lokal; lalu hasilnya di-commit dan di-push ke GitHub otomatis.

**Success criteria:**
- Pesan sukses di Telegram berisi jawaban AI, daftar file yang berubah, dan SHA commit.
- Commit baru muncul di branch remote dalam 1 menit setelah `/ai` selesai.
- Tidak ada satu pun file sensitif (`.env`, key, credential) yang pernah masuk commit.
- command `/ai` tidak pernah diproses dua kali bersamaan.

## 2. Di luar scope (v1)

Tidak dikerjakan di versi ini, supaya `index.js` tetap ringkas dan mudah direview:

- Multi-user / multi-repo (satu bot, satu repo)
- Broadcast ke group/channel, hanya chat private
- Riwayat percakapan di Telegram (opencode yang menyimpan sesinya)
- Dashboard web, auth HTTP, webhook
- Voice note, vision, upload file
- Pemilihan branch manual — branch selalu dideteksi otomatis dari `git rev-parse`, dengan `GIT_BRANCH` hanya sebagai override

## 3. Stack

| Komponen | Pilihan | Alasan |
|---|---|---|
| Runtime | Node.js ≥ 18.17, ESM (`"type": "module"`) | Sesuai spec; konsisten dengan `opencode-telegram-gateway` |
| Telegram | `telegraf@^4` | Sesuai spec (user memilih Telegraf, bukan grammy) |
| Env | `dotenv@^16` | Sesuai spec |
| Proses | `child_process.spawn` built-in | Binary ada di PATH, dan bisa di-kill dengan `SIGINT` |
| Test | `node --test` built-in | Tanpa dependency test tambahan |

Tidak ada dependency lain.

## 4. Koreksi terhadap spesifikasi awal

Spesifikasi JSON asli saying: `child_process.exec()` dengan `opencode "<prompt>"`. Dua masalah, keduanya diperbaiki di desain ini:

1. **`opencode "<prompt>"` bukan mode non-interaktif.** `opencode <args>` itu alias TUI interaktif. Dipanggil dari child_process tanpa TTY, proses akan menggantung tanpa pernah selesai. Perintah yang benar: `opencode run "<prompt>"` (dikonfirmasi dari `opencode --help` v1.18.33).
2. **`exec()` tidak bisa dihentikan dengan andal** dan menumpuk output di memori (batas 1MB sebelum `maxBuffer` error). `spawn()` memberi stdout/stderr streaming dan `.kill()` yang bisa diandalkan.

Ditambah satu hal yang tidak ada di spec: opencode dalam mode non-interaktif butuh izin `edit`/`bash`. Config global user (`~/.config/opencode/opencode.json`) tidak punya blok `permission`, sehingga default `ask` berlaku dan tidak ada siapa pun untuk menjawab. Solusi yang dipilih: flag `--auto` di command.

> ⚠️ `--auto` berarti AI yang dijalankan lewat bot ini berwenang mengubah file dan menjalankan perintah shell di mesin tersebut. Ini konsekuensi yang sengaja disetujui; tanpa itu bot tidak bisa menjalankan `/ai` sama sekali. Bot ini hanya boleh dipakai di mesin yang memang dipercayai.

## 5. Environment variables

| Var | Default | Wajib | Fungsi |
|---|---|---|---|
| `BOT_TOKEN` | — | ✅ | Token dari BotFather |
| `ALLOWED_USER_IDS` | — | ✅ | CSV Telegram user ID, mis. `1484782778` |
| `REPO_PATH` | — | ✅ | Path absolut repo target |
| `OPENCODE_BIN` | `opencode` | — | Binary opencode bila tidak ada di PATH |
| `OPENCODE_MODEL` | — | — | Override `-m provider/model` |
| `OPENCODE_AGENT` | — | — | Override `--agent` |
| `AI_TIMEOUT_MS` | `1800000` | — | 30 menit, batas proses `/ai` |
| `PROGRESS_EVERY_MS` | `15000` | — | Interval edit pesan status |
| `GIT_BRANCH` | *(kosong)* | — | Kosong = deteksi branch aktif. Bukan hardcode `main` |
| `COMMIT_PREFIX` | `Update via AI` | — | Prefix commit message |
| `MAX_OUTPUT_CHARS` | `3500` | — | Batas balasan jawaban AI |

**Baris perintah yang dijalankan:**

```
opencode run "<prompt>" --auto [--model <m>] [--agent <a>] --format json
```

`--format json` dipilih (bukan `default`) karena stdout berisi event terstruktur: teks jawaban AI bisa diambil bersih tanpa noise, dan `sessionID` bisa diekstrak untuk `/ai` berikutnya.

**Validasi boot:** `BOT_TOKEN`, `ALLOWED_USER_IDS`, `REPO_PATH` kosong → proses keluar dengan pesan jelas listing variabel yang kurang, bukan crash undefined. `REPO_PATH` yang tidak ada atau bukan git repo → keluar, bukan crash saat `/ai` dipanggil.

## 6. Arsitektur

```
Telegram ──▶ index.js (Telegraf 4, ESM)
               │
               ├─ /ai  ─▶ guard (whitelist + busy) ─▶ runAI()
               │            ├─ spawn opencode run "<prompt>" --auto
               │            │     cwd = REPO_PATH, timer edit tiap 15s
               │            ├─ simpan sessionId ke data/session.json
               │            └─ pipelineGit()
               ├─ /cancel ─▶ kill proses + abort pipeline
               ├─ /status ─▶ idle/busy + durasi berjalan
               └─ /newsession ─▶ buang session tersimpan
```

**Struktur internal `index.js`** — satu file sesuai spec, dipecah jadi unit-unit kecil dengan satu tanggung jawab:

| Unit | Tanggung jawab |
|---|---|
| `loadConfig()` | Baca + validasi env, return objek config |
| `isAllowed(userId)` | Cek CSV `ALLOWED_USER_IDS` |
| `splitText(text, limit)` | Potong string panjang jadi beberapa pesan (limit 4096) |
| `screenSensitiveFiles(files)` | Deteksi pola file sensitif pada daftar path hasil staging |
| `runOpencode(prompt, onProgress)` | Spawn proses, kumpulkan stdout, kembalikan `{code, stdout, sessionId, answer}` |
| `git(args)` | Jalankan `git <args>` di `REPO_PATH`, kembalikan `{code, stdout, stderr}` |
| `pipelineGit()` | add → screening → commit → push, dengan abort di setiap langkah |
| `formatReport(result)` | Susun pesan sukses (jawaban AI + file berubah + SHA) |
| `sendLong(ctx, text)` | Kirim sebagai pesan; kalau masih kepanjangan, kirim file `.txt` |

Tidak ada state global selain objek `currentRun` (satu proses aktif) dan file `data/session.json`.

## 7. Command

| Command | Kebijakan | Tindakan |
|---|---|---|
| `/ai` tanpa argumen | semua | Balas cara pakai, tidak menjalankan opencode |
| `/ai <prompt>` | semua | Jalankan pipeline penuh |
| `/ai <prompt>` dari ID tak dikenal | semua | Tolak: "Anda tidak diizinkan." Tidak menjalankan opencode |
| `/ai <prompt>` saat busy | semua | Tolak dengan sisa waktu perkiraan. Tidak mengantre |
| `/cancel` | semua | `SIGINT` ke proses + batalkan pipeline. Balas konfirmasi |
| `/status` | semua | Laporkan idle/busy + durasi |
| `/newsession` | semua | Hapus `sessionId` tersimpan |

## 8. Data flow `/ai`

| # | Aksi | Kalau gagal |
|---|---|---|
| 1 | Whitelist check | Stop, tolak |
| 2 | Busy check | Stop, tolak + perkiraan sisa waktu |
| 3 | Balas "Memproses…" + timer edit tiap 15s | — |
| 4 | Validasi `REPO_PATH` (ada? git repo?) | Stop, kirim pesan error |
| 5 | `spawn opencode run "<prompt>" --auto`, cwd `REPO_PATH` | Kirim stderr ringkas. Tidak ada yang di-push |
| 6 | Timeout `AI_TIMEOUT_MS` → `SIGINT` | Kill proses, kirim "kewalahan waktu", tidak ada push |
| 7 | Parse `sessionId` dari event JSON | Non-fatal; sesi berikutnya mulai fresh |
| 8 | Tulis `data/session.json` | Non-fatal |
| 9 | `git status --porcelain` → bersih? | Lapor "AI tidak mengubah apa-apa". Selesai, tidak ada commit |
| 10 | `git add -A` | Error, stop |
| 11 | `git diff --cached --name-only` → screening file sensitif | `git reset` (batalkan staging), tolak push, laporkan |
| 12 | `git commit -m "<prefix>: <cuplikan prompt>"` | Error, stop. Tidak ada push |
| 13. `git rev-parse --abbrev-ref HEAD` → cek bukan `HEAD` detached | Stop sebelum push |
| 14 | `git push origin <branch>` | Commit tetap lokal; lapor SHA + perintah push manual |
| 15 | Kirim laporan: jawaban AI + file berubah + SHA 7 karakter | — |

Langkah 9–14 adalah "guardrail yang ditambahkan di luar spec". Alasannya:

- **Repo bersih → jangan commit.** Tanpa ini, `/ai` yang tidak menghasilkan perubahan tetap membuat commit kosong, dan riwayat git terisi noise.
- **Screening file sensitif.** `git add -A` bisa memasukkan `.env`, `*.key`, atau `credentials.json` milik user. Ini risiko kebocoran credential yang nyata, jadi diperiksa *setelah* staging dan di-*unstage* sebelum commit.
- **Branch auto-deteksi, bukan hardcode `main`.** Hardcode `main` akan push ke branch yang salah kalau repo sedang berada di branch lain, dan gagal diam-diam di repo yang branch defaultnya `master`.

## 9. Sesi beruntun

`opencode run --format json` memuat `sessionID` di event awal. ID ini disimpan di `data/session.json` (atomic write via file sementara + rename). `/ai` berikutnya memakai `-s <sessionId>`, sehingga `/ai "tambahin endpoint baru"` lalu `/ai "sekarang buat testnya"` punya context yang nyambung.

`/newsession` menghapus ID tersimpan; `/ai` berikutnya berjalan fresh.

## 10. Format pesan Telegram (bahasa Indonesia)

**Sukses:**

```
✅ Selesai — commit 3a9f2c1

Jawaban AI:
<teks, dipotong MAX_OUTPUT_CHARS>

File yang berubah (3):
  M src/server.js
  A src/routes/user.js
  D src/legacy.js

Branch: main → origin/main
Sesi: ses_abc123 (aktif untuk /ai berikutnya)
```

**Tidak ada perubahan:**

```
⚠️ Selesai, tapi AI tidak mengubah file apa pun.
Tidak ada commit yang dibuat.
```

**Ditolak karena file sensitif:**

```
🚫 Push dibatalkan — file sensitif terdeteksi:
  .env

Staging dibatalkan (git reset). Tidak ada yang di-push.
Perbaiki .gitignore lalu ulangi.
```

**Gagal:**

```
❌ Gagal setelah 2m 14s

Tahap: Menjalankan opencode
opencode keluar dengan kode 1:
<stderr, dipotong>
```

**Sedang sibuk:**

```
⏳ Masih ada proses lain yang jalan (sudah 4m 02s).
Coba lagi nanti, atau /cancel untuk membatalkan.
```

## 11. Error handling

- Semua error dari `spawn` ditangkap; `error` event dan non-zero exit code ditangani terpisah.
- `git()` mengembalikan objek `{code, stdout, stderr}` — tidak pernah throw. Pipeline memeriksa `code` di setiap langkah, jadi tidak ada git command yang gagal diam-diam.
- Kegagalan setelah `commit` tapi sebelum `push` dilaporkan sebagai kondisi terpisah, karena itu satu-satunya kasus di mana user perlu tindakan manual (`git push`).
- Semua pesan error dipotong ke `MAX_OUTPUT_CHARS` sebelum dikirim, agar tidak kena limit 4096 Telegram.
- Kegagalan kirim pesan Telegram (mis. `message to edit not found`) tidak boleh menggagalkan pipeline — dibungkus try/catch terpisah.
- Error fatal saat boot (env kurang, `REPO_PATH` invalid) keluar dari proses dengan pesan jelas, bukan stack trace.

## 12. Testing

`npm test` → `node --test`. Tanpa dependency tambahan.

| Test | Yang diuji |
|---|---|
| `splitText()` | Potong tepat di batas 4096, tidak ada karakter hilang, string pendek tidak dipecah |
| `isAllowed()` | CSV parsing (spasi, satu ID, banyak ID), ID sendiri lolos, ID asing ditolak, env kosong ditolak semua orang |
| Screening file sensitif | `.env`, `id_rsa`, `credentials.json` tertangkap; `src/server.js` lolos |
| Guardrail repo bersih | Repo fixture yang bersih → tidak ada commit yang dibuat |
| Guardrail file sensitif | Repo fixture dengan `.env` → staging dibatalkan, tidak ada commit |
| Pipeline end-to-end | `OPENCODE_BIN=/bin/echo` menggantikan opencode, `GIT_BRANCH` dipaksa ke branch test, verifikasi commit benar-benar terjadi dan laporan sukses terisi |
| Timeout | `OPENCODE_BIN=/bin/sleep`, `AI_TIMEOUT_MS` kecil → proses dibunuh, pesan error timeout terkirim |

Fixture git dibuat di direktori sementara oleh test itu sendiri, lalu dibersihkan. Test tidak menyentuh `REPO_PATH` user.

## 13. Keamanan

- **`.gitignore` ketat.** Proyek ini ikut `git add .`; `.env` berisi bot token tidak boleh masuk repo.

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

  `data/*` ditulis sebagai `data/*` (bukan `data/`) supaya `data/.gitkeep` tetap bisa di-track.

- **`BOT_TOKEN` tidak pernah ditulis ke `.env.example`** — hanya placeholder, supaya aman di-share.
- **Whitelist user ID** membatasi siapa yang bisa memicu eksekusi kode di mesin tersebut.
- **Tidak ada eval shell.** Prompt user diteruskan sebagai argumen `spawn`, bukan dirangkai ke string `shell: true`. Ini menutup kelas bug shell injection di prompt.
- **Screening file sensitif** mencegat kebocoran credential sebelum commit, bukan setelah.
- Bot token tidak pernah di-log; setiap log hanya menulis ID numerik user.

> ⚠️ Token bot sudah pernah dibagikan di chat. Kalau transcript ini tersimpan atau di-share, rotasi token lewat BotFather (`/revoke`) dan isi ulang `.env`.

## 14. Kemungkinan kegagalan yang diketahui

| Masalah | Mitigasi |
|---|---|
| `opencode` butuh provider aktif. Di environment user, provider `9router/Kombo1` mengarah ke `http://127.0.0.1:20128/v1` — proses lokal | Jika bot berjalan di mesin berbeda dari proses 9Router, `/ai` akan gagal dengan error auth. `OPENCODE_MODEL` tersedia untuk override ke provider yang selalu hidup |
| `--auto` terbukti berbahaya di produksi | Flag ini ada karena bot tidak bisa menjawab dialog izin. Kalau nanti butuh mode aman, ubah jadi blok `permission` di `opencode.json` lalu hapus `--auto` dari command |
| Job yang timeout mungkin meninggalkan `git.lock` | `git reset` dijalankan di jalur gagal commit; lock yang tersisa akan dibersihkan `git` sendiri |
| opencode versi lama tidak punya `--format json` | Deteksi `--format` tidak didukung dari stderr, jatuh ke mode teks |

## 15. Berkas yang akan dibuat

| Berkas | Isi |
|---|---|
| `package.json` | Dependensi + script `start`, `test` |
| `.env.example` | 11 variabel env dengan placeholder, tanpa token asli |
| `.env` | Konfigurasi lokal, di-gitignore, tidak pernah di-share |
| `.gitignore` | Aturan di bagian 13 |
| `index.js` | Bot Telegraf + pipeline |
| `data/.gitkeep` | Folder state, isinya di-gitignore |
| `README.md` | Tracker proyek (wajib per aturan `/sdcard/projek/opencode/README.md`) |
| `docs/superpowers/specs/2026-10-03-telegram-opencode-bridge-design.md` | Dokumen ini |

## 16. Catatan untuk implementasi

- `data/` dibuat otomatis saat bot start, tidak perlu harus ada di repo.
- `message to edit not found` adalah error yang sering terjadi kalau pesan sudah dihapus atau terlalu lama — timer progress harus menanganinya diam-diam.
- Batas Telegram: 4096 karakter per pesan teks. Semua pengiriman teks melewati `splitText()`.
- Jika jawaban AI masih melebihi batas setelah dipotong `MAX_OUTPUT_CHARS`, sisanya dikirim sebagai dokumen `.txt`.