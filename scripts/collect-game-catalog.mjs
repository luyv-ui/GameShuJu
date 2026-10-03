import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { load } from 'cheerio';
import { prepareVerifiedSnapshot } from '../server/ingestion.js';

const fetchedAt = new Date().toISOString();
const dateAsOf = fetchedAt.slice(0, 10);
const targets = { steam: 720, app: 380, mini: 100 };
const existing = JSON.parse(await fs.readFile('data/imports/public-games-2026-10-03.json', 'utf8')).games;
const seenSteam = new Set(existing.map(game => game.steamAppId).filter(Boolean));
const seenApp = new Set(existing.map(game => game.sourceExtras?.appStoreId).filter(Boolean));
const seenMini = new Set();
const games = [];
const failures = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchText(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GameIntelligenceResearch/1.0)' }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      await sleep(600 * (attempt + 1));
    }
  }
  throw lastError;
}
const fetchJson = async url => JSON.parse(await fetchText(url));
const isoDate = value => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) || parsed > new Date() ? '' : parsed.toISOString().slice(0, 10);
};

const steamGenreTags = [
  [1666, '策略卡牌'], [4328, '城市建造'], [1716, 'Roguelike'], [1664, '解谜'],
  [1667, '恐怖'], [1625, '平台动作'], [699, '竞速'], [701, '体育'],
  [1662, '生存'], [3799, '视觉小说'], [599, '模拟经营'], [9, '策略'],
  [122, '角色扮演'], [19, '动作'], [21, '冒险'], [597, '休闲']
];
let steamTagNames = new Map();
try {
  const tags = await fetchJson('https://store.steampowered.com/tagdata/populartags/english');
  steamTagNames = new Map(tags.map(tag => [tag.tagid, tag.name]));
} catch (error) {
  failures.push({ source: 'Steam tag names', error: String(error) });
}

let steamCount = 0;
for (let start = 0; start < 2500 && steamCount < targets.steam; start += 50) {
  try {
    const url = `https://store.steampowered.com/search/results/?query&start=${start}&count=50&filter=games&sort_by=_ASC&infinite=1`;
    const result = await fetchJson(url);
    const $ = load(result.results_html || '');
    let found = 0;
    $('a.search_result_row').each((_, element) => {
      const row = $(element);
      const appId = Number(row.attr('data-ds-appid'));
      const name = row.find('.title').first().text().trim();
      if (!Number.isSafeInteger(appId) || appId <= 0 || !name || /\b(demo|playtest|soundtrack)\b/i.test(name) || seenSteam.has(appId)) return;
      let tagIds = [];
      try { tagIds = JSON.parse(row.attr('data-ds-tagids') || '[]').map(Number); } catch { /* Source tag list is optional. */ }
      const genre = steamGenreTags.find(([id]) => tagIds.includes(id))?.[1] || '未分类';
      const releaseDate = isoDate(row.find('.search_released').first().text().trim());
      const tags = tagIds.map(id => steamTagNames.get(id)).filter(Boolean).slice(0, 12);
      seenSteam.add(appId);
      found++;
      games.push({
        channel: '端游', name, englishName: name, genre, platforms: ['PC'], releaseDate,
        developer: '', publisher: '', price: null, rating: null, reviewCount: null, peakPlayers: null,
        tags, description: '', steamAppId: appId, sourceUrl: `https://store.steampowered.com/app/${appId}/`,
        metricsSourceUrl: '', dataAsOf: dateAsOf,
        metricScope: 'Steam 搜索目录商品资料；价格、评价和销量未采集', isDemo: false
      });
      steamCount++;
    });
    if (!found && start >= 100) break;
  } catch (error) { failures.push({ source: `Steam search start=${start}`, error: String(error) }); }
  await sleep(250);
}

const appleGenreMap = new Map([
  ['Action', '动作'], ['Adventure', '冒险'], ['Arcade', '街机'], ['Board', '桌游'],
  ['Card', '策略卡牌'], ['Casino', '博彩'], ['Casual', '休闲'], ['Family', '家庭'],
  ['Music', '音乐'], ['Puzzle', '解谜'], ['Racing', '竞速'], ['Role Playing', '角色扮演'],
  ['Simulation', '模拟经营'], ['Sports', '体育'], ['Strategy', '策略'], ['Trivia', '问答'], ['Word', '文字']
]);
let appCount = 0;
for (const term of ['game', 'puzzle', 'rpg', 'strategy', 'simulation', 'arcade', 'casual', 'action', 'adventure', 'card', 'sports']) {
  if (appCount >= targets.app) break;
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&country=us&limit=200`;
    const result = await fetchJson(url);
    for (const item of result.results || []) {
      if (item.primaryGenreName !== 'Games' || !Number.isSafeInteger(item.trackId) || !item.trackName || !item.trackViewUrl || seenApp.has(item.trackId)) continue;
      const subgenre = (item.genres || []).find(value => appleGenreMap.has(value));
      seenApp.add(item.trackId);
      games.push({
        channel: 'App', name: item.trackName, englishName: item.trackName,
        genre: appleGenreMap.get(subgenre) || '未分类', platforms: ['iOS'], releaseDate: isoDate(item.releaseDate),
        developer: item.artistName || '', publisher: item.artistName || '',
        price: null, rating: null, reviewCount: null, peakPlayers: null,
        tags: (item.genres || []).filter(value => value !== 'Games').slice(0, 8),
        description: (item.description || '').slice(0, 500), steamAppId: null,
        sourceUrl: item.trackViewUrl, metricsSourceUrl: '', dataAsOf: dateAsOf,
        metricScope: 'Apple App Store 美国区商品；美元价格和五星评分另存，未与 Steam 指标合并',
        sourceExtras: {
          appStoreId: item.trackId, usPriceUsd: item.price ?? null,
          usRatingOutOf5: item.averageUserRating ?? null, usRatingCount: item.userRatingCount ?? null
        },
        isDemo: false
      });
      appCount++;
    }
  } catch (error) { failures.push({ source: `Apple search ${term}`, error: String(error) }); }
  await sleep(250);
}

const miniPages = [
  ['/wechat-game-tag/xiuxianyizhi', '休闲益智'], ['/wechat-game-tag/rpg', '角色扮演'],
  ['/wechat-game-tag/chess', '棋牌'], ['/wechat-game-tag/slg02', '策略'],
  ['/wechat-game-tag/avg', '竞技'], ['/wechat-game-tag/danji', '单机'],
  ['/wechat-game', '未分类'], ['/wechat-game/hot-game-list', '未分类'],
  ['/wechat-game/choice-game-list', '未分类'], ['/wechat-game/popular-game-rank', '未分类'],
  ['/wechat-game/best-sell-game-rank', '未分类'], ['/wechat-game/new-game-rank', '未分类']
];
let miniCount = 0;
for (const [page, fallbackGenre] of miniPages) {
  try {
    const $ = load(await fetchText(`https://sj.qq.com${page}`));
    const next = JSON.parse($('#__NEXT_DATA__').text());
    const components = next.props?.pageProps?.dynamicCardResponse?.data?.components || [];
    for (const item of components.flatMap(component => component.data?.itemData || [])) {
      if (!/^wx[0-9a-f]{16}$/i.test(item.pkg_name || '') || item.report_info?.yyb_app_type !== 'wechatgame' || !item.name || seenMini.has(item.pkg_name)) continue;
      seenMini.add(item.pkg_name);
      const tags = String(item.tags || '').split(',').map(value => value.trim()).filter(Boolean);
      games.push({
        channel: '小游戏', name: item.name, englishName: '', genre: tags[0] || fallbackGenre,
        platforms: ['微信小游戏'], releaseDate: '', developer: item.developer || '',
        publisher: '', price: null, rating: null, reviewCount: null, peakPlayers: null,
        tags: tags.slice(0, 12), description: item.editor_intro || '', steamAppId: null,
        sourceUrl: `https://sj.qq.com/appdetail/${item.pkg_name}`, metricsSourceUrl: '',
        dataAsOf: dateAsOf, metricScope: '腾讯应用宝微信小游戏目录；未采集可比营收及评价指标', isDemo: false
      });
      miniCount++;
    }
  } catch (error) { failures.push({ source: `Tencent mini catalog ${page}`, error: String(error) }); }
  await sleep(250);
}

const document = {
  title: '游戏产品公开目录扩展样本', fetchedAt,
  methodology: 'Steam 搜索目录、Apple App Store 美国区搜索目录、腾讯应用宝微信小游戏目录。按来源 ID 去重；端游含 PC/主机，App 为原生移动应用，小游戏仅含已核验的微信小程序游戏。Steam 类型由公开用户标签映射，Apple 类型来自商店子类，微信小游戏类型来自目录标签。目录收录不代表市场份额或收入。',
  sources: ['https://store.steampowered.com/search/', 'https://itunes.apple.com/search', 'https://sj.qq.com/wechat-game'],
  limitations: ['目录检索结果和人工选样均非全量或随机样本', '新增目录记录不含可比销量、收入或 Steam 评论指标', 'App Store 美元价格与五星评分仅在 sourceExtras 中', '微信小游戏样本不代表抖音小游戏，也不代表微信平台全量'],
  counts: { steam: steamCount, app: appCount, mini: miniCount }, games, failures
};
if (failures.length || games.length < 1000 || steamCount < targets.steam || appCount < targets.app || miniCount < targets.mini) {
  throw new Error(`采集量不足：${JSON.stringify(document.counts)}，失败 ${JSON.stringify(failures)}`);
}
prepareVerifiedSnapshot(document);
const file = path.join('data/imports', `public-game-catalog-${fetchedAt.replace(/[:.]/g, '-')}.json`);
await fs.mkdir(path.dirname(file), { recursive: true });
const temporary = path.join(path.dirname(file), `.public-game-catalog-${randomUUID()}.tmp`);
try {
  await fs.writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { flag: 'wx' });
  await fs.link(temporary, file);
} finally {
  await fs.rm(temporary, { force: true });
}
console.log(JSON.stringify({ file, counts: document.counts, total: games.length, failures: failures.length }));
