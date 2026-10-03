import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAuth } from '../server/auth.js';
import { checkDeployment } from './check-deployment.mjs';

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
