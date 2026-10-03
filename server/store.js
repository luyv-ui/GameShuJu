import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');
const dataFile = path.join(dataDir, 'games.json');
const seedFile = path.join(dataDir, 'seed.json');

export function listGames() {
  if (!fs.existsSync(dataFile)) return JSON.parse(fs.readFileSync(seedFile, 'utf8'));
  return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
}

function saveGames(games) {
  fs.mkdirSync(dataDir, { recursive: true });
  const tempFile = `${dataFile}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(games, null, 2));
  fs.renameSync(tempFile, dataFile);
}

export function validateGame(input) {
  if (!input || typeof input !== 'object') throw new Error('请填写游戏信息');
  const name = String(input.name || '').trim();
  const genre = String(input.genre || '').trim();
  if (!name || !genre) throw new Error('游戏名称和类型为必填项');
  if (name.length > 120 || genre.length > 50) throw new Error('名称或类型过长');
  const numeric = (key, max) => {
    const value = Number(input[key] ?? 0);
    if (!Number.isFinite(value) || value < 0 || value > max) throw new Error(`${key} 数值无效`);
    return value;
  };
  const url = String(input.sourceUrl || '').trim();
  if (url && !/^https?:\/\//i.test(url)) throw new Error('来源链接必须以 http:// 或 https:// 开头');
  const platforms = Array.isArray(input.platforms) ? input.platforms : [];
  const tags = Array.isArray(input.tags) ? input.tags : [];
  return {
    name, genre,
    englishName: String(input.englishName || '').trim().slice(0, 120),
    platforms: platforms.map(String).map(x => x.trim()).filter(Boolean).slice(0, 10),
    releaseDate: String(input.releaseDate || '').slice(0, 10),
    developer: String(input.developer || '').trim().slice(0, 120),
    publisher: String(input.publisher || '').trim().slice(0, 120),
    price: numeric('price', 100000),
    rating: numeric('rating', 100),
    reviewCount: numeric('reviewCount', 1000000000),
    peakPlayers: numeric('peakPlayers', 1000000000),
    tags: tags.map(String).map(x => x.trim()).filter(Boolean).slice(0, 12),
    description: String(input.description || '').trim().slice(0, 1000),
    sourceUrl: url,
    steamAppId: Number.isInteger(Number(input.steamAppId)) && Number(input.steamAppId) > 0 ? Number(input.steamAppId) : null,
    isDemo: Boolean(input.isDemo)
  };
}

export function createGame(input) {
  const game = { id: randomUUID(), ...validateGame(input), updatedAt: new Date().toISOString() };
  const games = listGames();
  games.unshift(game);
  saveGames(games);
  return game;
}

export function updateGame(id, input) {
  const games = listGames();
  const index = games.findIndex(game => game.id === id);
  if (index < 0) return null;
  games[index] = { ...games[index], ...validateGame(input), id, updatedAt: new Date().toISOString() };
  saveGames(games);
  return games[index];
}

export function deleteGame(id) {
  const games = listGames();
  const filtered = games.filter(game => game.id !== id);
  if (filtered.length === games.length) return false;
  saveGames(filtered);
  return true;
}
