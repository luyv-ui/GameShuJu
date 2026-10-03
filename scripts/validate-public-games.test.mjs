import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { publishPublicGames, validatePublicGames } from './validate-public-games.mjs';

function fixture() {
  return {
    fetchedAt: '2026-10-03T06:07:30.545Z',
    methodology: 'Steam 中国区人民币原价；全部语言评论，好评率为好评数/评论数；null 表示未采集。',
    sources: ['Steam 商品与评论接口'],
    limitations: ['非全量样本'],
    failures: [],
    games: [{
      name: 'Example', genre: '策略', platforms: ['PC'],
      sourceUrl: 'https://store.steampowered.com/app/1/',
      metricsSourceUrl: 'https://store.steampowered.com/appreviews/1',
      dataAsOf: '2026-10-03', metricScope: 'Steam 中国区人民币原价；全部语言评论',
      steamAppId: 1, price: 0, rating: 90, reviewCount: 10, peakPlayers: null
    }]
  };
}

test('accepts zero price and explicit unknown metric', () => {
  assert.deepEqual(validatePublicGames(fixture(), { expectedCount: 1 }), []);
});

test('rejects partial collections and missing metric provenance', () => {
  const document = fixture();
  document.failures.push({ source: 'Steam 2', error: 'timeout' });
  document.games[0].metricScope = '';
  document.games[0].peakPlayers = undefined;
  const errors = validatePublicGames(document, { expectedCount: 2 });
  assert.ok(errors.some(error => error.includes('失败项目')));
  assert.ok(errors.some(error => error.includes('预期 2 款')));
  assert.ok(errors.some(error => error.includes('metricScope')));
  assert.ok(errors.some(error => error.includes('peakPlayers')));
});

test('publish preserves a valid snapshot on validation failure or name collision', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'game-intelligence-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const document = fixture();
  const filename = await publishPublicGames(document, directory, { expectedCount: 1 });
  const original = await fs.readFile(filename, 'utf8');
  await assert.rejects(publishPublicGames(document, directory, { expectedCount: 1 }), { code: 'EEXIST' });
  document.failures.push({ source: 'Steam 2', error: 'timeout' });
  await assert.rejects(publishPublicGames(document, directory), /快照校验失败/);
  assert.equal(await fs.readFile(filename, 'utf8'), original);
  assert.deepEqual(await fs.readdir(directory), [path.basename(filename)]);
});
