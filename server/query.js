export function searchGames(games, query = '', genre = '全部', platform = '全部') {
  const keyword = String(query).trim().toLocaleLowerCase();
  return games.filter(game => {
    const haystack = [game.name, game.englishName, game.developer, game.publisher, ...(game.tags || [])].join(' ').toLocaleLowerCase();
    return (!keyword || haystack.includes(keyword)) && (genre === '全部' || game.genre === genre) && (platform === '全部' || game.platforms.includes(platform));
  });
}

export function answerQuery(games, input) {
  const text = String(input || '').replace(/^\s*(查询|搜索|查找|游戏|@\S+)\s*/u, '').trim();
  if (!text) return '发送“查询 游戏名”或输入游戏名，即可搜索情报库。';
  const matches = searchGames(games, text).slice(0, 5);
  if (!matches.length) return `未找到“${text}”。可尝试游戏中文名、英文名、开发商或标签。`;
  return matches.map(game => `${game.name}（${game.englishName || game.genre}）\n类型：${game.genre}｜平台：${game.platforms.join('、') || '未录入'}\n评分：${game.rating || '未录入'}｜价格：¥${game.price ?? '未录入'}${game.isDemo ? '\n注：指标为演示数据' : ''}${game.sourceUrl ? `\n来源：${game.sourceUrl}` : ''}`).join('\n\n');
}
