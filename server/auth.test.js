import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createAuth } from './auth.js';
import { createTestAccounts } from '../scripts/create-test-accounts.mjs';

const secret = 'test-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
const config = {
  AUTH_MODE: 'external', HOST: '127.0.0.1', AUTH_SHARED_SECRET: secret,
  AUTH_CORP_ID: 'corp-1', EXTERNAL_LOGIN_URL: 'https://login.example.test/start'
};

async function serve(auth) {
  const app = express();
  app.use(express.json());
  app.use('/api/auth/exchange', express.urlencoded({ extended: false }));
  auth.routes(app);
  app.get('/api/projects', auth.read, (req, res) => res.json({ user: req.user }));
  app.get('/api/projects/p1/report', auth.read, (req, res) => res.json({ report: true }));
  app.get('/api/projects/p1/report.pdf', auth.read, (req, res) => res.type('pdf').send('pdf'));
  app.post('/api/projects', auth.write, (req, res) => res.status(201).json({ ok: true }));
  app.post('/api/games/import', auth.write, (req, res) => res.json({ ok: true }));
  app.put('/api/score-config', auth.admin, (req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

function claim(role, overrides = {}) {
  const body = { corpId: 'corp-1', id: `${role}-1`, name: role, role, timestamp: Date.now(), nonce: `nonce-${Math.random().toString(36).slice(2).padEnd(16, '0')}`, ...overrides };
  body.signature = createHmac('sha256', secret).update([body.corpId, body.id, body.name, body.role, body.timestamp, body.nonce, body.state].join('\n')).digest('hex');
  return body;
}

async function beginLogin(url) {
  const response = await fetch(`${url}/api/auth/login`, { redirect: 'manual' });
  assert.equal(response.status, 302);
  return { state: new URL(response.headers.get('location')).searchParams.get('state'), loginCookie: response.headers.get('set-cookie').split(';')[0] };
}

async function signIn(url, role) {
  const { state, loginCookie } = await beginLogin(url);
  const response = await fetch(`${url}/api/auth/exchange`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: loginCookie }, body: JSON.stringify(claim(role, { state })) });
  assert.equal(response.status, 200);
  return { cookie: response.headers.get('set-cookie').split(';')[0], csrf: (await response.json()).csrfToken };
}

test('local mode only binds loopback and bootstraps an admin session', async t => {
  assert.throws(() => createAuth({ AUTH_MODE: 'local', HOST: '0.0.0.0' }), /loopback/);
  const server = await serve(createAuth({ AUTH_MODE: 'local', HOST: '127.0.0.1' }));
  t.after(server.close);
  const me = await fetch(`${server.url}/api/auth/me`);
  const body = await me.json();
  assert.equal(body.user.role, 'admin');
  assert.equal(body.mode, 'local');
  assert.ok(body.csrfToken);
  const denied = await fetch(`${server.url}/api/projects`, { method: 'POST', headers: { Cookie: me.headers.get('set-cookie').split(';')[0] } });
  assert.equal(denied.status, 403);
});

test('external mode fails closed without its required settings', () => {
  assert.throws(() => createAuth({ AUTH_MODE: 'external', HOST: '0.0.0.0' }), /requires/);
  assert.throws(() => createAuth({ ...config, HOST: '0.0.0.0' }), /AUTH_COOKIE_SECURE/);
  assert.throws(() => createAuth({ ...config, EXTERNAL_LOGIN_URL: 'http://login.example.test' }), /HTTPS/);
});

test('signed external identity enforces organization, freshness and replay protection', async t => {
  const server = await serve(createAuth(config));
  t.after(server.close);
  const { state, loginCookie } = await beginLogin(server.url);
  const post = body => fetch(`${server.url}/api/auth/exchange`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: loginCookie }, body: JSON.stringify(body) });
  assert.equal((await fetch(`${server.url}/api/projects`)).status, 401);
  assert.equal((await post(claim('admin', { corpId: 'other-corp', state }))).status, 403);
  assert.equal((await post(claim('admin', { timestamp: Date.now() - 6 * 60 * 1000, state }))).status, 403);
  const forged = claim('investor', { state });
  forged.role = 'admin';
  assert.equal((await post(forged)).status, 403);
  const valid = claim('investor', { state });
  assert.equal((await fetch(`${server.url}/api/auth/exchange`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(valid) })).status, 403);
  assert.equal((await post(valid)).status, 200);
  assert.equal((await post(valid)).status, 403);
});

test('browser form exchange returns to the app with a session cookie', async t => {
  const server = await serve(createAuth(config));
  t.after(server.close);
  const { state, loginCookie } = await beginLogin(server.url);
  const response = await fetch(`${server.url}/api/auth/exchange`, {
    method: 'POST', redirect: 'manual', headers: { Cookie: loginCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(claim('analyst', { state }))
  });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/');
  const sessionCookie = response.headers.get('set-cookie').match(/investment_session=[^;]+/)[0];
  assert.equal((await fetch(`${server.url}/api/projects`, { headers: { Cookie: sessionCookie } })).status, 200);
});

test('investor, analyst and admin permissions cover reports and every write category', async t => {
  const server = await serve(createAuth(config));
  t.after(server.close);
  for (const role of ['investor', 'analyst', 'admin']) {
    const { cookie, csrf } = await signIn(server.url, role);
    const call = (path, method, sendCsrf = true) => fetch(`${server.url}${path}`, {
      method, headers: { Cookie: cookie, ...(sendCsrf ? { 'X-CSRF-Token': csrf } : {}) }
    });
    assert.equal((await call('/api/projects', 'GET')).status, 200);
    assert.equal((await call('/api/projects/p1/report', 'GET')).status, 200);
    assert.equal((await call('/api/projects/p1/report.pdf', 'GET')).status, 200);
    assert.equal((await call('/api/projects', 'POST')).status, role === 'investor' ? 403 : 201);
    assert.equal((await call('/api/games/import', 'POST')).status, role === 'investor' ? 403 : 200);
    assert.equal((await call('/api/score-config', 'PUT')).status, role === 'admin' ? 200 : 403);
    assert.equal((await call('/api/projects', 'POST', false)).status, 403);
    assert.equal((await call('/api/auth/logout', 'POST', false)).status, 403);
    assert.equal((await call('/api/auth/logout', 'POST')).status, 204);
    assert.equal((await call('/api/projects', 'GET')).status, 401);
  }
});

test('isolated test accounts authenticate with distinct roles and secure sessions', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'game-auth-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const usersFile = path.join(dir, 'users.json');
  const credentialsFile = path.join(dir, 'credentials.txt');
  createTestAccounts(usersFile, credentialsFile);
  assert.equal(fs.statSync(usersFile).mode & 0o777, 0o600);
  assert.equal(fs.statSync(credentialsFile).mode & 0o777, 0o600);
  assert.throws(() => createTestAccounts(usersFile, credentialsFile), /已存在/);
  assert.throws(() => createAuth({ AUTH_MODE: 'accounts', AUTH_USERS_FILE: usersFile }), /AUTH_COOKIE_SECURE/);
  const server = await serve(createAuth({ AUTH_MODE: 'accounts', HOST: '127.0.0.1', AUTH_COOKIE_SECURE: 'true', AUTH_USERS_FILE: usersFile }));
  t.after(server.close);
  const credentials = fs.readFileSync(credentialsFile, 'utf8');
  for (const [id, role] of [['investor-demo', 'investor'], ['analyst-demo', 'analyst'], ['admin-demo', 'admin']]) {
    const password = credentials.match(new RegExp(`账号：${id}\\n初始密码：([^\\n]+)`))[1];
    const response = await fetch(`${server.url}/api/auth/password`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, password }) });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie'), /; Secure/);
    const body = await response.json();
    assert.equal(body.user.role, role);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(`${server.url}/api/projects`, { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(`${server.url}/api/projects`, { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': body.csrfToken } })).status,
      role === 'investor' ? 403 : 201);
  }
  assert.equal((await fetch(`${server.url}/api/auth/password`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'admin-demo', password: 'wrong' }) })).status, 401);
});
