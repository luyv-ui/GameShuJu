import test from 'node:test';
import assert from 'node:assert/strict';
import { createRankings, parseRanking, parseAppleRanking, parseTapTapRanking, parseMediaMonthlyRanking } from './rankings.js';

const html = items => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { dynamicCardResponse: { data: { components: [{ data: { itemData: items } }] } } } } })}</script>`;
const item = (id, name) => ({ pkg_name: `wx${id.repeat(16)}`, name, report_info: { yyb_app_type: 'wechatgame' } });

test('ranking parser preserves source order and removes non-games and duplicates', () => {
  const rows = parseRanking(html([item('a', '第一'), { ...item('b', '其他'), report_info: { yyb_app_type: 'app' } }, item('c', '第二'), item('a', '重复')]));
  assert.deepEqual(rows.map(row => [row.rank, row.name]), [[1, '第一'], [2, '第二']]);
  assert.equal(rows[0].url, 'https://sj.qq.com/appdetail/wxaaaaaaaaaaaaaaaa');
});

test('Apple RSS and TapTap structured lists keep verified item order', () => {
  const apple = JSON.stringify({ feed: { entry: [
    { id: { attributes: { 'im:id': '123' } }, 'im:name': { label: '游戏 A' },
      'im:image': [{ label: 'https://example.com/a.png' }], 'im:artist': { label: '厂商' },
      link: [{ attributes: { rel: 'alternate', href: 'https://apps.apple.com/cn/app/game-a/id123' } }] },
    { id: { attributes: { 'im:id': '123' } }, 'im:name': { label: '重复' },
      link: [{ attributes: { rel: 'alternate', href: 'https://apps.apple.com/cn/app/game-a/id123' } }] }
  ] } });
  assert.deepEqual(parseAppleRanking(apple).map(game => [game.rank, game.name]), [[1, '游戏 A']]);
  const tapIcon = 'https://img-tc.tapimg.com/market/images/game.png/_tap_appicon_s.jpg';
  const tap = `<a href="/app/456?os=android"><img src="${tapIcon}" alt="游戏 B icon"></a>` +
    '<a href="/app/789"><img src="https://example.com/untrusted.png"></a>' +
    '<script type="application/ld+json">' + JSON.stringify({ '@type': 'ItemList', itemListElement: [
    { position: 1, name: '游戏 B', url: 'https://www.taptap.cn/app/456' },
    { position: 2, name: '游戏 C', url: 'https://www.taptap.cn/app/789' },
    { position: 2, name: '错误域名', url: 'https://example.com/app/2' }
  ] }) + '</script>';
  const tapGames = parseTapTapRanking(tap);
  assert.deepEqual(tapGames.map(game => [game.rank, game.name]), [[1, '游戏 B'], [2, '游戏 C']]);
  assert.equal(tapGames[0].icon, tapIcon);
  assert.equal(tapGames[1].icon, '');
});

test('third-party mini-game monthly lists require a matching article and ten named ranks', () => {
  const url = 'http://www.gamelook.com.cn/2026/09/601451/';
  const search = JSON.stringify([{ id: 601451, title: '8月抖音小游戏畅销榜Top 100：月报', url }]);
  const names = Array.from({ length: 10 }, (_, index) => `《游戏${index + 1}》`).join('、');
  const post = JSON.stringify({ id: 601451, link: url, date_gmt: '2026-09-04T01:17:39',
    content: { rendered: `<p>2026年8月抖音小游戏畅销榜前十名依次是：${names}。</p>` } });
  const board = parseMediaMonthlyRanking(search, post, 'douyin');
  assert.equal(board.period, '2026-08');
  assert.deepEqual(board.items.map(item => item.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(board.items[0].url, url);
  assert.throws(() => parseMediaMonthlyRanking(search, post, 'wechat'), /没有找到/);
  assert.throws(() => parseMediaMonthlyRanking(search, post.replace('游戏10', '游戏1'), 'douyin'), /不完整/);
});

test('ranking cache retains last successful board after a failed refresh', async () => {
  let time = 1000;
  let fail = false;
  let calls = 0;
  const rankings = createRankings({ now: () => time, fetchPage: async () => { calls++; if (fail) throw new Error('offline'); return html([item('a', '测试游戏')]); } });
  const first = await rankings.get();
  assert.equal(first.boards.bestSell.items[0].name, '测试游戏');
  await rankings.get();
  assert.equal(calls, 11);
  time += 1000;
  fail = true;
  const stale = await rankings.get(true);
  assert.equal(stale.boards.bestSell.items[0].name, '测试游戏');
  assert.equal(stale.boards.bestSell.error, 'offline');
  assert.equal(stale.boards.bestSell.fetchedAt, first.boards.bestSell.fetchedAt);
});
