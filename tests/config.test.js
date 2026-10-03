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
