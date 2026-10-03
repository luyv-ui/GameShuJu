import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createGame, deleteGame, importGames, listGames, updateGame } from './store.js';
import { createProject, deleteProject, listProjects, updateProject } from './projects.js';
import { getScoreConfig, putScoreConfig } from './score-config.js';
import { withDatabase, withDatabaseTransaction } from './db.js';

function temporaryDatabase(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'game-sqlite-test-'));
  const previous = process.env.DATABASE_FILE;
  process.env.DATABASE_FILE = path.join(dir, 'data.sqlite');
  try { return run(dir); }
  finally {
    if (previous === undefined) delete process.env.DATABASE_FILE;
    else process.env.DATABASE_FILE = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('SQLite CRUD preserves missing values, projections and live score configuration', () => temporaryDatabase(() => {
  const game = createGame({ name: '样本游戏', genre: '策略' });
  assert.equal(listGames()[0].price, null);
  assert.equal(updateGame(game.id, { name: '更新游戏', genre: '策略' }).name, '更新游戏');
  assert.deepEqual(importGames({ games: [{ name: '导入', genre: '策略', sourceUrl: 'https://example.com/game' }] }),
    { added: 1, replaced: 0, skipped: 0, total: 2 });
  assert.equal(deleteGame(game.id), true);
  const project = createProject({ name: '投资项目', genre: '策略', stage: 'concept', risks: [
    { id: 'risk-1', category: 'ip', description: '待核查', status: 'unverified', severity: 'high' }
  ], investmentInputs: { market: { tam: 0 }, users: { d1Pct: 0 } } });
  assert.equal(project.investmentInputs.market.tam, 0);
  assert.equal(project.investmentInputs.market.growth12mPct, null);
  withDatabase(db => {
    assert.equal(db.prepare('SELECT tam FROM market_analysis').get().tam, 0);
    assert.equal(db.prepare('SELECT growth_12m_pct FROM market_analysis').get().growth_12m_pct, null);
    assert.equal(db.prepare('SELECT d1_pct FROM user_metric').get().d1_pct, 0);
    assert.equal(db.prepare('SELECT status FROM risk_analysis').get().status, 'unverified');
    for (const table of ['commercial', 'version_ops', 'benchmark_compare', 'investment_report']) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 1);
    }
  });
  const updated = updateProject(project.id, { name: '投资项目', genre: '策略', stage: 'prototype', risks: [] });
  assert.equal(updated.investmentInputs.market.tam, 0);
  withDatabase(db => assert.equal(db.prepare('SELECT COUNT(*) AS count FROM risk_analysis').get().count, 0));
  const changed = getScoreConfig();
  changed.thresholds.irrTargetPct = 25;
  putScoreConfig(changed);
  assert.equal(getScoreConfig().thresholds.irrTargetPct, 25);
  assert.equal(listProjects()[0].stage, 'prototype');
  assert.equal(deleteProject(project.id), true);
  assert.deepEqual(listProjects(), []);
}));

test('SQLite transaction rolls back all records after an error', () => temporaryDatabase(() => {
  assert.throws(() => withDatabaseTransaction(db => {
    db.prepare(`INSERT INTO game_base (id, position, payload) VALUES ('rollback', 0, '{}')`).run();
    throw new Error('abort');
  }), /abort/);
  assert.deepEqual(listGames(), []);
}));

test('SQLite concurrent writers retain every game', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'game-sqlite-process-test-'));
  const database = path.join(dir, 'games.sqlite');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const worker = index => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e',
      `import { createGame } from './server/store.js'; createGame({ name: 'Worker ${index}', genre: '解谜' });`],
    { cwd: root, env: { ...process.env, DATABASE_FILE: database } });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(stderr)));
  });
  try {
    await Promise.all(Array.from({ length: 8 }, (_, index) => worker(index)));
    const previous = process.env.DATABASE_FILE;
    process.env.DATABASE_FILE = database;
    try {
      assert.equal(listGames().length, 8);
      assert.equal(new Set(listGames().map(game => game.name)).size, 8);
    } finally {
      if (previous === undefined) delete process.env.DATABASE_FILE;
      else process.env.DATABASE_FILE = previous;
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
