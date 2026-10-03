import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withDatabaseTransaction, dbListGames, dbListProjects,
  dbGetScoreConfig, dbSaveGames, dbSaveProjects, dbPutScoreConfig } from '../server/db.js';
import { defaultScoreConfig, validateScoreConfig } from '../server/score-config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

export function migrateJsonToSqlite(options = {}) {
  const database = options.database ?? process.env.DATABASE_FILE;
  if (!database) throw new Error('请通过 --database 或 DATABASE_FILE 指定 SQLite 文件');
  const gamesFile = options.gamesFile ?? process.env.GAME_DATA_FILE ?? path.join(root, 'data/games.json');
  const projectsFile = options.projectsFile ?? process.env.PROJECT_DATA_FILE ?? path.join(root, 'data/projects.json');
  const scoreFile = options.scoreFile ?? process.env.SCORE_CONFIG_FILE ?? path.join(root, 'data/score-config.json');
  const games = readJson(gamesFile, readJson(path.join(root, 'data/seed.json'), []));
  const projects = readJson(projectsFile, []);
  const scoreConfig = validateScoreConfig(readJson(scoreFile, defaultScoreConfig));
  if (!Array.isArray(games) || !Array.isArray(projects)) throw new Error('游戏或项目 JSON 必须为数组');
  const previous = process.env.DATABASE_FILE;
  process.env.DATABASE_FILE = database;
  try {
    return withDatabaseTransaction(db => {
      const existingGames = dbListGames(db);
      const existingProjects = dbListProjects(db);
      const existingConfig = dbGetScoreConfig(db);
      if (existingGames.length || existingProjects.length || existingConfig) {
        if (!same(existingGames, games) || !same(existingProjects, projects) ||
            !same(existingConfig ?? defaultScoreConfig, scoreConfig)) {
          throw new Error('目标数据库已有不同数据；请指定新的数据库文件');
        }
        return { games: games.length, projects: projects.length, scoreConfig: 1, unchanged: true };
      }
      dbSaveGames(db, games);
      dbSaveProjects(db, projects);
      dbPutScoreConfig(db, scoreConfig);
      if (!same(dbListGames(db), games) || !same(dbListProjects(db), projects) ||
          !same(dbGetScoreConfig(db), scoreConfig)) throw new Error('迁移校验失败，已回滚');
      const riskCount = projects.reduce((count, project) => count + (project.risks?.length ?? 0), 0);
      if (db.prepare('SELECT COUNT(*) AS count FROM risk_analysis').get().count !== riskCount) {
        throw new Error('风险数据数量校验失败，已回滚');
      }
      for (const table of ['market_analysis', 'user_metric', 'commercial', 'version_ops',
        'benchmark_compare', 'investment_report']) {
        if (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count !== projects.length) {
          throw new Error(`${table} 数据数量校验失败，已回滚`);
        }
      }
      return { games: games.length, projects: projects.length, risks: riskCount,
        scoreConfig: 1, unchanged: false };
    });
  } finally {
    if (previous === undefined) delete process.env.DATABASE_FILE;
    else process.env.DATABASE_FILE = previous;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const value = flag => {
      const index = args.indexOf(flag);
      return index < 0 ? undefined : args[index + 1];
    };
    const result = migrateJsonToSqlite({ database: value('--database'), gamesFile: value('--games'),
      projectsFile: value('--projects'), scoreFile: value('--score-config') });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
