export function searchGames(games, query = '', genre = '全部', platform = '全部', channel = '全部') {
  const keyword = String(query).trim().toLocaleLowerCase();
  return games.filter(game => {
    const haystack = [game.name, game.englishName, game.developer, game.publisher, ...(game.tags || [])].join(' ').toLocaleLowerCase();
    return (!keyword || haystack.includes(keyword)) && (genre === '全部' || game.genre === genre) && (platform === '全部' || game.platforms.includes(platform)) && (channel === '全部' || game.channel === channel);
  });
}

export function answerQuery(games, input) {
  const text = String(input || '').replace(/^\s*(查询|搜索|查找|游戏|@\S+)\s*/u, '').trim();
  if (!text) return '发送“查询 游戏名”或输入游戏名，即可搜索情报库。';
  const matches = searchGames(games, text).slice(0, 5);
  if (!matches.length) return `未找到“${text}”。可尝试游戏中文名、英文名、开发商或标签。`;
  return matches.map(game => {
    const metrics = [];
    if (game.rating != null) metrics.push(`好评率：${game.rating}%`);
    if (game.price != null) metrics.push(`${game.steamAppId ? '中国区售价' : '售价'}：${game.steamAppId ? '¥' : ''}${game.price}`);
    if (game.sourceExtras?.usRatingOutOf5 != null) metrics.push(`App Store 评分：${game.sourceExtras.usRatingOutOf5}/5`);
    if (game.sourceExtras?.usPriceUsd != null) metrics.push(`美国区售价：US$${game.sourceExtras.usPriceUsd}`);
    return [
      `${game.name}（${game.englishName || game.genre}）`,
      `类型：${game.genre}｜平台：${game.platforms.join('、') || '未录入'}`,
      metrics.length ? metrics.join('｜') : '指标：未取得可比数据',
      game.isDemo ? '注：指标为演示数据' : '',
      game.dataAsOf ? `采集日期：${game.dataAsOf}` : '',
      game.metricScope ? `口径：${game.metricScope}` : '',
      game.sourceUrl ? `来源：${game.sourceUrl}` : ''
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}
