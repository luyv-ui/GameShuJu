import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createGame, importGames, listGames, updateGame, validateGame } from './store.js';

function withTemporaryStore(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'game-store-test-'));
  const previous = process.env.GAME_DATA_FILE;
  process.env.GAME_DATA_FILE = path.join(dir, 'games.json');
  fs.writeFileSync(process.env.GAME_DATA_FILE, '[]');
  try { return run(); }
  finally {
    if (previous === undefined) delete process.env.GAME_DATA_FILE;
    else process.env.GAME_DATA_FILE = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('missing metrics stay missing instead of becoming zero', () => {
  const game = validateGame({ name: '样本', genre: '解谜', price: null, rating: null, reviewCount: null, peakPlayers: null });
  assert.equal(game.price, null);
  assert.equal(game.rating, null);
  assert.equal(game.reviewCount, null);
  assert.equal(game.peakPlayers, null);
});

test('import rejects records without a source before changing the library', () => {
  assert.throws(() => importGames({ games: [{ name: '无来源', genre: '解谜' }] }), /来源链接/);
  assert.throws(() => validateGame({ name: '无效链接', genre: '解谜', metricsSourceUrl: 'javascript:alert(1)' }), /指标来源链接/);
});

test('source extras preserve distinct App Store units and reject unknown fields', () => {
  const input = { name: 'Monument Valley', genre: '解谜', platforms: ['iOS'],
    sourceUrl: 'https://apps.apple.com/us/app/monument-valley/id728293409?uo=4',
    sourceExtras: { appStoreId: 728293409, usPriceUsd: 3.99, usRatingOutOf5: 4.77, usRatingCount: 16917 } };
  const game = validateGame(input);
  assert.deepEqual(game.sourceExtras, input.sourceExtras);
  assert.equal(game.price, null);
  assert.equal(game.rating, null);
  assert.throws(() => validateGame({ ...input, sourceExtras: { arbitrary: 'value' } }), /不支持字段/);
  assert.throws(() => validateGame({ ...input, sourceExtras: { usRatingOutOf5: 6 } }), /数值无效/);
  assert.throws(() => validateGame({ ...input, sourceExtras: [] }), /格式无效/);
  assert.equal(validateGame({ ...input, sourceExtras: null }).sourceExtras, null);
});

test('import de-duplicates within a batch and across changed platform order or URL query', () => withTemporaryStore(() => {
  const input = { name: 'Example', genre: '解谜', platforms: ['PC', 'Switch'],
    sourceUrl: 'https://example.com/game?id=1', sourceExtras: { usPriceUsd: 2.99 } };
  assert.deepEqual(importGames({ games: [input, input] }), { added: 1, replaced: 0, skipped: 1, total: 1 });
  assert.deepEqual(importGames({ games: [{ ...input, platforms: ['Switch', 'PC'], sourceUrl: 'https://example.com/game?id=2' }] }),
    { added: 0, replaced: 0, skipped: 1, total: 1 });
  assert.equal(listGames()[0].sourceExtras.usPriceUsd, 2.99);
}));

test('different store IDs do not merge solely because names match', () => withTemporaryStore(() => {
  const base = { name: 'Example', genre: '解谜', platforms: ['PC'] };
  const result = importGames({ games: [
    { ...base, steamAppId: 1, sourceUrl: 'https://store.steampowered.com/app/1/' },
    { ...base, steamAppId: 2, sourceUrl: 'https://store.steampowered.com/app/2/' }
  ] });
  assert.equal(result.added, 2);
}));

test('store URLs with distinct product query IDs remain separate', () => withTemporaryStore(() => {
  const base = { genre: '冒险', platforms: ['Android'] };
  const result = importGames({ games: [
    { ...base, name: 'Minecraft', sourceUrl: 'https://play.google.com/store/apps/details?id=com.mojang.minecraftpe' },
    { ...base, name: 'Among Us', sourceUrl: 'https://play.google.com/store/apps/details?id=com.innersloth.spacemafia' }
  ] });
  assert.equal(result.added, 2);
}));

test('updating other fields preserves source extras unless explicitly cleared', () => withTemporaryStore(() => {
  const input = { name: 'Example', genre: '解谜', sourceUrl: 'https://example.com/game',
    sourceExtras: { appStoreId: 123, usRatingCount: null } };
  importGames({ games: [input] });
  const id = listGames()[0].id;
  const { sourceExtras, ...withoutExtras } = input;
  assert.deepEqual(updateGame(id, { ...withoutExtras, genre: '冒险' }).sourceExtras, sourceExtras);
  assert.equal(updateGame(id, { ...withoutExtras, sourceExtras: null }).sourceExtras, null);
}));

test('dates, URLs and count metrics reject malformed input', () => {
  const base = { name: 'Example', genre: '解谜' };
  assert.throws(() => validateGame({ ...base, releaseDate: '2026-02-30' }), /发售日期/);
  assert.throws(() => validateGame({ ...base, sourceUrl: 'https:///' }), /来源链接/);
  assert.throws(() => validateGame({ ...base, reviewCount: 1.5 }), /reviewCount/);
  assert.throws(() => validateGame({ ...base, steamAppId: -1 }), /steamAppId/);
  assert.throws(() => validateGame({ ...base, channel: '网页' }), /产品分类/);
});

test('legacy records infer a channel and a catalog batch above 500 imports once', () => withTemporaryStore(() => {
  const records = Array.from({ length: 510 }, (_, index) => ({
    name: `Catalog ${index}`, genre: '策略', channel: '小游戏', platforms: ['微信小游戏'],
    sourceUrl: `https://sj.qq.com/appdetail/wx${String(index).padStart(16, '0')}`
  }));
  assert.equal(importGames({ games: records }).added, 510);
  assert.equal(importGames({ games: records }).skipped, 510);
  assert.equal(listGames().filter(game => game.channel === '小游戏').length, 510);
  fs.writeFileSync(process.env.GAME_DATA_FILE, JSON.stringify([{ id: 'old', name: 'Old App', genre: '休闲', platforms: ['iOS'] }]));
  assert.equal(listGames()[0].channel, 'App');
}));

test('an old empty lock left before PID write can be reclaimed', () => withTemporaryStore(() => {
  const lockFile = `${process.env.GAME_DATA_FILE}.lock`;
  fs.writeFileSync(lockFile, '');
  const old = new Date(Date.now() - 31000);
  fs.utimesSync(lockFile, old, old);
  assert.equal(createGame({ name: 'Recovered', genre: '解谜' }).name, 'Recovered');
  assert.equal(fs.existsSync(lockFile), false);
  assert.equal(listGames().length, 1);
}));

test('concurrent writers retain every record', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'game-store-process-test-'));
  const file = path.join(dir, 'games.json');
  fs.writeFileSync(file, '[]');
  const worker = index => new Promise((resolve, reject) => {
    const code = `import { createGame } from './server/store.js'; createGame({ name: 'Worker ${index}', genre: '解谜' });`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
      cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), env: { ...process.env, GAME_DATA_FILE: file }
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', status => status === 0 ? resolve() : reject(new Error(stderr)));
  });
  try {
    await Promise.all(Array.from({ length: 8 }, (_, index) => worker(index)));
    const games = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(games.length, 8);
    assert.equal(new Set(games.map(game => game.name)).size, 8);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
