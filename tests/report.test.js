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
  assert.ok(report.includes('Jawaban AI:\n_(tidak ada output teks)_'));
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
