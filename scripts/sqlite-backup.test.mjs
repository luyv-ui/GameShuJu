import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { backupDatabase, restoreDatabase } from './sqlite-backup.mjs';

test('backup and restore preserve a consistent SQLite snapshot without overwriting files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-backup-test-'));
  const source = path.join(dir, 'source.sqlite');
  const backup = path.join(dir, 'backup.sqlite');
  const restored = path.join(dir, 'restored.sqlite');
  try {
    const db = new Database(source);
    db.exec('CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO records (value) VALUES (\'preserved\')');
    db.close();
    assert.equal(await backupDatabase(source, backup), backup);
    assert.equal(restoreDatabase(backup, restored), restored);
    const read = new Database(restored, { readonly: true });
    try { assert.equal(read.prepare('SELECT value FROM records').get().value, 'preserved'); }
    finally { read.close(); }
    await assert.rejects(backupDatabase(source, backup), /不存在的新文件/);
    assert.throws(() => restoreDatabase(backup, source), /不存在的新文件/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
