import { importGames, validateGame } from './store.js';

const measuredFields = ['price', 'rating', 'reviewCount', 'peakPlayers'];
const allowedHosts = new Set([
  'store.steampowered.com', 'apps.apple.com', 'play.google.com',
  'store.playstation.com', 'www.xbox.com', 'www.nintendo.com', 'sj.qq.com', 'www.taptap.cn'
]);

function sourceIdentity(game) {
  const url = new URL(game.sourceUrl);
  if (url.hostname === 'store.steampowered.com') {
    if (!Number.isSafeInteger(game.steamAppId) || game.steamAppId <= 0 ||
        !url.pathname.startsWith(`/app/${game.steamAppId}/`)) throw new Error('Steam 商品 ID 与链接不一致');
    return `steam:${game.steamAppId}`;
  }
  if (url.hostname === 'apps.apple.com') {
    const id = game.sourceExtras?.appStoreId;
    if (!Number.isSafeInteger(id) || id <= 0 || !url.pathname.endsWith(`/id${id}`)) {
      throw new Error('Apple 商品 ID 与链接不一致');
    }
    return `apple:${id}`;
  }
  if (game.steamAppId || game.sourceExtras?.appStoreId) throw new Error('商品 ID 与来源不一致');
  return `${url.hostname}${url.pathname.replace(/\/$/, '')}${url.search}`;
}

export function prepareVerifiedSnapshot(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('快照必须是对象');
  const fetchedAt = document.fetchedAt;
  if (typeof fetchedAt !== 'string' || Number.isNaN(Date.parse(fetchedAt)) ||
      new Date(fetchedAt).toISOString() !== fetchedAt) throw new Error('缺少有效的 UTC 采集时间');
  if (!Array.isArray(document.failures) || document.failures.length) throw new Error('采集失败或失败清单缺失，禁止导入');
  if (typeof document.methodology !== 'string' || !document.methodology.trim() ||
      !Array.isArray(document.sources) || !document.sources.length ||
      !document.sources.every(source => typeof source === 'string' && source.trim()) ||
      !Array.isArray(document.limitations) || !document.limitations.length ||
      !document.limitations.every(limit => typeof limit === 'string' && limit.trim())) {
    throw new Error('缺少采集方法、来源或局限说明');
  }
  if (!Array.isArray(document.games) || !document.games.length || document.games.length > 2000) {
    throw new Error('快照必须包含 1 至 2000 条游戏');
  }

  const seen = new Set();
  const games = document.games.map((raw, index) => {
    const label = `games[${index}]`;
    try {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('记录不是对象');
      if (!raw.sourceUrl || !raw.dataAsOf || !raw.metricScope) throw new Error('缺少来源、采集日期或指标口径');
      if (raw.dataAsOf !== fetchedAt.slice(0, 10)) throw new Error('采集日期与快照不符');
      if (!Array.isArray(raw.platforms) || !raw.platforms.length) throw new Error('必须明确平台');
      if (measuredFields.some(field => raw[field] === undefined)) throw new Error('指标缺失，请用 null 表示未采集');
      if (raw.isDemo) throw new Error('真实采集快照不能包含演示数据');
      const url = new URL(raw.sourceUrl);
      if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) throw new Error('来源不在已核验官方域名内');
      const identity = sourceIdentity(raw);
      if (seen.has(identity)) throw new Error(`重复来源 ${identity}`);
      seen.add(identity);

      if (url.hostname === 'store.steampowered.com') {
        if (!raw.platforms.includes('PC') || raw.platforms.some(platform => !['PC', 'macOS', 'Linux'].includes(platform))) throw new Error('Steam 平台口径无效');
        const hasReviewMetric = raw.rating !== null || raw.reviewCount !== null;
        if (hasReviewMetric) {
          const metricUrl = new URL(raw.metricsSourceUrl);
          const reviewValuesValid = (raw.reviewCount === 0 && raw.rating === null) ||
            (raw.reviewCount !== null && raw.rating !== null);
          if (metricUrl.protocol !== 'https:' || metricUrl.hostname !== 'store.steampowered.com' ||
              !metricUrl.pathname.startsWith(`/appreviews/${raw.steamAppId}`) ||
              !reviewValuesValid) throw new Error('Steam 评价来源或数值不完整');
        }
        if (raw.price !== null && !/(人民币|美元)/.test(raw.metricScope)) throw new Error('Steam 价格缺少币种口径');
        if (raw.peakPlayers !== null) throw new Error('当前采集器未核验同时在线峰值');
      } else {
        if (raw.platforms.length !== 1) throw new Error('非 Steam 来源必须明确唯一平台');
        if (measuredFields.some(field => raw[field] !== null)) throw new Error('非 Steam 公共指标必须为 null');
        if (raw.metricsSourceUrl) throw new Error('非 Steam 指标来源不应填入');
        if (url.hostname === 'apps.apple.com') {
          if (raw.platforms[0] !== 'iOS' || !raw.metricScope.includes('美国区')) throw new Error('Apple 地区或平台口径无效');
        } else if (raw.sourceExtras !== undefined) throw new Error('非 Apple 来源不能携带 Apple 指标');
        if (url.hostname === 'sj.qq.com' && raw.platforms[0] !== '微信小游戏') throw new Error('小游戏平台口径无效');
        if (url.hostname === 'www.taptap.cn' && (raw.platforms[0] !== 'Android' || !/^\/app\/\d+$/.test(url.pathname))) throw new Error('TapTap 商品链接或平台口径无效');
        if (url.hostname === 'play.google.com' && raw.platforms[0] !== 'Android') throw new Error('Google Play 平台口径无效');
        if (url.hostname === 'store.playstation.com' && !['PS4', 'PS5'].includes(raw.platforms[0])) throw new Error('PlayStation 平台口径无效');
        if (url.hostname === 'www.xbox.com' && raw.platforms[0] !== 'Xbox') throw new Error('Xbox 平台口径无效');
        if (url.hostname === 'www.nintendo.com' && raw.platforms[0] !== 'Switch') throw new Error('Nintendo 平台口径无效');
      }
      const game = validateGame(raw);
      if (!game.sourceUrl || !game.dataAsOf || !game.metricScope) throw new Error('来源字段无效');
      return game;
    } catch (error) { throw new Error(`${label}: ${error.message}`); }
  });
  return { games, fetchedAt, count: games.length };
}

export function importVerifiedSnapshot(document, options = {}) {
  const prepared = prepareVerifiedSnapshot(document);
  return { ...importGames({ games: prepared.games }, options), fetchedAt: prepared.fetchedAt };
}
