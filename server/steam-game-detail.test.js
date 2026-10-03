import test from 'node:test';
import assert from 'node:assert/strict';
import { createSteamGameDetail, isValuableSteamReview, parseSteamPlayerHistory, parseSteamProduct, parseSteamReviews } from './steam-game-detail.js';

test('parses Steam product fields used by every ranked game detail', () => {
  const product = parseSteamProduct({ '730': { success: true, data: { name: 'Counter-Strike 2', is_free: true,
    short_description: '<b>竞技射击</b>', developers: ['Valve'], publishers: ['Valve'], release_date: { coming_soon: false, date: '2023 年 9 月 28 日' },
    categories: [{ description: '线上玩家对战' }], genres: [{ description: '动作' }], platforms: { windows: true, mac: false },
    supported_languages: '简体中文, 英语<strong>*</strong>', pc_requirements: { minimum: '<strong>最低配置:</strong><br>Windows 10' } } } }, 730);
  assert.equal(product.price.text, '免费开玩');
  assert.deepEqual(product.platforms, ['Windows']);
  assert.match(product.supportedLanguages[1], /完整音频/);
  assert.match(product.pcRequirements.minimum, /Windows 10/);
});

test('parses real review playtime and recommendation', () => {
  const reviews = parseSteamReviews({ query_summary: { review_score_desc: 'Very Positive', total_positive: 8, total_negative: 2, total_reviews: 10 }, reviews: [
    { recommendationid: '1', voted_up: true, review: '枪械反馈清晰，但匹配等待时间偶尔比较长。', timestamp_created: 100, author: { playtime_forever: 123, playtime_at_review: 60, num_reviews: 3 } }
  ] });
  assert.equal(reviews.summary.positivePercent, 80);
  assert.equal(reviews.summary.score, '特别好评');
  assert.equal(reviews.items[0].playtimeForeverHours, 2.1);
  assert.equal(reviews.items[0].playtimeAtReviewHours, 1);
  assert.deepEqual(reviews.quality, { fetched: 1, valuable: 1, filtered: 0, retentionRate: 100, filterVersion: 1 });
});

test('filters low-information reviews and keeps concrete player feedback', () => {
  assert.equal(isValuableSteamReview({ text: '好玩' }), false);
  assert.equal(isValuableSteamReview({ text: '666666666' }), false);
  assert.equal(isValuableSteamReview({ text: '优化很差，进入多人模式后会频繁掉帧和闪退。' }), true);
  assert.equal(isValuableSteamReview({ text: 'The matchmaking queue is slow and crashes after every second round.' }), true);
});

test('reports useful and filtered review sample counts', () => {
  const reviews = parseSteamReviews({ query_summary: {}, reviews: [
    { recommendationid: '1', review: '好玩', author: {} },
    { recommendationid: '2', review: '匹配等待时间较长，但枪械反馈和地图节奏都很清晰。', author: {} }
  ] });
  assert.equal(reviews.quality.fetched, 2);
  assert.equal(reviews.quality.valuable, 1);
  assert.equal(reviews.quality.filtered, 1);
  assert.equal(reviews.quality.retentionRate, 50);
});

test('parses recent online-player history for the trend chart and drops zero placeholders', () => {
  const history = parseSteamPlayerHistory([[500, 0], [1000, 12.2], [2000, 18], [3000, 16]], 2);
  assert.deepEqual(history.map(point => point.count), [18, 16]);
  assert.equal(history[1].capturedAt, '1970-01-01T00:00:03.000Z');
});

test('caches a fetched game detail', async () => {
  let calls = 0;
  const fetchPage = async url => {
    calls += 1;
    return url.includes('appdetails') ? JSON.stringify({ '730': { success: true, data: { name: 'Counter-Strike 2' } } })
      : JSON.stringify({ query_summary: {}, reviews: [] });
  };
  const detail = createSteamGameDetail({ fetchPage, now: () => 1000, cacheFile: false });
  await detail.get(730); await detail.get(730);
  assert.equal(calls, 3);
});

test('loads any valid Steam app id and rejects invalid ids', async () => {
  const fetchPage = async url => url.includes('appdetails')
    ? JSON.stringify({ '570': { success: true, data: { name: 'Dota 2', is_free: true } } })
    : url.includes('chart-data') ? '[]' : JSON.stringify({ query_summary: {}, reviews: [] });
  const detail = createSteamGameDetail({ fetchPage, cacheFile: false });
  assert.equal((await detail.get(570)).product.name, 'Dota 2');
  await assert.rejects(() => detail.get('not-an-id'), /App ID/);
});

test('warms a complete list once and reports individual failures', async () => {
  const fetchPage = async url => {
    const id = Number(url.match(/(?:appids=|appreviews\/|app\/)(\d+)/)?.[1]);
    if (id === 999) throw new Error('blocked');
    return url.includes('appdetails')
      ? JSON.stringify({ [id]: { success: true, data: { name: `Game ${id}` } } })
      : url.includes('chart-data') ? '[]' : JSON.stringify({ query_summary: {}, reviews: [] });
  };
  const detail = createSteamGameDetail({ fetchPage, cacheFile: false });
  const result = await detail.warm([570, 570, 730, 999], { concurrency: 2 });
  assert.equal(result.requested, 3);
  assert.deepEqual(result.completed.map(item => item.appId).sort(), [570, 730]);
  assert.deepEqual(result.failures.map(item => item.appId), [999]);
});

test('persists game detail and serves a stale snapshot without opening a network refresh', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'steam-detail-cache-'));
  const cacheFile = path.join(directory, 'details.json');
  let calls = 0;
  const fetchPage = async url => {
    calls += 1;
    return url.includes('appdetails') ? JSON.stringify({ '730': { success: true, data: { name: 'Counter-Strike 2' } } })
      : url.includes('chart-data') ? JSON.stringify([[1000, 50]]) : JSON.stringify({ query_summary: {}, reviews: [] });
  };
  const first = createSteamGameDetail({ fetchPage, now: () => 1000, ttl: 10, cacheFile });
  await first.get(730);
  const restarted = createSteamGameDetail({ fetchPage, now: () => 2000, ttl: 10, cacheFile });
  const stale = await restarted.get(730);
  assert.equal(stale.product.name, 'Counter-Strike 2');
  assert.equal(stale.cache.state, 'stale');
  assert.equal(calls, 3);
});

test('replaces the full detail cache and removes games no longer in the ranking set', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'steam-detail-replace-'));
  const cacheFile = path.join(directory, 'details.json');
  const fetchPage = async url => {
    const id = Number(url.match(/(?:appids=|appreviews\/|app\/)(\d+)/)?.[1]);
    return url.includes('appdetails')
      ? JSON.stringify({ [id]: { success: true, data: { name: `Game ${id}` } } })
      : url.includes('chart-data') ? '[]' : JSON.stringify({ query_summary: {}, reviews: [] });
  };
  const detail = createSteamGameDetail({ fetchPage, cacheFile });
  await detail.get(570);
  await detail.warm([730], { force: true, replace: true });
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(cacheFile, 'utf8'))), ['730']);
});
