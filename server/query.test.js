import test from 'node:test';
import assert from 'node:assert/strict';
import { answerQuery, answerRankingQuery, rankingQueryType, searchGames } from './query.js';

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

test('search resolves common Chinese aliases and bot links to the matching web result', () => {
  const entries = [{ name: 'Genshin Impact 6th Anniversary', englishName: 'Genshin Impact 6th Anniversary', genre: 'RPG', developer: 'COGNOSPHERE PTE. LTD.', publisher: '', tags: [], platforms: ['iOS'], channel: 'App', sourceUrl: 'https://apps.apple.com/test' }];
  assert.equal(searchGames(entries, '原神')[0].name, 'Genshin Impact 6th Anniversary');
  const answer = answerQuery(entries, '查询 原神', { webUrl: 'https://games.example.com' });
  assert.match(answer, /Genshin Impact/);
  assert.match(answer, /view=library/);
  assert.match(answer, /q=Genshin/);
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
  const linkedAnswer = answerQuery(games, '@游戏信息助手 查询 黑神话', { webUrl: 'https://games.example.com' });
  assert.match(linkedAnswer, /查看对应数据：https:\/\/games.example.com\//);
  assert.match(linkedAnswer, /view=library/);
  assert.match(linkedAnswer, /q=/);
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

test('bot answers WeChat mini-game rankings with top games and a matching page link', () => {
  const data = { source: '腾讯应用宝微信小游戏榜单', boards: { bestSell: {
    fetchedAt: '2026-10-03T09:12:35.408Z', error: null,
    items: [{ rank: 1, name: '三国：冰河时代', developer: '测试厂商', tags: ['策略'] }, { rank: 2, name: '向僵尸开炮', developer: '', tags: [] }]
  } } };
  assert.equal(rankingQueryType('我想看近期微信畅销榜的榜单'), 'bestSell');
  const answer = answerRankingQuery(data, '我想看近期微信畅销榜的榜单', { webUrl: 'https://games.example.com' });
  assert.match(answer, /微信小游戏畅销榜/);
  assert.match(answer, /1\. 三国：冰河时代/);
  assert.match(answer, /view=rankings/);
  assert.match(answer, /board=bestSell/);
});
