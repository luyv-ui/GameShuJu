import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';

const SESSION_MS = 8 * 60 * 60 * 1000;
const ASSERTION_MS = 5 * 60 * 1000;
const ROLES = new Set(['investor', 'analyst', 'admin']);
const LOGIN_ATTEMPT_MS = 15 * 60 * 1000;

const token = () => randomBytes(32).toString('base64url');
function same(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(part => part.trim().split(/=(.*)/s).slice(0, 2)).filter(([key]) => key));
}
function cookie(value, secure, age) {
  return `investment_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${secure ? '; Secure' : ''}`;
}
function stateCookie(value, secure, age) {
  return `investment_login_state=${value}; HttpOnly; SameSite=${secure ? 'None' : 'Lax'}; Path=/api/auth; Max-Age=${age}${secure ? '; Secure' : ''}`;
}
function isLoopback(host) {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
}
function assertionText(body) {
  return [body.corpId, body.id, body.name, body.role, body.timestamp, body.nonce, body.state].join('\n');
}

export function createAuth(env = process.env) {
  const host = env.HOST || '127.0.0.1';
  const mode = env.AUTH_MODE || 'local';
  if (!['local', 'external', 'accounts'].includes(mode)) throw new Error('AUTH_MODE must be local, external or accounts');
  if (mode === 'local' && !isLoopback(host)) throw new Error('Local authentication requires loopback HOST');
  let accounts = new Map();
  if (mode === 'accounts') {
    if (env.AUTH_COOKIE_SECURE !== 'true' || !env.AUTH_USERS_FILE) {
      throw new Error('Account authentication requires AUTH_COOKIE_SECURE=true and AUTH_USERS_FILE');
    }
    const records = JSON.parse(fs.readFileSync(env.AUTH_USERS_FILE, 'utf8'));
    if (!Array.isArray(records) || records.length === 0) throw new Error('AUTH_USERS_FILE must contain accounts');
    for (const account of records) {
      if (typeof account.id !== 'string' || !/^[A-Za-z0-9_-]{3,64}$/.test(account.id) ||
          typeof account.name !== 'string' || !account.name.trim() || account.name.length > 128 ||
          !ROLES.has(account.role) || !/^[a-f0-9]{32}$/.test(account.salt) || !/^[a-f0-9]{128}$/.test(account.hash) ||
          accounts.has(account.id)) throw new Error('AUTH_USERS_FILE contains an invalid or duplicate account');
      accounts.set(account.id, account);
    }
  }
  if (mode === 'external') {
    if (!env.AUTH_SHARED_SECRET || env.AUTH_SHARED_SECRET.length < 32 || !env.AUTH_CORP_ID || !env.EXTERNAL_LOGIN_URL) {
      throw new Error('External authentication requires AUTH_SHARED_SECRET (32+ characters), AUTH_CORP_ID, and EXTERNAL_LOGIN_URL');
    }
    const loginUrl = new URL(env.EXTERNAL_LOGIN_URL);
    if (!['https:', 'http:'].includes(loginUrl.protocol) || (loginUrl.protocol !== 'https:' && !isLoopback(loginUrl.hostname))) {
      throw new Error('EXTERNAL_LOGIN_URL must use HTTPS outside localhost');
    }
    if (!isLoopback(host) && env.AUTH_COOKIE_SECURE !== 'true') throw new Error('External authentication requires AUTH_COOKIE_SECURE=true on non-loopback HOST');
  }
  const secure = mode !== 'local' && env.AUTH_COOKIE_SECURE === 'true';
  const sessions = new Map();
  const nonces = new Map();
  const states = new Map();
  const loginFailures = new Map();

  function makeSession(res, user) {
    const id = token();
    const current = { user, csrfToken: token(), expires: Date.now() + SESSION_MS };
    sessions.set(id, current);
    res.setHeader('Set-Cookie', cookie(id, secure, SESSION_MS / 1000));
    return current;
  }
  function session(req, res) {
    const id = cookies(req).investment_session;
    let current = id && sessions.get(id);
    if (current?.expires <= Date.now()) { sessions.delete(id); current = null; }
    if (!current && mode === 'local') current = makeSession(res, { id: 'local-developer', name: '本地开发者', role: 'admin' });
    return current;
  }
  function requireRole(minRole) {
    const rank = { investor: 1, analyst: 2, admin: 3 };
    return (req, res, next) => {
      const current = session(req, res);
      if (!current) return res.status(401).json({ error: '请先登录' });
      if (rank[current.user.role] < rank[minRole]) return res.status(403).json({ error: '权限不足' });
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !same(req.headers['x-csrf-token'], current.csrfToken)) {
        return res.status(403).json({ error: 'CSRF 校验失败' });
      }
      req.user = current.user;
      next();
    };
  }
  const read = requireRole('investor');
  const write = requireRole('analyst');
  const admin = requireRole('admin');

  function routes(app) {
    app.get('/api/auth/me', (req, res) => {
      const current = session(req, res);
      res.json({ authenticated: Boolean(current), mode, user: current?.user || null, csrfToken: current?.csrfToken || null,
        loginUrl: '/api/auth/login' });
    });
    app.get('/api/auth/login', (req, res) => {
      if (mode === 'local') { session(req, res); return res.redirect('/'); }
      if (mode === 'accounts') return res.redirect('/');
      const state = token();
      for (const [key, expires] of states) if (expires < Date.now()) states.delete(key);
      states.set(state, Date.now() + ASSERTION_MS);
      res.setHeader('Set-Cookie', stateCookie(state, secure, ASSERTION_MS / 1000));
      const url = new URL(env.EXTERNAL_LOGIN_URL);
      url.searchParams.set('state', state);
      res.redirect(url.toString());
    });
    app.post('/api/auth/password', (req, res) => {
      if (mode !== 'accounts') return res.status(404).json({ error: '接口不存在' });
      if (!req.is('application/json')) return res.status(415).json({ error: '需要 JSON 请求' });
      const id = req.body?.id;
      const password = req.body?.password;
      if (typeof id !== 'string' || typeof password !== 'string' || id.length > 64 || password.length > 256) {
        return res.status(400).json({ error: '账号或密码格式错误' });
      }
      const clientIp = env.AUTH_TRUST_PROXY === 'true'
        ? String(req.headers['x-forwarded-for'] || '').split(',').at(-1)?.trim() || req.socket.remoteAddress
        : req.socket.remoteAddress;
      const key = `${clientIp}:${id}`;
      const account = accounts.get(id);
      const failed = account && loginFailures.get(key);
      if (failed?.until > Date.now() && failed.count >= 5) return res.status(429).json({ error: '尝试过多，请稍后重试' });
      const candidate = account ? scryptSync(password, Buffer.from(account.salt, 'hex'), 64) : null;
      if (!account || !timingSafeEqual(candidate, Buffer.from(account.hash, 'hex'))) {
        const count = failed?.until > Date.now() ? failed.count + 1 : 1;
        if (account) loginFailures.set(key, { count, until: Date.now() + LOGIN_ATTEMPT_MS });
        return res.status(401).json({ error: '账号或密码错误' });
      }
      loginFailures.delete(key);
      const current = makeSession(res, { id: account.id, name: account.name, role: account.role });
      res.json({ authenticated: true, mode, user: current.user, csrfToken: current.csrfToken });
    });
    app.post('/api/auth/exchange', (req, res) => {
      if (mode !== 'external') return res.status(404).json({ error: '接口不存在' });
      const body = req.body || {};
      const timestamp = Number(body.timestamp);
      if (!body.corpId || body.corpId !== env.AUTH_CORP_ID || typeof body.id !== 'string' || !body.id.trim() || body.id.length > 128 || /[\r\n]/.test(body.id) ||
          typeof body.name !== 'string' || !body.name.trim() || body.name.length > 128 || /[\r\n]/.test(body.name) || !ROLES.has(body.role) ||
          !Number.isSafeInteger(timestamp) || Math.abs(Date.now() - timestamp) > ASSERTION_MS ||
          typeof body.nonce !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(body.nonce) ||
          !same(body.state, cookies(req).investment_login_state) || (states.get(body.state) || 0) < Date.now()) {
        return res.status(403).json({ error: '身份声明无效' });
      }
      const expected = createHmac('sha256', env.AUTH_SHARED_SECRET).update(assertionText(body)).digest('hex');
      if (!same(body.signature, expected)) return res.status(403).json({ error: '身份签名无效' });
      for (const [nonce, expires] of nonces) if (expires < Date.now()) nonces.delete(nonce);
      if (nonces.has(body.nonce)) return res.status(403).json({ error: '身份声明已使用' });
      nonces.set(body.nonce, Date.now() + ASSERTION_MS);
      states.delete(body.state);
      const current = makeSession(res, { id: body.id, name: body.name, role: body.role });
      res.append('Set-Cookie', stateCookie('', secure, 0));
      if (req.is('application/x-www-form-urlencoded')) return res.redirect(303, '/');
      res.json({ authenticated: true, mode, user: current.user, csrfToken: current.csrfToken });
    });
    app.post('/api/auth/logout', (req, res) => {
      const id = cookies(req).investment_session;
      const current = id && sessions.get(id);
      if (!current) return res.status(401).json({ error: '请先登录' });
      if (!same(req.headers['x-csrf-token'], current.csrfToken)) return res.status(403).json({ error: 'CSRF 校验失败' });
      sessions.delete(id);
      res.setHeader('Set-Cookie', cookie('', secure, 0));
      res.status(204).end();
    });
  }
  return { mode, routes, read, write, admin };
}
