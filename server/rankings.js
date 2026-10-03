import { load } from 'cheerio';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
let detectedSystemProxy;

async function systemHttpsProxy() {
  if (detectedSystemProxy !== undefined) return detectedSystemProxy;
  detectedSystemProxy = process.env.HTTPS_PROXY || process.env.https_proxy || '';
  if (detectedSystemProxy || process.platform !== 'darwin') return detectedSystemProxy;
  try {
    const { stdout } = await execFileAsync('/usr/sbin/scutil', ['--proxy']);
    if (!/HTTPSEnable\s*:\s*1/.test(stdout)) return detectedSystemProxy;
    const host = stdout.match(/HTTPSProxy\s*:\s*(\S+)/)?.[1];
    const port = stdout.match(/HTTPSPort\s*:\s*(\d+)/)?.[1];
    if (host && port) detectedSystemProxy = `http://${host}:${port}`;
  } catch { /* Direct networking remains available outside managed macOS desktops. */ }
  return detectedSystemProxy;
}

export const rankingSources = {
  popular: { label: '最受欢迎', url: 'https://sj.qq.com/wechat-game/popular-game-rank' },
  bestSell: { label: '畅销', url: 'https://sj.qq.com/wechat-game/best-sell-game-rank' },
  new: { label: '热门新游', url: 'https://sj.qq.com/wechat-game/new-game-rank' }
};

export const appleRankingSources = {
  free: { label: '免费榜', url: 'https://itunes.apple.com/cn/rss/topfreeapplications/limit=100/genre=6014/json' },
  paid: { label: '付费榜', url: 'https://itunes.apple.com/cn/rss/toppaidapplications/limit=100/genre=6014/json' },
  grossing: { label: '畅销榜', url: 'https://itunes.apple.com/cn/rss/topgrossingapplications/limit=100/genre=6014/json' }
};
export const tapTapRankingSources = {
  download: { label: '下载榜', url: 'https://www.taptap.cn/top/download' },
  played: { label: '热玩榜', url: 'https://www.taptap.cn/top/played' },
  new: { label: '新品榜', url: 'https://www.taptap.cn/top/new' }
};
export const steamRegions = {
  global: { label: '全球', path: 'global', cc: 'us' },
  CN: { label: '中国', path: 'CN', cc: 'cn' },
  US: { label: '美国', path: 'US', cc: 'us' },
  JP: { label: '日本', path: 'JP', cc: 'jp' }
};
const steamTopSellingSource = region => ({ label: `${steamRegions[region].label}实时畅销 Top 100`,
  url: `https://store.steampowered.com/charts/topselling/${steamRegions[region].path}?cc=${steamRegions[region].cc}&l=schinese` });
export const steamRankingSources = {
  topSelling: steamTopSellingSource('global'),
  mostPlayed: { label: '实时最热玩', url: 'https://store.steampowered.com/charts/mostplayed?cc=us&l=schinese' },
  // This endpoint rejects the cc/l query combination with HTTP 403, unlike the
  // other chart endpoints. Let Steam return its public global Deck snapshot.
  steamDeck: { label: 'Steam Deck 热玩', url: 'https://store.steampowered.com/charts/steamdecktopplayed' }
};
export const steamRankingHistoryFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/collected/steam-ranking-history.json');
export const steamRankingCacheFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/collected/steam-ranking-cache.json');

function readSteamHistory(file) {
  if (!file) return [];
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(value) ? value.filter(snapshot => snapshot?.capturedAt && Array.isArray(snapshot?.board?.items))
      .map(snapshot => ({ ...snapshot, region: snapshot.region || 'JP' })).slice(0, 360) : [];
  } catch { return []; }
}

function writeSteamHistory(file, history) {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(history, null, 2));
  fs.renameSync(temporary, file);
}

function readSteamRankingCache(file) {
  if (!file) return null;
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value?.savedAt && value?.regionalTopSelling ? value : null;
  } catch { return null; }
}

function writeSteamRankingCache(file, value) {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}

function localSnapshotDate(timestamp) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: process.env.TZ || 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(timestamp));
}
const mediaSearch = {
  wechat: '微信小游戏畅销榜',
  douyin: '抖音小游戏畅销榜'
};
const mediaApi = 'http://www.gamelook.com.cn/wp-json/wp/v2';

function selectMediaPost(posts, platform) {
  const term = mediaSearch[platform];
  if (!term || !Array.isArray(posts)) throw new Error('第三方榜单搜索结果无效');
  const matches = posts.filter(post => new RegExp(`^\\d{1,2}月${term}Top\\s*100`).test(post.title || '') &&
    /^http:\/\/www\.gamelook\.com\.cn\/\d{4}\/\d{2}\/\d+\/$/.test(post.url || ''));
  return matches.sort((a, b) => b.id - a.id)[0];
}

export function parseRanking(html) {
  const data = JSON.parse(load(html)('#__NEXT_DATA__').text());
  const components = data.props?.pageProps?.dynamicCardResponse?.data?.components || [];
  const seen = new Set();
  const items = [];
  for (const item of components.flatMap(component => component.data?.itemData || [])) {
    if (!/^wx[0-9a-f]{16}$/i.test(item.pkg_name || '') || item.report_info?.yyb_app_type !== 'wechatgame' || !item.name || seen.has(item.pkg_name)) continue;
    seen.add(item.pkg_name);
    items.push({
      rank: items.length + 1,
      id: item.pkg_name,
      name: item.name,
      icon: typeof item.icon === 'string' && /^https:\/\//.test(item.icon) ? item.icon : '',
      developer: item.developer || '',
      tags: String(item.tags || '').split(',').map(tag => tag.trim()).filter(Boolean).slice(0, 8),
      description: item.editor_intro || '',
      url: `https://sj.qq.com/appdetail/${item.pkg_name}`
    });
  }
  if (!items.length) throw new Error('来源页面没有有效榜单条目');
  return items;
}

export function parseAppleRanking(json) {
  const entries = JSON.parse(json).feed?.entry;
  if (!Array.isArray(entries)) throw new Error('Apple 榜单缺少游戏条目');
  const seen = new Set();
  const items = [];
  for (const entry of entries) {
    const id = entry.id?.attributes?.['im:id'];
    const name = entry['im:name']?.label;
    const url = entry.link?.find?.(link => link.attributes?.rel === 'alternate')?.attributes?.href;
    if (!/^\d+$/.test(id || '') || !name || !url || !url.startsWith('https://apps.apple.com/cn/app/') || seen.has(id)) continue;
    seen.add(id);
    items.push({ rank: items.length + 1, id, name, icon: entry['im:image']?.at(-1)?.label || '',
      developer: entry['im:artist']?.label || '', tags: [entry.category?.attributes?.label].filter(Boolean),
      description: entry.summary?.label || '', url });
  }
  if (!items.length) throw new Error('Apple 榜单没有有效游戏');
  return items;
}

export function parseTapTapRanking(html) {
  const $ = load(html);
  const cardIcons = new Map();
  $('a[href*="/app/"]').each((_, element) => {
    let gameUrl;
    try { gameUrl = new URL($(element).attr('href'), 'https://www.taptap.cn'); } catch { return; }
    if (gameUrl.hostname !== 'www.taptap.cn' || !/^\/app\/\d+$/.test(gameUrl.pathname) || cardIcons.has(gameUrl.pathname)) return;
    const image = $(element).find('img').first();
    const rawIcon = image.attr('src') || image.attr('data-src') || image.attr('data-original') ||
      image.attr('srcset')?.split(',')[0]?.trim().split(/\s+/)[0] || '';
    try {
      const iconUrl = new URL(rawIcon);
      if (iconUrl.protocol === 'https:' && (iconUrl.hostname === 'tapimg.com' || iconUrl.hostname.endsWith('.tapimg.com'))) {
        cardIcons.set(gameUrl.pathname, iconUrl.toString());
      }
    } catch { /* Keep the safe local fallback when an icon URL is missing or invalid. */ }
  });
  const list = $('script[type="application/ld+json"]').toArray().map(element => {
    try { return JSON.parse($(element).text()); } catch { return null; }
  }).find(value => value?.['@type'] === 'ItemList');
  const seen = new Set();
  const items = [];
  for (const entry of list?.itemListElement || []) {
    let url;
    try { url = new URL(entry.url); } catch { continue; }
    if (url.hostname !== 'www.taptap.cn' || !/^\/app\/\d+$/.test(url.pathname) || !entry.name || seen.has(url.pathname)) continue;
    seen.add(url.pathname);
    items.push({ rank: Number.isSafeInteger(entry.position) && entry.position > 0 ? entry.position : items.length + 1,
      id: url.pathname.slice(5), name: entry.name, icon: cardIcons.get(url.pathname) || '', developer: '', tags: [], description: '',
      url: `${url.origin}${url.pathname}` });
  }
  if (!items.length) throw new Error('TapTap 页面没有有效榜单条目');
  return items;
}

export function parseSteamRanking(html) {
  const $ = load(html);
  const normalizedHtml = String(html || '').replaceAll('\\"', '"');
  const officialPlayers = new Map([...normalizedHtml.matchAll(/"nRank":(\d+),"itemKey":\{"appid":(\d+)\},"nConcurrentInGame":(\d+),"nPeakInGame":(\d+)/g)]
    .map(match => [match[2], { currentPlayers: Number(match[3]), dailyPeakPlayers: Number(match[4]) }]));
  const seen = new Set();
  const items = [];
  $('a[href*="/app/"]').each((_, element) => {
    let url;
    try { url = new URL($(element).attr('href'), 'https://store.steampowered.com'); } catch { return; }
    const id = url.pathname.match(/^\/app\/(\d+)/)?.[1];
    // The Steam Deck chart includes a promotional link for the Deck hardware
    // (app 1675200) before the actual game rows. It is not a ranked game.
    if (!id || id === '1675200' || seen.has(id)) return;
    const anchor = $(element);
    const rawName = anchor.find('[class*="ItemName"], [class*="title"]').first().text().trim() ||
      anchor.clone().find('img').remove().end().text().replace(/\s+/g, ' ').trim();
    const name = rawName.replace(/\s*[（(]在您的地区不可用[）)]\s*$/u, '').trim();
    if (!name) return;
    const row = anchor.closest('tr').length ? anchor.closest('tr') : anchor.parents().filter((__, parent) => $(parent).find('img').length > 0).first();
    const cells = row.find('td').toArray().map(cell => $(cell).text().replace(/\s+/g, ' ').trim()).filter(Boolean);
    const text = row.text().replace(/\s+/g, ' ').trim();
    const image = anchor.find('img').first().attr('src') || row.find('img').first().attr('src') || '';
    const priceCell = cells.find(value => /(?:free to play|免费|\$|¥|€|£|₩)/i.test(value)) || '';
    const prices = [...(priceCell || text).matchAll(/(?:\$|¥|€|£|₩)\s?[\d,.]+/g)].map(match => match[0].replace(/\s+/g, ''));
    const freeText = (priceCell || text).match(/(?:Free To Play|免费开玩|免费游玩)/i)?.[0] || '';
    const priceText = prices.at(-1) || freeText;
    const discountText = (priceCell || text).match(/-\d+%/)?.[0] || '';
    const availabilityText = text.match(/(?:即将推出|推出日期[：:]\s*\d{4}年\d{1,2}月\d{1,2}日)/)?.[0] || '';
    const change = cells.find(value => /^(?:new|新品|[▲▼]\s*\d+|[+-]\d+)$/i.test(value)) || '';
    const numericCells = cells.filter(value => /^\d[\d,]*$/.test(value));
    seen.add(id);
    items.push({ rank: items.length + 1, id, name, icon: /^https:\/\//.test(image) ? image : `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${id}/capsule_231x87.jpg`, developer: '', tags: [],
      description: '', url: `https://store.steampowered.com/app/${id}/`, priceText, discountText, availabilityText, change,
      weeks: numericCells.length > 1 ? numericCells.at(-1) : '', chartText: text, ...officialPlayers.get(id) });
  });
  if (!items.length) throw new Error('Steam 榜单没有有效游戏');
  return items.slice(0, 100);
}

const steamMonthNumbers = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
};

export function parseSteamArchivePeriods(html) {
  const monthly = [...String(html).matchAll(/charts\/topnewreleases\/([a-z]+)_(\d{4})/gi)].map(match => {
    const month = steamMonthNumbers[match[1].toLowerCase()];
    return month ? { path: `${match[1].toLowerCase()}_${match[2]}`, date: `${match[2]}-${String(month).padStart(2, '0')}` } : null;
  }).filter(Boolean);
  const yearly = [...String(html).matchAll(/charts\/bestofyear\/(\d{4})/g)]
    .map(match => ({ path: match[1], date: match[1] }));
  return {
    monthly: [...new Map(monthly.map(item => [item.path, item])).values()].slice(0, 3),
    yearly: [...new Map(yearly.map(item => [item.path, item])).values()].slice(0, 3)
  };
}

function steamArchiveApiUrl(type, date) {
  const timestamp = type === 'monthly'
    ? Math.floor(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, 15) / 1000)
    : Math.floor(Date.UTC(Number(date), 1, 15) / 1000);
  const method = type === 'monthly' ? 'GetMonthTopAppReleases' : 'GetYearTopAppReleases';
  const field = type === 'monthly' ? 'rtime_month' : 'rtime_year';
  const query = new URLSearchParams({ [field]: String(timestamp), include_dlc: 'true', top_results_limit: '100' });
  return `https://api.steampowered.com/ISteamChartsService/${method}/v1/?${query}`;
}

function steamArchiveRefs(type, payload) {
  const response = payload?.response || {};
  const source = type === 'monthly' ? response.top_combined_app_and_dlc_releases :
    [...(response.top_app_list || []), ...(response.top_combined_app_and_dlc_releases || [])];
  const unique = new Map();
  for (const item of source) {
    const id = Number(item?.appid);
    if (!Number.isSafeInteger(id) || id <= 0 || unique.has(id)) continue;
    unique.set(id, { id, tier: Number(item.app_release_rank || 0), releaseAt: Number(item.rtime_release || 0), type: Number(item.type || 0) });
  }
  return [...unique.values()].sort((a, b) => (a.tier || 99) - (b.tier || 99) || b.releaseAt - a.releaseAt).slice(0, 100);
}

function steamStoreItemsUrl(ids, countryCode) {
  const input = { ids: ids.map(appid => ({ appid })), context: { language: 'schinese', country_code: countryCode.toUpperCase(), steam_realm: 1 },
    data_request: { include_assets: true, include_release: true, include_basic_info: true, include_reviews: true, include_best_purchase_option: true } };
  return `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`;
}

function steamAssetUrl(item) {
  const format = item?.assets?.asset_url_format;
  const file = item?.assets?.small_capsule || item?.assets?.main_capsule;
  if (!format || !file) return '';
  return `https://shared.fastly.steamstatic.com/store_item_assets/${format.replace('${FILENAME}', file)}`;
}

function enrichSteamRankedItem(ranked, item, currentTime = Date.now()) {
  if (!item) return ranked;
  const releaseAt = Number(item.release?.steam_release_date || 0);
  const upcoming = releaseAt > Math.floor(currentTime / 1000);
  const releaseDate = releaseAt ? new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric'
  }).format(new Date(releaseAt * 1000)) : '';
  const option = item.best_purchase_option || {};
  return {
    ...ranked,
    name: item.name || ranked.name,
    icon: steamAssetUrl(item) || ranked.icon,
    developer: item.basic_info?.developers?.[0]?.name || ranked.developer,
    description: item.basic_info?.short_description || ranked.description,
    priceText: upcoming ? '' : ranked.priceText || option.formatted_final_price || '',
    discountText: upcoming ? '' : ranked.discountText || (option.discount_pct ? `-${option.discount_pct}%` : ''),
    availabilityText: upcoming ? `即将推出${releaseDate ? ` · ${releaseDate}` : ''}` : ranked.availabilityText
  };
}

function steamArchiveBoard(type, period, refs, storeItems, region, currentTime = Date.now()) {
  const byId = new Map((storeItems || []).map(item => [Number(item.appid || item.id), item]));
  const items = refs.map((ref, index) => {
    const item = byId.get(ref.id) || {};
    const releaseAt = Number(item.release?.steam_release_date || ref.releaseAt || 0);
    const upcoming = releaseAt > Math.floor(currentTime / 1000);
    const releaseDate = releaseAt ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(releaseAt * 1000)) : '';
    const option = item.best_purchase_option || {};
    return { rank: index + 1, id: String(ref.id), name: item.name || `Steam App ${ref.id}`,
      icon: steamAssetUrl(item) || `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${ref.id}/capsule_231x87.jpg`,
      developer: item.basic_info?.developers?.[0]?.name || '', tags: [], description: item.basic_info?.short_description || '',
      url: `https://store.steampowered.com/app/${ref.id}/`, priceText: upcoming ? '' : option.formatted_final_price || '',
      discountText: option.discount_pct ? `-${option.discount_pct}%` : '',
      availabilityText: upcoming ? `即将推出${releaseDate ? ` · ${releaseDate}` : ''}` : '', change: '', weeks: '', chartText: '', tier: ref.tier };
  });
  const label = type === 'monthly' ? `${period.date.slice(0, 4)}年${Number(period.date.slice(5, 7))}月最热新品` : `${period.date}年度最佳`;
  const url = type === 'monthly' ? `https://store.steampowered.com/charts/topnewreleases/${period.path}` : `https://store.steampowered.com/charts/bestofyear/${period.path}`;
  return { date: period.date, region, capturedAt: new Date().toISOString(), board: { label, url, items, fetchedAt: new Date().toISOString(), error: null } };
}

export function parseSteamWeeklyDates(html) {
  const dates = [...String(html).matchAll(/charts\/topsellers\/[^/"\\]+\/(\d{4})-(\d{1,2})-(\d{1,2})/g)]
    .map(match => `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`);
  return [...new Set(dates)].slice(0, 3);
}

export function parseSteamFeatured(json) {
  const items = JSON.parse(json)?.top_sellers?.items;
  if (!Array.isArray(items) || !items.length) throw new Error('Steam 日本区备用接口没有热销商品');
  return items.filter(item => Number.isSafeInteger(item.id) && item.id > 0 && item.name).slice(0, 100).map((item, index) => ({
    rank: index + 1,
    id: String(item.id),
    name: item.name.replace(/\s*[（(]在您的地区不可用[）)]\s*$/u, '').trim(),
    icon: typeof item.small_capsule_image === 'string' && /^https:\/\//.test(item.small_capsule_image) ? item.small_capsule_image : `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${item.id}/capsule_231x87.jpg`,
    developer: '', tags: [], description: '',
    url: `https://store.steampowered.com/app/${item.id}/`,
    priceText: item.final_price === 0 ? '免费开玩' : item.currency === 'JPY' && Number.isFinite(item.final_price) ? `¥${Math.round(item.final_price / 100).toLocaleString('en-US')}` : '',
    change: '', weeks: '', chartText: ''
  }));
}

export function parseMediaMonthlyRanking(searchJson, postJson, platform) {
  const posts = JSON.parse(searchJson.replace(/^\uFEFF/, ''));
  const term = mediaSearch[platform];
  const match = selectMediaPost(posts, platform);
  if (!match) throw new Error('没有找到可核验的月度 Top 100 报道');
  const post = JSON.parse(postJson.replace(/^\uFEFF/, ''));
  if (post.id !== match.id || post.link !== match.url || !post.date_gmt) throw new Error('榜单文章与搜索结果不一致');
  const article = load(post.content?.rendered || '');
  const body = article('body').text().replace(/\s+/g, ' ');
  const line = body.match(new RegExp(`(\\d{4})年(\\d{1,2})月${term}前十名依次是[：:]([^。]+)。`));
  if (!line) throw new Error('报道没有明确列出前十名及榜单月份');
  const names = [...line[3].matchAll(/《([^》]{1,80})》/g)].map(match => match[1]);
  if (names.length !== 10 || new Set(names).size !== 10) throw new Error('报道的前十名不完整');
  const period = `${line[1]}-${line[2].padStart(2, '0')}`;
  const publishedAt = `${post.date_gmt}Z`;
  if (Number.isNaN(Date.parse(publishedAt)) || period > publishedAt.slice(0, 7)) throw new Error('榜单月份或发布日期无效');
  let chartUrl = '';
  const rawChart = article('img').toArray().map(element => article(element).attr('src') || '')
    .find(value => /MiniGame/i.test(value));
  try {
    const parsed = new URL(rawChart);
    if (parsed.hostname === 'www.gamelook.com.cn' && parsed.pathname.startsWith('/wp-content/uploads/')) {
      parsed.protocol = 'https:';
      parsed.pathname = parsed.pathname.replace(/-\d+x\d+(?=\.[a-z]+$)/i, '');
      chartUrl = parsed.toString();
    }
  } catch { /* The structured top ten remains usable when the source chart is absent. */ }
  return { url: match.url, period, publishedAt, total: 100, chartUrl, items: names.map((name, index) => ({
    rank: index + 1, id: `${platform}:${period}:${index + 1}`, name, icon: '', developer: '', tags: [],
    description: '', url: match.url
  })) };
}

function productKey(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (host === 'sj.qq.com') return `wechat:${url.pathname.match(/\/appdetail\/(wx[0-9a-f]{16})/i)?.[1]?.toLowerCase() || ''}`;
    if (host === 'apps.apple.com') return `apple:${url.pathname.match(/\/id(\d+)/)?.[1] || ''}`;
    if (host === 'www.taptap.cn') return `taptap:${url.pathname.match(/^\/app\/(\d+)/)?.[1] || ''}`;
  } catch { /* Invalid links simply cannot be matched. */ }
  return '';
}

function normalizedName(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\s·・:：™®©()（）\[\]【】'"“”‘’_-]+/g, '');
}

export function enrichRankingCatalog(data, games) {
  const byProduct = new Map();
  const nameCandidates = new Map();
  for (const game of Array.isArray(games) ? games : []) {
    const key = productKey(game.sourceUrl);
    if (key && !key.endsWith(':')) byProduct.set(key, game);
    for (const value of [game.name, game.englishName]) {
      const name = normalizedName(value);
      if (!name) continue;
      const candidates = nameCandidates.get(name) || [];
      candidates.push(game);
      nameCandidates.set(name, candidates);
    }
  }
  const enrichItems = items => (items || []).map(item => {
    const exact = byProduct.get(productKey(item.url));
    const named = nameCandidates.get(normalizedName(item.name));
    const game = exact || (named?.length === 1 ? named[0] : null);
    if (!game) return { ...item };
    return {
      ...item,
      icon: item.icon || game.iconUrl || '',
      developer: item.developer || game.developer || '',
      tags: item.tags?.length ? item.tags : (game.tags || []).slice(0, 8),
      description: item.description || game.description || ''
    };
  });
  const platforms = Object.fromEntries(Object.entries(data?.platforms || {}).map(([platform, group]) => [platform, {
    ...group,
    boards: Object.fromEntries(Object.entries(group.boards || {}).map(([key, board]) => [key, { ...board, items: enrichItems(board.items) }]))
  }]));
  return { ...data, platforms, boards: platforms.wechat?.boards || data?.boards || {} };
}

const rankingIconCache = new Map();
const tapTapProductHints = new Map([
  [normalizedName('传奇之业'), 'https://www.taptap.cn/app/800323'],
  [normalizedName('超能下蛋鸭'), 'https://www.taptap.cn/app/798978']
]);

export async function fillMissingRankingIcons(data, { getJson = async url => {
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GameIntelligenceResearch/1.0)' }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}, getText = async url => {
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GameIntelligenceResearch/1.0)' }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}, now = () => Date.now() } = {}) {
  const names = [...new Set(Object.values(data?.platforms || {}).flatMap(group =>
    Object.values(group.boards || {}).flatMap(board => board.items || [])).filter(item => !item.icon).map(item => item.name))];
  await Promise.all(names.map(async name => {
    const key = normalizedName(name);
    const cached = rankingIconCache.get(key);
    if (cached && now() - cached.at < 6 * 60 * 60 * 1000) return;
    let icon = '';
    try {
      const query = new URLSearchParams({ term: name, entity: 'software', country: 'cn', limit: '10' });
      const result = await getJson(`https://itunes.apple.com/search?${query}`);
      const exact = (result.results || []).find(item => normalizedName(item.trackName) === key &&
        (item.primaryGenreName === 'Games' || item.genres?.includes('Games')));
      if (typeof exact?.artworkUrl100 === 'string' && /^https:\/\/[^/]*mzstatic\.com\//.test(exact.artworkUrl100)) icon = exact.artworkUrl100;
    } catch { /* Keep a named fallback when no verified store icon is available. */ }
    if (!icon && tapTapProductHints.has(key)) {
      try {
        const $ = load(await getText(tapTapProductHints.get(key)));
        const details = $('script[type="application/ld+json"]').toArray().map(element => {
          try { return JSON.parse($(element).text()); } catch { return null; }
        }).find(value => value?.['@type'] === 'VideoGame' && normalizedName(value.name) === key);
        const candidate = Array.isArray(details?.image) ? details.image[0] : details?.image;
        if (typeof candidate === 'string' && /^https:\/\/[^/]*tapimg\.com\//.test(candidate)) icon = candidate;
      } catch { /* Named fallback remains available if the official product page is temporarily unavailable. */ }
    }
    rankingIconCache.set(key, { icon, at: now() });
  }));
  const platforms = Object.fromEntries(Object.entries(data?.platforms || {}).map(([platform, group]) => [platform, {
    ...group,
    boards: Object.fromEntries(Object.entries(group.boards || {}).map(([boardKey, board]) => [boardKey, { ...board,
      items: (board.items || []).map(item => ({ ...item, icon: item.icon || rankingIconCache.get(normalizedName(item.name))?.icon || '' }))
    }]))
  }]));
  return { ...data, platforms, boards: platforms.wechat?.boards || data?.boards || {} };
}

export function createRankings({ fetchPage = async url => {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GameIntelligenceResearch/1.0)' }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  } catch {
    const proxy = await systemHttpsProxy();
    const args = ['--fail', '--location', '--silent', '--show-error', '--connect-timeout', '5', '--max-time', '12'];
    if (proxy) args.push('--proxy', proxy);
    args.push(url);
    const { stdout } = await execFileAsync('curl', args, { maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  }
}, now = () => Date.now(), ttl = 30 * 60 * 1000,
historyFile = process.env.STEAM_RANKING_HISTORY_FILE || steamRankingHistoryFile, cacheFile } = {}) {
  const resolvedCacheFile = cacheFile === undefined
    ? (historyFile === false ? false : process.env.STEAM_RANKING_CACHE_FILE || steamRankingCacheFile)
    : cacheFile;
  const boards = Object.fromEntries(Object.entries(rankingSources).map(([key, source]) => [key, { ...source, items: [], fetchedAt: null, error: null }]));
  const apple = Object.fromEntries(Object.entries(appleRankingSources).map(([key, source]) => [key, { ...source, items: [], fetchedAt: null, error: null }]));
  const taptap = Object.fromEntries(Object.entries(tapTapRankingSources).map(([key, source]) => [key, { ...source, items: [], fetchedAt: null, error: null }]));
  const steam = Object.fromEntries(Object.entries(steamRankingSources).map(([key, source]) => [key, { ...source, items: [], fetchedAt: null, error: null }]));
  const regionalTopSelling = Object.fromEntries(Object.keys(steamRegions).map(region => [region,
    { ...steamTopSellingSource(region), items: [], fetchedAt: null, error: null }]));
  const regionalWeekly = Object.fromEntries(Object.keys(steamRegions).map(region => [region, []]));
  const regionalMonthly = Object.fromEntries(Object.keys(steamRegions).map(region => [region, []]));
  const regionalYearly = Object.fromEntries(Object.keys(steamRegions).map(region => [region, []]));
  const savedSteam = readSteamRankingCache(resolvedCacheFile);
  if (savedSteam) {
    Object.assign(steam, savedSteam.steam || {});
    Object.assign(regionalTopSelling, savedSteam.regionalTopSelling || {});
    Object.assign(regionalWeekly, savedSteam.regionalWeekly || {});
    Object.assign(regionalMonthly, savedSteam.regionalMonthly || {});
    Object.assign(regionalYearly, savedSteam.regionalYearly || {});
  }
  boards.mediaMonthly = { label: '第三方月度畅销 Top 100', url: '', items: [], fetchedAt: null, error: null };
  const douyin = { mediaMonthly: { label: '第三方月度畅销 Top 100', url: '', items: [], fetchedAt: null, error: null } };
  const platforms = {
    wechat: { label: '微信小游戏', scope: '腾讯应用宝公开榜单及 GameLook 月度报道', boards },
    apple: { label: 'App Store', scope: '中国区 iPhone 游戏榜单', boards: apple },
    taptap: { label: 'TapTap', scope: 'TapTap 公开榜单', boards: taptap },
    steam: { label: 'Steam', scope: 'Steam 官方全球及区域榜单；价格按来源页面返回币种显示', boards: steam },
    douyin: { label: '抖音小游戏', scope: 'GameLook 第三方月度畅销榜报道', boards: douyin }
  };
  let lastAttempt = 0;
  let pending = null;
  const steamPending = new Map();
  let steamHistory = readSteamHistory(historyFile);

  function saveSteamCache() {
    writeSteamRankingCache(resolvedCacheFile, { savedAt: new Date(now()).toISOString(), steam, regionalTopSelling,
      regionalWeekly, regionalMonthly, regionalYearly });
  }

  function response(region = 'global') {
    const selectedRegion = steamRegions[region] ? region : 'global';
    return { source: '多平台公开游戏榜单', boards, platforms: {
      ...platforms,
      steam: { ...platforms.steam, region: selectedRegion,
        regionOptions: Object.entries(steamRegions).map(([value, item]) => ({ value, label: item.label })),
        boards: { ...steam, topSelling: regionalTopSelling[selectedRegion] },
        weeklyBoards: regionalWeekly[selectedRegion],
        monthlyBoards: regionalMonthly[selectedRegion],
        yearlyBoards: regionalYearly[selectedRegion],
        history: steamHistory.filter(item => item.region === selectedRegion) }
    } };
  }

  function saveTopSellingSnapshot(board, region) {
    if (!board?.items?.length || !board.fetchedAt) return;
    const date = localSnapshotDate(board.fetchedAt);
    const snapshot = { capturedAt: board.fetchedAt, date, region, board: { ...board, items: board.items.map(item => ({ ...item })) } };
    steamHistory = [snapshot, ...steamHistory.filter(item => item.date !== date || item.region !== region)]
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)).slice(0, 360);
    writeSteamHistory(historyFile, steamHistory);
  }

  async function refreshSteam(force = false, requestedRegion = 'global') {
    const region = steamRegions[requestedRegion] ? requestedRegion : 'global';
    if (steamPending.has(region)) return steamPending.get(region);
    const selectedTopSelling = regionalTopSelling[region];
    if (!force && selectedTopSelling.items.length) {
      const age = now() - Date.parse(selectedTopSelling.fetchedAt || '');
      if (!Number.isFinite(age) || age >= ttl) void refreshSteam(true, region).catch(() => {});
      return response(region);
    }
    const sources = region === 'global' ? { ...steamRankingSources, topSelling: steamTopSellingSource(region) }
      : { topSelling: steamTopSellingSource(region) };
    const task = (async () => {
      await Promise.all(Object.entries(sources).map(async ([key, source]) => {
        const target = key === 'topSelling' ? regionalTopSelling : steam;
        const current = key === 'topSelling' ? target[region] : target[key];
        try {
          const html = await fetchPage(source.url);
          const items = parseSteamRanking(html);
          if (key === 'topSelling') {
            target[region] = { ...source, items, fetchedAt: new Date(now()).toISOString(), error: null };
            const dates = parseSteamWeeklyDates(html);
            const weekly = await Promise.all(dates.map(async date => {
              const rawDate = date.replace(/-0(\d)/g, '-$1');
              const weeklyUrl = `https://store.steampowered.com/charts/topsellers/${steamRegions[region].path}/${rawDate}?cc=${steamRegions[region].cc}&l=schinese`;
              try {
                return { date, region, capturedAt: new Date(now()).toISOString(), board: {
                  label: `${steamRegions[region].label}${date}每周畅销榜`, url: weeklyUrl,
                  items: parseSteamRanking(await fetchPage(weeklyUrl)), fetchedAt: new Date(now()).toISOString(), error: null
                } };
              } catch { return null; }
            }));
            regionalWeekly[region] = weekly.filter(Boolean);
            const periods = parseSteamArchivePeriods(html);
            const latestMonthly = periods.monthly[0]?.date;
            const latestYearly = periods.yearly[0]?.date;
            const needsMonthlyRefresh = !regionalMonthly[region].length ||
              (latestMonthly && regionalMonthly[region][0]?.date !== latestMonthly);
            const needsYearlyRefresh = !regionalYearly[region].length ||
              (latestYearly && regionalYearly[region][0]?.date !== latestYearly);
            const loadArchive = async (type, period) => {
              try { return { period, refs: steamArchiveRefs(type, JSON.parse(await fetchPage(steamArchiveApiUrl(type, period.date)))) }; }
              catch { return null; }
            };
            const [monthlyRaw, yearlyRaw] = await Promise.all([
              needsMonthlyRefresh ? Promise.all(periods.monthly.map(period => loadArchive('monthly', period))) : Promise.resolve([]),
              needsYearlyRefresh ? Promise.all(periods.yearly.map(period => loadArchive('yearly', period))) : Promise.resolve([])
            ]);
            const archives = [...monthlyRaw, ...yearlyRaw].filter(Boolean);
            const ids = [...new Set([
              ...items.map(item => Number(item.id)),
              ...archives.flatMap(item => item.refs.map(ref => ref.id))
            ].filter(id => Number.isSafeInteger(id) && id > 0))];
            const chunks = Array.from({ length: Math.ceil(ids.length / 40) }, (_, index) => ids.slice(index * 40, index * 40 + 40));
            const storeItems = (await Promise.all(chunks.map(async chunk => {
              try {
                return JSON.parse(await fetchPage(steamStoreItemsUrl(chunk, steamRegions[region].cc)))?.response?.store_items || [];
              } catch { return []; }
            }))).flat();
            const storeItemsById = new Map(storeItems.map(item => [Number(item.appid || item.id), item]));
            target[region] = { ...target[region], items: items.map(item => enrichSteamRankedItem(item, storeItemsById.get(Number(item.id)), now())) };
            if (archives.length) {
              const monthly = monthlyRaw.filter(Boolean).map(item => steamArchiveBoard('monthly', item.period, item.refs, storeItems, region, now()));
              const yearly = yearlyRaw.filter(Boolean).map(item => steamArchiveBoard('yearly', item.period, item.refs, storeItems, region, now()));
              if (monthly.length) regionalMonthly[region] = monthly;
              if (yearly.length) regionalYearly[region] = yearly;
            }
          } else target[key] = { ...source, items, fetchedAt: new Date(now()).toISOString(), error: null };
        } catch (error) {
          if (key === 'topSelling') {
            try {
              const items = parseSteamFeatured(await fetchPage(`https://store.steampowered.com/api/featuredcategories/?cc=${steamRegions[region].cc}&l=schinese`));
              target[region] = { ...source, label: `${steamRegions[region].label}实时畅销（当前返回 ${items.length} 款）`, items,
                fetchedAt: new Date(now()).toISOString(), error: null, fallback: true };
              return;
            } catch { /* Preserve the last successful chart below. */ }
          }
          if (key === 'topSelling') target[region] = { ...current, error: error instanceof Error ? error.message : '采集失败' };
          else target[key] = { ...current, error: error instanceof Error ? error.message : '采集失败' };
        }
      }));
      saveTopSellingSnapshot(regionalTopSelling[region], region);
      saveSteamCache();
      return response(region);
    })();
    steamPending.set(region, task);
    try { return await task; }
    finally { steamPending.delete(region); }
  }

  async function get(force = false) {
    if (pending) return pending;
    if (!force && lastAttempt && now() - lastAttempt < ttl) return response();
    lastAttempt = now();
    pending = (async () => {
      const official = Promise.all([
        ...Object.entries(rankingSources).map(([key, source]) => ({ key, source, target: boards, parse: parseRanking })),
        ...Object.entries(appleRankingSources).map(([key, source]) => ({ key, source, target: apple, parse: parseAppleRanking })),
        ...Object.entries(tapTapRankingSources).map(([key, source]) => ({ key, source, target: taptap, parse: parseTapTapRanking })),
        ...Object.entries(steamRankingSources).map(([key, source]) => ({ key, source, target: steam, parse: parseSteamRanking }))
      ].map(async ({ key, source, target, parse }) => {
        try {
          const items = parse(await fetchPage(source.url));
          target[key] = { ...source, items, fetchedAt: new Date(now()).toISOString(), error: null };
        } catch (error) {
          target[key] = { ...target[key], error: error instanceof Error ? error.message : '采集失败' };
        }
      }));
      const monthly = Promise.all(Object.entries(mediaSearch).map(async ([platform, term]) => {
        const target = platforms[platform].boards;
        try {
          const searchJson = await fetchPage(`${mediaApi}/search?search=${encodeURIComponent(term)}&per_page=10`);
          const posts = JSON.parse(searchJson.replace(/^\uFEFF/, ''));
          const match = selectMediaPost(posts, platform);
          if (!match) throw new Error('没有找到可核验的月度 Top 100 报道');
          const postJson = await fetchPage(`${mediaApi}/posts/${match.id}`);
          const result = parseMediaMonthlyRanking(searchJson, postJson, platform);
          target.mediaMonthly = { label: '第三方月度畅销 Top 100', ...result,
            fetchedAt: new Date(now()).toISOString(), error: null };
        } catch (error) {
          target.mediaMonthly = { ...target.mediaMonthly, error: error instanceof Error ? error.message : '采集失败' };
        }
      }));
      await Promise.all([official, monthly]);
      regionalTopSelling.global = steam.topSelling;
      saveTopSellingSnapshot(regionalTopSelling.global, 'global');
      return response();
    })();
    try { return await pending; }
    finally { pending = null; }
  }
  return { get, refreshSteam };
}
