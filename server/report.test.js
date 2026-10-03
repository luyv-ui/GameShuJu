import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyReport, dailyReportText, renderDailyReportHtml } from './report.js';

const games = [{
  name: '<测试游戏>', genre: '动作', platforms: ['PC'], releaseDate: '2026-10-01',
  sourceUrl: 'https://example.com/game', hasLiveData: true, currentPlayers: 1200,
  steamCapturedAt: '2026-10-03T06:00:00.000Z', steamNewsCounts: { last90Days: 2 },
  latestSteamNews: [{ title: '更新公告', url: 'https://example.com/news', publishedAt: '2026-10-03T05:00:00.000Z' }]
}];

test('daily report uses collected metrics and provides a detail URL', () => {
  const report = buildDailyReport(games, '2026-10-03');
  assert.equal(report.totals.currentPlayers, 1200);
  assert.equal(report.news.length, 1);
  assert.match(dailyReportText(games, { webUrl: 'https://games.example.com/base' }), /\/reports\/\d{4}-\d{2}-\d{2}/);
});

test('daily report HTML escapes data and retains safe source links', () => {
  const html = renderDailyReportHtml(buildDailyReport(games, '2026-10-03'));
  assert.doesNotMatch(html, /<测试游戏>/);
  assert.match(html, /&lt;测试游戏&gt;/);
  assert.match(html, /https:\/\/example\.com\/news/);
});
