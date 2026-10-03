import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowed, loadConfig } from '../src/config.js';

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

test('loadConfig memakai default gitTimeoutMs 120000', () => {
  const config = loadConfig({
    BOT_TOKEN: 't',
    ALLOWED_USER_IDS: '1',
    REPO_PATH: '/tmp',
  });
  assert.equal(config.gitTimeoutMs, 120000);
});

test('loadConfig membaca GIT_TIMEOUT_MS dari env', () => {
  const config = loadConfig({
    BOT_TOKEN: 't',
    ALLOWED_USER_IDS: '1',
    REPO_PATH: '/tmp',
    GIT_TIMEOUT_MS: '45000',
  });
  assert.equal(config.gitTimeoutMs, 45000);
});

test('loadConfig mengabaikan GIT_TIMEOUT_MS yang bukan angka', () => {
  const config = loadConfig({
    BOT_TOKEN: 't',
    ALLOWED_USER_IDS: '1',
    REPO_PATH: '/tmp',
    GIT_TIMEOUT_MS: 'secepatnya',
  });
  assert.equal(config.gitTimeoutMs, 120000);
});
