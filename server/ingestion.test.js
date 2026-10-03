import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { importVerifiedSnapshot, prepareVerifiedSnapshot } from './ingestion.js';

function snapshot() {
  return {
    fetchedAt: '2026-10-03T06:07:30.545Z', methodology: 'Steam 中国区人民币原价，评价按全语言汇总。',
    sources: ['Steam 商品与评价接口'], limitations: ['选样非全量'], failures: [],
    games: [{ name: 'Verified Fixture', genre: '策略', platforms: ['PC'],
      sourceUrl: 'https://store.steampowered.com/app/987654321/',
      metricsSourceUrl: 'https://store.steampowered.com/appreviews/987654321?json=1',
      steamAppId: 987654321, dataAsOf: '2026-10-03',
      metricScope: 'Steam 中国区人民币原价；全语言评价',
      price: 0, rating: 90, reviewCount: 10, peakPlayers: null, isDemo: false }]
  };
}

test('accepts verified zero and null values, then skips a repeated import', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ingestion-'));
  const file = path.join(directory, 'games.json');
  fs.writeFileSync(file, '[]');
  const previous = process.env.GAME_DATA_FILE;
  process.env.GAME_DATA_FILE = file;
  t.after(() => {
    if (previous === undefined) delete process.env.GAME_DATA_FILE;
    else process.env.GAME_DATA_FILE = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  assert.equal(prepareVerifiedSnapshot(snapshot()).games[0].price, 0);
  assert.equal(prepareVerifiedSnapshot(snapshot()).games[0].peakPlayers, null);
  assert.deepEqual(importVerifiedSnapshot(snapshot()), {
    added: 1, replaced: 0, skipped: 0, total: 1, fetchedAt: '2026-10-03T06:07:30.545Z'
  });
  const first = fs.readFileSync(file, 'utf8');
  assert.equal(importVerifiedSnapshot(snapshot()).skipped, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), first);

  const failed = snapshot();
  failed.failures.push({ source: 'Steam', error: 'timeout' });
  assert.throws(() => importVerifiedSnapshot(failed), /采集失败/);
  assert.equal(fs.readFileSync(file, 'utf8'), first);
});

test('refreshes newer verified product data without erasing measured values', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ingestion-refresh-'));
  const file = path.join(directory, 'games.json');
  fs.writeFileSync(file, '[]');
  const previous = process.env.GAME_DATA_FILE;
  process.env.GAME_DATA_FILE = file;
  t.after(() => {
    if (previous === undefined) delete process.env.GAME_DATA_FILE;
    else process.env.GAME_DATA_FILE = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const original = snapshot();
  importVerifiedSnapshot(original);
  const refreshed = snapshot();
  refreshed.fetchedAt = '2026-10-04T06:07:30.545Z';
  refreshed.games[0].dataAsOf = '2026-10-04';
  refreshed.games[0].name = 'Verified Fixture Updated';
  refreshed.games[0].price = null;
  refreshed.games[0].rating = null;
  refreshed.games[0].reviewCount = null;
  refreshed.games[0].metricsSourceUrl = '';
  const result = importVerifiedSnapshot(refreshed, { refreshExisting: true });
  const game = JSON.parse(fs.readFileSync(file, 'utf8'))[0];
  assert.equal(result.updated, 1);
  assert.equal(game.name, 'Verified Fixture Updated');
  assert.equal(game.dataAsOf, '2026-10-04');
  assert.equal(game.rating, 90);
  assert.equal(game.reviewCount, 10);
  assert.equal(game.metricsSourceUrl, original.games[0].metricsSourceUrl);
  assert.equal(game.metricScope, original.games[0].metricScope);
});

test('refresh keeps earlier App Store rating when a later search omits it', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ingestion-apple-'));
  const file = path.join(directory, 'games.json');
  fs.writeFileSync(file, '[]');
  const previous = process.env.GAME_DATA_FILE;
  process.env.GAME_DATA_FILE = file;
  t.after(() => {
    if (previous === undefined) delete process.env.GAME_DATA_FILE;
    else process.env.GAME_DATA_FILE = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const document = snapshot();
  document.games = [{ name: 'Apple Game', genre: '解谜', platforms: ['iOS'],
    sourceUrl: 'https://apps.apple.com/us/app/example/id123456789',
    metricsSourceUrl: '', dataAsOf: '2026-10-03', metricScope: 'Apple App Store 美国区商品',
    steamAppId: null, price: null, rating: null, reviewCount: null, peakPlayers: null,
    sourceExtras: { appStoreId: 123456789, usPriceUsd: 0, usRatingOutOf5: 4.5, usRatingCount: 100 } }];
  importVerifiedSnapshot(document);
  document.fetchedAt = '2026-10-04T06:07:30.545Z';
  document.games[0].dataAsOf = '2026-10-04';
  document.games[0].sourceExtras.usRatingOutOf5 = null;
  document.games[0].sourceExtras.usRatingCount = null;
  importVerifiedSnapshot(document, { refreshExisting: true });
  const game = JSON.parse(fs.readFileSync(file, 'utf8'))[0];
  assert.equal(game.sourceExtras.usRatingOutOf5, 4.5);
  assert.equal(game.sourceExtras.usRatingCount, 100);
});

test('rejects unsupported metrics, broken provenance, duplicate identities and missing nulls', () => {
  const cases = [
    [game => { game.peakPlayers = 100; }, /同时在线峰值/],
    [game => { game.metricsSourceUrl = 'https://example.com/appreviews/987654321'; }, /评价来源/],
    [game => { game.sourceUrl = 'https://store.steampowered.com/app/123/'; }, /商品 ID/],
    [game => { game.dataAsOf = '2026-10-02'; }, /采集日期/],
    [game => { delete game.reviewCount; }, /用 null/],
    [game => { game.price = 10; game.metricScope = 'Steam 价格'; }, /币种口径/]
  ];
  for (const [mutate, expected] of cases) {
    const document = snapshot();
    mutate(document.games[0]);
    assert.throws(() => prepareVerifiedSnapshot(document), expected);
  }
  const duplicate = snapshot();
  duplicate.games.push({ ...duplicate.games[0], name: 'Duplicate' });
  assert.throws(() => prepareVerifiedSnapshot(duplicate), /重复来源/);
});

test('keeps Apple US metrics separate from Steam measures', () => {
  const document = snapshot();
  document.games = [{ name: 'Apple Example', genre: '解谜', platforms: ['iOS'],
    sourceUrl: 'https://apps.apple.com/us/app/example/id123456789',
    metricsSourceUrl: '', dataAsOf: '2026-10-03', metricScope: 'Apple App Store 美国区商品',
    steamAppId: null, price: null, rating: null, reviewCount: null, peakPlayers: null,
    sourceExtras: { appStoreId: 123456789, usPriceUsd: 0, usRatingOutOf5: null, usRatingCount: null } }];
  assert.equal(prepareVerifiedSnapshot(document).games[0].sourceExtras.usPriceUsd, 0);
  document.games[0].rating = 90;
  assert.throws(() => prepareVerifiedSnapshot(document), /非 Steam 公共指标/);
});

test('accepts a TapTap product page only with the Android catalog scope', () => {
  const document = snapshot();
  document.games = [{ name: 'TapTap Example', genre: '音游', channel: 'App', platforms: ['Android'],
    sourceUrl: 'https://www.taptap.cn/app/165287', metricsSourceUrl: '',
    dataAsOf: '2026-10-03', metricScope: 'TapTap 公开榜单及商品页；评分未采集',
    steamAppId: null, price: null, rating: null, reviewCount: null, peakPlayers: null }];
  assert.equal(prepareVerifiedSnapshot(document).games[0].name, 'TapTap Example');
  document.games[0].platforms = ['PC'];
  assert.throws(() => prepareVerifiedSnapshot(document), /TapTap 商品链接或平台口径/);
});
