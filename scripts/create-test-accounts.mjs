import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function createTestAccounts(usersFile, credentialsFile) {
  if (!usersFile || !credentialsFile) throw new Error('需要指定账号文件和密码交付文件');
  const usersPath = path.resolve(usersFile);
  const credentialsPath = path.resolve(credentialsFile);
  if (usersPath === credentialsPath || fs.existsSync(usersPath) || fs.existsSync(credentialsPath)) {
    throw new Error('目标文件已存在；为避免覆盖现有账号，请使用新路径');
  }
  const entries = [
    { id: 'investor-demo', name: '投资人测试账号', role: 'investor' },
    { id: 'analyst-demo', name: '分析师测试账号', role: 'analyst' },
    { id: 'admin-demo', name: '管理员测试账号', role: 'admin' }
  ];
  const credentials = entries.map(user => ({ ...user, password: randomBytes(18).toString('base64url') }));
  const users = credentials.map(({ password, ...user }) => {
    const salt = randomBytes(16).toString('hex');
    return { ...user, salt, hash: scryptSync(password, Buffer.from(salt, 'hex'), 64).toString('hex') };
  });
  fs.mkdirSync(path.dirname(usersPath), { recursive: true });
  fs.mkdirSync(path.dirname(credentialsPath), { recursive: true });
  fs.writeFileSync(usersPath, `${JSON.stringify(users, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  try {
    fs.writeFileSync(credentialsPath, credentials.map(({ id, name, role, password }) =>
      `${name} (${role})\n账号：${id}\n初始密码：${password}\n`).join('\n'), { flag: 'wx', mode: 0o600 });
  } catch (error) { fs.unlinkSync(usersPath); throw error; }
  return { usersFile: usersPath, credentialsFile: credentialsPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const value = flag => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
    console.log(JSON.stringify(createTestAccounts(value('--users'), value('--credentials'))));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
