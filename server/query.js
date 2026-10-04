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

function compactName(value) {
  return String(value || '').toLocaleLowerCase().replace(/[\s·:：—_\-（）()，。！？、；;,.!?]/gu, '');
}

function mentionedGames(games, input) {
  const compactInput = compactName(String(input).replace(/@\S+\s*/gu, ''));
  if (!compactInput) return [];
  return games.map(game => {
    const canonicalNames = [game.name, game.englishName].filter(Boolean);
    const aliases = [...gameAliases.entries()]
      .filter(([, targets]) => targets.some(target => canonicalNames.some(name => compactName(name).includes(compactName(target)))))
      .map(([alias]) => alias);
    const candidates = [...canonicalNames, ...aliases].map(compactName).filter(name => name.length >= 2);
    let score = Math.max(0, ...candidates.filter(name => compactInput.includes(name)).map(name => name.length));
    const chineseName = compactName(game.name);
    if (!score && /\p{Script=Han}/u.test(String(game.name || '')) && chineseName.length >= 4) {
      for (let length = chineseName.length - 1; length >= 3; length--) {
        if (compactInput.includes(chineseName.slice(0, length))) { score = length; break; }
      }
    }
    return { game, score };
  }).filter(result => result.score > 0)
    .sort((left, right) => right.score - left.score)
    .map(result => result.game);
}

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

function formatDateTime(value) {
  if (!value || Number.isNaN(Date.parse(value))) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(value));
}

function shorten(value, limit = 150) {
  const text = String(value || '').replace(/\s+/gu, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit).trim()}…` : text;
}

function median(values) {
  const numbers = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  if (!numbers.length) return null;
  const middle = Math.floor(numbers.length / 2);
  return numbers.length % 2 ? numbers[middle] : Math.round((numbers[middle - 1] + numbers[middle]) / 2 * 10) / 10;
}

function formatSteamDetail(game, detail, input = '') {
  const product = detail.product || {};
  const review = detail.reviews?.summary || {};
  const samples = detail.reviews?.items || [];
  const history = (detail.players?.history || []).filter(point => Number.isFinite(Number(point.count)));
  const current = Number.isFinite(Number(detail.players?.current)) ? Number(detail.players.current) : game.currentPlayers;
  const average = history.length ? Math.round(history.reduce((sum, point) => sum + Number(point.count), 0) / history.length) : null;
  const peak = history.length ? Math.max(...history.map(point => Number(point.count))) : null;
  const trend = current != null && average
    ? current >= average * 1.1 ? `高于缓存均值 ${Math.round((current / average - 1) * 100)}%`
      : current <= average * 0.9 ? `低于缓存均值 ${Math.round((1 - current / average) * 100)}%` : '接近缓存均值'
    : '';
  const recommendedSamples = samples.filter(item => item.recommended).length;
  const playtimeMedian = median(samples.map(item => item.playtimeForeverHours));
  const productName = product.name && compactName(product.name) !== compactName(game.name) ? ` / ${product.name}` : '';
  const price = product.price?.text || (game.price != null ? String(game.price) : '暂未公布');
  const originalPrice = product.price?.originalText && product.price.originalText !== price ? `（原价 ${product.price.originalText}）` : '';
  const discount = Number(product.price?.discountPercent || 0) > 0 ? `，优惠 ${product.price.discountPercent}%` : '';
  const genres = (product.genres?.length ? product.genres : [game.genre]).filter(Boolean).slice(0, 4);
  const platforms = (product.platforms?.length ? product.platforms : game.platforms || []).filter(Boolean);
  const makers = [...(product.developers || []), ...(product.publishers || [])].filter((value, index, values) => value && values.indexOf(value) === index).slice(0, 3);
  const asksPrice = /(价格|售价|多少钱|折扣|优惠|史低|免费)/u.test(input);
  const asksReviews = /(好玩|口碑|评价|评测|评论|推荐|值得|入手|怎么样|如何)/u.test(input);
  const asksOnline = /(在线|人数|玩家数|热度|活跃|峰值|趋势)/u.test(input);
  const asksConfig = /(配置|电脑|显卡|带得动|最低要求|推荐要求|系统要求)/u.test(input);
  const asksGameplay = /(玩法|功能|单人|多人|联机|控制器|手柄|内容|简介|讲什么)/u.test(input);
  const asksProduct = /(开发商|发行商|谁做|平台|类型|发售|发行|上线|什么时候)/u.test(input);
  const focused = asksPrice || asksReviews || asksOnline || asksConfig || asksGameplay || asksProduct;
  const showAll = !focused || /(详细|完整|全部|介绍|资料|数据)/u.test(input);
  const lines = [`${game.name}${productName}｜Steam 情报`];
  if (showAll || asksProduct || asksGameplay) {
    lines.push(`类型：${genres.join('、') || '未录入'}｜平台：${platforms.join('、') || '未录入'}`);
    if (makers.length) lines.push(`开发/发行：${makers.join('、')}`);
    lines.push(`发售：${product.comingSoon ? '即将推出' : product.releaseDate || game.releaseDate || '未录入'}`);
  }
  if (showAll || asksPrice) lines.push(`价格：${price}${originalPrice}${discount}`);
  if (showAll || asksReviews) {
    lines.push(review.positivePercent != null
      ? `Steam 口碑：${review.score || '已有评测'}｜好评 ${review.positivePercent}%｜${formatNumber(review.total)} 条简体中文公开评测`
      : 'Steam 口碑：当前缓存暂无可用评测汇总');
    if (product.metacritic != null) lines.push(`Metacritic：${product.metacritic}`);
    if (samples.length) lines.push(`评论样本：有效 ${samples.length} 条｜推荐 ${recommendedSamples} / 不推荐 ${samples.length - recommendedSamples}${playtimeMedian != null ? `｜玩家累计时长中位数 ${playtimeMedian} 小时` : ''}`);
  }
  if ((showAll || asksOnline) && current != null) {
    lines.push(`玩家在线：当前 ${formatNumber(current)}${average != null ? `｜缓存均值 ${formatNumber(average)}` : ''}${peak != null ? `｜缓存峰值 ${formatNumber(peak)}` : ''}${trend ? `｜${trend}` : ''}`);
  }
  if ((showAll || asksGameplay || asksReviews) && product.shortDescription) lines.push(`简介：${shorten(product.shortDescription)}`);
  if (asksConfig || showAll) {
    lines.push(product.pcRequirements?.minimum ? `最低配置：${shorten(product.pcRequirements.minimum, 260)}` : '最低配置：Steam 当前未提供');
    if (product.pcRequirements?.recommended) lines.push(`推荐配置：${shorten(product.pcRequirements.recommended, 260)}`);
  }
  if ((asksGameplay || showAll) && product.categories?.length) {
    lines.push(`产品功能：${product.categories.slice(0, 8).join('、')}`);
  }
  lines.push(detail.capturedAt ? `数据采集：${formatDateTime(detail.capturedAt)}` : '');
  const scope = [];
  if (showAll || asksPrice) scope.push('价格为采集区服商店价');
  if (showAll || asksOnline) scope.push('在线趋势来自缓存时段，不代表销量或独立用户');
  if (scope.length) lines.push(`口径：${scope.join('；')}。`);
  if (detail.sources?.product || game.sourceUrl) lines.push(`来源：${detail.sources?.product || game.sourceUrl}`);
  return lines.filter(Boolean).join('\n');
}

function formatGame(game, detail = null, input = '') {
  if (game.steamAppId && detail?.product) return formatSteamDetail(game, detail, input);
  const metrics = [];
  if (game.rating != null) metrics.push(`好评率：${game.rating}%`);
  if (game.price != null) metrics.push(`${game.steamAppId ? 'Steam 售价' : '售价'}：${game.steamAppId && game.metricScope?.includes('美元') ? 'US$' : game.steamAppId ? '¥' : ''}${game.price}`);
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

function gameOpinionRequest(text) {
  const pattern = /(?:这款|这个)?(?:游戏)?(?:好不好玩|好玩吗|怎么样|如何|值不值得玩|值得玩吗|值得入手吗|推荐吗|口碑如何|口碑怎么样|评价如何|评价怎么样)[呢吗啊呀吧]*[\s？?。！!]*$/u;
  if (!pattern.test(text)) return null;
  const gameName = text.replace(pattern, '').trim();
  return gameName || null;
}

function queryHelp(input, query = '') {
  const compact = String(input || '').replace(/\s+/gu, '');
  if (/steam/i.test(compact)) return [
    query ? `暂时无法确认“${query}”对应哪款已入库 Steam 游戏。` : '请在问题中带上具体游戏名称。',
    '可以直接套用：',
    '• [游戏名]现在多少钱，有折扣吗？',
    '• [游戏名]当前在线人数和趋势怎么样？',
    '• [游戏名]口碑怎么样，值得玩吗？',
    '• [游戏名]最低配置是什么？',
    '• 详细介绍一下[游戏名]的 Steam 数据',
    '示例：星露谷物语当前在线人数和口碑怎么样？'
  ].join('\n');
  if (/小游戏|微信|抖音/u.test(compact)) return [
    '暂时没有识别到具体的小游戏查询目标。',
    '可以直接套用：',
    '• 微信小游戏热门榜前五名',
    '• 微信小游戏畅销榜有哪些游戏？',
    '• [小游戏名称]是什么类型？',
    '• 查询[小游戏名称]的开发商和来源',
    '示例：微信小游戏有什么好玩的？'
  ].join('\n');
  return [
    query ? `暂时无法确认“${query}”对应哪款已入库游戏。` : '请补充游戏名称或要查询的数据。',
    '可以直接套用：',
    '• 查询[游戏名]',
    '• [游戏名]好玩吗？',
    '• [游戏名]多少钱/多少人在线/需要什么配置？',
    '• 最近发布的游戏有哪些？',
    '• 微信小游戏畅销榜前五名'
  ].join('\n');
}

export function rankingQueryType(input = '') {
  const compact = String(input).replace(/@\S+\s*/gu, '').replace(/[\s，。！？、：:；;]/gu, '');
  if (/抖音/u.test(compact)) return null;
  const hasRankingWord = /(榜|排名|前几|第一|最热|热门新游)/u.test(compact);
  const hasRecommendationWord = /(好玩|推荐|玩什么|有哪些|有啥|有什么)/u.test(compact);
  const hasWechatScope = /(微信|小游戏)/u.test(compact);
  if ((!hasRankingWord && !hasRecommendationWord) || !hasWechatScope) return null;
  if (/(畅销|氪金|吸金|收入)/u.test(compact)) return 'bestSell';
  if (/(新游|新上线|最新)/u.test(compact)) return 'new';
  return 'popular';
}

export function answerRankingQuery(data, input, options = {}) {
  const type = rankingQueryType(input);
  if (!type) return null;
  const board = data?.boards?.[type];
  const labels = { popular: '最受欢迎榜', bestSell: '畅销榜', new: '热门新游榜' };
  const pageLink = content => appendWebLink(content, options.webUrl, { view: 'rankings', board: type });
  if (!board?.items?.length) {
    const reason = board?.error ? `本次获取失败：${board.error}` : '尚未生成榜单快照';
    return pageLink(`微信小游戏${labels[type]}暂时没有可用数据。${reason}。`);
  }
  const fetchedAt = board.fetchedAt
    ? new Date(board.fetchedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
    : '未记录';
  const top = board.items.slice(0, 5).map(item => {
    const detail = [item.developer, ...(item.tags || []).slice(0, 2)].filter(Boolean).join(' · ');
    return `${item.rank}. ${item.name}${detail ? `（${detail}）` : ''}`;
  });
  return pageLink([
    `微信小游戏${labels[type]}（前 ${top.length} 名）`,
    `数据源：${data.source || '腾讯应用宝微信小游戏榜单'}`,
    `采集时间：${fetchedAt}`,
    '',
    ...top,
    '',
    '口径：排名为来源页面展示顺序，不等于全平台真实销量或收入。'
  ].join('\n'));
}

export function answerQuery(games, input, options = {}) {
  const { original, text, compact } = normalizedRequest(input);
  const withLink = (content, params) => appendWebLink(content, options.webUrl, params);
  const gameLink = game => ({ view: 'library', q: game.name, steamAppId: game.steamAppId ? String(game.steamAppId) : '' });
  let mentionedCache;
  const getMentioned = () => mentionedCache || (mentionedCache = mentionedGames(games, original));
  const detailFor = game => {
    if (!game?.steamAppId || typeof options.getSteamDetail !== 'function') return null;
    try { return options.getSteamDetail(game.steamAppId) || null; }
    catch { return null; }
  };
  const format = game => formatGame(game, detailFor(game), original);

  if (!text || /^(帮助|菜单|help|\?)$/iu.test(text)) {
    return withLink('游戏信息助手已就绪。可直接问：\n• 查询 黑神话或原神\n• 当前在线 / 黑神话现在多少人在线\n• 近期发布的热门游戏\n• 最新公告\n• 数据状态\n\n只根据已入库数据回答；未采集的平台会明确说明。', { view: 'library' });
  }

  if (/抖音.*小游戏|小游戏.*抖音/u.test(compact)) {
    const douyinGames = games.filter(game => game.channel === '小游戏' && /抖音|douyin|字节|bytedance/u.test([
      ...(game.platforms || []), ...(game.tags || []), game.metricScope || '', game.sourceUrl || ''
    ].join(' ').toLocaleLowerCase()));
    if (douyinGames.length) {
      const items = douyinGames.slice(0, 5).map((game, index) => `${index + 1}. ${game.name}${game.genre ? `｜${game.genre}` : ''}${game.sourceUrl ? `\n${game.sourceUrl}` : ''}`);
      return withLink([
        `当前库内明确标注的抖音小游戏（展示 ${items.length} 款）`,
        ...items,
        '',
        '说明：以上是已入库产品，不代表抖音热门榜或畅销榜排名。'
      ].join('\n'), { view: 'library', channel: '小游戏' });
    }
    const wechatCount = games.filter(game => game.channel === '小游戏' && (game.platforms || []).some(platform => /微信/u.test(platform))).length;
    return withLink(`当前库里没有明确标注且可核验的抖音小游戏产品或榜单，因此不能推荐或生成排名。现有小游戏中有 ${wechatCount} 款明确来自微信小游戏，不能把它们自动当作抖音版本。`, { view: 'library', channel: '小游戏' });
  }

  if (/steam/i.test(original) && /(数据|覆盖|资料|情况|状态|有什么|多少)/u.test(compact) && !getMentioned().length && typeof options.getSteamOverview === 'function') {
    const overview = options.getSteamOverview();
    const coverage = overview?.coverage || {};
    const leaders = overview?.playerMarket?.onlineLeaders || [];
    const top = leaders.slice(0, 5).map((game, index) => `${index + 1}. ${game.name}：当前 ${formatNumber(game.current)}${game.positivePercent != null ? `｜好评 ${game.positivePercent}%` : ''}`);
    return withLink([
      'Steam 数据覆盖状态',
      `商品详情：${formatNumber(coverage.products)} 款｜有评测汇总：${formatNumber(coverage.reviews)} 款｜有在线数据：${formatNumber(coverage.players)} 款`,
      `有效中文评论样本：${formatNumber(coverage.reviewSamples)} 条`,
      overview?.capturedAt ? `最近采集：${formatDateTime(overview.capturedAt)}` : '',
      top.length ? '\n当前在线前列：' : '',
      ...top,
      '',
      '说明：回答只使用本项目已采集的 Steam 商品、评测与在线缓存。'
    ].filter(value => value !== '').join('\n'), { view: 'steam' });
  }

  if (/^(数据状态|采集状态|状态)$/u.test(text)) {
    const liveGames = games.filter(game => game.hasLiveData);
    const latestCapture = liveGames.map(game => game.steamCapturedAt || '').sort().at(-1);
    const counts = games.reduce((result, game) => ({ ...result, [game.channel]: (result[game.channel] || 0) + 1 }), {});
    return withLink(`情报库共 ${games.length} 款游戏：端游 ${counts.端游 || 0}、App ${counts.App || 0}、小游戏 ${counts.小游戏 || 0}。其中 ${liveGames.length} 款有 Steam 实采数据。${latestCapture ? `\n最近采集：${latestCapture}` : '\n尚未生成实时采集快照。'}`, { view: 'library' });
  }

  if (!recentReleaseIntent(compact) && (/(当前在线|在线人数|在线排行|现在.*在线|谁.*最热|最?热门(?:的)?游戏|本周.*热门|最近.*热门|哪些游戏.*热|热度排行)/u.test(compact) || compact === '热门')) {
    const gameQuery = original.replace(/(请问|麻烦|请|帮我|查询|查一下|查|现在|当前|有|多少|人|在线人数|在线|情况|怎么样|？|\?)/gu, '').trim();
    if (gameQuery) {
      const match = searchGames(games, gameQuery).find(game => game.hasLiveData || detailFor(game)?.players?.current != null);
      if (match) return withLink(format(match), gameLink(match));
    }
    const liveGames = games.filter(game => game.hasLiveData && Number.isFinite(Number(game.currentPlayers)))
      .sort((left, right) => Number(right.currentPlayers) - Number(left.currentPlayers)).slice(0, 5);
    if (!liveGames.length) return withLink('目前没有在线人数实采数据，请先运行 Steam 采集任务。');
    const scope = /(本周|这周|一周)/u.test(compact)
      ? '当前库尚未采集完整周热度，以下按最近一次 Steam 在线人数排序：'
      : 'Steam 当前在线排行：';
    return withLink(`${scope}\n${liveGames.map((game, index) => `${index + 1}. ${game.name}：${formatNumber(game.currentPlayers)}`).join('\n')}\n注：这是采集时刻快照，不是历史峰值。`, { view: 'analytics' });
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

  const opinionGameName = gameOpinionRequest(text);
  if (opinionGameName) {
    const match = getMentioned()[0] || searchGames(games, opinionGameName)[0];
    if (!match) return withLink(queryHelp(original, opinionGameName), { view: 'library', q: opinionGameName });
    const steamDetail = detailFor(match);
    const positivePercent = steamDetail?.reviews?.summary?.positivePercent ?? match.rating;
    const assessment = positivePercent != null
      ? `从已入库指标看，${match.name}当前好评率为 ${positivePercent}%，可作为口碑参考；是否适合你仍取决于个人玩法偏好。`
      : `情报库中有${match.name}的资料，但暂未取得可用于判断口碑的评分数据。`;
    return withLink(`${assessment}\n\n${formatGame(match, steamDetail, original)}`, gameLink(match));
  }

  const mentioned = getMentioned().slice(0, 5);
  if (mentioned.length) return withLink(mentioned.map(format).join('\n\n'), gameLink(mentioned[0]));

  const matches = searchGames(games, text).slice(0, 5);
  if (!matches.length) return withLink(queryHelp(original, text), { view: 'library', q: text });
  return withLink(matches.map(format).join('\n\n'), gameLink(matches[0]));
}
