import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRankings, enrichRankingCatalog, fillMissingRankingIcons, parseRanking, parseAppleRanking, parseTapTapRanking, parseMediaMonthlyRanking, parseSteamArchivePeriods, parseSteamFeatured, parseSteamRanking, parseSteamWeeklyDates } from './rankings.js';

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

test('Steam chart parser keeps product icons and public chart fields', () => {
  const chart = '<table><tr><td>1</td><td><a href="https://store.steampowered.com/app/730/Counter_Strike_2/"><img src="https://shared.fastly.steamstatic.com/cs2.jpg"><span class="ItemName">反恐精英 2</span></a></td><td>Free To Play</td><td>▲ 2</td><td>738</td></tr></table>';
  const games = parseSteamRanking(chart);
  assert.equal(games[0].id, '730');
  assert.equal(games[0].name, '反恐精英 2');
  assert.equal(games[0].icon, 'https://shared.fastly.steamstatic.com/cs2.jpg');
  assert.equal(games[0].priceText, 'Free To Play');
  assert.equal(games[0].change, '▲ 2');
  assert.equal(games[0].weeks, '738');
});

test('Steam chart parser keeps official current players and daily peak', () => {
  const html = '<a href="https://store.steampowered.com/app/730/"><span class="ItemName">Counter-Strike 2</span><img src="https://cdn.test/730.jpg"></a>' +
    String.raw`<script>"rgRanks":[{"nRank":1,"itemKey":{"appid":730},"nConcurrentInGame":1078743,"nPeakInGame":1184260}]</script>`;
  const item = parseSteamRanking(html)[0];
  assert.equal(item.currentPlayers, 1078743);
  assert.equal(item.dailyPeakPlayers, 1184260);
});

test('Steam Deck chart parser ignores the hardware promotional card', () => {
  const chart = '<a href="https://store.steampowered.com/app/1675200/Steam_Deck/"><img src="https://media.steampowered.com/deck.png">Steam DeckYour Games, Everywhere</a>' +
    '<table><tr><td>1</td><td><a href="https://store.steampowered.com/app/2868840/Slay_the_Spire_2/"><img src="https://shared.fastly.steamstatic.com/sts2.jpg"><span class="ItemName">Slay the Spire 2</span></a></td><td>$29.99</td></tr></table>';
  const games = parseSteamRanking(chart);
  assert.deepEqual(games.map(game => [game.rank, game.id, game.name]), [[1, '2868840', 'Slay the Spire 2']]);
});

test('Steam chart exposes official weekly ranking dates without duplicates', () => {
  const page = '<a href="/charts/topsellers/JP/2026-9-22">周榜</a><a href="/charts/topsellers/JP/2026-9-22">重复</a><a href="/charts/topsellers/JP/2026-9-15">周榜</a>';
  assert.deepEqual(parseSteamWeeklyDates(page), ['2026-09-22', '2026-09-15']);
});

test('Steam chart exposes official monthly and yearly periods', () => {
  const page = '<a href="/charts/topnewreleases/august_2026">月榜</a><a href="/charts/topnewreleases/august_2026">重复</a>' +
    '<a href="/charts/topnewreleases/july_2026">月榜</a><a href="/charts/bestofyear/2025">年榜</a><a href="/charts/bestofyear/2024">年榜</a>';
  assert.deepEqual(parseSteamArchivePeriods(page), {
    monthly: [{ path: 'august_2026', date: '2026-08' }, { path: 'july_2026', date: '2026-07' }],
    yearly: [{ path: '2025', date: '2025' }, { path: '2024', date: '2024' }]
  });
});

test('Steam chart separates current discount price from upcoming release status', () => {
  const chart = '<table>' +
    '<tr><td>1</td><td><a href="https://store.steampowered.com/app/1/A"><span class="ItemName">即将游戏</span></a></td><td>推出日期： 2026年10月5日</td><td>▲ 3</td><td>2</td></tr>' +
    '<tr><td>2</td><td><a href="https://store.steampowered.com/app/2/B"><span class="ItemName">折扣游戏</span></a></td><td>-70% ¥8,778 ¥2,633</td><td>新品</td><td>1</td></tr></table>';
  const games = parseSteamRanking(chart);
  assert.equal(games[0].priceText, '');
  assert.equal(games[0].availabilityText, '推出日期： 2026年10月5日');
  assert.equal(games[1].priceText, '¥2,633');
  assert.equal(games[1].discountText, '-70%');
});

test('Steam Japan featured fallback keeps official names, capsules and JPY prices', () => {
  const games = parseSteamFeatured(JSON.stringify({ top_sellers: { items: [
    { id: 2288340, name: '空战奇兵8', final_price: 979000, currency: 'JPY', small_capsule_image: 'https://shared.akamai.steamstatic.com/game.jpg' },
    { id: 3393110, name: 'AION 2（在您的地区不可用）', final_price: null, currency: 'JPY' }
  ] } }));
  assert.deepEqual([games[0].id, games[0].name, games[0].priceText], ['2288340', '空战奇兵8', '¥9,790']);
  assert.equal(games[0].icon, 'https://shared.akamai.steamstatic.com/game.jpg');
  assert.equal(games[1].name, 'AION 2');
  assert.match(games[1].icon, /apps\/3393110\/capsule_231x87\.jpg$/);
});

test('third-party mini-game monthly lists require a matching article and ten named ranks', () => {
  const url = 'http://www.gamelook.com.cn/2026/09/601451/';
  const search = JSON.stringify([{ id: 601451, title: '8月抖音小游戏畅销榜Top 100：月报', url }]);
  const names = Array.from({ length: 10 }, (_, index) => `《游戏${index + 1}》`).join('、');
  const post = JSON.stringify({ id: 601451, link: url, date_gmt: '2026-09-04T01:17:39',
    content: { rendered: `<p>2026年8月抖音小游戏畅销榜前十名依次是：${names}。</p>` } });
  const board = parseMediaMonthlyRanking(search, post, 'douyin');
  assert.equal(board.period, '2026-08');
  assert.equal(board.total, 100);
  assert.deepEqual(board.items.map(item => item.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(board.items[0].url, url);
  assert.throws(() => parseMediaMonthlyRanking(search, post, 'wechat'), /没有找到/);
  assert.throws(() => parseMediaMonthlyRanking(search, post.replace('游戏10', '游戏1'), 'douyin'), /不完整/);
});

test('ranking cache retains last successful board after a failed refresh', async () => {
  let time = 1000;
  let fail = false;
  let calls = 0;
  const rankings = createRankings({ now: () => time, historyFile: false, fetchPage: async () => { calls++; if (fail) throw new Error('offline'); return html([item('a', '测试游戏')]); } });
  const first = await rankings.get();
  assert.equal(first.boards.bestSell.items[0].name, '测试游戏');
  await rankings.get();
  assert.equal(calls, 14);
  time += 1000;
  fail = true;
  const stale = await rankings.get(true);
  assert.equal(stale.boards.bestSell.items[0].name, '测试游戏');
  assert.equal(stale.boards.bestSell.error, 'offline');
  assert.equal(stale.boards.bestSell.fetchedAt, first.boards.bestSell.fetchedAt);
});

test('Steam Japan top sellers are persisted as daily snapshots', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'steam-ranking-'));
  const historyFile = path.join(directory, 'history.json');
  const chart = '<table><tr><td>1</td><td><a href="https://store.steampowered.com/app/730/Counter_Strike_2/"><span class="ItemName">反恐精英 2</span></a></td><td>免费开玩</td></tr></table>';
  const rankings = createRankings({ now: () => Date.parse('2026-10-04T01:00:00Z'), historyFile,
    fetchPage: async url => url.includes('steampowered.com/charts') ? chart : (() => { throw new Error('offline'); })() });
  const result = await rankings.refreshSteam(true, 'JP');
  assert.match(result.platforms.steam.boards.topSelling.url, /topselling\/JP/);
  assert.equal(result.platforms.steam.region, 'JP');
  assert.equal(result.platforms.steam.history[0].date, '2026-10-04');
  assert.equal(result.platforms.steam.history[0].region, 'JP');
  assert.equal(result.platforms.steam.history[0].board.items[0].id, '730');
  assert.equal(JSON.parse(fs.readFileSync(historyFile, 'utf8')).length, 1);
});

test('Steam ranking cache survives a server restart and returns before refresh', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'steam-ranking-cache-'));
  const cacheFile = path.join(directory, 'cache.json');
  const chart = '<table><tr><td>1</td><td><a href="https://store.steampowered.com/app/730/Counter_Strike_2/"><span class="ItemName">Counter-Strike 2</span></a></td><td>Free To Play</td></tr></table>';
  const first = createRankings({ now: () => 1000, historyFile: false, cacheFile, fetchPage: async url => {
    if (url.includes('steampowered.com/charts')) return chart;
    if (url.includes('IStoreBrowseService')) return JSON.stringify({ response: { store_items: [] } });
    throw new Error('offline');
  } });
  await first.refreshSteam(true, 'global');
  const restarted = createRankings({ now: () => 1000 + 31 * 60 * 1000, historyFile: false, cacheFile,
    fetchPage: async () => { throw new Error('offline'); } });
  const cached = await restarted.refreshSteam(false, 'global');
  assert.equal(cached.platforms.steam.boards.topSelling.items[0].name, 'Counter-Strike 2');
});

test('Steam monthly and yearly archives refresh only when a new period appears', async () => {
  const chart = '<a href="/charts/topnewreleases/august_2026">月榜</a><a href="/charts/bestofyear/2025">年榜</a>' +
    '<table><tr><td>1</td><td><a href="https://store.steampowered.com/app/730/Counter_Strike_2/"><span class="ItemName">反恐精英 2</span></a></td><td>免费开玩</td></tr></table>';
  let archiveCalls = 0;
  const rankings = createRankings({ now: () => Date.parse('2026-10-04T01:00:00Z'), historyFile: false, fetchPage: async url => {
    if (url.includes('ISteamChartsService')) {
      archiveCalls++;
      return JSON.stringify({ response: { top_combined_app_and_dlc_releases: [{ appid: 730, rtime_release: 1477958400 }] } });
    }
    if (url.includes('IStoreBrowseService')) return JSON.stringify({ response: { store_items: [{ appid: 730, name: 'Counter-Strike 2' }] } });
    if (url.includes('steampowered.com/charts')) return chart;
    throw new Error('unexpected URL');
  } });
  const first = await rankings.refreshSteam(true, 'JP');
  assert.equal(first.platforms.steam.monthlyBoards[0].date, '2026-08');
  assert.equal(first.platforms.steam.yearlyBoards[0].date, '2025');
  assert.equal(archiveCalls, 2);
  await rankings.refreshSteam(true, 'JP');
  assert.equal(archiveCalls, 2);
});

test('ranking items reuse catalog icons by product id or a unique localized name', () => {
  const board = { label: '榜单', items: [
    { id: '456', name: 'Phigros', url: 'https://www.taptap.cn/app/456', icon: '', developer: '', tags: [], description: '' },
    { id: 'monthly:1', name: '灵画师', url: 'https://example.com/report', icon: '', developer: '', tags: [], description: '' }
  ] };
  const enriched = enrichRankingCatalog({ platforms: { taptap: { boards: { download: board } }, douyin: { boards: { mediaMonthly: board } }, wechat: { boards: {} } } }, [
    { name: 'Phigros', englishName: '', sourceUrl: 'https://www.taptap.cn/app/456?os=android', iconUrl: 'https://cdn.example/phigros.png', developer: 'Pigeon Games', tags: ['音乐'], description: '节奏游戏' },
    { name: '灵画师', englishName: '', sourceUrl: 'https://sj.qq.com/appdetail/wxaaaaaaaaaaaaaaaa', iconUrl: 'https://cdn.example/artist.png', developer: '', tags: [], description: '' }
  ]);
  assert.equal(enriched.platforms.taptap.boards.download.items[0].icon, 'https://cdn.example/phigros.png');
  assert.equal(enriched.platforms.taptap.boards.download.items[0].developer, 'Pigeon Games');
  assert.equal(enriched.platforms.douyin.boards.mediaMonthly.items[1].icon, 'https://cdn.example/artist.png');
});

test('missing ranking icons use an exact China App Store game match', async () => {
  const board = { items: [{ name: '时尚百货城', icon: '', url: 'https://example.com/report' }] };
  const data = { platforms: { wechat: { boards: {} }, douyin: { boards: { mediaMonthly: board } } } };
  const enriched = await fillMissingRankingIcons(data, { now: () => 123,
    getJson: async () => ({ results: [{ trackName: '时尚百货城', primaryGenreName: 'Games', artworkUrl100: 'https://is1-ssl.mzstatic.com/icon.jpg' }] }) });
  assert.equal(enriched.platforms.douyin.boards.mediaMonthly.items[0].icon, 'https://is1-ssl.mzstatic.com/icon.jpg');
});

test('known mini games can use a verified official TapTap product icon', async () => {
  const board = { items: [{ name: '传奇之业', icon: '', url: 'https://example.com/report' }] };
  const data = { platforms: { wechat: { boards: {} }, douyin: { boards: { mediaMonthly: board } } } };
  const enriched = await fillMissingRankingIcons(data, { now: () => 456, getJson: async () => ({ results: [] }),
    getText: async () => '<script type="application/ld+json">' + JSON.stringify({ '@type': 'VideoGame', name: '传奇之业', image: 'https://img-tc.tapimg.com/icon.png' }) + '</script>' });
  assert.equal(enriched.platforms.douyin.boards.mediaMonthly.items[0].icon, 'https://img-tc.tapimg.com/icon.png');
});
