# 🤖 telegram-opencode-bridge

> Bot Telegram (Node.js + Telegraf 4) sebagai remote control opencode-cli: kirim `/ai <prompt>` dari HP, AI mengerjakan di repo lokal, lalu auto-commit & push ke GitHub.

**Status:** 🔄 Desain + implementation plan selesai — implementasi belum dimulai
**Dibuat:** 2026-10-03
**Lokasi:** `/sdcard/projek/opencode/telegram-opencode-bridge/`
**Dokumen desain:** [`docs/superpowers/specs/2026-10-03-telegram-opencode-bridge-design.md`](docs/superpowers/specs/2026-10-03-telegram-opencode-bridge-design.md)
**Implementation plan:** [`docs/superpowers/plans/2026-10-03-telegram-opencode-bridge.md`](docs/superpowers/plans/2026-10-03-telegram-opencode-bridge.md)

---

## 🎯 Tujuan

Menjadikan mesin dev bisa dikendalikan dari Telegram. Satu perintah `/ai` menjalankan opencode-cli di repo target, lalu perubahan di-commit dan di-push otomatis — tanpa perlu buka laptop.

**Success criteria**
- Pesan sukses berisi jawaban AI, daftar file berubah, dan SHA commit
- Commit baru muncul di branch remote ≤ 1 menit setelah `/ai` selesai
- Tidak ada file sensitif (`.env`, key, credential) yang pernah masuk commit
- `/ai` tidak pernah diproses dua kali bersamaan

## 🧱 Stack

| Komponen | Pilihan |
|---|---|
| Runtime | Node.js ≥ 18.17, ESM |
| Telegram | `telegraf@^4` |
| Env | `dotenv@^16` |
| Proses | `child_process.spawn` (built-in) |
| Test | `node --test` (built-in) |

## 📁 Struktur Berkas (direncanakan)

| Berkas | Status |
|---|---|
| `docs/superpowers/specs/2026-10-03-...-design.md` | ✅ Selesai |
| `docs/superpowers/plans/2026-10-03-...md` | ✅ Selesai — 6 task, 46 step |
| `package.json` | ✅ Selesai |
| `.env.example` | ✅ Selesai |
| `.env` | ⬜ Belum (di-gitignore) |
| `.gitignore` | ✅ Selesai |
| `index.js` | ✅ Selesai |
| `data/.gitkeep` | ✅ Selesai |

## ⚙️ Environment Variables (11)

| Var | Wajib | Default |
|---|---|---|
| `BOT_TOKEN` | ✅ | — |
| `ALLOWED_USER_IDS` | ✅ | — (CSV, mis. `1484782778`) |
| `REPO_PATH` | ✅ | — |
| `OPENCODE_BIN` | — | `opencode` |
| `OPENCODE_MODEL` | — | — |
| `OPENCODE_AGENT` | — | — |
| `AI_TIMEOUT_MS` | — | `1800000` (30 mnt) |
| `PROGRESS_EVERY_MS` | — | `15000` |
| `GIT_BRANCH` | — | *(kosong = auto-deteksi)* |
| `COMMIT_PREFIX` | — | `Update via AI` |
| `MAX_OUTPUT_CHARS` | — | `3500` |

## 🤖 Command

| Command | Fungsi |
|---|---|
| `/ai <prompt>` | Jalankan pipeline opencode + auto-commit + push |
| `/cancel` | Batalkan proses yang sedang jalan |
| `/status` | Status idle/busy + durasi |
| `/newsession` | Buang sesi tersimpan, mulai context fresh |

## 🛡 Guardrail (5)

1. **Whitelist user ID** — hanya `ALLOWED_USER_IDS` yang bisa menjalankan `/ai`
2. **Busy lock** — satu proses pada satu waktu, permintaan kedua ditolak
3. **Deteksi repo bersih** — tidak ada perubahan → tidak ada commit
4. **Cek branch + detached HEAD** — branch auto-deteksi, bukan hardcode `main`
5. **Screening file sensitif** — `.env`, `*.key`, `*.pem`, `id_rsa`, `credentials*` → `git reset`, push dibatalkan

## ⚠️ Catatan Penting

- **Perintah yang benar adalah `opencode run "<prompt>" --auto`**, bukan `opencode "<prompt>"`. Yang latter adalah TUI interaktif yang akan hang selamanya di child_process.
- **`--auto` dipilih** karena opencode butuh izin `edit`/`bash` yang tidak bisa dijawab dalam mode non-interaktif. Konsekuensinya: AI yang dijalankan bot berwenang mengubah file & menjalankan shell di mesin tersebut.
- **Bot token pernah dibagikan di chat.** Kalau transcript ini tersimpan/berbagi → rotasi lewat BotFather `/revoke`.
- `.env.example` tidak pernah memuat token asli; `.env` di-gitignore.

## 📊 Progress Tracker

| Step | Status | Catatan |
|---|---|---|
| 1. Klasifikasi jalur (architectural) | ✅ Selesai | Proyek baru, spesifikasi dari user |
| 2. Explore environment | ✅ Selesai | opencode 1.18.33, Node 24, pattern bot WA |
| 3. Koreksi spesifikasi | ✅ Selesai | `exec()`→`spawn()`, `opencode`→`opencode run` |
| 4. Tanya jawab klarifikasi (10 pertanyaan) | ✅ Selesai | Izin, akses, guardrail, sesi, lokasi, output, progress, konkurensi, docs |
| 5. Presentasi desain di chat | ✅ Selesai | Disetujui user 2026-10-03 |
| 6. Tulis dokumen desain | ✅ Selesai | 16 bagian, ~14.5 KB |
| 7. Spec self-review | ✅ Selesai | Placeholder/kontradiksi/ambiguitas/scope — 11 perbaikan |
| 8. Review dokumen oleh user | ✅ Selesai | Disetujui 2026-10-03 |
| 9. Implementation plan (`writing-plans`) | ✅ Selesai | 6 task, 46 step, 37 test — `docs/superpowers/plans/2026-10-03-telegram-opencode-bridge.md` |
| 10. Implementasi 6 task | ✅ Selesai | **43/43 test hijau**, 6 commit, final review Task 6 selesai |
| 11. Verifikasi manual di mesin target | ⬜ Belum | Butuh provider opencode aktif |

## ➡️ Timeline

**Sedang di:** Step 11 — implementasi selesai, menunggu verifikasi manual di mesin target.

**Aksi berikutnya:** isi `.env` di mesin target dengan token yang sudah dirotasi, lalu verifikasi `/status` dan `/ai` dari Telegram. Lihat bagian 🚀 Cara Pakai.

## 📌 Temuan Verifikasi Lingkungan (2026-10-03)

Ditemukan saat menyusun implementation plan — ketiganya sudah dipin oleh test di plan:

| Temuan | Konsekuensi |
|---|---|
| **Provider opencode mati** — config global pakai `9router/Kombo1` → `http://127.0.0.1:20128/v1`, port tidak terjangkau | `opencode run` **menggantung tanpa output 0 byte** (exit 124 setelah `timeout 40`). `AI_TIMEOUT_MS` jadi **wajib**, bukan opsional — tanpa itu flag busy terkunci permanen |
| **`p.kill('SIGINT')` menghasilkan `code === null`**, bukan angka non-zero | Deteksi cancel harus `code === null && signal === 'SIGINT'`. Cek `code !== 0` saja akan salah klasifikasi cancel sebagai sukses |
| **`git rev-parse --abbrev-ref @{u}` exit `128`** di branch tanpa upstream | Ini cara deteksi branch tanpa upstream — pakai exit code, bukan parse teks |
| **`shell: false` aman untuk prompt ber-kutip** | `spawn('opencode', ['run', 'tambah endpoint "users" ...'])` tidak menghasilkan error shell — konfirmasi keputusan array args |
| **`/sdcard/projek/opencode/` bukan git repo** | Dokumen & tracker disimpan lokal, tidak bisa di-commit |

**Catatan:** verifikasi `opencode run` sungguhan **tidak bisa dilakukan** di environment penulisan plan (port provider mati). Semua test memakai `OPENCODE_BIN=/bin/echo` atau `/bin/sleep`. Uji end-to-end dengan provider nyata harus dilakukan di mesin target.

## 🚀 Cara Pakai

```bash
cd /sdcard/projek/opencode/telegram-opencode-bridge
cp .env.example .env
# isi .env: BOT_TOKEN, ALLOWED_USER_IDS, REPO_PATH
npm install --no-bin-links
npm start
```

**Syarat sebelum bot bisa menjalankan `/ai` di mesin target:**
- `opencode` ada di PATH (`which opencode`), atau isi `OPENCODE_BIN` dengan path absolutnya
- opencode punya provider aktif yang bisa dihubungi — `opencode models` harus menampilkan model
- `REPO_PATH` menunjuk ke git repo yang punya remote `origin` dan branch dengan upstream

**Tanpa provider aktif, `opencode run` menggantung tanpa output** dan hanya bisa dihentikan oleh `AI_TIMEOUT_MS`.

> `npm install --no-bin-links` dipakai karena mount `/sdcard` (Android/FUSE) tidak mendukung symlink. Di mesin target dengan filesystem normal, `npm install` biasa sudah cukup.

### Perintah

| Perintah | Fungsi |
|---|---|
| `/ai <prompt>` | Jalankan opencode di `REPO_PATH`, lalu commit + push otomatis |
| `/cancel` | Batalkan proses yang sedang jalan |
| `/status` | Lihat status proses |
| `/newsession` | Buang context sesi, `/ai` berikutnya mulai dari nol |

Hanya user di `ALLOWED_USER_IDS` yang bisa memakai bot; selain itu ditolak.

### Catatan keterbatasan

- **Verifikasi `opencode run` sungguhan belum bisa dilakukan** di environment penulisan proyek ini karena port `127.0.0.1:20128` mati. Test otomatis memakai stub script, bukan opencode asli. Uji end-to-end dengan provider nyata harus dilakukan di mesin target.
- **Screening file sensitif bisa menolak file yang sah** (mis. `src/credentials-page.jsx`) dan tidak punya escape hatch — pola penolaknya ada di kode, bukan di `.gitignore`. Lihat catatan di ledger.
