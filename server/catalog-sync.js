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
  google: 'https://play.google.com/store/games',
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
const googleCategories = [
  ['', '未分类'], ['GAME_ACTION', '动作'], ['GAME_ADVENTURE', '冒险'],
  ['GAME_ARCADE', '街机'], ['GAME_BOARD', '桌游'], ['GAME_CARD', '策略卡牌'],
  ['GAME_CASUAL', '休闲'], ['GAME_PUZZLE', '解谜'], ['GAME_RACING', '竞速'],
  ['GAME_ROLE_PLAYING', '角色扮演'], ['GAME_SIMULATION', '模拟经营'],
  ['GAME_SPORTS', '体育'], ['GAME_STRATEGY', '策略']
];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const execFileAsync = promisify(execFile);
const asDate = value => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date > new Date() ? '' : date.toISOString().slice(0, 10);
};
const emptyMetrics = { price: null, rating: null, reviewCount: null, peakPlayers: null };

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
      if (error.cause?.code === 'ECONNRESET' || error.cause?.code === 'ETIMEDOUT') {
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

export async function collectSteam(asOf, pages = 8) {
  const games = new Map();
  for (let page = 0; page < pages; page++) {
    const query = new URLSearchParams({ query: '', start: String(page * 50), count: '50', filter: 'games', sort_by: 'Released_DESC', infinite: '1' });
    const result = await fetchJson(`https://store.steampowered.com/search/results/?${query}`);
    const $ = load(result.results_html || '');
    $('a.search_result_row').each((_, element) => {
      const row = $(element);
      const id = Number(row.attr('data-ds-appid'));
      const name = row.find('.title').first().text().trim();
      if (!Number.isSafeInteger(id) || id <= 0 || !name || /\b(demo|playtest|soundtrack)\b/i.test(name)) return;
      games.set(id, {
        channel: '端游', name, englishName: name, genre: '未分类', platforms: ['PC'],
        releaseDate: asDate(row.find('.search_released').first().text().trim()),
        developer: '', publisher: '', ...emptyMetrics, tags: [], description: '',
        steamAppId: id, sourceUrl: `https://store.steampowered.com/app/${id}/`,
        metricsSourceUrl: '', dataAsOf: asOf,
        metricScope: 'Steam 搜索目录商品资料；价格、评价和销量未采集', isDemo: false
      });
    });
    if (!result.results_html || !$('a.search_result_row').length) break;
    if (page + 1 < pages) await pause(250);
  }
  if (!games.size) throw new Error('Steam 未返回有效游戏');
  return [...games.values()];
}

export async function collectApple(asOf, terms = appleTerms) {
  const games = new Map();
  const warnings = [];
  for (const term of terms) {
    try {
      const query = new URLSearchParams({ term, entity: 'software', country: 'us', limit: '200' });
      const result = await fetchJson(`https://itunes.apple.com/search?${query}`);
      for (const item of result.results || []) {
        if (item.primaryGenreName !== 'Games' || !Number.isSafeInteger(item.trackId) || !item.trackName || !item.trackViewUrl) continue;
        const subgenre = (item.genres || []).find(genre => genreNames.has(genre));
        games.set(item.trackId, {
          channel: 'App', name: item.trackName, englishName: item.trackName,
          genre: genreNames.get(subgenre) || '未分类', platforms: ['iOS'],
          releaseDate: asDate(item.releaseDate), developer: item.artistName || '',
          publisher: item.artistName || '', ...emptyMetrics,
          tags: (item.genres || []).filter(genre => genre !== 'Games').slice(0, 8),
          description: (item.description || '').slice(0, 500), steamAppId: null,
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
  const result = [...games.values()];
  result.warnings = warnings;
  return result;
}

export async function collectGoogle(asOf, categories = googleCategories) {
  const games = new Map();
  const warnings = [];
  for (const [category, genre] of categories) {
    try {
      const url = category
        ? `https://play.google.com/store/apps/category/${category}?hl=en_US&gl=US`
        : 'https://play.google.com/store/games?hl=en_US&gl=US';
      const $ = load(await fetchText(url));
      const rows = $('a[href*="/store/apps/details?id="]');
      rows.each((_, element) => {
        const row = $(element);
        const id = new URL(row.attr('href') || '', 'https://play.google.com').searchParams.get('id');
        const name = row.find('span').first().text().trim();
        if (!id || !/^[A-Za-z0-9._]+$/.test(id) || !name || name.length > 120 || games.has(id)) return;
        games.set(id, {
          channel: 'App', name, englishName: name, genre, platforms: ['Android'],
          releaseDate: '', developer: '',
          publisher: '', ...emptyMetrics, tags: genre === '未分类' ? [] : [genre],
          description: '', steamAppId: null,
          sourceUrl: `https://play.google.com/store/apps/details?id=${id}`,
          metricsSourceUrl: '', dataAsOf: asOf,
          metricScope: 'Google Play 美国区游戏分类商品目录；价格与评价未采集', isDemo: false
        });
      });
      if (!rows.length) warnings.push(`${category || 'games'}: 无商品结果`);
    } catch (error) { warnings.push(`${category || 'games'}: ${error.message || error}`); }
    await pause(250);
  }
  if (!games.size) throw new Error('Google Play 未返回有效游戏');
  const result = [...games.values()];
  result.warnings = warnings;
  return result;
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
        ...emptyMetrics, tags: tags.slice(0, 12), description: item.editor_intro || '',
        steamAppId: null, sourceUrl: `https://sj.qq.com/appdetail/${item.pkg_name}`,
        metricsSourceUrl: '', dataAsOf: asOf,
        metricScope: '腾讯应用宝微信小游戏目录；未采集可比营收及评价指标', isDemo: false
      });
    }
    await pause(250);
  }
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

export function createCatalogSync({ collectors = { steam: collectSteam, apple: collectApple, google: collectGoogle, wechat: collectWechat }, now = () => new Date(), file = process.env.CATALOG_SYNC_STATUS_FILE || statusFile } = {}) {
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
      status.running = true;
      status.startedAt = now().toISOString();
      const asOf = status.startedAt.slice(0, 10);
      saveStatus(file, status);
      try {
        for (const [key, collect] of Object.entries(collectors)) {
          try {
            const games = await collect(asOf);
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
        }
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
    if (current.running && !fs.existsSync(`${file}.lock`)) current.running = false;
    return current;
  }
  return { run, getStatus };
}
