import test from 'node:test';
import assert from 'node:assert/strict';
import { createRankings, parseRanking, parseAppleRanking, parseDouyinRanking, parseTapTapRanking } from './rankings.js';

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
  const tap = '<script type="application/ld+json">' + JSON.stringify({ '@type': 'ItemList', itemListElement: [
    { position: 1, name: '游戏 B', url: 'https://www.taptap.cn/app/456' },
    { position: 2, name: '错误域名', url: 'https://example.com/app/2' }
  ] }) + '</script>';
  assert.deepEqual(parseTapTapRanking(tap).map(game => [game.rank, game.name]), [[1, '游戏 B']]);
});

test('Douyin public ranking parser keeps the visible free top list and date', () => {
  const document = '<body><span>数据日期</span><button>2026-10-03</button><table><tbody>' +
    '<tr><td>1</td><td><img src="https://example.com/a.png"><a href="/douyin/games/528"><span title="狱国争霸">狱国争霸</span></a></td><td>SLG</td><td>持平</td></tr>' +
    '<tr><td>2</td><td><a href="/douyin/games/479"><span title="疯狂水世界">疯狂水世界</span></a></td><td>模拟经营</td><td>+3</td></tr>' +
    '</tbody></table></body>';
  const parsed = parseDouyinRanking(document);
  assert.equal(parsed.dataDate, '2026-10-03');
  assert.deepEqual(parsed.items.map(game => [game.rank, game.name]), [[1, '狱国争霸'], [2, '疯狂水世界']]);
  assert.equal(parsed.items[0].url, 'https://www.momorank.com/douyin/games/528');
});

test('ranking cache retains last successful board after a failed refresh', async () => {
  let time = 1000;
  let fail = false;
  let calls = 0;
  const rankings = createRankings({ now: () => time, fetchPage: async () => { calls++; if (fail) throw new Error('offline'); return html([item('a', '测试游戏')]); } });
  const first = await rankings.get();
  assert.equal(first.boards.bestSell.items[0].name, '测试游戏');
  await rankings.get();
  assert.equal(calls, 9);
  time += 1000;
  fail = true;
  const stale = await rankings.get(true);
  assert.equal(stale.boards.bestSell.items[0].name, '测试游戏');
  assert.equal(stale.boards.bestSell.error, 'offline');
  assert.equal(stale.boards.bestSell.fetchedAt, first.boards.bestSell.fetchedAt);
});
