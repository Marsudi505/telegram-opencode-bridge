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

test('tidak tertangkap kata yang hanya berawalan secret', () => {
  const files = ['src/secretary.js', 'src/secretariat.ts', 'docs/secrethistory.md'];
  assert.deepEqual(screenSensitiveFiles(files), []);
});

test('tetap menangkap secret yang berdiri sendiri sebagai kata', () => {
  const files = ['src/secret.js', 'config/secrets.yaml', 'deploy/secret-manager.ts'];
  assert.deepEqual(screenSensitiveFiles(files), [
    'src/secret.js',
    'config/secrets.yaml',
    'deploy/secret-manager.ts',
  ]);
});

test('tidak menangkap file env yang namanya mirip tapi bukan .env', () => {
  const files = ['src/env.js', 'src/environment.ts', 'src/keyboard.js'];
  assert.deepEqual(screenSensitiveFiles(files), []);
});
