import { fileURLToPath } from 'node:url';

const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);

export async function checkDeployment(baseUrl, expectedMode = 'external', fetcher = fetch) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback.has(base.hostname))) {
    throw new Error('团队访问地址必须使用 HTTPS');
  }
  const request = (path, options = {}) => fetcher(new URL(path, base), { redirect: 'manual', ...options });
  const health = await request('/api/health');
  if (health.status !== 200 || (await health.json()).status !== 'ok') throw new Error('健康检查未通过');

  const me = await request('/api/auth/me');
  if (me.status !== 200) throw new Error('身份状态接口不可用');
  const identity = await me.json();
  if (identity.mode !== expectedMode || identity.authenticated !== false) {
    throw new Error(`身份模式应为 ${expectedMode}，且新访客不能自动登录`);
  }
  const protectedResponse = await request('/api/projects');
  if (protectedResponse.status !== 401) throw new Error('未登录访问业务接口未被拒绝');

  if (expectedMode === 'accounts') {
    const invalid = await request('/api/auth/password', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'invalid-account', password: 'invalid-password' }) });
    if (invalid.status !== 401) throw new Error('错误账号未被拒绝');
    return { health: 'ok', anonymous: 'blocked', login: 'accounts' };
  }

  const login = await request('/api/auth/login');
  if (login.status !== 302) throw new Error('组织登录跳转不可用');
  const destination = new URL(login.headers.get('location'));
  if (destination.protocol !== 'https:' || !destination.searchParams.get('state')) {
    throw new Error('组织登录地址必须为 HTTPS 且包含 state');
  }
  const cookie = login.headers.get('set-cookie') || '';
  if (!/investment_login_state=/.test(cookie) || !/; HttpOnly/i.test(cookie) || !/; Secure/i.test(cookie) || !/; SameSite=None/i.test(cookie)) {
    throw new Error('登录 state Cookie 未设置完整的生产安全属性');
  }
  return { health: 'ok', anonymous: 'blocked', login: destination.origin };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.argv[2];
  if (!url) {
    console.error('用法: npm run check:deployment -- https://团队地址 [--mode accounts]');
    process.exitCode = 1;
  } else {
    try {
      const mode = process.argv[3] === '--mode' ? process.argv[4] : 'external';
      if (!['external', 'accounts'].includes(mode)) throw new Error('模式须为 external 或 accounts');
      console.log(JSON.stringify(await checkDeployment(url, mode)));
    }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
