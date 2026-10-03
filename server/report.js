function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}

function reportDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

function zhDate(value) {
  const [year, month, day] = value.split('-');
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function cleanUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch { return ''; }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

export function buildDailyReport(games, date = reportDate()) {
  const liveGames = games.filter(game => game.hasLiveData);
  const hotGames = [...liveGames]
    .filter(game => Number.isFinite(Number(game.currentPlayers)))
    .sort((left, right) => Number(right.currentPlayers) - Number(left.currentPlayers))
    .slice(0, 10);
  const news = liveGames.flatMap(game => (game.latestSteamNews || []).map(item => ({
    ...item, gameName: game.name, url: cleanUrl(item.url)
  }))).filter(item => item.publishedAt)
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
    .slice(0, 12);
  const releases = [...games].filter(game => /^\d{4}-\d{2}-\d{2}$/.test(game.releaseDate || ''))
    .sort((left, right) => right.releaseDate.localeCompare(left.releaseDate)).slice(0, 10);
  const captures = liveGames.map(game => game.steamCapturedAt).filter(Boolean).sort();
  const sources = new Map();
  for (const game of games) {
    const url = cleanUrl(game.sourceUrl);
    if (url) sources.set(url, game.name);
  }
  for (const item of news) if (item.url) sources.set(item.url, `${item.gameName}：${item.title}`);
  return {
    date,
    title: `游戏行业日报｜${zhDate(date)}`,
    generatedAt: new Date().toISOString(),
    totals: {
      games: games.length,
      liveGames: liveGames.length,
      currentPlayers: hotGames.reduce((sum, game) => sum + Number(game.currentPlayers || 0), 0),
      news90Days: liveGames.reduce((sum, game) => sum + Number(game.steamNewsCounts?.last90Days || 0), 0)
    },
    hotGames,
    news,
    releases,
    sources: [...sources].map(([url, label]) => ({ url, label })),
    latestCapture: captures.at(-1) || null,
    limitations: [
      '当前自动采集范围以 Steam 官方公开数据为主。',
      '国内新闻、B站、微信小游戏和抖音小游戏尚未取得可核验数据时，不生成推测性内容。',
      '在线人数为采集时刻快照，不代表历史峰值或销量。'
    ]
  };
}

export function dailyReportText(games, options = {}) {
  const report = buildDailyReport(games);
  const lines = [
    report.title,
    '',
    '今日概览',
    `• 情报库 ${report.totals.games} 款游戏，${report.totals.liveGames} 款有实时采集`,
    `• 已采集游戏当前在线合计 ${formatNumber(report.totals.currentPlayers)}`,
    `• 近90天 Steam 公告 ${formatNumber(report.totals.news90Days)} 条`
  ];
  if (report.hotGames.length) {
    lines.push('', '热度排行', ...report.hotGames.slice(0, 3).map((game, index) =>
      `${index + 1}. ${game.name}：${formatNumber(game.currentPlayers)} 人在线`));
  }
  if (report.news.length) {
    lines.push('', '最新动态', ...report.news.slice(0, 3).map((item, index) =>
      `${index + 1}. ${item.gameName}｜${item.title}`));
  }
  const base = cleanUrl(options.webUrl);
  if (base) lines.push('', `查看完整报告：${new URL(`/reports/${report.date}`, base).toString()}`);
  else lines.push('', '完整报告链接尚未配置，请设置 PUBLIC_WEB_URL。');
  lines.push('', '说明：仅根据已采集且有来源的数据生成。');
  return lines.join('\n');
}

export function renderDailyReportHtml(report) {
  const itemList = (items, render, empty) => items.length
    ? `<ol class="items">${items.map(render).join('')}</ol>`
    : `<div class="empty">${escapeHtml(empty)}</div>`;
  const hot = itemList(report.hotGames, game => `<li><div><strong>${escapeHtml(game.name)}</strong><span>${escapeHtml((game.platforms || []).join('、') || '平台未录入')}</span></div><b>${formatNumber(game.currentPlayers)}<small> 当前在线</small></b></li>`, '暂无在线人数实采数据');
  const news = itemList(report.news, item => `<li><div><strong>${escapeHtml(item.gameName)}｜${escapeHtml(item.title)}</strong><span>${escapeHtml(new Date(item.publishedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }))}</span></div>${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">原始来源 ↗</a>` : '<em>来源链接缺失</em>'}</li>`, '暂无已采集的游戏公告');
  const releases = itemList(report.releases, game => `<li><div><strong>${escapeHtml(game.name)}</strong><span>${escapeHtml(game.genre)}｜${escapeHtml((game.platforms || []).join('、') || '平台未录入')}</span></div><b>${escapeHtml(game.releaseDate)}</b></li>`, '暂无有效发行日期');
  const sources = itemList(report.sources, source => `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.label)} ↗</a></li>`, '暂无来源链接');
  const focus = report.hotGames.slice(0, 5).map((game, index) => {
    const appId = Number(game.steamAppId);
    const cover = Number.isSafeInteger(appId) && appId > 0
      ? `<img class="game-cover" src="https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg" alt="${escapeHtml(game.name)}封面" loading="lazy">`
      : '';
    const source = cleanUrl(game.sourceUrl);
    return `<article class="focus-card">${cover}<div><span class="rank">重点观察 ${index + 1}</span><h3>${escapeHtml(game.name)}</h3><p>${escapeHtml(game.description || '当前仅展示已核验的结构化指标，尚无可引用的编辑分析。')}</p><ul><li>当前在线：<strong>${formatNumber(game.currentPlayers)}</strong></li><li>近90天公告：<strong>${formatNumber(game.steamNewsCounts?.last90Days || 0)}</strong></li><li>平台：<strong>${escapeHtml((game.platforms || []).join('、') || '未录入')}</strong></li></ul>${source ? `<a href="${escapeHtml(source)}" target="_blank" rel="noreferrer">查看原始数据 ↗</a>` : ''}</div></article>`;
  }).join('') || '<div class="empty">暂无足够数据生成重点产品拆解。</div>';
  const lead = report.hotGames[0];
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(report.title)}</title><style>
:root{font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif;color:#19343a;background:#f3f7f6;scroll-behavior:smooth}*{box-sizing:border-box}body{margin:0}main{width:min(920px,calc(100% - 32px));margin:36px auto 72px}.hero{padding:34px;border-radius:22px;background:linear-gradient(135deg,#0b5f5d,#169889);color:#fff;box-shadow:0 18px 45px #0d66552b}.eyebrow{font-size:12px;letter-spacing:.16em;opacity:.72}.hero h1{margin:10px 0 8px;font-size:32px}.hero p{margin:0;opacity:.82}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}.metric,section{background:#fff;border:1px solid #dfe9e6;border-radius:16px}.metric{padding:18px}.metric b{display:block;font-size:24px;color:#0c756d}.metric span{font-size:12px;color:#71837f}section{padding:26px;margin-top:16px}h2{margin:0 0 16px;font-size:20px}h3{margin:8px 0 10px;font-size:19px}.section-note{color:#7a8c87;font-size:13px}.summary{background:#eaf6f3;border-color:#c7e5df}.summary ul{margin:0;padding-left:20px;line-height:1.9}.toc{display:flex;flex-wrap:wrap;gap:10px}.toc a{padding:8px 12px;border-radius:999px;background:#f0f6f4;color:#0a756d;text-decoration:none;font-size:13px}.items{list-style:none;margin:0;padding:0}.items li{display:flex;justify-content:space-between;gap:18px;padding:14px 0;border-top:1px solid #edf1f0}.items li:first-child{border-top:0}.items div{display:grid;gap:5px}.items span,.items small,.items em{font-size:12px;color:#7b8b87;font-style:normal}.items b{white-space:nowrap}.items a,.focus-card a{color:#087f76;text-decoration:none}.empty{padding:22px;background:#f7faf9;border-radius:10px;color:#7b8b87}.focus-card{display:grid;grid-template-columns:240px 1fr;gap:22px;padding:22px 0;border-top:1px solid #e7eeec}.focus-card:first-of-type{border-top:0}.game-cover{width:100%;aspect-ratio:460/215;object-fit:cover;border-radius:12px;background:#eef3f2}.focus-card p{color:#5e716d;line-height:1.75}.focus-card ul{padding-left:18px;line-height:1.8}.rank{color:#b56c18;font-size:12px;font-weight:700}.notice{border-left:4px solid #d99a38}footer{margin-top:18px;text-align:center;color:#82928e;font-size:12px}@media(max-width:700px){main{margin-top:16px}.hero{padding:24px}.hero h1{font-size:25px}.metrics{grid-template-columns:repeat(2,1fr)}section{padding:18px}.items li{align-items:flex-start;flex-direction:column;gap:8px}.focus-card{grid-template-columns:1fr}.game-cover{max-width:520px}}
</style></head><body><main>
<header class="hero"><div class="eyebrow">GAME INTELLIGENCE DAILY</div><h1>${escapeHtml(report.title)}</h1><p>基于项目已采集数据自动生成｜不使用无来源推测</p></header>
<div class="metrics"><div class="metric"><b>${formatNumber(report.totals.games)}</b><span>情报库游戏</span></div><div class="metric"><b>${formatNumber(report.totals.liveGames)}</b><span>实时采集游戏</span></div><div class="metric"><b>${formatNumber(report.totals.currentPlayers)}</b><span>当前在线合计</span></div><div class="metric"><b>${formatNumber(report.totals.news90Days)}</b><span>近90天公告</span></div></div>
<section class="summary"><h2>摘要</h2><ul><li>本期覆盖 ${formatNumber(report.totals.liveGames)} 款有实时采集的游戏。</li><li>${lead ? `当前在线最高为 ${escapeHtml(lead.name)}，采集值 ${formatNumber(lead.currentPlayers)}。` : '当前暂无在线人数实采数据。'}</li><li>所有结论均可回溯到页面末尾的原始来源。</li></ul></section>
<section><h2>目录</h2><nav class="toc"><a href="#hot">热度观察</a><a href="#overseas">海外动态</a><a href="#domestic">国内热闻</a><a href="#focus">重点产品拆解</a><a href="#release">近期发行</a><a href="#sources">数据来源</a></nav></section>
<section id="hot"><h2>🔥 热度观察</h2>${hot}</section>
<section id="overseas"><h2>🌍 海外动态</h2><p class="section-note">Steam 官方公开公告，按发布时间排序。</p>${news}</section>
<section id="domestic"><h2>🇨🇳 国内热闻</h2><div class="empty">尚未采集到可核验的国内新闻数据，接入国内来源后将在此展示。</div></section>
<section id="focus"><h2>📖 重点产品拆解</h2><p class="section-note">仅呈现已入库字段和实采指标；后续接入图片、视频和编辑批注。</p>${focus}</section>
<section id="release"><h2>🗓️ 近期发行</h2>${releases}</section>
<section id="sources"><h2>🔗 数据来源</h2>${sources}</section>
<section class="notice"><h2>数据说明</h2><ul>${report.limitations.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul><p class="section-note">最近采集：${escapeHtml(report.latestCapture || '尚未采集')}｜报告生成：${escapeHtml(report.generatedAt)}</p></section>
<footer>游戏情报分析系统 · 可追溯数据日报</footer>
</main></body></html>`;
}

export { reportDate };
