import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

function verifyDatabase(filename) {
  const db = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('SQLite 完整性检查失败');
  } finally { db.close(); }
}

export async function backupDatabase(source, destination) {
  if (!source || !destination) throw new Error('需要 --database 和 --output');
  const input = path.resolve(source);
  const output = path.resolve(destination);
  if (input === output || fs.existsSync(output)) throw new Error('备份目标必须是不存在的新文件');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const db = new Database(input, { readonly: true, fileMustExist: true });
  let reserved = false;
  try {
    fs.closeSync(fs.openSync(output, 'wx'));
    reserved = true;
    await db.backup(output);
    verifyDatabase(output);
  } catch (error) {
    if (reserved) fs.unlinkSync(output);
    throw error;
  } finally { db.close(); }
  return output;
}

export function restoreDatabase(backup, destination) {
  if (!backup || !destination) throw new Error('需要 --backup 和 --database');
  const input = path.resolve(backup);
  const output = path.resolve(destination);
  if (input === output || fs.existsSync(output)) throw new Error('恢复目标必须是不存在的新文件');
  verifyDatabase(input);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  let copied = false;
  try {
    fs.copyFileSync(input, output, fs.constants.COPYFILE_EXCL);
    copied = true;
    verifyDatabase(output);
  } catch (error) {
    if (copied) fs.unlinkSync(output);
    throw error;
  }
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = flag => {
    const index = args.indexOf(flag);
    return index < 0 ? undefined : args[index + 1];
  };
  try {
    const result = args[0] === 'backup'
      ? await backupDatabase(value('--database'), value('--output'))
      : args[0] === 'restore'
        ? restoreDatabase(value('--backup'), value('--database'))
        : (() => { throw new Error('用法: backup --database <源库> --output <新备份> 或 restore --backup <备份> --database <新库>'); })();
    console.log(result);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
