import test from 'node:test';
import assert from 'node:assert/strict';
import { createRankings, parseRanking } from './rankings.js';

const html = items => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { dynamicCardResponse: { data: { components: [{ data: { itemData: items } }] } } } } })}</script>`;
const item = (id, name) => ({ pkg_name: `wx${id.repeat(16)}`, name, report_info: { yyb_app_type: 'wechatgame' } });

test('ranking parser preserves source order and removes non-games and duplicates', () => {
  const rows = parseRanking(html([item('a', '第一'), { ...item('b', '其他'), report_info: { yyb_app_type: 'app' } }, item('c', '第二'), item('a', '重复')]));
  assert.deepEqual(rows.map(row => [row.rank, row.name]), [[1, '第一'], [2, '第二']]);
  assert.equal(rows[0].url, 'https://sj.qq.com/appdetail/wxaaaaaaaaaaaaaaaa');
});

test('ranking cache retains last successful board after a failed refresh', async () => {
  let time = 1000;
  let fail = false;
  let calls = 0;
  const rankings = createRankings({ now: () => time, fetchPage: async () => { calls++; if (fail) throw new Error('offline'); return html([item('a', '测试游戏')]); } });
  const first = await rankings.get();
  assert.equal(first.boards.bestSell.items[0].name, '测试游戏');
  await rankings.get();
  assert.equal(calls, 3);
  time += 1000;
  fail = true;
  const stale = await rankings.get(true);
  assert.equal(stale.boards.bestSell.items[0].name, '测试游戏');
  assert.equal(stale.boards.bestSell.error, 'offline');
  assert.equal(stale.boards.bestSell.fetchedAt, first.boards.bestSell.fetchedAt);
});
