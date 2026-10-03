import test from 'node:test';
import assert from 'node:assert/strict';
import { answerQuery, searchGames } from './query.js';

const games = [
  { name: '星露谷物语', englishName: 'Stardew Valley', genre: '模拟经营', developer: 'ConcernedApe', publisher: 'ConcernedApe', tags: ['农场'], platforms: ['PC'], releaseDate: '2016-02-26', rating: 98, price: 48, isDemo: true, sourceUrl: 'https://example.com' },
  { name: '黑神话：悟空', englishName: 'Black Myth: Wukong', genre: '动作角色扮演', developer: '游戏科学', publisher: '游戏科学', tags: ['神话'], platforms: ['PS5'], releaseDate: '2024-08-20', rating: 94, price: 268, isDemo: true, sourceUrl: '', hasLiveData: true, currentPlayers: 13468, steamNewsCounts: { last365Days: 15, last90Days: 6, last30Days: 0, last7Days: 0 }, steamCapturedAt: '2026-10-03T06:01:04.967Z', latestSteamNews: [{ id: 'n1', title: '版本更新', url: 'https://example.com/news', publishedAt: '2026-10-02T00:00:00.000Z' }] }
];

test('search matches name, developer, tags, genre and platform', () => {
  assert.equal(searchGames(games, 'stardew').length, 1);
  assert.equal(searchGames(games, '游戏科学')[0].name, '黑神话：悟空');
  assert.equal(searchGames(games, '', '模拟经营', 'PC')[0].name, '星露谷物语');
  assert.equal(searchGames(games, '', '模拟经营', 'PS5').length, 0);
});

test('bot answer labels demo data and handles empty results', () => {
  assert.match(answerQuery(games, '查询 星露谷'), /演示数据/);
  assert.match(answerQuery(games, '查询 黑神话'), /当前在线 13,468/);
  assert.match(answerQuery(games, '查询 黑神话'), /近90天公告 6 条/);
  assert.match(answerQuery(games, '不存在'), /未找到/);
  assert.match(answerQuery(games, ''), /查询 黑神话/);
});

test('bot supports operational commands and optional web link', () => {
  assert.match(answerQuery(games, '帮助'), /当前在线/);
  assert.match(answerQuery(games, '当前在线'), /13,468/);
  assert.match(answerQuery(games, '最近发布'), /黑神话：悟空/);
  assert.match(answerQuery(games, '最新公告'), /版本更新/);
  assert.match(answerQuery(games, '数据状态'), /1 款有 Steam 实采/);
  assert.match(answerQuery(games, '@游戏信息助手 查询 黑神话', { webUrl: 'https://games.example.com' }), /网页情报库：https:\/\/games.example.com\//);
});
