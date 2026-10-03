import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createAuth } from '../server/auth.js';
import { checkDeployment } from './check-deployment.mjs';
import { createTestAccounts } from './create-test-accounts.mjs';

test('deployment check confirms external login and anonymous access boundary', async t => {
  const app = express();
  const auth = createAuth({ AUTH_MODE: 'external', HOST: '127.0.0.1', AUTH_COOKIE_SECURE: 'true',
    AUTH_CORP_ID: 'test-corp', AUTH_SHARED_SECRET: 'test-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
    EXTERNAL_LOGIN_URL: 'https://login.example.test/start' });
  auth.routes(app);
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/projects', auth.read, (_req, res) => res.json([]));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  assert.deepEqual(await checkDeployment(`http://127.0.0.1:${server.address().port}`),
    { health: 'ok', anonymous: 'blocked', login: 'https://login.example.test' });
});

test('deployment check accepts isolated account mode without a preexisting session', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'game-deploy-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const usersFile = path.join(directory, 'users.json');
  createTestAccounts(usersFile, path.join(directory, 'credentials.txt'));
  const app = express();
  app.use(express.json());
  const auth = createAuth({ AUTH_MODE: 'accounts', HOST: '127.0.0.1', AUTH_COOKIE_SECURE: 'true', AUTH_USERS_FILE: usersFile });
  auth.routes(app);
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/projects', auth.read, (_req, res) => res.json([]));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  assert.deepEqual(await checkDeployment(`http://127.0.0.1:${server.address().port}`, 'accounts'),
    { health: 'ok', anonymous: 'blocked', login: 'accounts' });
});

test('deployment check preserves a shared HTTPS path prefix', async () => {
  const paths = [];
  const fetcher = async (url, options) => {
    paths.push(url.pathname);
    if (url.pathname.endsWith('/api/health')) return { status: 200, json: async () => ({ status: 'ok' }) };
    if (url.pathname.endsWith('/api/auth/me')) return { status: 200, json: async () => ({ mode: 'accounts', authenticated: false }) };
    if (url.pathname.endsWith('/api/projects')) return { status: 401 };
    if (url.pathname.endsWith('/api/auth/password') && options.method === 'POST') return { status: 401 };
    throw new Error(`unexpected request: ${url}`);
  };
  await checkDeployment('https://example.test/intelligence/', 'accounts', fetcher);
  assert.deepEqual(paths, ['/intelligence/api/health', '/intelligence/api/auth/me',
    '/intelligence/api/projects', '/intelligence/api/auth/password']);
});
