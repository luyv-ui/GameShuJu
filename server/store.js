import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { sqliteEnabled, withDatabase, withDatabaseTransaction, dbListGames, dbSaveGames } from './db.js';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');
const defaultDataFile = path.join(dataDir, 'games.json');
const seedFile = path.join(dataDir, 'seed.json');
const steamDataFile = path.join(dataDir, 'collected', 'steam-latest.json');
const dataFile = () => process.env.GAME_DATA_FILE || defaultDataFile;

function readSteamData() {
  if (!fs.existsSync(steamDataFile)) return null;
  try { return JSON.parse(fs.readFileSync(steamDataFile, 'utf8')); }
  catch (error) {
    console.error('Unable to read collected Steam data:', error);
    return null;
  }
}

export function gameChannel(game) {
  if (['端游', 'App', '小游戏'].includes(game.channel)) return game.channel;
  if (game.platforms?.some(platform => /微信|抖音|小游戏|小程序/.test(platform))) return '小游戏';
  if (game.platforms?.some(platform => ['iOS', 'Android'].includes(platform))) return 'App';
  return '端游';
}

function readBaseGames() {
  if (sqliteEnabled()) return withDatabase(db => dbListGames(db));
  const file = dataFile();
  return JSON.parse(fs.readFileSync(fs.existsSync(file) ? file : seedFile, 'utf8'));
}

export function listGames() {
  const games = readBaseGames().map(game => ({ ...game, channel: gameChannel(game) }));
  const steamData = readSteamData();
  if (!steamData) return games;
  const byAppId = new Map(steamData.games.map(game => [Number(game.steamAppId), game]));
  return games.map(game => {
    const collected = byAppId.get(Number(game.steamAppId));
    if (!collected || collected.status !== 'ok') return game;
    return {
      ...game,
      currentPlayers: collected.currentPlayers,
      steamNewsCounts: collected.newsCounts,
      latestSteamNews: collected.news.slice(0, 5),
      steamCapturedAt: collected.capturedAt,
      hasLiveData: true
    };
  });
}

function saveGames(games) {
  const file = dataFile();
  const tempFile = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(games, null, 2));
    fs.renameSync(tempFile, file);
  } finally {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
}

function withWriteLock(operation) {
  const file = dataFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lockFile = `${file}.lock`;
  const deadline = Date.now() + 5000;
  while (true) {
    try {
      const fd = fs.openSync(lockFile, 'wx');
      try { fs.writeFileSync(fd, String(process.pid)); }
      finally { fs.closeSync(fd); }
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // A crashed writer may leave its lock behind; never reclaim a recent lock.
      try {
        const stat = fs.statSync(lockFile);
        if (Date.now() - stat.mtimeMs > 30000) {
          const pid = Number(fs.readFileSync(lockFile, 'utf8'));
          let alive = Number.isSafeInteger(pid) && pid > 0;
          if (alive) {
            try { process.kill(pid, 0); }
            catch (probeError) { alive = probeError.code !== 'ESRCH'; }
          }
          if (!alive) { fs.unlinkSync(lockFile); continue; }
        }
      } catch (readError) {
        if (readError.code !== 'ENOENT') throw readError;
      }
      if (Date.now() >= deadline) throw new Error('数据文件正在写入，请稍后重试');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try { return operation(); }
  finally { fs.unlinkSync(lockFile); }
}

function checkedUrl(value, label) {
  const url = String(value || '').trim();
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (url.length <= 2048 && ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname) return url;
  } catch { /* Report the same validation error below. */ }
  throw new Error(`${label}必须是有效的 http:// 或 https:// 链接`);
}

function checkedDate(value, label) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label}必须是有效的 YYYY-MM-DD 日期`);
  }
  return value;
}

function checkedSourceExtras(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('sourceExtras 格式无效');
  const limits = { appStoreId: Number.MAX_SAFE_INTEGER, usPriceUsd: 100000,
    usRatingOutOf5: 5, usRatingCount: 1000000000 };
  const result = {};
  for (const [key, field] of Object.entries(value)) {
    if (!Object.hasOwn(limits, key)) throw new Error(`sourceExtras 不支持字段 ${key}`);
    if (field === null) { result[key] = null; continue; }
    if (typeof field !== 'number' || !Number.isFinite(field) || field < 0 || field > limits[key] ||
        (['appStoreId', 'usRatingCount'].includes(key) && !Number.isSafeInteger(field)) ||
        (key === 'appStoreId' && field === 0)) throw new Error(`sourceExtras.${key} 数值无效`);
    result[key] = field;
  }
  return result;
}

export function validateGame(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('请填写游戏信息');
  if (input.channel !== undefined && !['端游', 'App', '小游戏'].includes(input.channel)) throw new Error('产品分类无效');
  const name = String(input.name || '').trim();
  const genre = String(input.genre || '').trim();
  if (!name || !genre) throw new Error('游戏名称和类型为必填项');
  if (name.length > 120 || genre.length > 50) throw new Error('名称或类型过长');
  const numeric = (key, max) => {
    if (input[key] === null || input[key] === undefined || input[key] === '') return null;
    const value = Number(input[key]);
    if (typeof input[key] === 'boolean' || !Number.isFinite(value) || value < 0 || value > max ||
        (['reviewCount', 'peakPlayers'].includes(key) && !Number.isSafeInteger(value))) throw new Error(`${key} 数值无效`);
    return value;
  };
  const url = checkedUrl(input.sourceUrl, '来源链接');
  const metricsUrl = checkedUrl(input.metricsSourceUrl, '指标来源链接');
  const platforms = Array.isArray(input.platforms) ? input.platforms : [];
  const tags = Array.isArray(input.tags) ? input.tags : [];
  const steamAppId = input.steamAppId === null || input.steamAppId === undefined || input.steamAppId === ''
    ? null : Number(input.steamAppId);
  if (steamAppId !== null && (!Number.isSafeInteger(steamAppId) || steamAppId <= 0)) throw new Error('steamAppId 数值无效');
  const game = {
    name, genre,
    channel: gameChannel(input),
    englishName: String(input.englishName || '').trim().slice(0, 120),
    platforms: platforms.map(String).map(x => x.trim()).filter(Boolean).slice(0, 10),
    releaseDate: checkedDate(input.releaseDate, '发售日期'),
    developer: String(input.developer || '').trim().slice(0, 120),
    publisher: String(input.publisher || '').trim().slice(0, 120),
    price: numeric('price', 100000),
    rating: numeric('rating', 100),
    reviewCount: numeric('reviewCount', 1000000000),
    peakPlayers: numeric('peakPlayers', 1000000000),
    tags: tags.map(String).map(x => x.trim()).filter(Boolean).slice(0, 12),
    description: String(input.description || '').trim().slice(0, 1000),
    sourceUrl: url,
    metricsSourceUrl: metricsUrl,
    dataAsOf: checkedDate(input.dataAsOf, '采集日期'),
    metricScope: String(input.metricScope || '').trim().slice(0, 120),
    steamAppId,
    isDemo: Boolean(input.isDemo)
  };
  if (Object.hasOwn(input, 'sourceExtras')) game.sourceExtras = checkedSourceExtras(input.sourceExtras);
  return game;
}

function gameKeys(game) {
  const keys = [];
  if (game.steamAppId) keys.push(`steam:${game.steamAppId}`);
  if (game.sourceExtras?.appStoreId) keys.push(`appstore:${game.sourceExtras.appStoreId}`);
  if (game.sourceUrl) {
    try {
      const url = new URL(game.sourceUrl);
      keys.push(`url:${url.origin.toLowerCase()}${url.pathname.replace(/\/$/, '')}${url.search}`);
    } catch { /* Older saved records may contain a malformed source URL. */ }
  }
  if (!game.steamAppId && !game.sourceExtras?.appStoreId) {
    keys.push(`name:${game.name.trim().toLocaleLowerCase()}:${[...game.platforms].map(x => x.toLocaleLowerCase()).sort().join(',')}`);
  }
  return keys;
}

export function importGames(document, { refreshExisting = false } = {}) {
  if (!document || !Array.isArray(document.games) || !document.games.length || document.games.length > 2000) {
    throw new Error('导入文档须包含 1 至 2000 条 games 记录');
  }
  const incoming = document.games.map(validateGame);
  if (incoming.some(game => !game.sourceUrl)) throw new Error('导入记录必须包含来源链接');
  const operation = db => {
    const games = (db ? dbListGames(db) : readBaseGames()).map(game => ({ ...game, channel: gameChannel(game) }));
    const keys = new Map();
    games.forEach((game, index) => gameKeys(game).forEach(key => {
      const previous = keys.get(key);
      if (previous === undefined || (games[previous].isDemo && !game.isDemo)) keys.set(key, index);
    }));
    const now = new Date().toISOString();
    let added = 0;
    let replaced = 0;
    let updated = 0;
    let skipped = 0;
    for (const game of incoming) {
      const identities = gameKeys(game);
      const index = identities.map(key => keys.get(key)).find(value => value !== undefined);
      if (index !== undefined) {
        if (games[index].isDemo) {
          games[index] = { ...games[index], ...game, updatedAt: now };
          gameKeys(games[index]).forEach(key => keys.set(key, index));
          replaced++;
        } else if (refreshExisting && game.sourceUrl && gameKeys(games[index]).some(key => identities.includes(key) && key !== `name:${game.name.trim().toLocaleLowerCase()}:${[...game.platforms].map(x => x.toLocaleLowerCase()).sort().join(',')}`) &&
          game.dataAsOf && game.dataAsOf >= (games[index].dataAsOf || '')) {
          const previous = games[index];
          const retainedSteamMetrics = ['price', 'rating', 'reviewCount', 'peakPlayers'].some(field =>
            game[field] === null && previous[field] !== null && previous[field] !== undefined);
          const extras = game.sourceExtras && previous.sourceExtras
            ? Object.fromEntries(Object.keys({ ...previous.sourceExtras, ...game.sourceExtras }).map(key =>
              [key, game.sourceExtras[key] ?? previous.sourceExtras[key] ?? null]))
            : game.sourceExtras ?? previous.sourceExtras;
          const next = { ...previous, ...game,
            genre: game.genre === '未分类' ? previous.genre : game.genre,
            englishName: game.englishName || previous.englishName,
            price: game.price ?? previous.price,
            rating: game.rating ?? previous.rating,
            reviewCount: game.reviewCount ?? previous.reviewCount,
            peakPlayers: game.peakPlayers ?? previous.peakPlayers,
            metricsSourceUrl: game.metricsSourceUrl || previous.metricsSourceUrl,
            sourceExtras: extras,
            metricScope: retainedSteamMetrics ? previous.metricScope : game.metricScope,
            releaseDate: game.releaseDate || previous.releaseDate,
            developer: game.developer || previous.developer,
            publisher: game.publisher || previous.publisher,
            description: game.description || previous.description,
            tags: game.tags.length ? game.tags : previous.tags,
            updatedAt: now };
          if (JSON.stringify({ ...next, updatedAt: '' }) !== JSON.stringify({ ...previous, updatedAt: '' })) {
            games[index] = next;
            updated++;
          } else skipped++;
        } else skipped++;
        continue;
      }
      const nextIndex = games.length;
      identities.forEach(key => keys.set(key, nextIndex));
      games.push({ id: randomUUID(), ...game, updatedAt: now });
      added++;
    }
    if (added || replaced || updated) db ? dbSaveGames(db, games) : saveGames(games);
    return refreshExisting ? { added, replaced, updated, skipped, total: games.length }
      : { added, replaced, skipped, total: games.length };
  };
  return sqliteEnabled() ? withDatabaseTransaction(operation) : withWriteLock(() => operation(null));
}

export function createGame(input) {
  const valid = validateGame(input);
  const operation = db => {
    const game = { id: randomUUID(), ...valid, updatedAt: new Date().toISOString() };
    const games = db ? dbListGames(db) : readBaseGames();
    games.unshift(game);
    db ? dbSaveGames(db, games) : saveGames(games);
    return game;
  };
  return sqliteEnabled() ? withDatabaseTransaction(operation) : withWriteLock(() => operation(null));
}

export function updateGame(id, input) {
  const valid = validateGame(input);
  const operation = db => {
    const games = db ? dbListGames(db) : readBaseGames();
    const index = games.findIndex(game => game.id === id);
    if (index < 0) return null;
    games[index] = { ...games[index], ...valid, id, updatedAt: new Date().toISOString() };
    db ? dbSaveGames(db, games) : saveGames(games);
    return games[index];
  };
  return sqliteEnabled() ? withDatabaseTransaction(operation) : withWriteLock(() => operation(null));
}

export function deleteGame(id) {
  const operation = db => {
    const games = db ? dbListGames(db) : readBaseGames();
    const filtered = games.filter(game => game.id !== id);
    if (filtered.length === games.length) return false;
    db ? dbSaveGames(db, filtered) : saveGames(filtered);
    return true;
  };
  return sqliteEnabled() ? withDatabaseTransaction(operation) : withWriteLock(() => operation(null));
}
