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

test('bot answer labels demo data and handles empty results', () => {
  assert.match(answerQuery(games, '查询 星露谷'), /演示数据/);
  assert.match(answerQuery(games, '不存在'), /未找到/);
  assert.match(answerQuery(games, ''), /查询 游戏名/);
});
