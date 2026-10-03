import { load } from 'cheerio';

export const rankingSources = {
  popular: { label: '最受欢迎', url: 'https://sj.qq.com/wechat-game/popular-game-rank' },
  bestSell: { label: '畅销', url: 'https://sj.qq.com/wechat-game/best-sell-game-rank' },
  new: { label: '热门新游', url: 'https://sj.qq.com/wechat-game/new-game-rank' }
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

export function createRankings({ fetchPage = async url => {
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GameIntelligenceResearch/1.0)' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}, now = () => Date.now(), ttl = 30 * 60 * 1000 } = {}) {
  const boards = Object.fromEntries(Object.entries(rankingSources).map(([key, source]) => [key, { ...source, items: [], fetchedAt: null, error: null }]));
  let lastAttempt = 0;
  let pending = null;

  async function get(force = false) {
    if (pending) return pending;
    if (!force && lastAttempt && now() - lastAttempt < ttl) return { source: '腾讯应用宝微信小游戏榜单', boards };
    lastAttempt = now();
    pending = (async () => {
      await Promise.all(Object.entries(rankingSources).map(async ([key, source]) => {
        try {
          const items = parseRanking(await fetchPage(source.url));
          boards[key] = { ...source, items, fetchedAt: new Date(now()).toISOString(), error: null };
        } catch (error) {
          boards[key] = { ...boards[key], error: error instanceof Error ? error.message : '采集失败' };
        }
      }));
      return { source: '腾讯应用宝微信小游戏榜单', boards };
    })();
    try { return await pending; }
    finally { pending = null; }
  }
  return { get };
}
