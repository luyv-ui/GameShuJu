import { useEffect, useMemo, useState } from 'react';
import { Activity, Database, ExternalLink, Gamepad2, RefreshCw, Search, Star, TrendingUp, Users } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Game } from './types';
import { apiUrl } from './api-url';
import { apiFetch } from './auth';
import './steam-workspace.css';

type SyncSource = { state?: string; fetched?: number; lastSuccessAt?: string };
type SyncStatus = { running?: boolean; sources?: Record<string, SyncSource> };
type RankedGame = { rank: number; id: string; name: string; icon?: string; url?: string; priceText?: string; discountText?: string; availabilityText?: string; change?: string; weeks?: string; currentPlayers?: number; dailyPeakPlayers?: number };
type Board = { label: string; url?: string; items: RankedGame[]; fetchedAt?: string | null; error?: string | null };
type RankingSnapshot = { capturedAt: string; date: string; region?: string; board: Board };
type RegionOption = { value: string; label: string };
type SteamRankings = { platforms?: { steam?: { region?: string; regionOptions?: RegionOption[]; boards?: Record<string, Board>; weeklyBoards?: RankingSnapshot[]; monthlyBoards?: RankingSnapshot[]; yearlyBoards?: RankingSnapshot[] } } };
type Distribution = { name: string; count: number };
type SteamOverviewData = {
  platform: { capturedAt: string; sourceUrl: string; current: number; peak: number; history: Array<{ capturedAt: string; count: number }>; refreshError?: string };
  sample: { capturedAt: string | null; coverage: { games: number; products: number; reviews: number; players: number; reviewSamples: number };
    reviewMarket: { totalReviews: number; positivePercent: number | null; recommendedSamples: number };
    playerMarket: { current: number; history: Array<{ capturedAt: string; count: number }>; onlineLeaders: Array<{ appId: number; name: string; image: string; current: number; average: number | null; peak: number; positivePercent: number | null }> };
    genreMix: Distribution[]; publisherMix: Distribution[]; platformMix: Distribution[]; featureMix: Distribution[]; priceMix: Distribution[]; discountMix: Distribution[]; reviewBands: Distribution[]; playtimeBuckets: Distribution[] };
};
type Module = 'rankings' | 'data';
type DataView = 'overview' | 'library';
type ChartPeriod = 'live' | 'weekly' | 'monthly' | 'yearly';

const periodCopy: Record<ChartPeriod, { label: string; title: string; description: string }> = {
  live: { label: '实时排行榜', title: '实时排行榜', description: '最畅销、最热玩与 Steam Deck 热门游戏' },
  weekly: { label: '每周排行榜', title: '每周畅销榜', description: '按周保存畅销游戏快照，观察排名持续性' },
  monthly: { label: '月度最热新品', title: '月度最热新品', description: '查看当月表现突出的新发行游戏' },
  yearly: { label: '年度最佳', title: '年度最佳', description: '汇总年度畅销、新品与最热玩游戏' }
};

function rankingAppIds(data: SteamRankings | null) {
  const steam = data?.platforms?.steam;
  const ids = new Set<number>();
  const addBoard = (board?: Board) => board?.items?.forEach(item => {
    const id = Number(item.id);
    if (Number.isSafeInteger(id) && id > 0) ids.add(id);
  });
  Object.values(steam?.boards || {}).forEach(addBoard);
  [...(steam?.weeklyBoards || []), ...(steam?.monthlyBoards || []), ...(steam?.yearlyBoards || [])]
    .forEach(snapshot => addBoard(snapshot.board));
  return [...ids];
}

function isSteam(game: Game) {
  try { return new URL(game.sourceUrl).hostname.toLowerCase() === 'store.steampowered.com'; }
  catch { return false; }
}

function number(value: number | null | undefined) {
  if (value == null) return '—';
  if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}万`;
  return value.toLocaleString('zh-CN');
}

function distributionLead(items: Distribution[] | undefined, unit = '款') {
  const rows = items || [];
  const total = rows.reduce((sum, item) => sum + item.count, 0);
  const top = rows.reduce<Distribution | null>((best, item) => !best || item.count > best.count ? item : best, null);
  return top && total ? `${top.name}最多，为 ${top.count} ${unit}，占该图统计量的 ${Math.round(top.count / total * 100)}%` : '当前样本不足，尚不能形成稳定结论';
}

function price(game: Game) {
  if (game.price == null) return '待补全';
  if (game.price === 0) return '免费';
  return game.metricScope?.includes('美元') ? `$${game.price.toFixed(2)}` : `¥${game.price}`;
}

function normalized(value: string) {
  return value.toLocaleLowerCase().replace(/[™®©\s:：·'’"“”\-_/]/g, '');
}

function rankingFallback(item: RankedGame): Game {
  const numericPrice = item.priceText?.match(/[\d,.]+/)?.[0]?.replace(',', '');
  const isDollar = item.priceText?.includes('$');
  return {
    id: `steam-ranking-${item.id}`,
    channel: '端游',
    name: item.name,
    englishName: item.name,
    genre: '未分类',
    platforms: ['PC'],
    releaseDate: '',
    developer: '',
    publisher: '',
    price: numericPrice ? Number(numericPrice) : item.priceText?.includes('免费') ? 0 : null,
    rating: null,
    reviewCount: null,
    peakPlayers: null,
    tags: ['Steam 榜单'],
    description: '该游戏已从 Steam 官方榜单建立基础档案，商店详情与评价数据将在后续同步中补全。',
    iconUrl: item.icon,
    steamAppId: Number(item.id) || null,
    sourceUrl: item.url || `https://store.steampowered.com/app/${item.id}/`,
    metricScope: isDollar ? 'Steam 美国区美元价格；官方榜单快照' : 'Steam 官方榜单快照',
    dataAsOf: new Date().toISOString().slice(0, 10),
    isDemo: false
  };
}

function SteamCover({ game }: { game: Game }) {
  const [failed, setFailed] = useState(false);
  const src = game.iconUrl || (game.steamAppId ? `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${game.steamAppId}/header.jpg` : '');
  return <div className="steam-card-cover">{src && !failed
    ? <img src={src} alt={`${game.name} 封面`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <Gamepad2 size={28} />}</div>;
}

function RankingCover({ game }: { game: RankedGame }) {
  const [failed, setFailed] = useState(false);
  return <span className="steam-board-cover">{game.icon && !failed
    ? <img src={game.icon} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <Gamepad2 size={19} />}</span>;
}

export default function SteamWorkspace({ games, syncStatus, syncMessage, canSync, onSync, onOpenGame }:
  { games: Game[]; syncStatus: SyncStatus | null; syncMessage: string; canSync: boolean; onSync: () => Promise<void> | void; onOpenGame: (game: Game) => void }) {
  const steamGames = useMemo(() => games.filter(isSteam), [games]);
  const [module, setModule] = useState<Module>('rankings');
  const [dataView, setDataView] = useState<DataView>('overview');
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState('全部');
  const [sort, setSort] = useState('reviews');
  const [page, setPage] = useState(1);
  const [boards, setBoards] = useState<Record<string, Board>>({});
  const [weeklyBoards, setWeeklyBoards] = useState<RankingSnapshot[]>([]);
  const [monthlyBoards, setMonthlyBoards] = useState<RankingSnapshot[]>([]);
  const [yearlyBoards, setYearlyBoards] = useState<RankingSnapshot[]>([]);
  const [activeRegion, setActiveRegion] = useState('global');
  const [regionOptions, setRegionOptions] = useState<RegionOption[]>([
    { value: 'global', label: '全球' }, { value: 'CN', label: '中国' }, { value: 'US', label: '美国' }, { value: 'JP', label: '日本' }
  ]);
  const [activeBoard, setActiveBoard] = useState('topSelling');
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>('live');
  const [archiveLabel, setArchiveLabel] = useState('');
  const [rankingQuery, setRankingQuery] = useState('');
  const [rankingUpdating, setRankingUpdating] = useState(false);
  const [rankingMessage, setRankingMessage] = useState('');
  const [overview, setOverview] = useState<SteamOverviewData | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);

  const applyRankings = (data: SteamRankings | null) => {
    const steam = data?.platforms?.steam;
    const next = steam?.boards || {};
    const snapshots = steam?.weeklyBoards || [];
    setBoards(next);
    setWeeklyBoards(snapshots);
    setMonthlyBoards(steam?.monthlyBoards || []);
    setYearlyBoards(steam?.yearlyBoards || []);
    if (steam?.region) setActiveRegion(steam.region);
    if (steam?.regionOptions?.length) setRegionOptions(steam.regionOptions);
    setArchiveLabel(snapshots[0]?.date || '');
    if (!next[activeBoard]) setActiveBoard(Object.keys(next)[0] || 'topSelling');
  };
  async function loadRankings(force = false, region = activeRegion) {
    const response = await fetch(apiUrl(`/api/rankings?scope=steam&region=${encodeURIComponent(region)}${force ? '&refresh=1' : ''}`));
    if (!response.ok) throw new Error('Steam 榜单更新失败');
    const data = await response.json() as SteamRankings;
    applyRankings(data);
    return data;
  }
  useEffect(() => { void loadRankings(false, 'global').catch(() => setRankingMessage('榜单暂时无法读取')); }, []);
  async function loadOverview(force = false) {
    setOverviewLoading(true);
    try {
      const response = await fetch(apiUrl(`/api/steam/overview${force ? '?refresh=1' : ''}`));
      if (!response.ok) throw new Error('Steam 整体数据读取失败');
      const data = await response.json() as SteamOverviewData;
      setOverview(data);
      return data;
    } finally { setOverviewLoading(false); }
  }
  useEffect(() => {
    if (module === 'data' && !overview && !overviewLoading) void loadOverview().catch(() => setRankingMessage('整体数据暂时无法读取'));
  }, [module]);
  async function changeRegion(region: string) {
    setActiveRegion(region);
    setActiveBoard('topSelling');
    setChartPeriod('live');
    setRankingQuery('');
    setRankingUpdating(true);
    setRankingMessage(`正在读取${regionOptions.find(item => item.value === region)?.label || ''}榜单…`);
    try {
      await loadRankings(false, region);
      setRankingMessage('');
    } catch (cause) { setRankingMessage(cause instanceof Error ? cause.message : '榜单读取失败'); }
    finally { setRankingUpdating(false); }
  }
  async function updateSteamData() {
    setRankingUpdating(true);
    setRankingMessage(`正在更新${regionOptions.find(item => item.value === activeRegion)?.label || ''}榜单…`);
    try {
      await onSync();
      const rankingData = await loadRankings(true, activeRegion);
      const appIds = rankingAppIds(rankingData);
      setRankingMessage(`榜单已更新，正在替换 ${appIds.length} 款游戏的完整缓存…`);
      const cacheResponse = await apiFetch('/api/steam/game-cache/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appIds })
      });
      const cacheResult = await cacheResponse.json() as { requested?: number; completed?: unknown[]; failures?: unknown[]; error?: string };
      if (!cacheResponse.ok) throw new Error(cacheResult.error || '游戏详情缓存更新失败');
      const completed = cacheResult.completed?.length || 0;
      const failures = cacheResult.failures?.length || 0;
      await loadOverview(true);
      setRankingMessage(`榜单和 ${completed} 款游戏缓存已更新${failures ? `，${failures} 款暂时无法读取` : ''}`);
    } catch (cause) { setRankingMessage(cause instanceof Error ? cause.message : '榜单更新失败'); }
    finally { setRankingUpdating(false); }
  }

  const rankedItems = useMemo(() => {
    const unique = new Map<string, RankedGame>();
    Object.values(boards).forEach(boardValue => boardValue.items.forEach(item => { if (!unique.has(item.id)) unique.set(item.id, item); }));
    return [...unique.values()];
  }, [boards]);
  const connectedGames = useMemo(() => {
    const result = [...steamGames];
    const ids = new Set(steamGames.map(game => String(game.steamAppId || '')));
    rankedItems.forEach(item => { if (!ids.has(String(item.id))) result.push(rankingFallback(item)); });
    return result;
  }, [steamGames, rankedItems]);
  const boardKeys = Object.keys(boards).filter(key => key === 'topSelling' || key === 'mostPlayed' || key === 'steamDeck');
  const activeRegionLabel = regionOptions.find(item => item.value === activeRegion)?.label || '全球';
  const displayRegionLabel = activeBoard === 'topSelling' ? activeRegionLabel : '全球';
  const liveBoard = boards[activeBoard];
  const archiveBoards = chartPeriod === 'weekly' ? weeklyBoards : chartPeriod === 'monthly' ? monthlyBoards : yearlyBoards;
  const selectedSnapshot = archiveBoards.find(item => item.date === archiveLabel);
  const board = chartPeriod === 'live' ? liveBoard : selectedSnapshot?.board;
  const officialChartUrl = board?.url || `https://store.steampowered.com/charts/topselling/${activeRegion === 'global' ? 'global' : activeRegion}`;
  const findCatalogGame = (ranked: RankedGame) => connectedGames.find(game => String(game.steamAppId || '') === String(ranked.id))
    || connectedGames.find(game => normalized(game.name) === normalized(ranked.name) || normalized(game.englishName) === normalized(ranked.name))
    || rankingFallback(ranked);
  const rankingRows = useMemo(() => (board?.items || []).filter(item => item.name.toLocaleLowerCase().includes(rankingQuery.trim().toLocaleLowerCase())), [board, rankingQuery]);
  const genres = useMemo(() => ['全部', ...new Set(connectedGames.map(game => game.genre || '未分类'))], [connectedGames]);
  const filtered = useMemo(() => connectedGames.filter(game => {
    const text = [game.name, game.englishName, game.developer, game.publisher, ...game.tags].join(' ').toLocaleLowerCase();
    return text.includes(query.trim().toLocaleLowerCase()) && (genre === '全部' || game.genre === genre);
  }).sort((a, b) => sort === 'reviews' ? (b.reviewCount ?? -1) - (a.reviewCount ?? -1)
    : sort === 'release' ? b.releaseDate.localeCompare(a.releaseDate)
      : sort === 'players' ? (b.currentPlayers ?? -1) - (a.currentPlayers ?? -1)
        : (b.rating ?? -1) - (a.rating ?? -1)), [connectedGames, query, genre, sort]);
  useEffect(() => setPage(1), [query, genre, sort]);
  const pageSize = 12;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visibleGames = filtered.slice((page - 1) * pageSize, page * pageSize);

  const source = syncStatus?.sources?.steam;
  const chartNumber = (value: number) => value >= 1000000 ? `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1)}M`
    : value >= 1000 ? `${Math.round(value / 1000)}k` : String(value);
  const pieColors = ['#218fbd', '#37b89b', '#e0a14a', '#889aa3', '#d96e67'];
  const sampleCoverage = overview?.sample.coverage;
  const leaderCurrentTotal = overview?.sample.playerMarket.onlineLeaders.reduce((sum, item) => sum + item.current, 0) || 0;
  const leaderFirst = overview?.sample.playerMarket.onlineLeaders[0];
  const officialSignals = useMemo(() => {
    const selling = boards.topSelling?.items || [];
    const played = boards.mostPlayed?.items || [];
    const playedIds = new Set(played.map(item => item.id));
    return {
      overlap: selling.filter(item => playedIds.has(item.id)).length,
      newEntries: selling.filter(item => /new|新品|新上榜/i.test(item.change || '')).length,
      rising: selling.filter(item => item.change?.includes('▲') || /^\+/.test(item.change || '')).length,
      discounted: selling.filter(item => Boolean(item.discountText)).length
    };
  }, [boards]);

  return <div className="steam-workspace">
    <div className="steam-module-bar">
      <div className="steam-module-tabs" role="tablist" aria-label="Steam 专区模块">
        <button role="tab" aria-selected={module === 'rankings'} className={module === 'rankings' ? 'active' : ''} onClick={() => setModule('rankings')}><TrendingUp size={17} /><span><strong>排行榜</strong><small>发现市场机会</small></span></button>
        <button role="tab" aria-selected={module === 'data'} className={module === 'data' ? 'active' : ''} onClick={() => setModule('data')}><Database size={17} /><span><strong>数据</strong><small>整体与单款分析</small></span></button>
      </div>
      <div className="steam-module-tools"><div className="steam-status"><span className={`steam-sync-dot ${source?.state === 'error' ? 'error' : ''}`} /><span>{board?.fetchedAt ? `榜单更新于 ${new Date(board.fetchedAt).toLocaleString('zh-CN')}` : source?.lastSuccessAt ? `资料更新于 ${new Date(source.lastSuccessAt).toLocaleString('zh-CN')}` : '等待首次同步'}</span>{(rankingMessage || syncMessage) && <span>{rankingMessage || syncMessage}</span>}</div>{canSync && <button className="steam-sync" onClick={() => void updateSteamData()} disabled={rankingUpdating || syncStatus?.running}><RefreshCw size={15} className={rankingUpdating || syncStatus?.running ? 'ranking-spinning' : ''} />{rankingUpdating || syncStatus?.running ? '更新中' : '更新数据'}</button>}</div>
    </div>

    {module === 'rankings' && <section className="steam-chart-shell">
      <div className="steam-ranking-layout">
        <aside className="steam-ranking-nav" aria-label="榜单目录">
          <div><span>实时排行榜</span>{boardKeys.map(key => <button key={key} className={chartPeriod === 'live' && activeBoard === key ? 'active' : ''} onClick={() => { setChartPeriod('live'); setActiveBoard(key); setRankingQuery(''); }}>{boards[key].label.replace(' Top 100', '')}</button>)}</div>
          <div><span>每周排行榜</span>{weeklyBoards.map(snapshot => <button key={snapshot.date} className={chartPeriod === 'weekly' && archiveLabel === snapshot.date ? 'active' : ''} onClick={() => { setChartPeriod('weekly'); setArchiveLabel(snapshot.date); setRankingQuery(''); }}>{new Date(`${snapshot.date}T00:00:00`).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}</button>)}{!weeklyBoards.length && <small className="steam-nav-empty">暂无官方周榜</small>}</div>
          <div><span>月度最热新品</span>{monthlyBoards.map(snapshot => <button key={snapshot.date} className={chartPeriod === 'monthly' && archiveLabel === snapshot.date ? 'active' : ''} onClick={() => { setChartPeriod('monthly'); setArchiveLabel(snapshot.date); setRankingQuery(''); }}>{snapshot.board.label.replace('最热新品', '')}</button>)}{!monthlyBoards.length && <small className="steam-nav-empty">暂无月榜</small>}</div>
          <div><span>年度最佳</span>{yearlyBoards.map(snapshot => <button key={snapshot.date} className={chartPeriod === 'yearly' && archiveLabel === snapshot.date ? 'active' : ''} onClick={() => { setChartPeriod('yearly'); setArchiveLabel(snapshot.date); setRankingQuery(''); }}>{snapshot.date}</button>)}{!yearlyBoards.length && <small className="steam-nav-empty">暂无年榜</small>}</div>
        </aside>
        <div className="steam-ranking-content">
        {board ? <>
          <div className="steam-chart-toolbar"><div><span className="steam-kicker">{chartPeriod === 'weekly' ? 'WEEKLY CHARTS' : chartPeriod === 'monthly' ? 'MONTHLY RELEASES' : chartPeriod === 'yearly' ? 'BEST OF YEAR' : 'STEAM CHARTS'}</span><h2>{board.label || 'Steam 官方榜单'}</h2><p>{chartPeriod === 'live' ? `${displayRegionLabel} · 当前公开顺序` : `${activeRegionLabel} · Steam 官方${periodCopy[chartPeriod].label}`}；点击游戏查看站内数据。</p></div><div className="steam-chart-controls"><select className="steam-region" value={activeRegion} onChange={event => void changeRegion(event.target.value)} aria-label="选择 Steam 榜单地区" disabled={rankingUpdating}>{regionOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><label className="steam-search"><Search size={16} /><input value={rankingQuery} onChange={event => setRankingQuery(event.target.value)} placeholder="搜索榜单游戏" /></label></div></div>
          <div className="steam-board-head"><span>排名与游戏</span><span>价格</span><span>变化</span><span>在榜周数</span><span>操作</span></div>
          <div className="steam-board-list">{rankingRows.map(item => {
        const catalogGame = findCatalogGame(item);
        const url = item.url || `https://store.steampowered.com/app/${item.id}/`;
        return <div className="steam-board-row" key={`${activeBoard}-${item.id}-${item.rank}`}>
          <button className="steam-board-main" disabled={!catalogGame} onClick={() => catalogGame && onOpenGame(catalogGame)} title={catalogGame ? `查看${item.name}数据` : '该游戏详情尚未入库'}><b>{String(item.rank).padStart(2, '0')}</b><RankingCover game={item} /><span><strong>{item.name}</strong><small>{catalogGame ? [catalogGame.developer, catalogGame.rating != null ? `${catalogGame.rating}% 好评` : '暂无评价'].filter(Boolean).join(' · ') : '详情数据待补全'}</small></span></button>
          <span className="steam-board-price">{item.availabilityText || [item.discountText, item.priceText].filter(Boolean).join(' · ') || (catalogGame ? price(catalogGame) : '—')}</span>
          <span className={`steam-board-change ${item.change?.includes('▲') ? 'up' : item.change?.includes('▼') ? 'down' : ''}`}>{item.change || (chartPeriod === 'live' || chartPeriod === 'weekly' ? '新上榜' : '—')}</span>
          <span className="steam-board-weeks">{item.weeks || (chartPeriod === 'live' || chartPeriod === 'weekly' ? '1' : '—')}</span>
          <span className="steam-board-actions"><a href={url} target="_blank" rel="noreferrer" title="打开 Steam 商店" aria-label={`打开${item.name} Steam 商店`}><ExternalLink size={16} /></a></span>
        </div>;
          })}{!rankingRows.length && <div className="steam-empty">{board?.items?.length ? '没有匹配的榜单游戏' : '榜单正在加载'}</div>}</div>
        </> : <div className="steam-archive-prompt"><div><span>{chartPeriod === 'weekly' ? 'WEEKLY CHARTS' : chartPeriod === 'monthly' ? 'MONTHLY RELEASES' : 'BEST OF YEAR'}</span><h3>{archiveLabel ? `${archiveLabel} · ` : ''}{periodCopy[chartPeriod].title}</h3><p>{chartPeriod === 'weekly' ? `当前地区暂未返回${activeRegionLabel}官方周榜。` : `${periodCopy[chartPeriod].description}。该区域将在接入对应官方榜单后展示。`}</p></div><a href={officialChartUrl} target="_blank" rel="noreferrer">查看 Steam 官方榜单 <ExternalLink size={16} /></a></div>}
        <p className="steam-footnote">榜单与游戏档案通过 Steam App ID 关联；排名代表官方页面当次抓取结果，不等同于具体销量或收入。</p>
        </div>
      </div>
    </section>}

    {module === 'data' && <>
      <div className="steam-data-tabs" role="tablist" aria-label="数据视角"><button role="tab" aria-selected={dataView === 'overview'} className={dataView === 'overview' ? 'active' : ''} onClick={() => setDataView('overview')}>市场概览</button><button role="tab" aria-selected={dataView === 'library'} className={dataView === 'library' ? 'active' : ''} onClick={() => setDataView('library')}>游戏库</button></div>
      {dataView === 'overview' && <div className="steam-overview">
        {!overview && <div className="steam-overview-loading">{overviewLoading ? '正在读取项目缓存…' : '整体数据暂时不可用'}</div>}
        {overview && <>
          <section className="steam-platform-panel">
            <div className="steam-platform-title"><div><span>STEAM PLATFORM ACTIVITY</span><h2>Steam 全平台在线趋势</h2><p>Steam 官方在线人数，不等同于下方榜单游戏样本合计。</p></div><a href={overview.platform.sourceUrl} target="_blank" rel="noreferrer">官方数据源 <ExternalLink size={14} /></a></div>
            <div className="steam-platform-body"><div className="steam-platform-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={overview.platform.history.map(point => ({ time: new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit' }).format(new Date(point.capturedAt)), value: point.count }))} margin={{ top: 12, right: 10, bottom: 0, left: 4 }}><CartesianGrid stroke="#e9eff2" vertical={false} /><XAxis dataKey="time" minTickGap={45} tickLine={false} axisLine={false} tick={{ fill: '#899ba4', fontSize: 9 }} /><YAxis width={54} tickFormatter={chartNumber} tickLine={false} axisLine={false} tick={{ fill: '#899ba4', fontSize: 9 }} /><Tooltip formatter={value => [Number(value).toLocaleString('zh-CN'), '在线玩家']} contentStyle={{ borderRadius: 7, border: '1px solid #dce6e9', fontSize: 11 }} /><Line type="monotone" dataKey="value" stroke="#218fbd" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} /></LineChart></ResponsiveContainer></div><div className="steam-platform-kpis"><div><Activity size={18} /><span>当前在线</span><strong>{overview.platform.current.toLocaleString('zh-CN')}</strong><small>占本周期峰值 {overview.platform.peak ? Math.round(overview.platform.current / overview.platform.peak * 100) : 0}%</small></div><div><TrendingUp size={18} /><span>在线峰值</span><strong>{overview.platform.peak.toLocaleString('zh-CN')}</strong><small>{new Date(overview.platform.capturedAt).toLocaleString('zh-CN')} 采集</small></div></div></div>
          </section>
          <section className="steam-metrics" aria-label="榜单游戏样本概览">
            <div><Gamepad2 size={18} /><span>榜单游戏缓存</span><strong>{sampleCoverage?.games || 0}</strong><small>{sampleCoverage?.products || 0} 款有完整商品资料</small></div>
            <div><Star size={18} /><span>加权好评率</span><strong>{overview.sample.reviewMarket.positivePercent == null ? '—' : `${overview.sample.reviewMarket.positivePercent}%`}</strong><small>{number(overview.sample.reviewMarket.totalReviews)} 条简中评价汇总</small></div>
            <div><Users size={18} /><span>样本当前在线</span><strong>{number(overview.sample.playerMarket.current)}</strong><small>{sampleCoverage?.players || 0} 款取得在线数据</small></div>
            <div><Database size={18} /><span>评论样本</span><strong>{number(sampleCoverage?.reviewSamples || 0)}</strong><small>{sampleCoverage?.reviews || 0} 款取得具体评论</small></div>
          </section>
          <section className="steam-official-signals"><div><span>畅销 × 最热玩重合</span><strong>{officialSignals.overlap}</strong><small>{activeRegionLabel}畅销榜与全球最热玩共同上榜</small></div><div><span>畅销榜新上榜</span><strong>{officialSignals.newEntries}</strong><small>Steam 官方本期变化标记</small></div><div><span>排名上升</span><strong>{officialSignals.rising}</strong><small>当前榜单中的上升产品</small></div><div><span>正在折扣</span><strong>{officialSignals.discounted}</strong><small>当前畅销榜折扣产品</small></div></section>
          <div className="steam-insight-grid">
            <section className="steam-panel steam-wide-card"><div className="steam-analysis-head"><div><span>PLAYER CONCENTRATION</span><h2>榜单游戏在线领先</h2></div><small>当前 / 近 7 日均值 / 周期峰值</small></div><p className="steam-chart-description">这张表把即时在线与常态均值、周期峰值放在一起，回答“玩家现在集中在哪、热度是否异常”。<strong>当前读数：{leaderFirst ? `${leaderFirst.name} 以 ${leaderFirst.current.toLocaleString('zh-CN')} 人领先，占前列游戏当前在线合计的 ${leaderCurrentTotal ? Math.round(leaderFirst.current / leaderCurrentTotal * 100) : 0}%` : '暂无足够在线数据'}。</strong>开发时可据此估算竞品活跃量级和活动窗口，但同时在线不等于销量或独立用户。</p><div className="steam-overall-leaders">{overview.sample.playerMarket.onlineLeaders.map((game, index) => { const record = connectedGames.find(item => Number(item.steamAppId) === game.appId); return <button key={game.appId} onClick={() => record && onOpenGame(record)} disabled={!record}><b>{index + 1}</b>{game.image ? <img src={game.image} alt="" /> : <Gamepad2 size={25} />}<span><strong>{game.name}</strong><small>{game.positivePercent == null ? '暂无口碑' : `${game.positivePercent}% 好评`}</small></span><em>{game.current.toLocaleString('zh-CN')}<small>当前</small></em><em>{game.average?.toLocaleString('zh-CN') || '—'}<small>均值</small></em><em>{game.peak.toLocaleString('zh-CN')}<small>峰值</small></em></button>; })}</div></section>
            <section className="steam-panel steam-chart-card"><div className="steam-analysis-head"><div><span>GENRE SUPPLY</span><h2>类型供给结构</h2></div><small>单款可计入两个官方类型</small></div><p className="steam-chart-description">横柱统计榜单样本中带有该 Steam 官方类型的产品数，反映赛道供给密度而非需求规模。<strong>当前读数：{distributionLead(overview.sample.genreMix.slice(0, 8))}。</strong>高供给意味着已验证受众也意味着竞争拥挤，应再结合口碑、在线和新品增长判断机会。</p><div className="steam-visual-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={overview.sample.genreMix.slice(0, 8)} layout="vertical" margin={{ top: 8, right: 20, bottom: 0, left: 8 }}><CartesianGrid stroke="#edf2f3" horizontal={false} /><XAxis type="number" hide /><YAxis type="category" dataKey="name" width={72} tickLine={false} axisLine={false} tick={{ fill: '#667b84', fontSize: 10 }} /><Tooltip /><Bar dataKey="count" name="游戏数" fill="#2999c8" radius={[0, 4, 4, 0]} barSize={12} /></BarChart></ResponsiveContainer></div></section>
            <section className="steam-panel steam-chart-card"><div className="steam-analysis-head"><div><span>MONETIZATION MIX</span><h2>价格与发行状态</h2></div><small>当前榜单样本</small></div><p className="steam-chart-description">圆环按付费、免费、即将推出和价格待公布拆分当前产品，展示主流商业化入口。<strong>当前读数：{distributionLead(overview.sample.priceMix)}。</strong>这能帮助选择买断或免费运营参照组；它只代表榜单构成，不能直接说明哪种模式收入更高。</p><div className="steam-pie-layout"><div className="steam-pie"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={overview.sample.priceMix} dataKey="count" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2}>{overview.sample.priceMix.map((item, index) => <Cell key={item.name} fill={pieColors[index % pieColors.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></div><div className="steam-pie-legend">{overview.sample.priceMix.map((item, index) => <div key={item.name}><i style={{ background: pieColors[index % pieColors.length] }} /><span>{item.name}</span><strong>{item.count}</strong></div>)}</div></div></section>
            <section className="steam-panel steam-chart-card"><div className="steam-analysis-head"><div><span>REVIEW QUALITY</span><h2>口碑区间分布</h2></div><small>{sampleCoverage?.reviews || 0} 款有评价汇总</small></div><p className="steam-chart-description">横轴为简体中文好评率区间，纵轴为游戏数，用来判断样本整体口碑门槛和风险产品占比。<strong>当前读数：{distributionLead(overview.sample.reviewBands)}。</strong>这里按“游戏”计数，不按评论量加权；高好评产品多不等于整个市场销量更高。</p><div className="steam-visual-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={overview.sample.reviewBands} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}><CartesianGrid stroke="#edf2f3" vertical={false} /><XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: '#667b84', fontSize: 9 }} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#8799a1', fontSize: 9 }} /><Tooltip /><Bar dataKey="count" name="游戏数" fill="#37b89b" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></section>
            <section className="steam-panel steam-chart-card"><div className="steam-analysis-head"><div><span>PLAYER DEPTH</span><h2>评论玩家游玩时长</h2></div><small>{number(sampleCoverage?.reviewSamples || 0)} 条有效评论样本</small></div><p className="steam-chart-description">横轴按评论作者累计游玩时长分层，纵轴为通过质量过滤的玩家数，用作内容消耗深度的代理。<strong>当前读数：{distributionLead(overview.sample.playtimeBuckets, '位')}。</strong>长时玩家多通常对应长线内容或多人黏性，但评论玩家不是全体用户，不能直接当留存率。</p><div className="steam-visual-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={overview.sample.playtimeBuckets} margin={{ top: 8, right: 8, bottom: 0, left: -6 }}><CartesianGrid stroke="#edf2f3" vertical={false} /><XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: '#667b84', fontSize: 9 }} /><YAxis tickFormatter={chartNumber} tickLine={false} axisLine={false} tick={{ fill: '#8799a1', fontSize: 9 }} /><Tooltip /><Bar dataKey="count" name="评论玩家数" fill="#e0a14a" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></section>
            <section className="steam-panel steam-chart-card"><div className="steam-analysis-head"><div><span>PRODUCT FEATURES</span><h2>玩法与功能配置</h2></div><small>Steam 官方产品分类</small></div><p className="steam-chart-description">横柱统计单人、多人、合作、控制器、家庭共享等官方功能覆盖数，展示头部产品的常见能力组合。<strong>当前读数：{distributionLead(overview.sample.featureMix.slice(0, 8))}。</strong>可用于整理竞品功能基线和排期优先级，但功能出现频繁不代表它单独驱动成功。</p><div className="steam-visual-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={overview.sample.featureMix.slice(0, 8)} layout="vertical" margin={{ top: 8, right: 20, bottom: 0, left: 18 }}><CartesianGrid stroke="#edf2f3" horizontal={false} /><XAxis type="number" hide /><YAxis type="category" dataKey="name" width={86} tickLine={false} axisLine={false} tick={{ fill: '#667b84', fontSize: 9 }} /><Tooltip /><Bar dataKey="count" name="游戏数" fill="#667fbc" radius={[0, 4, 4, 0]} barSize={12} /></BarChart></ResponsiveContainer></div></section>
            <section className="steam-panel steam-chart-card"><div className="steam-analysis-head"><div><span>PUBLISHER CONCENTRATION</span><h2>发行商供给集中度</h2></div><small>发行产品数 Top 8</small></div><p className="steam-chart-description">横柱统计同一发行商进入样本的产品数，观察头部厂商在当前榜单中的供给占位。<strong>当前读数：{distributionLead(overview.sample.publisherMix.slice(0, 8))}。</strong>它适合识别重点对标厂商和发行密度，不代表这些厂商的单款销量、收入或成功率。</p><div className="steam-visual-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={overview.sample.publisherMix.slice(0, 8)} layout="vertical" margin={{ top: 8, right: 20, bottom: 0, left: 18 }}><CartesianGrid stroke="#edf2f3" horizontal={false} /><XAxis type="number" hide /><YAxis type="category" dataKey="name" width={105} tickLine={false} axisLine={false} tick={{ fill: '#667b84', fontSize: 9 }} /><Tooltip /><Bar dataKey="count" name="游戏数" fill="#d98963" radius={[0, 4, 4, 0]} barSize={12} /></BarChart></ResponsiveContainer></div></section>
            <section className="steam-panel steam-chart-card"><div className="steam-analysis-head"><div><span>DISCOUNT DEPTH</span><h2>折扣深度结构</h2></div><small>当前商品价格状态</small></div><p className="steam-chart-description">柱状图按当前折扣百分比分组，观察促销覆盖、折扣深度以及榜单热度对降价的依赖。<strong>当前读数：{distributionLead(overview.sample.discountMix)}。</strong>若深折扣集中，可进一步比较折扣前后排名与在线变化；当前截面本身不能证明折扣带来的增量。</p><div className="steam-visual-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={overview.sample.discountMix} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}><CartesianGrid stroke="#edf2f3" vertical={false} /><XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: '#667b84', fontSize: 9 }} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#8799a1', fontSize: 9 }} /><Tooltip /><Bar dataKey="count" name="游戏数" fill="#4ea8a0" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></section>
          </div>
          <p className="steam-overview-note">Steam 全平台在线来自官方榜单概览；榜单游戏在线趋势来自已缓存的 SteamCharts 公开历史采样。评论数量、好评率和玩家游玩时长均不能直接推算销量或收入。</p>
        </>}
      </div>}
      {dataView === 'library' && <section className="steam-panel steam-library-panel">
        <div className="steam-panel-head"><div><span>GAME LIBRARY</span><h2>Steam 游戏库</h2></div><strong>{filtered.length} 款</strong></div>
        <div className="steam-filters"><label><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索游戏、开发商或标签" /></label><select value={genre} onChange={event => setGenre(event.target.value)}>{genres.map(item => <option key={item}>{item === '全部' ? '全部类型' : item}</option>)}</select><select value={sort} onChange={event => setSort(event.target.value)}><option value="reviews">热度优先</option><option value="rating">好评率优先</option><option value="players">在线人数优先</option><option value="release">最新发行</option></select></div>
        <div className="steam-card-grid">{visibleGames.map(game => <button className="steam-game-card" key={game.id} onClick={() => onOpenGame(game)}><SteamCover game={game} /><div className="steam-card-body"><h3>{game.name}</h3><p>{game.developer || '开发商待补全'}</p><div><span>{game.genre || '未分类'}</span><span>{game.rating == null ? '暂无评价' : `${game.rating}% 好评`}</span></div><footer><strong>{price(game)}</strong><small>{game.currentPlayers != null ? `${number(game.currentPlayers)} 在线` : game.releaseDate || '日期待补全'}</small></footer></div></button>)}</div>
        {!filtered.length && <div className="steam-empty">没有找到匹配的 Steam 游戏</div>}
        {filtered.length > pageSize && <div className="steam-pagination"><span>第 {page} / {totalPages} 页</span><div><button disabled={page === 1} onClick={() => setPage(value => value - 1)}>上一页</button><button disabled={page === totalPages} onClick={() => setPage(value => value + 1)}>下一页</button></div></div>}
      </section>}
    </>}
  </div>;
}
