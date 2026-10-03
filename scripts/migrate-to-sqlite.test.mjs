import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateJsonToSqlite } from './migrate-to-sqlite.mjs';
import { withDatabase, dbListGames, dbListProjects, dbGetScoreConfig } from '../server/db.js';
import { defaultScoreConfig } from '../server/score-config.js';

test('JSON migration fills all business tables, keeps source files and is idempotent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'game-migration-test-'));
  const gamesFile = path.join(dir, 'games.json');
  const projectsFile = path.join(dir, 'projects.json');
  const scoreFile = path.join(dir, 'score.json');
  const database = path.join(dir, 'data.sqlite');
  const games = [{ id: 'game-1', name: '历史游戏', genre: '策略', extraLegacy: { keep: true } }];
  const projects = [{ id: 'project-1', name: '历史项目', genre: '策略', stage: 'concept',
    risks: [{ id: 'risk-1', status: 'confirmed', severity: 'high', category: 'ip' }],
    investmentInputs: { market: { tam: null, growth12mPct: 0 }, finance: { upfrontCost: 100 } },
    extraLegacy: 'retained' }];
  fs.writeFileSync(gamesFile, JSON.stringify(games));
  fs.writeFileSync(projectsFile, JSON.stringify(projects));
  fs.writeFileSync(scoreFile, JSON.stringify(defaultScoreConfig));
  const options = { database, gamesFile, projectsFile, scoreFile };
  const originalGames = fs.readFileSync(gamesFile);
  const originalProjects = fs.readFileSync(projectsFile);
  try {
    assert.deepEqual(migrateJsonToSqlite(options), { games: 1, projects: 1, risks: 1, scoreConfig: 1, unchanged: false });
    assert.equal(migrateJsonToSqlite(options).unchanged, true);
    assert.deepEqual(fs.readFileSync(gamesFile), originalGames);
    assert.deepEqual(fs.readFileSync(projectsFile), originalProjects);
    const previous = process.env.DATABASE_FILE;
    process.env.DATABASE_FILE = database;
    try {
      withDatabase(db => {
        assert.deepEqual(dbListGames(db), games);
        assert.deepEqual(dbListProjects(db), projects);
        assert.deepEqual(dbGetScoreConfig(db), defaultScoreConfig);
        assert.equal(db.prepare('SELECT growth_12m_pct FROM market_analysis').get().growth_12m_pct, 0);
        assert.equal(db.prepare('SELECT tam FROM market_analysis').get().tam, null);
        assert.equal(db.prepare('SELECT status FROM risk_analysis').get().status, 'confirmed');
        assert.equal(db.prepare('SELECT upfront_cost FROM investment_report').get().upfront_cost, 100);
      });
    } finally {
      if (previous === undefined) delete process.env.DATABASE_FILE;
      else process.env.DATABASE_FILE = previous;
    }
    fs.writeFileSync(projectsFile, JSON.stringify([...projects, { ...projects[0], id: 'project-2' }]));
    assert.throws(() => migrateJsonToSqlite(options), /已有不同数据/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('bad source records roll back migration without changing JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'game-migration-rollback-'));
  const gamesFile = path.join(dir, 'games.json');
  const projectsFile = path.join(dir, 'projects.json');
  const scoreFile = path.join(dir, 'score.json');
  const database = path.join(dir, 'data.sqlite');
  fs.writeFileSync(gamesFile, JSON.stringify([{ id: 'duplicate', name: 'A' }, { id: 'duplicate', name: 'B' }]));
  fs.writeFileSync(projectsFile, '[]');
  fs.writeFileSync(scoreFile, JSON.stringify(defaultScoreConfig));
  try {
    assert.throws(() => migrateJsonToSqlite({ database, gamesFile, projectsFile, scoreFile }), /UNIQUE/);
    const previous = process.env.DATABASE_FILE;
    process.env.DATABASE_FILE = database;
    try { withDatabase(db => assert.equal(db.prepare('SELECT COUNT(*) AS count FROM game_base').get().count, 0)); }
    finally {
      if (previous === undefined) delete process.env.DATABASE_FILE;
      else process.env.DATABASE_FILE = previous;
    }
    assert.equal(JSON.parse(fs.readFileSync(gamesFile)).length, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
