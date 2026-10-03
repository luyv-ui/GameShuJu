export function searchGames(games, query = '', genre = '全部', platform = '全部') {
  const keyword = String(query).trim().toLocaleLowerCase();
  return games.filter(game => {
    const haystack = [game.name, game.englishName, game.developer, game.publisher, ...(game.tags || [])].join(' ').toLocaleLowerCase();
    return (!keyword || haystack.includes(keyword)) && (genre === '全部' || game.genre === genre) && (platform === '全部' || game.platforms.includes(platform));
  });
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}

function formatGame(game) {
  const live = game.hasLiveData
    ? `\nSteam 实采：当前在线 ${formatNumber(game.currentPlayers)}｜近90天公告 ${game.steamNewsCounts?.last90Days ?? 0} 条\n采集时间：${game.steamCapturedAt}`
    : '';
  return `${game.name}（${game.englishName || game.genre}）\n类型：${game.genre}｜平台：${game.platforms.join('、') || '未录入'}${live}${game.isDemo ? '\n注：价格、评分等基础指标仍为演示数据' : ''}${game.sourceUrl ? `\n来源：${game.sourceUrl}` : ''}`;
}

function appendWebLink(content, webUrl) {
  if (!webUrl) return content;
  try {
    const url = new URL(webUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return content;
    return `${content}\n\n网页情报库：${url.toString()}`;
  } catch { return content; }
}

export function answerQuery(games, input, options = {}) {
  const original = String(input || '').replace(/@\S+\s*/gu, '').trim();
  const text = original.replace(/^\s*(查询|搜索|查找|游戏)\s*/u, '').trim();
  const withLink = content => appendWebLink(content, options.webUrl);

  if (!text || /^(帮助|菜单|help|\?)$/iu.test(text)) {
    return withLink('游戏信息助手已就绪。可发送：\n• 查询 黑神话\n• 当前在线\n• 最近发布\n• 最新公告\n• 数据状态');
  }

  if (/^(数据状态|采集状态|状态)$/u.test(text)) {
    const liveGames = games.filter(game => game.hasLiveData);
    const latestCapture = liveGames.map(game => game.steamCapturedAt || '').sort().at(-1);
    return withLink(`情报库共 ${games.length} 款游戏，其中 ${liveGames.length} 款有 Steam 实采数据。${latestCapture ? `\n最近采集：${latestCapture}` : '\n尚未生成实时采集快照。'}`);
  }

  if (/^(当前在线|在线排行|热门游戏|热门)$/u.test(text)) {
    const liveGames = games.filter(game => game.hasLiveData && Number.isFinite(Number(game.currentPlayers)))
      .sort((left, right) => Number(right.currentPlayers) - Number(left.currentPlayers)).slice(0, 5);
    if (!liveGames.length) return withLink('目前没有在线人数实采数据，请先运行 Steam 采集任务。');
    return withLink(`Steam 当前在线排行：\n${liveGames.map((game, index) => `${index + 1}. ${game.name}：${formatNumber(game.currentPlayers)}`).join('\n')}\n注：这是采集时刻快照，不是历史峰值。`);
  }

  if (/^(最近发布|最新发布|本月新游|新游)$/u.test(text)) {
    const recent = games.filter(game => /^\d{4}-\d{2}-\d{2}$/.test(game.releaseDate || ''))
      .sort((left, right) => right.releaseDate.localeCompare(left.releaseDate)).slice(0, 5);
    if (!recent.length) return withLink('情报库中暂无有效发行日期。');
    return withLink(`最近发布：\n${recent.map((game, index) => `${index + 1}. ${game.name}｜${game.releaseDate}｜${game.platforms.join('、')}`).join('\n')}`);
  }

  if (/^(最新公告|最新新闻|公告|新闻)$/u.test(text)) {
    const news = games.flatMap(game => (game.latestSteamNews || []).map(item => ({ ...item, gameName: game.name })))
      .filter(item => item.publishedAt).sort((left, right) => right.publishedAt.localeCompare(left.publishedAt)).slice(0, 5);
    if (!news.length) return withLink('目前没有已采集的 Steam 公告，请先运行采集任务。');
    return withLink(`最新 Steam 公告：\n${news.map((item, index) => `${index + 1}. ${item.gameName}｜${item.title}\n${item.url}`).join('\n')}`);
  }

  const matches = searchGames(games, text).slice(0, 5);
  if (!matches.length) return withLink(`未找到“${text}”。可尝试游戏中文名、英文名、开发商或标签。发送“帮助”查看指令。`);
  return withLink(matches.map(formatGame).join('\n\n'));
}
