import { load } from 'cheerio';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
export const steamGameDetailCacheFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/collected/steam-game-details.json');
let detectedSystemProxy;

function readCache(file) {
  if (!file) return new Map();
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    return new Map(Object.entries(saved || {}).map(([id, entry]) => [Number(id), entry])
      .filter(([id, entry]) => Number.isSafeInteger(id) && entry?.data && Number.isFinite(entry?.at)));
  } catch { return new Map(); }
}

function writeCache(file, cache) {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(Object.fromEntries(cache), null, 2));
  fs.renameSync(temporary, file);
}

async function systemHttpsProxy() {
  if (detectedSystemProxy !== undefined) return detectedSystemProxy;
  detectedSystemProxy = process.env.HTTPS_PROXY || process.env.https_proxy || '';
  if (detectedSystemProxy || process.platform !== 'darwin') return detectedSystemProxy;
  try {
    const { stdout } = await execFileAsync('/usr/sbin/scutil', ['--proxy']);
    const host = stdout.match(/HTTPSProxy\s*:\s*(\S+)/)?.[1];
    const port = stdout.match(/HTTPSPort\s*:\s*(\d+)/)?.[1];
    if (/HTTPSEnable\s*:\s*1/.test(stdout) && host && port) detectedSystemProxy = `http://${host}:${port}`;
  } catch { /* Direct access may still work. */ }
  return detectedSystemProxy;
}

async function defaultFetchPage(url) {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GameIntelligenceResearch/1.0)' }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  } catch {
    const args = ['--fail', '--location', '--silent', '--show-error', '--connect-timeout', '5', '--max-time', '18'];
    const proxy = await systemHttpsProxy();
    if (proxy) args.push('--proxy', proxy);
    args.push(url);
    return (await execFileAsync('curl', args, { maxBuffer: 12 * 1024 * 1024 })).stdout;
  }
}

function plainText(html) {
  if (!html) return '';
  const $ = load(`<main>${html}</main>`);
  $('br').replaceWith('\n');
  $('li').each((_, element) => $(element).prepend('• ').append('\n'));
  return $('main').text().replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

function reviewScoreLabel(value) {
  return ({ OverwhelminglyPositive: '好评如潮', VeryPositive: '特别好评', Positive: '好评', MostlyPositive: '多半好评', Mixed: '褒贬不一',
    MostlyNegative: '多半差评', Negative: '差评', VeryNegative: '特别差评', OverwhelminglyNegative: '差评如潮', Nouserreviews: '暂无用户评测' })
    [String(value || '').replace(/\s/g, '')] || value || '暂无用户评测';
}

export function parseSteamProduct(payload, appId) {
  const entry = payload?.[String(appId)];
  if (!entry?.success || !entry.data) throw new Error('Steam 未返回该游戏的商品资料');
  const data = entry.data;
  const price = data.price_overview;
  const supportedLanguages = plainText(data.supported_languages)
    .replace(/\n\*具有完全音频支持的语言.*$/s, '')
    .replace(/\*/g, '（完整音频）')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  return {
    appId,
    name: data.name || '',
    shortDescription: plainText(data.short_description),
    about: plainText(data.about_the_game || data.detailed_description),
    headerImage: data.header_image || '',
    website: data.website || '',
    developers: data.developers || [],
    publishers: data.publishers || [],
    releaseDate: data.release_date?.date || '',
    comingSoon: Boolean(data.release_date?.coming_soon),
    price: data.is_free ? { text: '免费开玩', currency: '', discountPercent: 0 } : price ? {
      text: price.final_formatted || price.initial_formatted || '', currency: price.currency || '', discountPercent: price.discount_percent || 0,
      originalText: price.discount_percent ? price.initial_formatted || '' : ''
    } : { text: data.release_date?.coming_soon ? '即将推出' : '暂未公布', currency: '', discountPercent: 0 },
    genres: (data.genres || []).map(item => item.description).filter(Boolean),
    categories: (data.categories || []).map(item => item.description).filter(value => value && !value.startsWith('#')),
    platforms: Object.entries(data.platforms || {}).filter(([, enabled]) => enabled).map(([platform]) => ({ windows: 'Windows', mac: 'macOS', linux: 'Linux' })[platform] || platform),
    controllerSupport: data.controller_support || '',
    supportedLanguages,
    pcRequirements: { minimum: plainText(data.pc_requirements?.minimum), recommended: plainText(data.pc_requirements?.recommended) },
    legalNotice: plainText(data.legal_notice),
    contentNotice: plainText(data.content_descriptors?.notes),
    screenshots: (data.screenshots || []).slice(0, 6).map(item => item.path_thumbnail || item.path_full).filter(Boolean),
    recommendationsTotal: Number(data.recommendations?.total || 0),
    metacritic: data.metacritic?.score || null
  };
}

export function parseSteamReviews(payload) {
  const summary = payload?.query_summary || {};
  const total = Number(summary.total_reviews || 0);
  const positive = Number(summary.total_positive || 0);
  const fetchedItems = (payload?.reviews || []).map(item => ({
    id: String(item.recommendationid || ''), recommended: Boolean(item.voted_up), text: item.review || '', language: item.language || '',
    createdAt: item.timestamp_created ? new Date(item.timestamp_created * 1000).toISOString() : '',
    playtimeForeverHours: Math.round(Number(item.author?.playtime_forever || 0) / 6) / 10,
    playtimeAtReviewHours: Math.round(Number(item.author?.playtime_at_review || 0) / 6) / 10,
    playtimeTwoWeeksHours: Math.round(Number(item.author?.playtime_last_two_weeks || 0) / 6) / 10,
    gamesOwned: Number(item.author?.num_games_owned || 0), reviewsCount: Number(item.author?.num_reviews || 0),
    votesUp: Number(item.votes_up || 0), votesFunny: Number(item.votes_funny || 0), commentCount: Number(item.comment_count || 0),
    steamPurchase: Boolean(item.steam_purchase), receivedForFree: Boolean(item.received_for_free)
  })).filter(item => item.id);
  const items = fetchedItems.filter(isValuableSteamReview);
  return {
    summary: { total, positive, negative: Number(summary.total_negative || 0), positivePercent: total ? Math.round(positive / total * 100) : null,
      score: reviewScoreLabel(summary.review_score_desc) },
    quality: { fetched: fetchedItems.length, valuable: items.length, filtered: fetchedItems.length - items.length,
      retentionRate: fetchedItems.length ? Math.round(items.length / fetchedItems.length * 100) : null, filterVersion: 1 },
    items
  };
}

export function isValuableSteamReview(item) {
  const text = String(item?.text || '').normalize('NFKC').replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  const compact = text.replace(/[\s\p{P}\p{S}]/gu, '');
  if (!compact || /^(.)\1{3,}$/u.test(compact)) return false;
  const lowered = compact.toLocaleLowerCase();
  if (/^(好玩|不好玩|非常好玩|真好玩|神作|垃圾|一般|还行|经典|牛逼|牛|支持|推荐|不推荐|666+|6+|good|nice|fun|ok|lol|lmao|recommended|notrecommended|goodgame|nicegame)$/i.test(lowered)) return false;
  const cjkCount = (text.match(/[\p{Script=Han}]/gu) || []).length;
  const wordCount = (text.match(/[A-Za-z\d]+(?:['’-][A-Za-z\d]+)*/g) || []).length;
  return cjkCount >= 8 || wordCount >= 5 || compact.length >= 32;
}

function withValuableReviews(data) {
  if (!data?.reviews?.items) return data;
  const items = data.reviews.items.filter(isValuableSteamReview);
  const existing = data.reviews.quality;
  const quality = existing ? { ...existing, valuable: items.length,
    filtered: Number.isFinite(existing.fetched) ? Math.max(0, existing.fetched - items.length) : existing.filtered,
    retentionRate: Number.isFinite(existing.fetched) && existing.fetched > 0 ? Math.round(items.length / existing.fetched * 100) : existing.retentionRate }
    : { fetched: null, valuable: items.length, filtered: null, retentionRate: null, filterVersion: 1 };
  return { ...data, reviews: { ...data.reviews, quality, items } };
}

export function parseSteamPlayerHistory(payload, limit = 168) {
  const points = Array.isArray(payload) ? payload : [];
  return points.map(point => ({ timestamp: Number(point?.[0]), count: Math.round(Number(point?.[1])) }))
    .filter(point => Number.isFinite(point.timestamp) && Number.isFinite(point.count) && point.count > 0)
    .map(point => ({ capturedAt: new Date(point.timestamp).toISOString(), count: point.count }))
    .slice(-limit);
}

export function createSteamGameDetail({ fetchPage = defaultFetchPage, now = () => Date.now(), ttl = 30 * 60 * 1000,
cacheFile = process.env.STEAM_GAME_DETAIL_CACHE_FILE || steamGameDetailCacheFile } = {}) {
  const cache = readCache(cacheFile);
  const pending = new Map();
  async function refresh(id) {
    if (pending.has(id)) return pending.get(id);
    const task = (async () => {
      const productUrl = `https://store.steampowered.com/api/appdetails?appids=${id}&cc=us&l=schinese`;
      const reviewsUrl = `https://store.steampowered.com/appreviews/${id}?json=1&language=schinese&purchase_type=all&review_type=all&filter=recent&day_range=365&num_per_page=100`;
      const playerHistoryUrl = `https://steamcharts.com/app/${id}/chart-data.json`;
      const [productText, reviewsText, playerHistoryText] = await Promise.all([fetchPage(productUrl), fetchPage(reviewsUrl), fetchPage(playerHistoryUrl).catch(() => '[]')]);
      const playerHistory = parseSteamPlayerHistory(JSON.parse(playerHistoryText));
      const data = { appId: id, capturedAt: new Date(now()).toISOString(), product: parseSteamProduct(JSON.parse(productText), id), reviews: parseSteamReviews(JSON.parse(reviewsText)),
        players: { current: playerHistory.at(-1)?.count ?? null, history: playerHistory },
        sources: { product: `https://store.steampowered.com/app/${id}/?l=schinese`, reviews: `https://store.steampowered.com/appreviews/${id}?json=1`, players: playerHistoryUrl } };
      cache.set(id, { at: now(), data });
      writeCache(cacheFile, cache);
      return withValuableReviews(data);
    })();
    pending.set(id, task);
    try { return await task; }
    finally { pending.delete(id); }
  }
  async function get(appId, force = false) {
    const id = Number(appId);
    if (!Number.isSafeInteger(id) || id <= 0) throw Object.assign(new Error('Steam App ID 无效'), { status: 400 });
    const cached = cache.get(id);
    if (force) return refresh(id);
    if (cached) {
      return { ...withValuableReviews(cached.data), cache: { state: now() - cached.at < ttl ? 'fresh' : 'stale', savedAt: new Date(cached.at).toISOString() } };
    }
    return refresh(id);
  }
  function peek(appId) {
    const id = Number(appId);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const cached = cache.get(id);
    if (!cached) return null;
    return {
      ...withValuableReviews(cached.data),
      cache: { state: now() - cached.at < ttl ? 'fresh' : 'stale', savedAt: new Date(cached.at).toISOString() }
    };
  }
  async function warm(appIds, { force = false, concurrency = 5, replace = false } = {}) {
    const ids = [...new Set((Array.isArray(appIds) ? appIds : []).map(Number)
      .filter(id => Number.isSafeInteger(id) && id > 0))];
    const completed = [];
    const failures = [];
    let cursor = 0;
    async function worker() {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        try {
          const detail = await get(id, force);
          completed.push({ appId: id, name: detail.product.name });
        } catch (error) {
          failures.push({ appId: id, error: error instanceof Error ? error.message : '采集失败' });
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), ids.length || 1) }, worker));
    if (replace) {
      const retained = new Set(ids);
      for (const id of cache.keys()) {
        if (!retained.has(id)) cache.delete(id);
      }
      writeCache(cacheFile, cache);
    }
    return { requested: ids.length, completed, failures };
  }
  function overview() {
    const rows = [...cache.values()].map(entry => entry.data).filter(Boolean);
    const reviewRows = rows.filter(row => Number(row.reviews?.summary?.total) > 0);
    const playerRows = rows.filter(row => Number(row.players?.current) > 0);
    const samples = rows.flatMap(row => (row.reviews?.items || []).filter(isValuableSteamReview));
    const totalReviews = reviewRows.reduce((sum, row) => sum + Number(row.reviews.summary.total || 0), 0);
    const totalPositive = reviewRows.reduce((sum, row) => sum + Number(row.reviews.summary.positive || 0), 0);
    const counts = values => Object.entries(values.reduce((result, value) => {
      result[value] = (result[value] || 0) + 1; return result;
    }, {})).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    const orderedCounts = (values, order) => {
      const indexed = new Map(counts(values).map(item => [item.name, item.count]));
      return order.map(name => ({ name, count: indexed.get(name) || 0 }));
    };
    const genreMix = counts(rows.flatMap(row => (row.product?.genres || []).slice(0, 2))).slice(0, 10);
    const publisherMix = counts(rows.flatMap(row => (row.product?.publishers || []).slice(0, 1))).slice(0, 10);
    const platformMix = counts(rows.flatMap(row => row.product?.platforms || [])).slice(0, 6);
    const featureNames = ['单人', '多人', '在线玩家对战', '在线合作', '跨平台多人', '家庭共享', '完全支持控制器', '部分支持控制器', 'Steam 创意工坊', '应用内购买'];
    const featureMix = counts(rows.flatMap(row => (row.product?.categories || []).filter(item => featureNames.includes(item)))).slice(0, 10);
    const priceMix = orderedCounts(rows.map(row => row.product?.comingSoon ? '即将推出' : row.product?.price?.text === '免费开玩' ? '免费游戏'
      : row.product?.price?.text && row.product.price.text !== '暂未公布' ? '付费游戏' : '价格待公布'), ['付费游戏', '免费游戏', '即将推出', '价格待公布']);
    const discountMix = orderedCounts(rows.map(row => {
      const value = Number(row.product?.price?.discountPercent || 0);
      return value <= 0 ? '无折扣' : value < 30 ? '1–29%' : value < 50 ? '30–49%' : value < 70 ? '50–69%' : '70% 以上';
    }), ['无折扣', '1–29%', '30–49%', '50–69%', '70% 以上']);
    const reviewBands = orderedCounts(reviewRows.map(row => {
      const value = Number(row.reviews.summary.positivePercent);
      return value >= 90 ? '90% 以上' : value >= 80 ? '80–89%' : value >= 70 ? '70–79%' : value >= 50 ? '50–69%' : '50% 以下';
    }), ['90% 以上', '80–89%', '70–79%', '50–69%', '50% 以下']);
    const playtimeBuckets = orderedCounts(samples.map(item => Number(item.playtimeForeverHours) < 10 ? '<10h'
      : Number(item.playtimeForeverHours) < 50 ? '10–50h' : Number(item.playtimeForeverHours) < 100 ? '50–100h'
        : Number(item.playtimeForeverHours) < 500 ? '100–500h' : '500h+'), ['<10h', '10–50h', '50–100h', '100–500h', '500h+']);
    const onlineLeaders = playerRows.map(row => {
      const history = row.players.history || [];
      const average = history.length ? Math.round(history.reduce((sum, point) => sum + point.count, 0) / history.length) : null;
      const peak = history.length ? Math.max(...history.map(point => point.count)) : row.players.current;
      return { appId: row.appId, name: row.product?.name || String(row.appId), image: row.product?.headerImage || '', current: row.players.current,
        average, peak, positivePercent: row.reviews?.summary?.positivePercent ?? null };
    }).sort((a, b) => b.current - a.current).slice(0, 10);
    const onlineTimeline = new Map();
    for (const row of playerRows) for (const point of row.players.history || []) {
      const hour = `${point.capturedAt.slice(0, 13)}:00:00.000Z`;
      onlineTimeline.set(hour, (onlineTimeline.get(hour) || 0) + Number(point.count || 0));
    }
    return {
      capturedAt: rows.map(row => row.capturedAt).sort().at(-1) || null,
      coverage: { games: rows.length, products: rows.filter(row => row.product).length, reviews: reviewRows.length, players: playerRows.length, reviewSamples: samples.length },
      reviewMarket: { totalReviews, positivePercent: totalReviews ? Math.round(totalPositive / totalReviews * 100) : null,
        recommendedSamples: samples.filter(item => item.recommended).length },
      playerMarket: { current: playerRows.reduce((sum, row) => sum + Number(row.players.current || 0), 0), onlineLeaders,
        history: [...onlineTimeline].sort(([left], [right]) => left.localeCompare(right)).slice(-168).map(([capturedAt, count]) => ({ capturedAt, count })) },
      genreMix, publisherMix, platformMix, featureMix, priceMix, discountMix, reviewBands, playtimeBuckets
    };
  }
  function catalogGames() {
    return [...cache.values()].map(entry => entry.data).filter(row => row?.appId && row?.product).map(row => ({
      id: `steam-cache-${row.appId}`,
      channel: '端游',
      name: row.product.name || String(row.appId),
      englishName: row.product.name || '',
      genre: row.product.genres?.[0] || '未分类',
      developer: row.product.developers?.[0] || '',
      publisher: row.product.publishers?.[0] || '',
      tags: [...(row.product.genres || []), ...(row.product.categories || [])],
      platforms: row.product.platforms || [],
      releaseDate: row.product.releaseDate || '',
      rating: row.reviews?.summary?.positivePercent ?? null,
      reviewCount: row.reviews?.summary?.total ?? null,
      price: null,
      peakPlayers: null,
      currentPlayers: row.players?.current ?? null,
      hasLiveData: Number.isFinite(Number(row.players?.current)),
      steamCapturedAt: row.capturedAt || '',
      steamAppId: row.appId,
      sourceUrl: row.sources?.product || `https://store.steampowered.com/app/${row.appId}/`,
      isDemo: false,
      dataAsOf: row.capturedAt?.slice(0, 10) || '',
      metricScope: 'Steam 公开商品资料、简体中文评测与在线缓存'
    }));
  }
  return { get, peek, warm, overview, catalogGames };
}
