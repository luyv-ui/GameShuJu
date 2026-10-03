import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { load } from 'cheerio';
import { importVerifiedSnapshot } from './ingestion.js';

const statusFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/catalog-sync-status.json');
const sourceLinks = {
  steam: 'https://store.steampowered.com/search/',
  apple: 'https://itunes.apple.com/search',
  taptap: 'https://www.taptap.cn/top/download',
  wechat: 'https://sj.qq.com/wechat-game'
};
const genreNames = new Map([
  ['Action', '动作'], ['Adventure', '冒险'], ['Arcade', '街机'], ['Board', '桌游'],
  ['Card', '策略卡牌'], ['Casual', '休闲'], ['Puzzle', '解谜'], ['Racing', '竞速'],
  ['Role Playing', '角色扮演'], ['Simulation', '模拟经营'], ['Sports', '体育'],
  ['Strategy', '策略']
]);
const miniPages = [
  '/wechat-game', '/wechat-game/hot-game-list', '/wechat-game/choice-game-list',
  '/wechat-game/popular-game-rank', '/wechat-game/best-sell-game-rank',
  '/wechat-game/new-game-rank', '/wechat-game-tag/xiuxianyizhi',
  '/wechat-game-tag/rpg', '/wechat-game-tag/chess', '/wechat-game-tag/slg02',
  '/wechat-game-tag/avg', '/wechat-game-tag/danji'
];
const appleTerms = ['game', 'puzzle', 'rpg', 'strategy', 'simulation', 'arcade', 'casual', 'action', 'adventure', 'card', 'sports', 'music', 'racing'];
const tapTapBoards = ['/top/download', '/top/played', '/top/new', '/top/reserve'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const execFileAsync = promisify(execFile);
const asDate = value => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date > new Date() ? '' : date.toISOString().slice(0, 10);
};
const emptyMetrics = { price: null, rating: null, reviewCount: null, peakPlayers: null };
export function steamUsdPrice(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (/free/i.test(value)) return 0;
  const matches = [...value.matchAll(/\$\s*([\d,]+(?:\.\d{1,2})?)/g)];
  if (!matches.length) return null;
  const amount = Number(matches.at(-1)[1].replaceAll(',', ''));
  return Number.isFinite(amount) ? amount : null;
}

async function fetchText(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GameIntelligenceResearch/1.0)' },
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (error.cause || /fetch failed/i.test(String(error.message || error))) {
        try {
          const { stdout } = await execFileAsync('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '20',
            '--user-agent', 'Mozilla/5.0 (compatible; GameIntelligenceResearch/1.0)', url], { maxBuffer: 6 * 1024 * 1024 });
          return stdout;
        } catch (fallbackError) { lastError = fallbackError; }
      }
      if (attempt < 2) await pause(500 * (attempt + 1));
    }
  }
  throw lastError;
}
const fetchJson = async url => JSON.parse(await fetchText(url));

// Steam occasionally accepts the directory request while throttling its per-product
// APIs. Product enrichment is best-effort, so keep it on a short single-attempt
// budget: one unavailable product must never hold the whole catalog sync hostage.
async function fetchSteamJson(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GameIntelligenceResearch/1.0)' },
    signal: AbortSignal.timeout(6000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function publicImage(value) {
  const candidate = Array.isArray(value) ? value[0] : typeof value === 'object' && value ? value.url || value.contentUrl : value;
  return typeof candidate === 'string' && candidate.startsWith('https://') ? candidate : '';
}

async function mapConcurrent(values, limit, operation) {
  const results = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await operation(values[index], index);
    }
  }));
  return results;
}

export async function collectSteam(asOf, pages = 8, getJson = fetchSteamJson, getDetails = getJson) {
  const games = new Map();
  const warnings = [];
  for (let page = 0; page < pages; page++) {
    const query = new URLSearchParams({ query: '', start: String(page * 50), count: '50', filter: 'games', sort_by: 'Released_DESC', infinite: '1', cc: 'us', l: 'english' });
    const result = await getJson(`https://store.steampowered.com/search/results/?${query}`);
    const $ = load(result.results_html || '');
    $('a.search_result_row').each((_, element) => {
      const row = $(element);
      const id = Number(row.attr('data-ds-appid'));
      const name = row.find('.title').first().text().trim();
      if (!Number.isSafeInteger(id) || id <= 0 || !name || /\b(demo|playtest|soundtrack)\b/i.test(name)) return;
      const price = steamUsdPrice(row.find('.discount_final_price').last().text() || row.find('.search_price').text());
      games.set(id, {
        channel: '端游', name, englishName: name, genre: '未分类', platforms: ['PC'],
        releaseDate: asDate(row.find('.search_released').first().text().trim()),
        developer: '', publisher: '', ...emptyMetrics, price, tags: [], description: '',
        iconUrl: publicImage(row.find('img').first().attr('src')),
        steamAppId: id, sourceUrl: `https://store.steampowered.com/app/${id}/`,
        metricsSourceUrl: '', dataAsOf: asOf,
        metricScope: 'Steam 美国区公开目录；美元当前售价，评价和销量未采集', isDemo: false
      });
    });
    if (!result.results_html || !$('a.search_result_row').length) break;
    if (page + 1 < pages) await pause(250);
  }
  if (!games.size) throw new Error('Steam 未返回有效游戏');
  const enriched = await mapConcurrent([...games.values()], 32, async game => {
    const detailsUrl = `https://store.steampowered.com/api/appdetails?appids=${game.steamAppId}&cc=us&l=schinese`;
    const reviewsUrl = `https://store.steampowered.com/appreviews/${game.steamAppId}?json=1&language=all&purchase_type=all&filter=all&num_per_page=0`;
    const [detailsResult, reviewsResult] = await Promise.allSettled([getDetails(detailsUrl), getDetails(reviewsUrl)]);
    let next = game;
    if (detailsResult.status === 'fulfilled') {
      const payload = detailsResult.value?.[game.steamAppId];
      const details = payload?.success ? payload.data : null;
      if (details) {
        const usdPrice = details.is_free ? 0 : details.price_overview?.currency === 'USD' && Number.isFinite(details.price_overview.final)
          ? details.price_overview.final / 100 : game.price;
        const platforms = ['PC'];
        if (details.platforms?.mac) platforms.push('macOS');
        if (details.platforms?.linux) platforms.push('Linux');
        next = { ...next,
          name: String(details.name || next.name).slice(0, 120),
          genre: String(details.genres?.[0]?.description || next.genre).slice(0, 50),
          platforms, releaseDate: asDate(details.release_date?.date) || next.releaseDate,
          developer: String(details.developers?.[0] || '').slice(0, 120),
          publisher: String(details.publishers?.[0] || '').slice(0, 120),
          price: usdPrice, tags: (details.genres || []).map(item => String(item.description || '')).filter(Boolean).slice(0, 8),
          description: String(details.short_description || '').slice(0, 500),
          iconUrl: publicImage(details.header_image) || next.iconUrl };
      } else warnings.push(`${game.steamAppId}: Steam 详情接口未返回商品资料`);
    } else warnings.push(`${game.steamAppId}: Steam 详情采集失败`);
    if (reviewsResult.status === 'fulfilled' && reviewsResult.value?.success === 1) {
      const summary = reviewsResult.value.query_summary || {};
      const total = Number(summary.total_reviews || 0);
      const positive = Number(summary.total_positive || 0);
      next = { ...next, rating: total > 0 ? Math.round(positive / total * 100) : null,
        reviewCount: total, metricsSourceUrl: reviewsUrl };
    } else warnings.push(`${game.steamAppId}: Steam 评价采集失败`);
    return { ...next, metricScope: 'Steam 美国区美元当前售价；全语言全部购买类型评价；商品详情来自 Steam 官方接口' };
  });
  enriched.warnings = warnings;
  return enriched;
}

export async function collectApple(asOf, terms = appleTerms, getJson = fetchJson) {
  const games = new Map();
  const warnings = [];
  for (const term of terms) {
    try {
      const query = new URLSearchParams({ term, entity: 'software', country: 'us', limit: '200' });
      const result = await getJson(`https://itunes.apple.com/search?${query}`);
      for (const item of result.results || []) {
        if (item.primaryGenreName !== 'Games' || !Number.isSafeInteger(item.trackId) || !item.trackName || !item.trackViewUrl) continue;
        const subgenre = (item.genres || []).find(genre => genreNames.has(genre));
        games.set(item.trackId, {
          channel: 'App', name: item.trackName, englishName: item.trackName,
          genre: genreNames.get(subgenre) || '未分类', platforms: ['iOS'],
          releaseDate: asDate(item.releaseDate), developer: item.artistName || '',
          publisher: item.artistName || '', ...emptyMetrics,
          tags: (item.genres || []).filter(genre => genre !== 'Games').slice(0, 8),
          description: (item.description || '').slice(0, 500), iconUrl: publicImage(item.artworkUrl100), steamAppId: null,
          sourceUrl: item.trackViewUrl, metricsSourceUrl: '', dataAsOf: asOf,
          metricScope: 'Apple App Store 美国区商品；美元价格和五星评分另存，未与 Steam 指标合并',
          sourceExtras: { appStoreId: item.trackId, usPriceUsd: item.price ?? null,
            usRatingOutOf5: item.averageUserRating ?? null, usRatingCount: item.userRatingCount ?? null },
          isDemo: false
        });
      }
    } catch (error) { warnings.push(`${term}: ${error.message || error}`); }
    await pause(250);
  }
  if (!games.size) throw new Error('App Store 未返回有效游戏');
  const ids = [...games.keys()];
  for (let offset = 0; offset < ids.length; offset += 150) {
    const batch = ids.slice(offset, offset + 150);
    try {
      const query = new URLSearchParams({ id: batch.join(','), country: 'cn', entity: 'software' });
      const localized = await getJson(`https://itunes.apple.com/lookup?${query}`);
      for (const item of localized.results || []) {
        const existing = games.get(item.trackId);
        if (!existing) continue;
        games.set(item.trackId, { ...existing,
          name: String(item.trackName || existing.name).slice(0, 120),
          iconUrl: publicImage(item.artworkUrl100) || existing.iconUrl,
          metricScope: 'Apple App Store 美国区价格与评分；中文名称及图标优先取中国区官方商品'
        });
      }
    } catch (error) { warnings.push(`中国区名称批次 ${offset / 150 + 1}: ${error.message || error}`); }
    if (offset + 150 < ids.length) await pause(100);
  }
  const result = [...games.values()];
  result.warnings = warnings;
  return result;
}

export async function collectMissingAppleIcons(asOf, existingGames, getJson = fetchJson) {
  const missing = existingGames.filter(game => !game.iconUrl && game.sourceExtras?.appStoreId &&
    (() => { try { return new URL(game.sourceUrl).hostname === 'apps.apple.com'; } catch { return false; } })());
  if (!missing.length) return [];
  const byId = new Map(missing.map(game => [Number(game.sourceExtras.appStoreId), game]));
  const enriched = [];
  const ids = [...byId.keys()];
  for (let offset = 0; offset < ids.length; offset += 150) {
    const query = new URLSearchParams({ id: ids.slice(offset, offset + 150).join(','), country: 'us', entity: 'software' });
    const result = await getJson(`https://itunes.apple.com/lookup?${query}`);
    for (const item of result.results || []) {
      const previous = byId.get(Number(item.trackId));
      const iconUrl = publicImage(item.artworkUrl100);
      if (!previous || !iconUrl) continue;
      enriched.push({ ...previous, iconUrl, dataAsOf: asOf });
    }
    if (offset + 150 < ids.length) await pause(100);
  }
  return enriched;
}

export async function collectMissingPageIcons(asOf, existingGames, hostname) {
  const missing = existingGames.filter(game => !game.iconUrl && (() => {
    try { return new URL(game.sourceUrl).hostname === hostname; } catch { return false; }
  })());
  return (await mapConcurrent(missing, 4, async game => {
    try {
      const $ = load(await fetchText(game.sourceUrl));
      let iconUrl = '';
      if (hostname === 'www.taptap.cn') {
        const details = $('script[type="application/ld+json"]').toArray()
          .map(element => { try { return JSON.parse($(element).text()); } catch { return null; } })
          .find(value => value?.['@type'] === 'VideoGame');
        iconUrl = publicImage(details?.image);
      } else if (hostname === 'sj.qq.com') {
        iconUrl = publicImage($('img[class*="GameIcon"][src*="/logo/"]').first().attr('src'));
      }
      return iconUrl ? { ...game, iconUrl, dataAsOf: asOf } : null;
    } catch { return null; }
  })).filter(Boolean);
}

export async function collectTapTap(asOf, boards = tapTapBoards) {
  const links = new Map();
  const warnings = [];
  for (const board of boards) {
    try {
      const $ = load(await fetchText(`https://www.taptap.cn${board}`));
      const structured = $('script[type="application/ld+json"]').toArray()
        .map(element => JSON.parse($(element).text()))
        .find(value => value['@type'] === 'ItemList');
      if (!structured?.itemListElement?.length) throw new Error('榜单缺少商品列表');
      for (const entry of structured.itemListElement) {
        const url = new URL(entry.url);
        if (url.hostname === 'www.taptap.cn' && /^\/app\/\d+$/.test(url.pathname)) links.set(url.pathname, url.toString());
      }
      $('a[href*="/app/"]').each((_, element) => {
        const url = new URL($(element).attr('href') || '', 'https://www.taptap.cn');
        if (url.hostname === 'www.taptap.cn' && /^\/app\/\d+$/.test(url.pathname)) links.set(url.pathname, `${url.origin}${url.pathname}`);
      });
    } catch (error) { warnings.push(`${board}: ${error.message || error}`); }
    await pause(200);
  }
  const games = (await mapConcurrent([...links.values()], 6, async url => {
    try {
      const $ = load(await fetchText(url));
      const details = $('script[type="application/ld+json"]').toArray()
        .map(element => JSON.parse($(element).text()))
        .find(value => value['@type'] === 'VideoGame');
      if (!details?.name || String(details.name).length > 120) throw new Error('商品页缺少有效游戏名');
      const genre = Array.isArray(details.genre) ? details.genre[0] : details.genre;
      return {
        channel: 'App', name: details.name, englishName: '',
        genre: String(genre || '未分类').slice(0, 50), platforms: ['Android'],
        releaseDate: asDate(details.datePublished), developer: String(details.author?.name || '').slice(0, 120),
        publisher: '', ...emptyMetrics, tags: Array.isArray(details.genre) ? details.genre.slice(0, 8) : genre ? [genre] : [],
        description: String(details.description || '').slice(0, 500), iconUrl: publicImage(details.image), steamAppId: null,
        sourceUrl: url, metricsSourceUrl: '', dataAsOf: asOf,
        metricScope: 'TapTap 公开榜单及商品页；评分、下载量与收入未采集', isDemo: false
      };
    } catch (error) { warnings.push(`${url}: ${error.message || error}`); return null; }
  })).filter(Boolean);
  if (!games.length) throw new Error('TapTap 未返回有效游戏');
  games.warnings = warnings;
  return games;
}

export async function collectWechat(asOf, pages = miniPages) {
  const games = new Map();
  for (const page of pages) {
    const $ = load(await fetchText(`https://sj.qq.com${page}`));
    const next = JSON.parse($('#__NEXT_DATA__').text());
    const components = next.props?.pageProps?.dynamicCardResponse?.data?.components || [];
    for (const item of components.flatMap(component => component.data?.itemData || [])) {
      if (!/^wx[0-9a-f]{16}$/i.test(item.pkg_name || '') || item.report_info?.yyb_app_type !== 'wechatgame' || !item.name) continue;
      const tags = String(item.tags || '').split(',').map(tag => tag.trim()).filter(Boolean);
      games.set(item.pkg_name, {
        channel: '小游戏', name: item.name, englishName: '', genre: tags[0] || '未分类',
        platforms: ['微信小游戏'], releaseDate: '', developer: item.developer || '', publisher: '',
        ...emptyMetrics, tags: tags.slice(0, 12), description: item.editor_intro || '', iconUrl: publicImage(item.icon),
        steamAppId: null, sourceUrl: `https://sj.qq.com/appdetail/${item.pkg_name}`,
        metricsSourceUrl: '', dataAsOf: asOf,
        metricScope: '腾讯应用宝微信小游戏目录；未采集可比营收及评价指标', isDemo: false
      });
    }
    await pause(250);
  }
  const missingIcons = [...games.entries()].filter(([, game]) => !game.iconUrl);
  await mapConcurrent(missingIcons, 4, async ([key, game]) => {
    try {
      const $ = load(await fetchText(game.sourceUrl));
      const iconUrl = publicImage($('img[class*="GameIcon"][src*="/logo/"]').first().attr('src'));
      if (iconUrl) games.set(key, { ...game, iconUrl });
    } catch { /* Keep the verified catalog record when its detail page is temporarily unavailable. */ }
  });
  if (!games.size) throw new Error('腾讯应用宝未返回有效微信小游戏');
  return [...games.values()];
}

function readStatus(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return { sources: {} }; }
}
function saveStatus(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}

export function createCatalogSync({ collectors = { steam: collectSteam, apple: collectApple, taptap: collectTapTap, wechat: collectWechat }, now = () => new Date(), file = process.env.CATALOG_SYNC_STATUS_FILE || statusFile, getExistingGames = () => [] } = {}) {
  const status = readStatus(file);
  let running = null;
  async function run() {
    if (running) return running;
    running = (async () => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const lock = `${file}.lock`;
      let handle;
      try { handle = fs.openSync(lock, 'wx'); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        try {
          const pid = Number(fs.readFileSync(lock, 'utf8'));
          process.kill(pid, 0);
          return getStatus();
        } catch (probeError) {
          if (probeError.code !== 'ESRCH') return getStatus();
          fs.rmSync(lock, { force: true });
          handle = fs.openSync(lock, 'wx');
        }
      }
      fs.writeFileSync(handle, String(process.pid));
      fs.closeSync(handle);
      Object.assign(status, readStatus(file));
      status.sources = Object.fromEntries(Object.entries(status.sources || {}).filter(([key]) => key in collectors));
      status.running = true;
      status.startedAt = now().toISOString();
      const asOf = status.startedAt.slice(0, 10);
      for (const key of Object.keys(collectors)) status.sources[key] = { ...status.sources[key], url: sourceLinks[key], state: 'syncing' };
      saveStatus(file, status);
      try {
        await Promise.all(Object.entries(collectors).map(async ([key, collect]) => {
          try {
            const games = await collect(asOf);
            if (key === 'apple') {
              const knownIds = new Set(games.map(game => game.sourceExtras?.appStoreId).filter(Boolean));
              const backfilled = await collectMissingAppleIcons(asOf, getExistingGames());
              games.push(...backfilled.filter(game => !knownIds.has(game.sourceExtras?.appStoreId)));
            }
            if (key === 'taptap' || key === 'wechat') {
              const hostname = key === 'taptap' ? 'www.taptap.cn' : 'sj.qq.com';
              const knownUrls = new Set(games.map(game => game.sourceUrl));
              const backfilled = await collectMissingPageIcons(asOf, getExistingGames(), hostname);
              games.push(...backfilled.filter(game => !knownUrls.has(game.sourceUrl)));
            }
            const document = {
              fetchedAt: status.startedAt, methodology: '官方公开商品目录定期采集；按平台商品 ID 更新，不推断销量或收入。',
              sources: [sourceLinks[key]], limitations: ['目录搜索不是平台全量', '公开商品资料不包含可验证收入与留存'],
              failures: [], games
            };
            const result = importVerifiedSnapshot(document, { refreshExisting: true });
            status.sources[key] = { url: sourceLinks[key], state: games.warnings?.length ? 'partial' : 'ok',
              lastSuccessAt: now().toISOString(), fetched: games.length, ...result,
              warnings: games.warnings || [] };
          } catch (error) {
            status.sources[key] = { ...status.sources[key], url: sourceLinks[key], state: 'error',
              lastAttemptAt: now().toISOString(), error: String(error.message || error).slice(0, 300) };
          }
          saveStatus(file, status);
        }));
      } finally {
        status.running = false;
        status.finishedAt = now().toISOString();
        saveStatus(file, status);
        fs.rmSync(lock, { force: true });
      }
      return getStatus();
    })();
    try { return await running; }
    finally { running = null; }
  }
  function getStatus() {
    const current = readStatus(file);
    const lock = `${file}.lock`;
    if (current.running) {
      if (!fs.existsSync(lock)) current.running = false;
      else {
        try {
          const pid = Number(fs.readFileSync(lock, 'utf8'));
          if (!Number.isSafeInteger(pid) || pid <= 0) throw Object.assign(new Error('invalid lock'), { code: 'ESRCH' });
          process.kill(pid, 0);
        } catch (error) {
          if (error.code === 'ESRCH') {
            fs.rmSync(lock, { force: true });
            current.running = false;
          }
        }
      }
    }
    current.sources = Object.fromEntries(Object.entries(current.sources || {}).filter(([key]) => key in collectors));
    return current;
  }
  return { run, getStatus };
}
