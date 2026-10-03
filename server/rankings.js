import { load } from 'cheerio';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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
    const rawIcon = $(element).find('img').first().attr('src') || '';
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

export function parseMediaMonthlyRanking(searchJson, postJson, platform) {
  const posts = JSON.parse(searchJson.replace(/^\uFEFF/, ''));
  const term = mediaSearch[platform];
  const match = selectMediaPost(posts, platform);
  if (!match) throw new Error('没有找到可核验的月度 Top 100 报道');
  const post = JSON.parse(postJson.replace(/^\uFEFF/, ''));
  if (post.id !== match.id || post.link !== match.url || !post.date_gmt) throw new Error('榜单文章与搜索结果不一致');
  const body = load(post.content?.rendered || '')('body').text().replace(/\s+/g, ' ');
  const line = body.match(new RegExp(`(\\d{4})年(\\d{1,2})月${term}前十名依次是[：:]([^。]+)。`));
  if (!line) throw new Error('报道没有明确列出前十名及榜单月份');
  const names = [...line[3].matchAll(/《([^》]{1,80})》/g)].map(match => match[1]);
  if (names.length !== 10 || new Set(names).size !== 10) throw new Error('报道的前十名不完整');
  const period = `${line[1]}-${line[2].padStart(2, '0')}`;
  const publishedAt = `${post.date_gmt}Z`;
  if (Number.isNaN(Date.parse(publishedAt)) || period > publishedAt.slice(0, 7)) throw new Error('榜单月份或发布日期无效');
  return { url: match.url, period, publishedAt, items: names.map((name, index) => ({
    rank: index + 1, id: `${platform}:${period}:${index + 1}`, name, icon: '', developer: '', tags: [],
    description: '', url: match.url
  })) };
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
  boards.mediaMonthly = { label: '第三方月度畅销 Top 10', url: '', items: [], fetchedAt: null, error: null };
  const douyin = { mediaMonthly: { label: '第三方月度畅销 Top 10', url: '', items: [], fetchedAt: null, error: null } };
  const platforms = {
    wechat: { label: '微信小游戏', scope: '腾讯应用宝公开榜单及 GameLook 月度报道', boards },
    apple: { label: 'App Store', scope: '中国区 iPhone 游戏榜单', boards: apple },
    taptap: { label: 'TapTap', scope: 'TapTap 公开榜单', boards: taptap },
    douyin: { label: '抖音小游戏', scope: 'GameLook 第三方月度畅销榜报道', boards: douyin }
  };
  let lastAttempt = 0;
  let pending = null;

  async function get(force = false) {
    if (pending) return pending;
    if (!force && lastAttempt && now() - lastAttempt < ttl) return { source: '多平台公开游戏榜单', boards, platforms };
    lastAttempt = now();
    pending = (async () => {
      const official = Promise.all([
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
      const monthly = Promise.all(Object.entries(mediaSearch).map(async ([platform, term]) => {
        const target = platforms[platform].boards;
        try {
          const searchJson = await fetchPage(`${mediaApi}/search?search=${encodeURIComponent(term)}&per_page=10`);
          const posts = JSON.parse(searchJson.replace(/^\uFEFF/, ''));
          const match = selectMediaPost(posts, platform);
          if (!match) throw new Error('没有找到可核验的月度 Top 100 报道');
          const postJson = await fetchPage(`${mediaApi}/posts/${match.id}`);
          const result = parseMediaMonthlyRanking(searchJson, postJson, platform);
          target.mediaMonthly = { label: '第三方月度畅销 Top 10', ...result,
            fetchedAt: new Date(now()).toISOString(), error: null };
        } catch (error) {
          target.mediaMonthly = { ...target.mediaMonthly, error: error instanceof Error ? error.message : '采集失败' };
        }
      }));
      await Promise.all([official, monthly]);
      return { source: '多平台公开游戏榜单', boards, platforms };
    })();
    try { return await pending; }
    finally { pending = null; }
  }
  return { get };
}
