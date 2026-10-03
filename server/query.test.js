import test from 'node:test';
import assert from 'node:assert/strict';
import { answerQuery, searchGames } from './query.js';

const games = [
  { name: '星露谷物语', englishName: 'Stardew Valley', genre: '模拟经营', developer: 'ConcernedApe', publisher: 'ConcernedApe', tags: ['农场'], platforms: ['PC'], rating: 98, price: 48, isDemo: true, sourceUrl: 'https://example.com' },
  { name: '黑神话：悟空', englishName: 'Black Myth: Wukong', genre: '动作角色扮演', developer: '游戏科学', publisher: '游戏科学', tags: ['神话'], platforms: ['PS5'], rating: 94, price: 268, isDemo: false, sourceUrl: '' }
];

test('search matches name, developer, tags, genre and platform', () => {
  assert.equal(searchGames(games, 'stardew').length, 1);
  assert.equal(searchGames(games, '游戏科学')[0].name, '黑神话：悟空');
  assert.equal(searchGames(games, '', '模拟经营', 'PC')[0].name, '星露谷物语');
  assert.equal(searchGames(games, '', '模拟经营', 'PS5').length, 0);
});

test('search filters product channel independently of genre and platform', () => {
  const entries = [
    { ...games[0], channel: '端游' },
    { ...games[0], name: '手机农场', channel: 'App', platforms: ['iOS'] },
    { ...games[0], name: '微信农场', channel: '小游戏', platforms: ['微信小游戏'] }
  ];
  assert.deepEqual(searchGames(entries, '', '全部', '全部', '小游戏').map(game => game.name), ['微信农场']);
  assert.equal(searchGames(entries, '', '模拟经营', 'iOS', 'App').length, 1);
});

test('bot answer labels demo data and handles empty results', () => {
  assert.match(answerQuery(games, '查询 星露谷'), /演示数据/);
  assert.match(answerQuery(games, '不存在'), /未找到/);
  assert.match(answerQuery(games, ''), /查询 游戏名/);
});

test('bot keeps zero metrics and separates App Store units from Steam metrics', () => {
  const entries = [{
    name: 'Mobile Test', englishName: '', genre: '解谜', platforms: ['iOS'], tags: [],
    rating: null, price: null, isDemo: false, sourceUrl: 'https://apps.apple.com/test',
    dataAsOf: '2026-10-03', metricScope: 'Apple App Store 美国区',
    sourceExtras: { usPriceUsd: 0, usRatingOutOf5: 4.5 }
  }, {
    name: 'Steam Test', englishName: '', genre: '解谜', platforms: ['PC'], tags: [],
    rating: 0, price: 0, steamAppId: 123, isDemo: false, sourceUrl: ''
  }];
  assert.match(answerQuery(entries, 'Mobile Test'), /App Store 评分：4.5\/5.*美国区售价：US\$0/);
  assert.doesNotMatch(answerQuery(entries, 'Mobile Test'), /¥未录入/);
  assert.match(answerQuery(entries, 'Steam Test'), /好评率：0%.*中国区售价：¥0/);
});
