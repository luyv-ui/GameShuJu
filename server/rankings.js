import { load } from 'cheerio';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const rankingSources = {
  popular: { label: '最受欢迎', url: 'https://sj.qq.com/wechat-game/popular-game-rank' },
  bestSell: { label: '畅销', url: 'https://sj.qq.com/wechat-game/best-sell-game-rank' },
  new: { label: '热门新游', url: 'https://sj.qq.com/wechat-game/new-game-rank' }
};

export const douyinRankingSources = {
  popular: { label: '热门榜', url: 'https://www.momorank.com/douyin/rankings/popular' },
  bestSell: { label: '畅销榜', url: 'https://www.momorank.com/douyin/rankings/bestseller' },
  new: { label: '新游榜', url: 'https://www.momorank.com/douyin/rankings/new_game' }
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

export function parseDouyinRanking(html) {
  const $ = load(html);
  const bodyText = $('body').text().replace(/\s+/g, ' ');
  const dataDate = bodyText.match(/数据日期\s*(20\d{2}-\d{2}-\d{2})/u)?.[1] || null;
  const items = [];
  $('table tbody tr').slice(0, 10).each((_, row) => {
    const cells = $(row).find('td');
    const link = $(row).find('a[href^="/douyin/games/"]').first();
    const href = link.attr('href') || '';
    const name = link.find('[title]').attr('title') || link.text().trim();
    const rank = Number(cells.eq(0).text().trim());
    if (!name || !href || !Number.isSafeInteger(rank) || rank < 1) return;
    const category = cells.eq(2).text().replace(/\s+/g, ' ').trim();
    items.push({
      rank,
      id: href.split('/').filter(Boolean).at(-1),
      name,
      icon: $(row).find('img').first().attr('src') || '',
      developer: '',
      tags: category ? [category] : [],
      description: '',
      change: cells.eq(3).text().replace(/\s+/g, ' ').trim(),
      url: new URL(href, 'https://www.momorank.com').toString()
    });
  });
  if (!items.length) throw new Error('来源页面没有免费公开的榜单条目');
  return { items, dataDate };
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
      id: url.pathname.slice(5), name: entry.name, icon: '', developer: '', tags: [], description: '',
      url: `${url.origin}${url.pathname}` });
  }
  if (!items.length) throw new Error('TapTap 页面没有有效榜单条目');
  return items;
}

export function createRankings({ fetchPage = async url => {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GameIntelligenceResearch/1.0)' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  } catch {
    const { stdout } = await execFileAsync('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '20', url], { maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  }
}, now = () => Date.now(), ttl = 30 * 60 * 1000 } = {}) {
  const boards = Object.fromEntries(Object.entries(rankingSources).map(([key, source]) => [key, { ...source, items: [], fetchedAt: null, error: null }]));
  const apple = Object.fromEntries(Object.entries(appleRankingSources).map(([key, source]) => [key, { ...source, items: [], fetchedAt: null, error: null }]));
  const taptap = Object.fromEntries(Object.entries(tapTapRankingSources).map(([key, source]) => [key, { ...source, items: [], fetchedAt: null, error: null }]));
  const platforms = {
    wechat: { label: '微信小游戏', scope: '腾讯应用宝公开榜单', boards },
    apple: { label: 'App Store', scope: '中国区 iPhone 游戏榜单', boards: apple },
    taptap: { label: 'TapTap', scope: 'TapTap 公开榜单', boards: taptap },
    douyin: { label: '抖音小游戏', scope: '暂无可验证的公开榜单接口', boards: {}, unavailable: true,
      sourceUrl: 'https://developer.open-douyin.com/' }
  };
  let lastAttempt = 0;
  let pending = null;

  async function get(force = false) {
    if (pending) return pending;
    if (!force && lastAttempt && now() - lastAttempt < ttl) return { source: '多平台公开游戏榜单', boards, platforms };
    lastAttempt = now();
    pending = (async () => {
      await Promise.all([
        ...Object.entries(rankingSources).map(([key, source]) => ({ key, source, target: boards, parse: parseRanking })),
        ...Object.entries(appleRankingSources).map(([key, source]) => ({ key, source, target: apple, parse: parseAppleRanking })),
        ...Object.entries(tapTapRankingSources).map(([key, source]) => ({ key, source, target: taptap, parse: parseTapTapRanking }))
      ].map(async ({ key, source, target, parse }) => {
        try {
          const items = parse(await fetchPage(source.url));
          target[key] = { ...source, items, fetchedAt: new Date(now()).toISOString(), error: null };
        } catch (error) {
          target[key] = { ...target[key], error: error instanceof Error ? error.message : '采集失败' };
        }
      }));
      return { source: '多平台公开游戏榜单', boards, platforms };
    })();
    try { return await pending; }
    finally { pending = null; }
  }
  return { get };
}

export function createDouyinRankings({ fetchPage = async url => {
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GameIntelligenceResearch/1.0)' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}, now = () => Date.now(), ttl = 30 * 60 * 1000 } = {}) {
  const boards = Object.fromEntries(Object.entries(douyinRankingSources).map(([key, source]) => [key, { ...source, items: [], fetchedAt: null, dataDate: null, error: null }]));
  let lastAttempt = 0;
  let pending = null;
  async function get(force = false) {
    if (pending) return pending;
    if (!force && lastAttempt && now() - lastAttempt < ttl) return { source: 'MomoRank \u6296\u97f3\u5c0f\u6e38\u620f公开榜单', boards };
    lastAttempt = now();
    pending = (async () => {
      await Promise.all(Object.entries(douyinRankingSources).map(async ([key, source]) => {
        try {
          const parsed = parseDouyinRanking(await fetchPage(source.url));
          boards[key] = { ...source, ...parsed, fetchedAt: new Date(now()).toISOString(), error: null };
        } catch (error) {
          boards[key] = { ...boards[key], error: error instanceof Error ? error.message : '采集失败' };
        }
      }));
      return { source: 'MomoRank \u6296\u97f3\u5c0f\u6e38\u620f公开榜单', boards };
    })();
    try { return await pending; }
    finally { pending = null; }
  }
  return { get };
}
