const gameAliases = new Map([
  ['原神', ['genshin impact']],
  ['崩坏星穹铁道', ['honkai: star rail', 'honkai star rail']],
  ['星穹铁道', ['honkai: star rail', 'honkai star rail']],
  ['崩坏3', ['honkai impact 3rd']],
  ['崩坏三', ['honkai impact 3rd']],
  ['王者荣耀', ['honor of kings']],
  ['绝区零', ['zenless zone zero']],
  ['无限暖暖', ['infinity nikki']],
  ['明日方舟', ['arknights']],
  ['明日方舟终末地', ['arknights: endfield', 'arknights endfield']]
]);

export function searchGames(games, query = '', genre = '全部', platform = '全部', channel = '全部') {
  const keyword = String(query).trim().toLocaleLowerCase();
  const terms = [keyword, ...(gameAliases.get(keyword) || [])];
  return games.filter(game => {
    const haystack = [game.name, game.englishName, game.developer, game.publisher, ...(game.tags || [])].join(' ').toLocaleLowerCase();
    return (!keyword || terms.some(term => haystack.includes(term))) && (genre === '全部' || game.genre === genre) && (platform === '全部' || game.platforms.includes(platform)) && (channel === '全部' || game.channel === channel);
  });
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}

function formatGame(game) {
  const metrics = [];
  if (game.rating != null) metrics.push(`好评率：${game.rating}%`);
  if (game.price != null) metrics.push(`${game.steamAppId ? '中国区售价' : '售价'}：${game.steamAppId ? '¥' : ''}${game.price}`);
  if (game.sourceExtras?.usRatingOutOf5 != null) metrics.push(`App Store 评分：${game.sourceExtras.usRatingOutOf5}/5`);
  if (game.sourceExtras?.usPriceUsd != null) metrics.push(`美国区售价：US$${game.sourceExtras.usPriceUsd}`);
  const live = game.hasLiveData
    ? `\nSteam 实采：当前在线 ${formatNumber(game.currentPlayers)}｜近90天公告 ${game.steamNewsCounts?.last90Days ?? 0} 条\n采集时间：${game.steamCapturedAt}`
    : '';
  return [
    `${game.name}（${game.englishName || game.genre}）`,
    `类型：${game.genre}｜平台：${game.platforms.join('、') || '未录入'}`,
    metrics.length ? metrics.join('｜') : '指标：未取得可比数据',
    live.trim(),
    game.isDemo ? '注：指标为演示数据' : '',
    game.dataAsOf ? `采集日期：${game.dataAsOf}` : '',
    game.metricScope ? `口径：${game.metricScope}` : '',
    game.sourceUrl ? `来源：${game.sourceUrl}` : ''
  ].filter(Boolean).join('\n');
}

function appendWebLink(content, webUrl, params = {}) {
  if (!webUrl) return content;
  try {
    const url = new URL(webUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return content;
    for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
    return `${content}\n\n查看对应数据：${url.toString()}`;
  } catch { return content; }
}

function normalizedRequest(input) {
  const original = String(input || '').replace(/@\S+\s*/gu, '').trim();
  const text = original
    .replace(/^(请问|麻烦|请|帮我|给我|我想看|我想查|发一下)\s*/u, '')
    .replace(/^(查一查|查一下|查询一下|搜索一下|看一下|查询|搜索|查找|查)\s*/u, '')
    .replace(/^游戏\s*/u, '').trim();
  return { original, text, compact: original.replace(/[\s，。！？、：:；;]/gu, '') };
}

function recentReleaseIntent(compact) {
  return /(近期|最近|最新|近一个月|近30天).{0,8}(发布|发行|上线|新游|游戏数据)/u.test(compact)
    || /^(近期发布|最近发布|最新发布|本月新游|新游)$/u.test(compact);
}

export function rankingQueryRequest(input = '') {
  const compact = String(input).replace(/@\S+\s*/gu, '').replace(/[\s，。！？、：:；;]/gu, '');
  const hasRankingWord = /(榜|排名|前几|第一|最热|热门新游)/u.test(compact);
  const hasMiniGameScope = /(微信|抖音|小游戏)/u.test(compact);
  if (!hasRankingWord || !hasMiniGameScope) return null;
  const platform = /抖音/u.test(compact) ? 'douyin' : 'wechat';
  if (/(畅销|氪金|吸金|收入)/u.test(compact)) return { platform, type: 'bestSell' };
  if (/(新游|新上线|最新)/u.test(compact)) return { platform, type: 'new' };
  return { platform, type: 'popular' };
}

export function rankingQueryType(input = '') {
  return rankingQueryRequest(input)?.type || null;
}

export function answerRankingQuery(data, input, options = {}) {
  const request = rankingQueryRequest(input);
  if (!request) return null;
  const { platform, type } = request;
  const board = platform === 'douyin' ? data?.douyinBoards?.[type] : data?.boards?.[type];
  const labels = { popular: '最受欢迎榜', bestSell: '畅销榜', new: '热门新游榜' };
  const platformLabel = platform === 'douyin' ? '抖音小游戏' : '微信小游戏';
  const pageLink = content => appendWebLink(content, options.webUrl, { view: 'rankings', platform, board: type });
  if (!board?.items?.length) {
    const reason = board?.error ? `本次获取失败：${board.error}` : '尚未生成榜单快照';
    return pageLink(`${platformLabel}${labels[type]}暂时没有可用数据。${reason}。`);
  }
  const fetchedAt = board.fetchedAt
    ? new Date(board.fetchedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
    : '未记录';
  const top = board.items.slice(0, 5).map(item => {
    const detail = [item.developer, ...(item.tags || []).slice(0, 2)].filter(Boolean).join(' · ');
    return `${item.rank}. ${item.name}${detail ? `（${detail}）` : ''}`;
  });
  return pageLink([
    `${platformLabel}${labels[type]}（前 ${top.length} 名）`,
    `数据源：${platform === 'douyin' ? data.douyinSource || 'MomoRank 公开榜单' : data.source || '腾讯应用宝微信小游戏榜单'}`,
    ...(board.dataDate ? [`榜单日期：${board.dataDate}`] : []),
    `采集时间：${fetchedAt}`,
    '',
    ...top,
    '',
    `口径：排名为来源页面展示顺序，不等于全平台真实销量或收入。${platform === 'douyin' ? '抖音榜单为第三方日更公开 Top 10，非抖音官方 API。' : ''}`
  ].join('\n'));
}

export function answerQuery(games, input, options = {}) {
  const { original, text, compact } = normalizedRequest(input);
  const withLink = (content, params) => appendWebLink(content, options.webUrl, params);

  if (!text || /^(帮助|菜单|help|\?)$/iu.test(text)) {
    return withLink('游戏信息助手已就绪。可直接问：\n• 查询 黑神话或原神\n• 当前在线 / 黑神话现在多少人在线\n• 近期发布的热门游戏\n• 最新公告\n• 数据状态\n\n只根据已入库数据回答；未采集的平台会明确说明。', { view: 'library' });
  }

  if (/抖音.*小游戏|小游戏.*抖音/u.test(compact)) {
    return withLink('当前运行库没有可核验的抖音小游戏榜单数据，因此无法确认畅销榜或热门榜排名。现有 App 和 Steam 数据不能替代抖音小游戏数据。', { view: 'library', channel: '小游戏' });
  }

  if (/^(数据状态|采集状态|状态)$/u.test(text)) {
    const liveGames = games.filter(game => game.hasLiveData);
    const latestCapture = liveGames.map(game => game.steamCapturedAt || '').sort().at(-1);
    const counts = games.reduce((result, game) => ({ ...result, [game.channel]: (result[game.channel] || 0) + 1 }), {});
    return withLink(`情报库共 ${games.length} 款游戏：端游 ${counts.端游 || 0}、App ${counts.App || 0}、小游戏 ${counts.小游戏 || 0}。其中 ${liveGames.length} 款有 Steam 实采数据。${latestCapture ? `\n最近采集：${latestCapture}` : '\n尚未生成实时采集快照。'}`, { view: 'library' });
  }

  if (!recentReleaseIntent(compact) && (/(当前在线|在线人数|在线排行|现在.*在线|谁.*最热|热门游戏|热度排行)/u.test(compact) || compact === '热门')) {
    const gameQuery = original.replace(/(请问|麻烦|请|帮我|查询|查一下|查|现在|当前|有|多少|人|在线人数|在线|情况|怎么样|？|\?)/gu, '').trim();
    if (gameQuery) {
      const match = searchGames(games, gameQuery).find(game => game.hasLiveData);
      if (match) return withLink(formatGame(match), { view: 'library', q: match.name });
    }
    const liveGames = games.filter(game => game.hasLiveData && Number.isFinite(Number(game.currentPlayers)))
      .sort((left, right) => Number(right.currentPlayers) - Number(left.currentPlayers)).slice(0, 5);
    if (!liveGames.length) return withLink('目前没有在线人数实采数据，请先运行 Steam 采集任务。');
    return withLink(`Steam 当前在线排行：\n${liveGames.map((game, index) => `${index + 1}. ${game.name}：${formatNumber(game.currentPlayers)}`).join('\n')}\n注：这是采集时刻快照，不是历史峰值。`, { view: 'analytics' });
  }

  if (recentReleaseIntent(compact)) {
    const recent = games.filter(game => /^\d{4}-\d{2}-\d{2}$/.test(game.releaseDate || ''))
      .sort((left, right) => right.releaseDate.localeCompare(left.releaseDate)).slice(0, 5);
    if (!recent.length) return withLink('情报库中暂无有效发行日期。');
    return withLink(`近期发行数据：\n${recent.map((game, index) => `${index + 1}. ${game.name}｜${game.releaseDate}｜${game.platforms.join('、')}`).join('\n')}\n说明：按已入库发行日期排序。`, { view: 'library', sort: 'release' });
  }

  if (/^(最新公告|最新新闻|公告|新闻)$/u.test(text)) {
    const news = games.flatMap(game => (game.latestSteamNews || []).map(item => ({ ...item, gameName: game.name })))
      .filter(item => item.publishedAt).sort((left, right) => right.publishedAt.localeCompare(left.publishedAt)).slice(0, 5);
    if (!news.length) return withLink('目前没有已采集的 Steam 公告，请先运行采集任务。');
    return withLink(`最新 Steam 公告：\n${news.map((item, index) => `${index + 1}. ${item.gameName}｜${item.title}\n${item.url}`).join('\n')}`, { view: 'analytics' });
  }

  const matches = searchGames(games, text).slice(0, 5);
  if (!matches.length) return withLink(`未找到“${text}”。当前查询支持游戏中文别名、商店名称、开发商和标签；未入库数据不会编造。`, { view: 'library', q: text });
  return withLink(matches.map(formatGame).join('\n\n'), { view: 'library', q: matches[0].name });
}
