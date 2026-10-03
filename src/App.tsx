import { useEffect, useMemo, useRef, useState } from 'react';
import type { WheelEvent as ReactWheelEvent } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownUp, ArrowLeftRight, ArrowUpRight, BarChart3, Check, ChevronDown, ChevronRight, CircleHelp, ClipboardList, Database, ExternalLink, Gamepad2, LayoutDashboard, LogOut, Menu, Newspaper, Plus, Radio, RefreshCw, Search, ShieldAlert, SlidersHorizontal, Trophy, TrendingUp, Trash2, Upload, X } from 'lucide-react';
import type { Game, GameInput, Project } from './types';
import './catalog.css';
import ProjectWorkspace from './ProjectWorkspace';
import InvestmentDashboard from './InvestmentDashboard';
import InvestmentCompare from './InvestmentCompare';
import RiskCenter from './RiskCenter';
import RankingWorkspace from './RankingWorkspace';
import SteamWorkspace from './SteamWorkspace';
import { apiFetch, useAuth } from './auth';
import { apiUrl } from './api-url';

type View = 'steam' | 'dashboard' | 'projects' | 'benchmark' | 'risks' | 'library' | 'analytics' | 'catalogCompare' | 'rankings' | 'profitBreakdown';
type CatalogSyncStatus = { running?: boolean; finishedAt?: string; sources?: Record<string, { url: string; state: string; lastSuccessAt?: string; fetched?: number; added?: number; updated?: number; error?: string; warnings?: string[] }> };
type RankingMatch = { platform: string; board: string; rank: number };
type RankingResponse = { platforms?: Record<string, { label?: string; boards?: Record<string, { label?: string; items?: Array<{ rank: number; url: string }> }> }> };
type SteamReview = { id: string; recommended: boolean; text: string; createdAt: string; playtimeForeverHours: number; playtimeAtReviewHours: number; playtimeTwoWeeksHours: number; gamesOwned: number; reviewsCount: number; votesUp: number; votesFunny: number; commentCount: number; steamPurchase: boolean; receivedForFree: boolean };
type SteamGameDetailData = { appId: number; capturedAt: string; cache?: { state: 'fresh' | 'stale'; savedAt: string }; product: { name: string; shortDescription: string; about: string; headerImage: string; website: string; developers: string[]; publishers: string[]; releaseDate: string; comingSoon: boolean; price: { text: string; originalText?: string; discountPercent: number }; genres: string[]; categories: string[]; platforms: string[]; controllerSupport: string; supportedLanguages: string[]; pcRequirements: { minimum: string; recommended: string }; legalNotice: string; contentNotice: string; screenshots: string[]; recommendationsTotal: number; metacritic: number | null }; reviews: { summary: { total: number; positive: number; negative: number; positivePercent: number | null; score: string }; quality?: { fetched: number | null; valuable: number; filtered: number | null; retentionRate: number | null; filterVersion: number }; items: SteamReview[] }; players: { current: number | null; history: Array<{ capturedAt: string; count: number }> }; sources: { product: string; reviews: string; players: string } };
const initialParams = new URLSearchParams(window.location.search);
const requestedView = initialParams.get('view');
const initialView: View = requestedView && ['steam', 'dashboard', 'projects', 'benchmark', 'risks', 'library', 'analytics', 'catalogCompare', 'rankings', 'profitBreakdown'].includes(requestedView)
  ? requestedView as View : initialParams.get('q') ? 'library' : 'steam';
const palette = ['#e9a236', '#37a89b', '#687dd8', '#e16f72', '#889db2', '#b37ac5'];
const emptyGame: GameInput = { channel: '端游', name: '', englishName: '', genre: '', platforms: [], releaseDate: '', developer: '', publisher: '', price: null, rating: null, reviewCount: null, peakPlayers: null, tags: [], description: '', steamAppId: null, sourceUrl: '', isDemo: false };

function formatNumber(value: number | null) {
  if (value === null) return '未录入';
  if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}万`;
  return value.toLocaleString('zh-CN');
}
function formatPrice(value: number | null) { return value === null ? '未录入' : `¥${value}`; }
function formatUsd(value: number | null | undefined) { return value == null ? '未录入' : `$${value.toFixed(2)}`; }
function formatSteamPrice(game: Game) { return game.metricScope?.includes('美元') ? formatUsd(game.price) : formatPrice(game.price); }
function formatDateTime(value?: string) {
  if (!value) return '尚未采集';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai' }).format(new Date(value));
}
function sourceHost(url: string) {
  try { return new URL(url).hostname.toLowerCase(); }
  catch { return ''; }
}
function isAppStoreUrl(url: string) { return sourceHost(url) === 'apps.apple.com'; }
function sourceName(game: Game) {
  if (isAppStoreUrl(game.sourceUrl)) return 'Apple App Store 美国区';
  if (sourceHost(game.sourceUrl) === 'store.steampowered.com') return 'Steam（海外）';
  if (sourceHost(game.sourceUrl) === 'sj.qq.com') return '腾讯应用宝';
  if (sourceHost(game.sourceUrl) === 'www.taptap.cn') return 'TapTap';
  if (sourceHost(game.sourceUrl) === 'play.google.com') return 'Google Play';
  if (sourceHost(game.sourceUrl) === 'store.playstation.com') return 'PlayStation Store';
  if (sourceHost(game.sourceUrl) === 'www.xbox.com') return 'Xbox';
  if (sourceHost(game.sourceUrl) === 'www.nintendo.com') return 'Nintendo';
  return game.sourceUrl ? '其他来源' : '未录入';
}
function isSteamRecord(game: Game) { return sourceHost(game.sourceUrl) === 'store.steampowered.com'; }
function channelLabel(value: string) { return value === '小游戏' ? '微信小游戏' : value; }

function rankingKey(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === 'sj.qq.com') {
      const id = parsed.pathname.match(/\/appdetail\/(wx[0-9a-f]{16})/i)?.[1];
      return id ? `wechat:${id.toLowerCase()}` : '';
    }
    if (host === 'apps.apple.com') {
      const id = parsed.pathname.match(/\/id(\d+)/)?.[1];
      return id ? `apple:${id}` : '';
    }
    if (host === 'www.taptap.cn') {
      const id = parsed.pathname.match(/^\/app\/(\d+)/)?.[1];
      return id ? `taptap:${id}` : '';
    }
    if (host === 'store.steampowered.com') {
      const id = parsed.pathname.match(/^\/app\/(\d+)/)?.[1];
      return id ? `steam:${id}` : '';
    }
  } catch { /* Invalid source links cannot be associated with a public ranking. */ }
  return '';
}

function RankingStatus({ game, matches }: { game: Game; matches: RankingMatch[] }) {
  if (matches.length) return <div className="catalog-ranking-status">{matches.slice(0, 3).map(match => <span key={`${match.platform}-${match.board}`}>{match.board} #{match.rank}</span>)}</div>;
  if (rankingKey(game.sourceUrl)) return <span className="catalog-ranking-none">当前未进入公开榜</span>;
  return <span className="catalog-ranking-unavailable">暂无对应公开榜</span>;
}

function gameCover(game: Game) {
  return game.iconUrl || (game.steamAppId ? `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${game.steamAppId}/header.jpg` : '');
}

function Cover({ game, className = '' }: { game: Game; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = gameCover(game);
  const formatClass = game.channel === '端游' ? 'cover-landscape' : 'cover-square';
  return <div className={`cover ${formatClass} ${className}`}>
    {src && !failed ? <img src={src} alt={`${game.name} 封面`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <Gamepad2 size={28} />}
  </div>;
}

function MetricSource({ game }: { game: Game }) {
  return <div className="source-details">
    <div><span>数据来源</span><strong>{sourceName(game)}</strong></div>
    <div><span>采集日期</span><strong>{game.dataAsOf || '未录入'}</strong></div>
    <div><span>指标口径</span><strong>{game.metricScope || '未录入'}</strong></div>
    <div className="source-links">
      {game.sourceUrl && <a href={game.sourceUrl} target="_blank" rel="noreferrer">商品来源 <ExternalLink size={13} /></a>}
      {game.metricsSourceUrl && <a href={game.metricsSourceUrl} target="_blank" rel="noreferrer">指标来源 <ExternalLink size={13} /></a>}
      {game.peakSourceUrl && <a href={game.peakSourceUrl} target="_blank" rel="noreferrer">SteamCharts 峰值 · {formatDateTime(game.peakCapturedAt)} <ExternalLink size={13} /></a>}
    </div>
  </div>;
}

function GameDetail({ game, matches, onClose }: { game: Game; matches: RankingMatch[]; onClose: () => void }) {
  const steam = isSteamRecord(game);
  const appStore = isAppStoreUrl(game.sourceUrl);
  const hasSteamDetail = steam && Number.isSafeInteger(game.steamAppId) && Number(game.steamAppId) > 0;
  const [steamDetail, setSteamDetail] = useState<SteamGameDetailData | null>(null);
  const [steamDetailError, setSteamDetailError] = useState('');
  const [steamDetailLoading, setSteamDetailLoading] = useState(hasSteamDetail);
  const [detailPane, setDetailPane] = useState<'product' | 'reviews' | 'analysis'>('product');
  const detailBodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    const previousRootOverflow = root.style.overflow;
    const previousRootOverscroll = root.style.overscrollBehavior;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyOverscroll = document.body.style.overscrollBehavior;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    root.style.overflow = 'hidden';
    root.style.overscrollBehavior = 'none';
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      root.style.overflow = previousRootOverflow;
      root.style.overscrollBehavior = previousRootOverscroll;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.overscrollBehavior = previousBodyOverscroll;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, []);
  useEffect(() => {
    if (!hasSteamDetail || !game.steamAppId) return;
    let active = true;
    setSteamDetailLoading(true); setSteamDetailError(''); setSteamDetail(null);
    apiFetch(`/api/steam/games/${game.steamAppId}`).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Steam 资料读取失败');
      if (active) setSteamDetail(result);
    }).catch(cause => { if (active) setSteamDetailError(cause instanceof Error ? cause.message : 'Steam 资料读取失败'); })
      .finally(() => { if (active) setSteamDetailLoading(false); });
    return () => { active = false; };
  }, [game.steamAppId, hasSteamDetail]);
  const positioning = game.description
    ? game.description.split(/[。！？!?\n]/).find(Boolean)?.trim()
    : `收录于${sourceName(game)}公开目录的${game.genre && game.genre !== '未分类' ? `${game.genre}类` : ''}${channelLabel(game.channel)}，当前公开资料较少。`;
  const facts = [
    ['产品分类', channelLabel(game.channel)], ['游戏类型', game.genre || '未分类'],
    ['覆盖平台', game.platforms.join('、') || '未录入'], ['开发商', game.developer || '未公开'],
    ['发行商', game.publisher || '未公开'], ['发行日期', game.releaseDate || '未公开'],
    ['数据来源', sourceName(game)], ['采集日期', game.dataAsOf || '未录入']
  ];
  const metrics = steamDetail ? [
    ['当前价格', steamDetail.product.price.text], ['玩家口碑', steamDetail.reviews.summary.positivePercent == null ? '暂无评价' : `${steamDetail.reviews.summary.positivePercent}% 好评`],
    ['中文评论', steamDetail.reviews.summary.total ? steamDetail.reviews.summary.total.toLocaleString('zh-CN') : '暂无评论'], ['发行状态', steamDetail.product.comingSoon ? `即将推出 · ${steamDetail.product.releaseDate}` : steamDetail.product.releaseDate || '已发行']
  ] : steam ? [
    [game.metricScope?.includes('美元') ? '美国区售价' : '中国区售价', formatSteamPrice(game)], ['Steam 好评率', game.rating === null ? '未录入' : `${game.rating}%`],
    ['评价数量', formatNumber(game.reviewCount)], ['历史峰值在线', formatNumber(game.peakPlayers)]
  ] : appStore ? [
    ['美国区售价', formatUsd(game.sourceExtras?.usPriceUsd)],
    ['五星评分', game.sourceExtras?.usRatingOutOf5 == null ? '未录入' : `${game.sourceExtras.usRatingOutOf5.toFixed(1)} / 5`],
    ['评分数量', formatNumber(game.sourceExtras?.usRatingCount ?? null)], ['当前公开榜', matches[0] ? `${matches[0].board} #${matches[0].rank}` : '未进入公开榜']
  ] : [
    ['当前公开榜', matches[0] ? `${matches[0].board} #${matches[0].rank}` : '未进入公开榜'],
    ['榜单平台', matches[0]?.platform || '暂无公开榜'], ['商品平台', game.platforms[0] || '未录入'], ['资料状态', game.description ? '已有简介' : '基础资料']
  ];
  const reviewAnalysis = useMemo(() => {
    if (!steamDetail) return null;
    const items = steamDetail.reviews.items;
    const recommended = items.filter(item => item.recommended).length;
    const negative = items.length - recommended;
    const averagePlaytime = items.length ? items.reduce((total, item) => total + item.playtimeForeverHours, 0) / items.length : null;
    const sortedPlaytime = items.map(item => item.playtimeForeverHours).sort((a, b) => a - b);
    const medianPlaytime = sortedPlaytime.length ? sortedPlaytime[Math.floor(sortedPlaytime.length / 2)] : null;
    const engagement = {
      light: items.filter(item => item.playtimeForeverHours < 10).length,
      regular: items.filter(item => item.playtimeForeverHours >= 10 && item.playtimeForeverHours < 100).length,
      heavy: items.filter(item => item.playtimeForeverHours >= 100).length
    };
    const playtimeBuckets = [
      { name: '<10h', label: '快速体验', value: items.filter(item => item.playtimeForeverHours < 10).length },
      { name: '10–50h', label: '完成核心内容', value: items.filter(item => item.playtimeForeverHours >= 10 && item.playtimeForeverHours < 50).length },
      { name: '50–100h', label: '稳定投入', value: items.filter(item => item.playtimeForeverHours >= 50 && item.playtimeForeverHours < 100).length },
      { name: '100–500h', label: '深度玩家', value: items.filter(item => item.playtimeForeverHours >= 100 && item.playtimeForeverHours < 500).length },
      { name: '500h+', label: '核心用户', value: items.filter(item => item.playtimeForeverHours >= 500).length }
    ];
    const directPurchases = items.filter(item => item.steamPurchase).length;
    const receivedForFree = items.filter(item => item.receivedForFree).length;
    const helpfulVotes = items.reduce((total, item) => total + item.votesUp, 0);
    const averageGamesOwned = items.length ? Math.round(items.reduce((total, item) => total + item.gamesOwned, 0) / items.length) : null;
    const experiencedReviewers = items.filter(item => item.reviewsCount >= 10).length;
    const recentlyActive = items.filter(item => item.playtimeTwoWeeksHours > 0).length;
    const positivePercent = steamDetail.reviews.summary.positivePercent;
    const total = steamDetail.reviews.summary.total;
    const overallPositive = steamDetail.reviews.summary.positive;
    const overallNegative = steamDetail.reviews.summary.negative;
    const riskDefinitions = [
      ['作弊与外挂', /作弊|外挂|反作弊|开挂|anti.?cheat/i],
      ['性能与优化', /优化|卡顿|崩溃|掉帧|帧数|性能/i],
      ['服务器与匹配', /服务器|网络|延迟|掉线|匹配/i],
      ['付费与权益', /退款|付费|氪|礼包|会员|founder|价格|购买/i],
      ['地区与账号', /地区|锁区|账号|账户|region|china/i]
    ] as const;
    const risks = riskDefinitions.map(([label, pattern]) => ({ label, count: items.filter(item => pattern.test(item.text)).length })).filter(item => item.count > 0);
    const sentiment = positivePercent == null ? '暂无足够口碑数据' : positivePercent >= 85 ? '玩家口碑强，正向反馈稳定' : positivePercent >= 70 ? '整体口碑偏正向，仍有改进空间' : positivePercent >= 50 ? '口碑存在分歧，需要继续核查负面反馈' : '负向反馈较集中，建议谨慎评估';
    const validation = total >= 100000 ? '评论规模很大，口碑结论具有较强参考性' : total >= 1000 ? '已有一定评论规模，可用于初步市场验证' : total >= 100 ? '评论样本正在形成，适合持续观察' : '公开评论较少，暂不宜据此作单一结论';
    const conclusion = positivePercent == null ? '等待更多数据' : positivePercent >= 85 && total >= 1000 ? '具备成熟口碑验证' : positivePercent >= 70 ? '具备初步验证价值' : '建议进入风险复核';
    const recommendationRate = items.length ? Math.round(recommended / items.length * 100) : null;
    const purchaseRate = items.length ? Math.round(directPurchases / items.length * 100) : null;
    const corePlayerRate = items.length ? Math.round(engagement.heavy / items.length * 100) : null;
    const shortSession = items.filter(item => item.playtimeAtReviewHours < 10);
    const veteranPlayers = items.filter(item => item.playtimeForeverHours >= 100);
    const earlyNegativeCount = shortSession.filter(item => !item.recommended).length;
    const veteranNegativeCount = veteranPlayers.filter(item => !item.recommended).length;
    const earlyNegativeRate = shortSession.length ? Math.round(earlyNegativeCount / shortSession.length * 100) : null;
    const veteranNegativeRate = veteranPlayers.length ? Math.round(veteranNegativeCount / veteranPlayers.length * 100) : null;
    const recentActivityRate = items.length ? Math.round(recentlyActive / items.length * 100) : null;
    const chronological = [...items].filter(item => item.createdAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const bucketSize = Math.max(1, Math.ceil(chronological.length / 12));
    const reviewTrend = Array.from({ length: Math.ceil(chronological.length / bucketSize) }, (_, index) => {
      const bucket = chronological.slice(index * bucketSize, (index + 1) * bucketSize);
      const bucketRecommended = bucket.filter(item => item.recommended).length;
      const last = bucket[bucket.length - 1];
      return { date: last?.createdAt ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Shanghai' }).format(new Date(last.createdAt)) : `${index + 1}`, rate: bucket.length ? Math.round(bucketRecommended / bucket.length * 100) : 0, count: bucket.length };
    });
    return { items: items.length, recommended, negative, averagePlaytime, medianPlaytime, engagement, playtimeBuckets, directPurchases, receivedForFree, helpfulVotes, averageGamesOwned, experiencedReviewers, recentlyActive, positivePercent, overallPositive, overallNegative, risks, sentiment, validation, conclusion, recommendationRate, purchaseRate, corePlayerRate, reviewTrend, earlyNegativeRate, veteranNegativeRate, earlyNegativeCount, veteranNegativeCount, recentActivityRate, shortSessionCount: shortSession.length, veteranCount: veteranPlayers.length };
  }, [steamDetail]);
  const playerAnalysis = useMemo(() => {
    const history = (steamDetail?.players.history || []).filter(point => point.count > 0);
    if (!history.length) return null;
    const values = history.map(point => point.count);
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    const peak = Math.max(...values);
    const low = Math.min(...values);
    const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
    const volatility = average ? Math.round(Math.sqrt(variance) / average * 100) : 0;
    const current = values.at(-1) || 0;
    const currentVsAverage = average ? Math.round((current - average) / average * 100) : 0;
    const hourBuckets = Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0, count: 0 }));
    history.forEach(point => {
      const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Shanghai' }).formatToParts(new Date(point.capturedAt));
      const hour = Number(parts.find(part => part.type === 'hour')?.value || 0);
      hourBuckets[hour].total += point.count;
      hourBuckets[hour].count += 1;
    });
    const hourly = hourBuckets.filter(item => item.count).map(item => ({ name: `${String(item.hour).padStart(2, '0')}:00`, value: Math.round(item.total / item.count), hour: item.hour }));
    const peakHour = hourly.reduce((best, item) => !best || item.value > best.value ? item : best, null as null | typeof hourly[number]);
    return { current, average: Math.round(average), peak, low, volatility, currentVsAverage, hourly, peakHour };
  }, [steamDetail]);
  function switchDetailPane(next: 'product' | 'reviews' | 'analysis') {
    setDetailPane(next);
    detailBodyRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }
  function containModalWheel(event: ReactWheelEvent<HTMLElement>) {
    if ((event.target as Element).closest('.game-detail-body')) return;
    event.preventDefault();
    event.stopPropagation();
    detailBodyRef.current?.scrollBy({ top: event.deltaY, left: 0, behavior: 'auto' });
  }
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <article className="modal game-detail-modal" role="dialog" aria-modal="true" aria-label={`${game.name}游戏详情`} onMouseDown={event => event.stopPropagation()} onWheel={containModalWheel}>
      <header className="game-detail-hero">{steamDetail?.product.headerImage ? <div className="cover cover-landscape game-detail-cover"><img src={steamDetail.product.headerImage} alt={`${steamDetail.product.name}封面`} /></div> : <Cover game={game} className="game-detail-cover" />}<div><span className="eyebrow">{hasSteamDetail ? 'STEAM PRODUCT & REVIEWS' : 'GAME PROFILE'}</span><h2>{steamDetail?.product.name || game.name}</h2>{game.englishName && game.englishName !== game.name && <p>{game.englishName}</p>}<p className="game-detail-positioning">{steamDetail?.product.shortDescription || positioning}</p><div className="game-detail-badges"><span>{channelLabel(game.channel)}</span>{(steamDetail?.product.genres || [game.genre || '未分类']).slice(0, 4).map(item => <span key={item}>{item}</span>)}</div></div><div className="game-detail-hero-actions">{steamDetail && <div className="game-detail-view-switch" role="tablist" aria-label="游戏详情视图"><button role="tab" aria-selected={detailPane === 'product'} className={detailPane === 'product' ? 'active' : ''} onClick={() => switchDetailPane('product')}><Gamepad2 size={16} />产品信息</button><button role="tab" aria-selected={detailPane === 'reviews'} className={detailPane === 'reviews' ? 'active' : ''} onClick={() => switchDetailPane('reviews')}><ClipboardList size={16} />玩家评论</button><button role="tab" aria-selected={detailPane === 'analysis'} className={detailPane === 'analysis' ? 'active' : ''} onClick={() => switchDetailPane('analysis')}><BarChart3 size={16} />数据分析</button></div>}</div></header>
      <div className="game-detail-body" ref={detailBodyRef}>
        {steamDetailLoading && <div className="steam-detail-state"><RefreshCw className="ranking-spinning" size={18} />正在读取 Steam 商品资料与玩家评论…</div>}
        {steamDetailError && <div className="steam-detail-state error"><ShieldAlert size={18} />{steamDetailError}</div>}
        <div key={detailPane} className={`game-detail-pane ${detailPane === 'analysis' ? 'slide-from-right' : 'slide-from-left'}`}>
        {detailPane === 'product' && <><section className="game-detail-metrics" aria-label="关键指标">{metrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>
        {steamDetail ? <>
          <section className="game-detail-section"><h3>产品资料</h3><div className="game-detail-facts"><div><span>开发商</span><strong>{steamDetail.product.developers.join('、') || '未公开'}</strong></div><div><span>发行商</span><strong>{steamDetail.product.publishers.join('、') || '未公开'}</strong></div><div><span>平台</span><strong>{steamDetail.product.platforms.join('、') || '未公开'}</strong></div><div><span>控制器支持</span><strong>{steamDetail.product.controllerSupport || '未标注'}</strong></div></div></section>
          {steamDetail.product.screenshots.length > 0 && <section className="game-detail-section"><h3>产品画面</h3><div className="steam-detail-gallery">{steamDetail.product.screenshots.slice(0, 4).map((image, index) => <img key={image} src={image} alt={`${steamDetail.product.name}产品画面${index + 1}`} loading="lazy" />)}</div></section>}
          <section className="game-detail-section"><h3>游戏介绍</h3><p>{steamDetail.product.about || steamDetail.product.shortDescription || 'Steam 暂未提供详细介绍。'}</p></section>
          <section className="game-detail-section"><h3>玩法与功能</h3><div className="game-detail-tags">{steamDetail.product.categories.map(item => <span key={item}>{item}</span>)}</div></section>
          <section className="game-detail-section"><h3>语言支持</h3><div className="steam-language-list">{steamDetail.product.supportedLanguages.map(item => <span key={item}>{item}</span>)}</div></section>
          {(steamDetail.product.pcRequirements.minimum || steamDetail.product.pcRequirements.recommended) && <section className="game-detail-section"><h3>PC 配置要求</h3><div className="steam-requirements"><div><strong>最低配置</strong><p>{steamDetail.product.pcRequirements.minimum || '未公开'}</p></div><div><strong>推荐配置</strong><p>{steamDetail.product.pcRequirements.recommended || '未公开'}</p></div></div></section>}
          {(steamDetail.product.legalNotice || steamDetail.product.contentNotice) && <section className="game-detail-section steam-risk-note"><h3>发行与内容提示</h3>{steamDetail.product.legalNotice && <p>{steamDetail.product.legalNotice}</p>}{steamDetail.product.contentNotice && <p>{steamDetail.product.contentNotice}</p>}</section>}
          <section className="game-detail-section"><h3>数据来源</h3><p>商品资料与评论均来自 Steam 公开接口，评论保留推荐态、正文与玩家游玩时长；采集于 {formatDateTime(steamDetail.capturedAt)}。</p><div className="game-detail-links"><a href={steamDetail.sources.product} target="_blank" rel="noreferrer">Steam 商品页 <ExternalLink size={14} /></a><a href={`https://steamcommunity.com/app/${steamDetail.appId}/reviews/`} target="_blank" rel="noreferrer">全部玩家评测 <ExternalLink size={14} /></a><a href={`https://steamcommunity.com/app/${steamDetail.appId}/discussions/`} target="_blank" rel="noreferrer">社区讨论 <ExternalLink size={14} /></a></div></section>
        </> : !steamDetailLoading && <>
          <section className="game-detail-section"><h3>基础资料</h3><div className="game-detail-facts">{facts.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></section>
          <section className="game-detail-section"><h3>游戏简介</h3><p>{game.description || '当前公开来源暂未提供游戏简介。'}</p></section>
          {game.tags.length > 0 && <section className="game-detail-section"><h3>标签</h3><div className="game-detail-tags">{game.tags.map(tag => <span key={tag}>{tag}</span>)}</div></section>}
          <section className="game-detail-section"><h3>来源与口径</h3><p>{game.metricScope || '当前仅收录公开商品基础资料。'}</p><div className="game-detail-links">{game.sourceUrl && <a href={game.sourceUrl} target="_blank" rel="noreferrer">查看商品来源 <ExternalLink size={14} /></a>}{game.metricsSourceUrl && <a href={game.metricsSourceUrl} target="_blank" rel="noreferrer">查看指标来源 <ExternalLink size={14} /></a>}</div></section>
        </>}</>}
        {detailPane === 'reviews' && steamDetail && <section className="steam-review-pane">
          <div className="steam-review-heading">
            <div><span className="eyebrow">PLAYER REVIEWS</span><h3>真实玩家评论</h3><p>{steamDetail.reviews.summary.score} · 共 {steamDetail.reviews.summary.total.toLocaleString('zh-CN')} 篇简体中文公开评论；下方只展示通过信息量筛选的近期样本</p></div>
            <strong>{steamDetail.reviews.summary.positivePercent == null ? '暂无评分' : `${steamDetail.reviews.summary.positivePercent}% 好评`}</strong>
          </div>
          {(() => {
            const fetched = steamDetail.reviews.quality?.fetched;
            const valuable = steamDetail.reviews.items.length;
            const filtered = steamDetail.reviews.quality?.filtered;
            const retentionRate = steamDetail.reviews.quality?.retentionRate;
            const qualityMetrics = [
              { label: '本次抓取', value: fetched == null ? '待更新' : `${fetched} 条`, percent: fetched == null ? 0 : 100, color: '#2f9ec8', note: 'Steam 返回的近期评论总量' },
              { label: '有效评论', value: `${valuable} 条`, percent: fetched ? Math.round(valuable / fetched * 100) : 0, color: '#2eaa94', note: '通过信息量筛选并用于分析' },
              { label: '过滤评论', value: filtered == null ? '待更新' : `${filtered} 条`, percent: fetched && filtered != null ? Math.round(filtered / fetched * 100) : 0, color: '#e5968c', note: '过短、重复或缺少具体信息' },
              { label: '有效率', value: retentionRate == null ? '待更新' : `${retentionRate}%`, percent: retentionRate || 0, color: '#557bc0', note: '有效评论占本次抓取比例' }
            ];
            return <div className="steam-review-quality-rings">
              {qualityMetrics.map(metric => <article key={metric.label}>
                <div className="steam-review-quality-ring" style={{ background: `conic-gradient(${metric.color} 0 ${metric.percent}%, #e9efef ${metric.percent}% 100%)` }}>
                  <div><strong>{metric.value}</strong><span>{metric.label}</span></div>
                </div>
                <p>{metric.note}</p>
              </article>)}
              <em>{valuable >= 50 ? '样本充足：可观察主要体验问题与玩家结构。' : valuable >= 30 ? '样本可用：适合作方向性判断。' : valuable >= 10 ? '样本偏少：结论需要谨慎解读。' : '样本不足：暂时不宜形成结论。'}</em>
            </div>;
          })()}
          {steamDetail.reviews.items.length ? <div className="steam-review-list">{steamDetail.reviews.items.map(review => <article className="steam-review-card" key={review.id}><header><strong className={review.recommended ? 'positive' : 'negative'}>{review.recommended ? '推荐' : '不推荐'}</strong><span>总时长 {review.playtimeForeverHours} 小时 · 评测时 {review.playtimeAtReviewHours} 小时</span></header><p>{review.text}</p><footer><span>{review.createdAt ? new Date(review.createdAt).toLocaleDateString('zh-CN') : ''}</span><span>{review.steamPurchase ? 'Steam 直接购买' : review.receivedForFree ? '免费获得' : '其他来源'}</span><span>{review.votesUp} 人认为有价值</span></footer></article>)}</div> : <div className="steam-review-empty">{steamDetail.product.comingSoon ? '游戏尚未正式推出，暂无玩家评论。' : '当前筛选语言下暂无有信息量的公开评论。'}</div>}
          <div className="steam-review-source"><span>过滤只影响具体评论样本与玩家画像；Steam 总评论数和总体好评率保持官方原始汇总口径。</span><a href={`https://steamcommunity.com/app/${steamDetail.appId}/reviews/`} target="_blank" rel="noreferrer">查看 Steam 全部评论 <ExternalLink size={13} /></a></div>
        </section>}
        {detailPane === 'analysis' && steamDetail && reviewAnalysis && <div className="steam-analysis-view">
          <section className="steam-analysis-brief" aria-label="开发分析摘要">
            <div><TrendingUp size={18} /><p><strong>{reviewAnalysis.positivePercent == null ? '暂无口碑' : `${reviewAnalysis.positivePercent}% 玩家推荐`}</strong><span>来自 {steamDetail.reviews.summary.total.toLocaleString('zh-CN')} 条简体中文公开评论</span></p></div>
            <div><Gamepad2 size={18} /><p><strong>典型评论玩家已游玩 {reviewAnalysis.medianPlaytime == null ? '暂无' : `${reviewAnalysis.medianPlaytime.toFixed(1)} 小时`}</strong><span>使用中位数，避免少数超长时长玩家拉高结果</span></p></div>
            <div><Radio size={18} /><p><strong>当前 {steamDetail.players.current == null ? '暂无在线数据' : `${steamDetail.players.current.toLocaleString('zh-CN')} 人在线`}</strong><span>{playerAnalysis ? `比近7日平均${playerAnalysis.currentVsAverage >= 0 ? '高' : '低'} ${Math.abs(playerAnalysis.currentVsAverage)}%` : '等待在线历史形成'}</span></p></div>
          </section>
          <div className="steam-analysis-chart-grid">
            <section className="steam-analysis-block steam-analysis-chart-panel">
              <div className="steam-analysis-block-title"><TrendingUp size={18} /><div><h4>市场口碑结构</h4><p>简体中文全部公开评论，判断市场验证强度。</p></div></div>
              <div className="steam-sentiment-chart" aria-label="推荐与不推荐评论扇形图">
                <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={[{ name: '推荐', value: reviewAnalysis.overallPositive }, { name: '不推荐', value: reviewAnalysis.overallNegative }]} dataKey="value" nameKey="name" innerRadius={58} outerRadius={82} paddingAngle={1.5} stroke="none"><Cell fill="#2ca790" /><Cell fill="#e69a91" /></Pie><Tooltip formatter={(value) => Number(value).toLocaleString('zh-CN')} contentStyle={{ borderRadius: 7, border: '1px solid #dfe8e8', fontSize: 11 }} /></PieChart></ResponsiveContainer>
                <div className="steam-sentiment-center"><strong>{reviewAnalysis.positivePercent == null ? '—' : `${reviewAnalysis.positivePercent}%`}</strong><span>总体好评</span></div>
              </div>
              <div className="steam-overall-legend"><span><i className="positive" />推荐 {reviewAnalysis.overallPositive.toLocaleString('zh-CN')}</span><span><i className="negative" />不推荐 {reviewAnalysis.overallNegative.toLocaleString('zh-CN')}</span></div>
            </section>
            <section className="steam-analysis-block steam-analysis-chart-panel">
              <div className="steam-analysis-block-title"><Gamepad2 size={18} /><div><h4>玩家时长分层</h4><p>用评论样本观察内容消耗深度与长线留存代理。</p></div></div>
              <div className="steam-playtime-chart" aria-label="玩家累计游玩时长柱状图"><ResponsiveContainer width="100%" height="100%"><BarChart data={reviewAnalysis.playtimeBuckets} margin={{ top: 18, right: 8, bottom: 0, left: -22 }}><CartesianGrid stroke="#edf2f2" vertical={false} /><XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: '#75868d', fontSize: 10 }} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#9aa6aa', fontSize: 10 }} /><Tooltip formatter={(value) => [`${value} 人`, '评论玩家']} labelFormatter={(label) => `累计时长 ${label}`} contentStyle={{ borderRadius: 7, border: '1px solid #dfe8e8', fontSize: 11 }} /><Bar dataKey="value" name="评论玩家" radius={[5, 5, 0, 0]}>{reviewAnalysis.playtimeBuckets.map((item, index) => <Cell key={item.name} fill={['#91cec2', '#68bbad', '#43a697', '#258f83', '#176e67'][index]} />)}</Bar></BarChart></ResponsiveContainer></div>
              <div className="steam-chart-footnote">中位数 {reviewAnalysis.medianPlaytime == null ? '暂无' : `${reviewAnalysis.medianPlaytime.toFixed(1)}h`} · 百小时玩家占比 {reviewAnalysis.corePlayerRate == null ? '暂无' : `${reviewAnalysis.corePlayerRate}%`}</div>
            </section>
          </div>
          <section className="steam-analysis-block steam-online-panel">
            <div className="steam-analysis-block-title"><Radio size={18} /><div><h4>在线规模与内容运营窗口</h4><p>用同时在线的规模、波动和高峰时段判断服务器容量、活动排期与版本触达窗口。</p></div></div>
            {playerAnalysis ? <>
              <div className="steam-live-readout">
                <div className="steam-live-current"><span>当前在线</span><strong>{playerAnalysis.current.toLocaleString('zh-CN')}</strong><em className={playerAnalysis.currentVsAverage >= 0 ? 'up' : 'down'}>{playerAnalysis.currentVsAverage >= 0 ? '高于' : '低于'}7日均值 {Math.abs(playerAnalysis.currentVsAverage)}%</em></div>
                <div className="steam-live-range"><div><span>近7日低位 {playerAnalysis.low.toLocaleString('zh-CN')}</span><span>高位 {playerAnalysis.peak.toLocaleString('zh-CN')}</span></div><i><b style={{ left: `${playerAnalysis.peak === playerAnalysis.low ? 50 : Math.max(0, Math.min(100, (playerAnalysis.current - playerAnalysis.low) / (playerAnalysis.peak - playerAnalysis.low) * 100))}%` }} /></i><small>当前值在近7日区间中的位置</small></div>
                <ul><li><span>平均在线</span><strong>{playerAnalysis.average.toLocaleString('zh-CN')}</strong></li><li><span>每日主要高峰</span><strong>{playerAnalysis.peakHour?.name || '暂无'}（北京时间）</strong></li><li><span>波动幅度</span><strong>{playerAnalysis.volatility}%</strong></li></ul>
              </div>
              <div className="steam-online-grid">
                <div><h5>近7日在线走势</h5><div className="steam-online-chart" aria-label="玩家在线人数折线图"><ResponsiveContainer width="100%" height="100%"><LineChart data={steamDetail.players.history.filter(point => point.count > 0).map(point => ({ time: new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', timeZone: 'Asia/Shanghai' }).format(new Date(point.capturedAt)), value: point.count }))} margin={{ top: 18, right: 12, bottom: 0, left: 4 }}><CartesianGrid stroke="#edf2f2" vertical={false} /><XAxis dataKey="time" minTickGap={42} tickLine={false} axisLine={false} tick={{ fill: '#829198', fontSize: 9 }} /><YAxis width={58} tickLine={false} axisLine={false} tick={{ fill: '#9aa6aa', fontSize: 9 }} tickFormatter={value => Number(value) >= 10000 ? `${Math.round(Number(value) / 1000)}k` : String(value)} /><Tooltip formatter={value => [Number(value).toLocaleString('zh-CN'), '在线玩家']} contentStyle={{ borderRadius: 7, border: '1px solid #dfe8e8', fontSize: 11 }} /><Line type="monotone" dataKey="value" name="在线玩家" stroke="#238f84" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} /></LineChart></ResponsiveContainer></div></div>
                <div><h5>24小时平均活跃节奏</h5><div className="steam-online-chart" aria-label="24小时平均在线柱状图"><ResponsiveContainer width="100%" height="100%"><BarChart data={playerAnalysis.hourly} margin={{ top: 18, right: 6, bottom: 0, left: -4 }}><CartesianGrid stroke="#edf2f2" vertical={false} /><XAxis dataKey="name" interval={3} tickLine={false} axisLine={false} tick={{ fill: '#829198', fontSize: 9 }} /><YAxis width={52} tickLine={false} axisLine={false} tick={{ fill: '#9aa6aa', fontSize: 9 }} tickFormatter={value => Number(value) >= 10000 ? `${Math.round(Number(value) / 1000)}k` : String(value)} /><Tooltip formatter={value => [Number(value).toLocaleString('zh-CN'), '平均在线']} contentStyle={{ borderRadius: 7, border: '1px solid #dfe8e8', fontSize: 11 }} /><Bar dataKey="value" fill="#58b3a4" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div></div>
              </div>
            </> : <div className="steam-analysis-empty">在线历史尚未形成；后续更新会继续累积真实采样点。</div>}
            <div className="steam-chart-footnote"><a href={steamDetail.sources.players} target="_blank" rel="noreferrer">SteamCharts 公开采样 <ExternalLink size={11} /></a> · 同时在线不等于销量或独立用户</div>
          </section>
          <section className="steam-analysis-block">
            <div className="steam-analysis-block-title"><SlidersHorizontal size={18} /><div><h4>开发体验损耗信号</h4><p>按评测发生时长拆分负面反馈，定位新手期与长线内容分别是否存在体验损耗。</p></div></div>
            <div className="steam-signal-rows">
              <div><span>新手期负面体验</span><i><b className="negative" style={{ width: `${reviewAnalysis.earlyNegativeRate || 0}%` }} /></i><strong>{reviewAnalysis.earlyNegativeCount}/{reviewAnalysis.shortSessionCount} 人</strong><em>{reviewAnalysis.earlyNegativeRate == null ? '暂无样本' : `${reviewAnalysis.earlyNegativeRate}% 不推荐`}</em></div>
              <div><span>深度玩家负面体验</span><i><b className="negative" style={{ width: `${reviewAnalysis.veteranNegativeRate || 0}%` }} /></i><strong>{reviewAnalysis.veteranNegativeCount}/{reviewAnalysis.veteranCount} 人</strong><em>{reviewAnalysis.veteranNegativeRate == null ? '暂无样本' : `${reviewAnalysis.veteranNegativeRate}% 不推荐`}</em></div>
              <div><span>近期仍在游玩</span><i><b style={{ width: `${reviewAnalysis.recentActivityRate || 0}%` }} /></i><strong>{reviewAnalysis.recentlyActive}/{reviewAnalysis.items} 人</strong><em>{reviewAnalysis.recentActivityRate == null ? '暂无样本' : `${reviewAnalysis.recentActivityRate}% 活跃`}</em></div>
            </div>
          </section>
          <section className="steam-analysis-block">
            <div className="steam-analysis-block-title"><ClipboardList size={18} /><div><h4>本次评论样本构成</h4><p>明确告诉你这 {reviewAnalysis.items} 位评论玩家是谁，避免把小样本误当作全部玩家。</p></div></div>
            <div className="steam-sample-table">
              <div><span>评论清洗</span><strong>{steamDetail.reviews.quality?.fetched == null ? `${reviewAnalysis.items} 条有效，过滤前数量待更新` : `${steamDetail.reviews.quality.fetched} 条抓取 → ${reviewAnalysis.items} 条有效`}</strong><em>{steamDetail.reviews.quality?.filtered == null ? '旧缓存没有保留过滤前数量' : `剔除 ${steamDetail.reviews.quality.filtered} 条 · 有效率 ${steamDetail.reviews.quality.retentionRate}%`}</em></div>
              <div><span>推荐 / 不推荐</span><strong>{reviewAnalysis.recommended} / {reviewAnalysis.negative} 人</strong><em>{reviewAnalysis.recommendationRate == null ? '—' : `${reviewAnalysis.recommendationRate}% 推荐`}</em></div>
              <div><span>直接购买 / 免费获得</span><strong>{reviewAnalysis.directPurchases} / {reviewAnalysis.receivedForFree} 人</strong><em>{reviewAnalysis.purchaseRate == null ? '—' : `${reviewAnalysis.purchaseRate}% 已验证购买`}</em></div>
              <div><span>百小时玩家 / 首10小时玩家</span><strong>{reviewAnalysis.veteranCount} / {reviewAnalysis.shortSessionCount} 人</strong><em>区分长线与新手反馈</em></div>
              <div><span>玩家背景</span><strong>平均拥有 {reviewAnalysis.averageGamesOwned == null ? '—' : reviewAnalysis.averageGamesOwned} 款游戏</strong><em>{reviewAnalysis.experiencedReviewers} 人发布过至少10篇评测</em></div>
            </div>
          </section>
          <p className="steam-analysis-scope">数据口径：总体评价来自 Steam 简体中文公开汇总；玩家画像与体验损耗来自近期评论样本，只作开发诊断线索；在线趋势来自 SteamCharts 公开采样。{steamDetail.cache ? `当前显示${steamDetail.cache.state === 'stale' ? '上次完整缓存，点击页面上方“更新数据”可统一替换' : '最新完整缓存'}，` : ''}采集于 {formatDateTime(steamDetail.capturedAt)}。</p>
        </div>}
        </div>
      </div>
    </article>
  </div>;
}

function Modal({ game, onClose, onSave, onDelete }: { game?: Game; onClose: () => void; onSave: (value: GameInput) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const [form, setForm] = useState<GameInput>(game ? { ...game } : emptyGame);
  const [platformText, setPlatformText] = useState(game?.platforms.join('、') || '');
  const [tagText, setTagText] = useState(game?.tags.join('、') || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key: keyof GameInput, value: string | number | boolean | null) => setForm(prev => ({ ...prev, [key]: value }));
  const setExtra = (key: keyof NonNullable<GameInput['sourceExtras']>, value: number | null) => setForm(prev => ({ ...prev, sourceExtras: { ...prev.sourceExtras, [key]: value } }));
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await onSave({ ...form, platforms: platformText.split(/[,，、]/).map(s => s.trim()).filter(Boolean), tags: tagText.split(/[,，、]/).map(s => s.trim()).filter(Boolean) });
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!game || !window.confirm(`确认删除“${game.name}”？`)) return;
    setBusy(true); setError('');
    try { await onDelete(game.id); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '删除失败'); setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div className="modal" role="dialog" aria-modal="true" aria-label={game ? '编辑游戏' : '新增游戏'} onMouseDown={event => event.stopPropagation()}>
      <div className="modal-header"><div><span className="eyebrow">情报录入</span><h2>{game ? '编辑游戏档案' : '新增游戏档案'}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={19} /></button></div>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>游戏名称 <span>*</span><input autoFocus required maxLength={120} value={form.name} onChange={e => set('name', e.target.value)} placeholder="例如：星露谷物语" /></label>
          <label>英文名称<input value={form.englishName} onChange={e => set('englishName', e.target.value)} placeholder="English title" /></label>
          <label>产品分类<select value={form.channel} onChange={e => set('channel', e.target.value)}><option value="端游">端游（PC/主机）</option><option value="App">App</option><option value="小游戏">微信小游戏</option></select></label>
          <label>游戏类型 <span>*</span><input required value={form.genre} onChange={e => set('genre', e.target.value)} placeholder="例如：模拟经营" /></label>
          <label>发行日期<input type="date" value={form.releaseDate} onChange={e => set('releaseDate', e.target.value)} /></label>
          <label>开发商<input value={form.developer} onChange={e => set('developer', e.target.value)} /></label>
          <label>发行商<input value={form.publisher} onChange={e => set('publisher', e.target.value)} /></label>
          <label>Steam 售价（币种按指标口径）<input type="number" min="0" step="0.01" value={form.price ?? ''} onChange={e => setForm(prev => ({ ...prev, price: e.target.value === '' ? null : Number(e.target.value) }))} /></label>
          <label>Steam 好评率（%）<input type="number" min="0" max="100" value={form.rating ?? ''} onChange={e => setForm(prev => ({ ...prev, rating: e.target.value === '' ? null : Number(e.target.value) }))} /></label>
          <label>Steam 评价数<input type="number" min="0" value={form.reviewCount ?? ''} onChange={e => setForm(prev => ({ ...prev, reviewCount: e.target.value === '' ? null : Number(e.target.value) }))} /></label>
          <label>Steam 历史峰值在线<input type="number" min="0" value={form.peakPlayers ?? ''} onChange={e => setForm(prev => ({ ...prev, peakPlayers: e.target.value === '' ? null : Number(e.target.value) }))} /></label>
          <label>平台（用顿号分隔）<input value={platformText} onChange={e => setPlatformText(e.target.value)} placeholder="PC、Switch、PS5" /></label>
          <label>标签（用顿号分隔）<input value={tagText} onChange={e => setTagText(e.target.value)} placeholder="开放世界、多人" /></label>
          <label>Steam App ID<input type="number" min="1" value={form.steamAppId ?? ''} onChange={e => set('steamAppId', e.target.value === '' ? null : Number(e.target.value))} placeholder="用于显示游戏封面" /></label>
          <div className="form-section span-two">来源与口径</div>
          <label className="span-two">商品来源链接<input type="url" value={form.sourceUrl} onChange={e => set('sourceUrl', e.target.value)} placeholder="https://" /></label>
          <label className="span-two">指标来源链接<input type="url" value={form.metricsSourceUrl ?? ''} onChange={e => set('metricsSourceUrl', e.target.value)} placeholder="https://" /></label>
          <label>采集日期<input type="date" value={form.dataAsOf ?? ''} onChange={e => set('dataAsOf', e.target.value)} /></label>
          <label className="span-two">指标口径<input value={form.metricScope ?? ''} maxLength={120} onChange={e => set('metricScope', e.target.value)} placeholder="例如：Steam 全语言评价；中国区人民币原价" /></label>
          {(isAppStoreUrl(form.sourceUrl) || form.sourceExtras) && <div className="form-section span-two extras-heading"><span>App Store 美国区指标</span>{form.sourceExtras && <button type="button" className="text-danger" onClick={() => setForm(prev => ({ ...prev, sourceExtras: null }))}><Trash2 size={14} />清除 App Store 指标</button>}</div>}
          {(isAppStoreUrl(form.sourceUrl) || form.sourceExtras) && <>
            <label>App Store ID<input type="number" min="1" value={form.sourceExtras?.appStoreId ?? ''} onChange={e => setExtra('appStoreId', e.target.value === '' ? null : Number(e.target.value))} /></label>
            <label>美国区售价（美元）<input type="number" min="0" step="0.01" value={form.sourceExtras?.usPriceUsd ?? ''} onChange={e => setExtra('usPriceUsd', e.target.value === '' ? null : Number(e.target.value))} /></label>
            <label>美国区评分（满分 5 星）<input type="number" min="0" max="5" step="0.1" value={form.sourceExtras?.usRatingOutOf5 ?? ''} onChange={e => setExtra('usRatingOutOf5', e.target.value === '' ? null : Number(e.target.value))} /></label>
            <label>美国区评分数<input type="number" min="0" value={form.sourceExtras?.usRatingCount ?? ''} onChange={e => setExtra('usRatingCount', e.target.value === '' ? null : Number(e.target.value))} /></label>
          </>}
          <label className="span-two">简介<textarea rows={3} value={form.description} onChange={e => set('description', e.target.value)} /></label>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions">{game && <button type="button" className="text-danger" onClick={remove} disabled={busy}><Trash2 size={16} /> 删除</button>}<span className="spacer" /><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={busy}><Check size={16} />{busy ? '保存中...' : '保存档案'}</button></div>
      </form>
    </div>
  </div>;
}

export default function App() {
  const { user, mode, canWrite } = useAuth();
  const [games, setGames] = useState<Game[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectError, setProjectError] = useState('');
  const [requestedProjectId, setRequestedProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<View>(initialView);
  const [query, setQuery] = useState(initialParams.get('q') || '');
  const [genre, setGenre] = useState('全部');
  const [channel, setChannel] = useState(initialParams.get('channel') || '全部');
  const [platform, setPlatform] = useState('全部');
  const [sort, setSort] = useState(initialParams.get('sort') || 'rating');
  const [viewing, setViewing] = useState<Game | null>(null);
  const [editing, setEditing] = useState<Game | null | 'new'>(null);
  const [compareA, setCompareA] = useState('1');
  const [compareB, setCompareB] = useState('2');
  // The first visit keeps the original workbench visible so users retain
  // orientation. Choosing Steam 专区 then closes it via nav(), leaving the
  // compact edge arrow available for reopening.
  const [menuOpen, setMenuOpen] = useState(initialView === 'steam');
  const [page, setPage] = useState(1);
  const [importMessage, setImportMessage] = useState('');
  const [analysisChannel, setAnalysisChannel] = useState('全部');
  const [analysisSource, setAnalysisSource] = useState('全部');
  const [syncStatus, setSyncStatus] = useState<CatalogSyncStatus | null>(null);
  const [syncMessage, setSyncMessage] = useState('');
  const [rankingMatches, setRankingMatches] = useState<Map<string, RankingMatch[]>>(new Map());

  async function refresh() {
    try {
      const response = await fetch(apiUrl('/api/games'));
      if (!response.ok) throw new Error('无法读取游戏数据');
      const data: Game[] = await response.json();
      setGames(data); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '加载失败'); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    const loadRankingMatches = async () => {
      try {
        const response = await fetch(apiUrl('/api/rankings'));
        if (!response.ok) return;
        const data = await response.json() as RankingResponse;
        const next = new Map<string, RankingMatch[]>();
        for (const [platformKey, group] of Object.entries(data.platforms || {})) {
          for (const board of Object.values(group.boards || {})) {
            for (const item of board.items || []) {
              const key = rankingKey(item.url);
              if (!key) continue;
              const current = next.get(key) || [];
              current.push({ platform: group.label || platformKey, board: board.label || '公开榜', rank: item.rank });
              next.set(key, current);
            }
          }
        }
        setRankingMatches(next);
      } catch { /* The catalog remains available if ranking sources are temporarily unavailable. */ }
    };
    void loadRankingMatches();
  }, []);
  useEffect(() => {
    if (view !== 'library' && view !== 'steam') return;
    const poll = async () => {
      try {
        const response = await fetch(apiUrl('/api/catalog-sync'));
        if (response.ok) setSyncStatus(await response.json());
        await refresh();
      } catch { /* Game fetch displays its own connection error. */ }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 5000);
    return () => window.clearInterval(timer);
  }, [view]);
  async function syncNow() {
    setSyncMessage('正在请求同步...');
    try {
      const response = await apiFetch('/api/catalog-sync', { method: 'POST' });
      if (!response.ok) throw new Error((await response.json()).error || '同步请求失败');
      setSyncStatus(current => ({ ...current, running: true }));
      setSyncMessage('同步已启动，完成后情报库自动刷新');
    } catch (cause) { setSyncMessage(cause instanceof Error ? cause.message : '同步请求失败'); }
  }
  async function refreshProjects() {
    try {
      const response = await fetch(apiUrl('/api/projects'));
      if (!response.ok) throw new Error('无法读取立项项目');
      setProjects(await response.json()); setProjectError('');
    } catch (cause) { setProjectError(cause instanceof Error ? cause.message : '加载项目失败'); }
  }
  useEffect(() => { void refreshProjects(); }, [view]);

  async function saveGame(value: GameInput) {
    const response = await apiFetch(editing && editing !== 'new' ? `/api/games/${editing.id}` : '/api/games', { method: editing && editing !== 'new' ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    if (!response.ok) throw new Error((await response.json()).error || '保存失败');
    await refresh();
  }
  async function removeGame(id: string) {
    const response = await apiFetch(`/api/games/${id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('删除失败');
    await refresh();
  }
  async function importDocument(file: File) {
    setImportMessage('正在导入...');
    try {
      const document = JSON.parse(await file.text());
      const response = await apiFetch('/api/games/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(document) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '导入失败');
      setImportMessage(`新增 ${result.added} 款，更新演示记录 ${result.replaced} 款，跳过重复 ${result.skipped} 款`);
      await refresh();
    } catch (cause) { setImportMessage(cause instanceof Error ? cause.message : '导入失败'); }
  }
  async function logout() {
    const response = await apiFetch('/api/auth/logout', { method: 'POST' });
    if (response.ok) window.location.reload();
  }

  const genres = useMemo(() => ['全部', ...new Set(games.map(game => game.genre))], [games]);
  const channelGenres = useMemo(() => {
    const counts = games
      .filter(game => channel === '全部' || game.channel === channel)
      .reduce<Record<string, number>>((result, game) => {
        const name = game.genre || '未分类';
        result[name] = (result[name] || 0) + 1;
        return result;
      }, {});
    return ['全部', ...Object.entries(counts).sort((left, right) => right[1] - left[1]).map(([name]) => name)];
  }, [games, channel]);
  const platforms = useMemo(() => ['全部', ...new Set(games.flatMap(game => game.platforms))], [games]);
  const filtered = useMemo(() => games.filter(game => {
    const text = [game.name, game.englishName, game.developer, game.publisher, ...game.tags].join(' ').toLocaleLowerCase();
    return text.includes(query.trim().toLocaleLowerCase()) && (genre === '全部' || game.genre === genre) && (platform === '全部' || game.platforms.includes(platform)) && (channel === '全部' || game.channel === channel);
  }).sort((a, b) => sort === 'rating' ? (b.rating ?? -1) - (a.rating ?? -1) : sort === 'reviews' ? (b.reviewCount ?? -1) - (a.reviewCount ?? -1) : sort === 'release' ? b.releaseDate.localeCompare(a.releaseDate) : a.name.localeCompare(b.name, 'zh-CN')), [games, query, genre, platform, channel, sort]);
  useEffect(() => { setPage(1); }, [query, genre, platform, channel, sort]);
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  const visibleGames = filtered.slice((page - 1) * pageSize, page * pageSize);
  const rankedGameCount = useMemo(() => games.filter(game => rankingMatches.has(rankingKey(game.sourceUrl))).length, [games, rankingMatches]);
  const channelCounts = useMemo(() => games.reduce<Record<string, number>>((counts, game) => { counts[game.channel] = (counts[game.channel] || 0) + 1; return counts; }, {}), [games]);
  const allRealGames = useMemo(() => games.filter(game => !game.isDemo), [games]);
  const allAnalysisGames = allRealGames;
  const analysisChannelCounts = useMemo(() => allAnalysisGames.reduce<Record<string, number>>((counts, game) => { counts[game.channel] = (counts[game.channel] || 0) + 1; return counts; }, {}), [allAnalysisGames]);
  const channelAnalysisGames = useMemo(() => allAnalysisGames.filter(game => analysisChannel === '全部' || game.channel === analysisChannel), [allAnalysisGames, analysisChannel]);
  const sourceCounts = useMemo(() => channelAnalysisGames.reduce<Record<string, number>>((counts, game) => { const name = sourceName(game); counts[name] = (counts[name] || 0) + 1; return counts; }, {}), [channelAnalysisGames]);
  const analysisGames = useMemo(() => channelAnalysisGames.filter(game => analysisSource === '全部' || sourceName(game) === analysisSource), [channelAnalysisGames, analysisSource]);
  const categoryData = useMemo(() => Object.entries(analysisGames.reduce<Record<string, number>>((acc, game) => { acc[game.genre] = (acc[game.genre] || 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value })), [analysisGames]);
  const categoryChartData = categoryData.length > 12 ? [...categoryData.slice(0, 11), { name: '其他类型', value: categoryData.slice(11).reduce((sum, item) => sum + item.value, 0) }] : categoryData;
  const platformData = useMemo(() => Object.entries(analysisGames.reduce<Record<string, number>>((acc, game) => { game.platforms.forEach(item => { acc[item] = (acc[item] || 0) + 1; }); return acc; }, {})).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value })), [analysisGames]);
  const yearData = useMemo(() => Object.entries(analysisGames.reduce<Record<string, number>>((acc, game) => { const year = game.releaseDate.slice(0, 4); if (year) acc[year] = (acc[year] || 0) + 1; return acc; }, {})).sort((a, b) => a[0].localeCompare(b[0])).map(([year, count]) => ({ year, count })), [analysisGames]);
  const a = games.find(game => game.id === compareA) || allAnalysisGames[0] || games[0];
  const b = games.find(game => game.id === compareB) || allAnalysisGames.find(game => game.id !== a?.id) || games.find(game => game.id !== a?.id);
  const ratedGames = allAnalysisGames.filter(game => isSteamRecord(game) && game.rating !== null);
  const avgRating = ratedGames.length ? Math.round(ratedGames.reduce((sum, game) => sum + (game.rating || 0), 0) / ratedGames.length) : null;
  const selectedSteamRated = analysisGames.filter(game => isSteamRecord(game) && game.rating !== null);
  const selectedSteamAverage = selectedSteamRated.length ? Math.round(selectedSteamRated.reduce((sum, game) => sum + game.rating!, 0) / selectedSteamRated.length) : null;
  const appleRated = analysisGames.filter(game => isAppStoreUrl(game.sourceUrl) && (game.sourceExtras?.usRatingOutOf5 ?? 0) > 0 && (game.sourceExtras?.usRatingCount ?? 0) > 0);
  const appleAverage = appleRated.length ? (appleRated.reduce((sum, game) => sum + game.sourceExtras!.usRatingOutOf5!, 0) / appleRated.length).toFixed(1) : null;
  const appleRatingData = [1, 2, 3, 4, 5].map(stars => ({ name: `${stars} 星`, value: appleRated.filter(game => Math.ceil(game.sourceExtras!.usRatingOutOf5!) === stars).length }));
  const showSteamSignals = (analysisChannel === '全部' || analysisChannel === '端游') && (analysisSource === '全部' || analysisSource === 'Steam（海外）');
  const liveGames = games.filter(game => game.hasLiveData);
  const totalCurrentPlayers = liveGames.reduce((sum, game) => sum + Number(game.currentPlayers || 0), 0);
  const totalNews90Days = liveGames.reduce((sum, game) => sum + Number(game.steamNewsCounts?.last90Days || 0), 0);
  const latestCapture = liveGames.map(game => game.steamCapturedAt || '').sort().at(-1);
  const playerData = [...liveGames].sort((left, right) => Number(right.currentPlayers || 0) - Number(left.currentPlayers || 0)).slice(0, 10).map(game => ({ name: game.name, value: game.currentPlayers || 0 }));
  const newsWindowData = [365, 90, 30, 7].map(days => ({ period: `近${days}天`, value: liveGames.reduce((sum, game) => {
    const counts = game.steamNewsCounts as Record<string, number> | undefined;
    return sum + Number(counts?.[`last${days}Days`] || 0);
  }, 0) }));
  const recentNews = liveGames.flatMap(game => (game.latestSteamNews || []).map(news => ({ ...news, gameName: game.name }))).sort((left, right) => right.publishedAt.localeCompare(left.publishedAt)).slice(0, 8);
  const nav = (next: View) => { setRequestedProjectId(null); setView(next); setMenuOpen(false); };
  const openProject = (id: string) => { setRequestedProjectId(id); setView('projects'); setMenuOpen(false); };

  return <div className={`app-shell ${view === 'steam' ? 'steam-focused' : ''}`}>
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
      <div className="brand"><span className="brand-mark"><Gamepad2 size={21} strokeWidth={2.3} /></span><div><strong>游观</strong><small>GAME INTELLIGENCE</small></div></div>
      <div className="workspace-label">工作空间 <ChevronDown size={14} /></div>
      <div className="workspace-name"><span className="workspace-avatar">点</span><span>点触科技<br /><small>游戏情报工作台</small></span></div>
      <nav className="side-nav" aria-label="主导航">
        <span className="nav-caption steam-nav-caption">专项工作台</span>
        <button className={`steam-nav-button ${view === 'steam' ? 'active' : ''}`} onClick={() => nav('steam')}><Gamepad2 size={18} /> Steam 专区</button>
        <span className="nav-caption">投资研判</span>
        <button className={view === 'dashboard' ? 'active' : ''} onClick={() => nav('dashboard')}><LayoutDashboard size={18} /> 投资总览</button>
        <button className={view === 'projects' ? 'active' : ''} onClick={() => nav('projects')}><ClipboardList size={18} /> 立项项目</button>
        <button className={view === 'benchmark' ? 'active' : ''} onClick={() => nav('benchmark')}><ArrowLeftRight size={18} /> 赛道对标</button>
        <button className={view === 'risks' ? 'active' : ''} onClick={() => nav('risks')}><ShieldAlert size={18} /> 风险监控</button>
        <span className="nav-caption nav-caption-secondary">竞品情报</span>
        <button className={view === 'library' ? 'active' : ''} onClick={() => nav('library')}><LayoutDashboard size={18} /> 情报库 <span className="nav-count">{games.length}</span></button>
        <button className={view === 'analytics' ? 'active' : ''} onClick={() => nav('analytics')}><BarChart3 size={18} /> 可视化分析</button>
        <button className={view === 'catalogCompare' ? 'active' : ''} onClick={() => nav('catalogCompare')}><ArrowLeftRight size={18} /> 产品对比</button>
        <button className={view === 'rankings' ? 'active' : ''} onClick={() => nav('rankings')}><Trophy size={18} /> 游戏榜单</button>
        <button className={view === 'profitBreakdown' ? 'active' : ''} onClick={() => nav('profitBreakdown')}><TrendingUp size={18} /> 畅销盈利拆解</button>
      </nav>
      <div className="side-bottom"><div className="side-tip"><Database size={17} /><span>本地情报库<small>团队协作数据</small></span></div><div className="side-profile"><span className="profile-avatar">{user?.name.slice(0, 1) || 'DC'}</span><span>{user?.name || '点触科技'}<small>{user?.role === 'admin' ? '管理员' : user?.role === 'analyst' ? '分析师' : '投资人'}</small></span>{mode === 'external' ? <button className="icon-button" title="退出登录" aria-label="退出登录" onClick={() => void logout()}><LogOut size={16} /></button> : <CircleHelp size={16} />}</div></div>
    </aside>
    {(menuOpen || view === 'steam') && <button className={`mobile-scrim ${menuOpen ? 'open' : ''}`} aria-label="关闭菜单" onClick={() => setMenuOpen(false)} />}
    <main className="main">
      <header className="topbar"><div className="top-left"><button className={`icon-button mobile-menu ${view === 'steam' ? 'steam-sidebar-toggle' : ''}`} onClick={() => setMenuOpen(true)} aria-label={view === 'steam' ? '展开原工作台导航' : '打开菜单'}>{view === 'steam' ? <ChevronRight size={18} /> : <Menu size={20} />}</button><span>工作空间</span><span className="breadcrumb-sep">/</span><strong>{({ steam: 'Steam 专区', dashboard: '投资总览', projects: '立项项目', benchmark: '赛道对标', risks: '风险监控', library: '游戏情报库', analytics: '可视化分析', catalogCompare: '产品对比', rankings: '游戏榜单', profitBreakdown: '畅销盈利拆解' } as Record<View, string>)[view]}</strong></div><div className="top-right">{view !== 'projects' && <span className={`top-status ${error || projectError ? 'disconnected' : ''}`}><span /> {error || projectError ? '连接失败' : loading ? '连接中' : '数据已连接'}</span>}<span className="top-avatar" title={user?.name}>{user?.name.slice(0, 1) || 'DC'}</span></div></header>
      <div className="content">
        {view === 'steam' && <SteamWorkspace games={games} syncStatus={syncStatus} syncMessage={syncMessage} canSync={canWrite && user?.role === 'admin'} onSync={syncNow} onOpenGame={setViewing} />}
        {view === 'dashboard' && <InvestmentDashboard projects={projects} games={games} onOpenProject={openProject} onOpenRiskCenter={() => nav('risks')} />}
        {view === 'projects' && <ProjectWorkspace initialSelectedId={requestedProjectId} onOpenBenchmark={() => nav('benchmark')} />}
        {view === 'benchmark' && <InvestmentCompare projects={projects} games={games} onOpenProject={openProject} />}
        {view === 'risks' && <RiskCenter projects={projects} onOpenProject={openProject} />}
        {view === 'rankings' && <RankingWorkspace mode="boards" />}
        {view === 'profitBreakdown' && <RankingWorkspace mode="breakdown" />}
        {view !== 'projects' && (error || projectError) && <div className="error-banner" role="alert">{error || projectError}<button onClick={() => { void refresh(); void refreshProjects(); }}>重试</button></div>}
        {view === 'library' && <>
          <div className="page-heading"><div><span className="eyebrow">GAME DATABASE / 01</span><h1>游戏情报库</h1><p>集中查看游戏资料、市场信号与产品定位</p></div>{canWrite && <div className="heading-actions">{user?.role === 'admin' && <button className="secondary-button" onClick={() => void syncNow()} disabled={syncStatus?.running}><RefreshCw size={17} /> {syncStatus?.running ? '同步中' : '立即同步'}</button>}<label className="secondary-button import-button"><Upload size={17} /> 导入 JSON<input type="file" accept="application/json,.json" onChange={event => { const file = event.target.files?.[0]; if (file) void importDocument(file); event.target.value = ''; }} /></label><button className="primary-button" onClick={() => setEditing('new')}><Plus size={18} /> 录入游戏</button></div>}</div>
          {importMessage && <div className="data-note" role="status">{importMessage}</div>}
          <div className="catalog-sync" aria-label="平台同步状态">
            <strong>平台目录同步</strong>
            <span>{syncStatus?.running ? '更新中' : syncStatus?.finishedAt ? `上次完成 ${new Date(syncStatus.finishedAt).toLocaleString('zh-CN')}` : '等待首次同步'}</span>
            {Object.entries(syncStatus?.sources || {}).map(([key, source]) =>
              <a key={key} href={source.url} target="_blank" rel="noreferrer"
                title={source.error || source.warnings?.join('；') || (source.lastSuccessAt ? `最近成功 ${new Date(source.lastSuccessAt).toLocaleString('zh-CN')}` : '')}>
                {key === 'steam' ? 'Steam（海外）' : key === 'apple' ? 'App Store' : key === 'taptap' ? 'TapTap' : '微信小游戏'} · {source.state === 'error' ? '同步失败' : `${source.state === 'partial' ? '部分成功 · ' : ''}抓取 ${source.fetched || 0} / 新增 ${source.added || 0} / 更新 ${source.updated || 0}`} <ExternalLink size={12} />
              </a>)}
            <span title="这些平台已有商品来源链接，但尚未接入稳定自动采集">其他平台：PlayStation、Xbox、Nintendo（手动来源）</span>
            {syncMessage && <span role="status">{syncMessage}</span>}
          </div>
          <div className="catalog-ranking-note"><strong>榜单关联</strong><span>已将情报库商品 ID 与公开榜单 ID 对应，当前有 {rankedGameCount} 款进入公开榜；其余显示“当前未进入公开榜”，不再误认为缺少档案。</span></div>
          <div className="stat-grid"><div className="stat"><div className="stat-icon teal"><Gamepad2 size={20} /></div><span>收录游戏</span><strong>{games.length}<small> 款</small></strong><p>覆盖 {genres.length - 1} 个游戏类型</p></div><div className="stat"><div className="stat-icon amber"><SlidersHorizontal size={20} /></div><span>游戏类型</span><strong>{genres.length - 1}<small> 类</small></strong><p>多维度分类检索</p></div><div className="stat"><div className="stat-icon blue"><BarChart3 size={20} /></div><span>平均好评率</span><strong>{avgRating ?? '—'}{avgRating !== null && <small> %</small>}</strong><p>仅非演示且有 Steam 好评率的记录</p></div><div className="stat"><div className="stat-icon coral"><ArrowUpRight size={20} /></div><span>覆盖平台</span><strong>{platforms.length - 1}<small> 个</small></strong><p>按来源已核验的平台</p></div></div>
          <div className="insight-strip"><div><span>Steam 实采游戏</span><strong>{liveGames.length}</strong></div><div><span>当前在线合计</span><strong>{formatNumber(totalCurrentPlayers)}</strong></div><div><span>近90天公告</span><strong>{totalNews90Days}</strong></div><div><span>最近采集</span><strong className="capture-time">{formatDateTime(latestCapture)}</strong></div></div>
          <div className="channel-tabs" role="group" aria-label="产品分类筛选">{['全部', '端游', 'App', '小游戏'].map(item => <button key={item} className={channel === item ? 'selected' : ''} onClick={() => { setChannel(item); setGenre('全部'); }}>{item === '全部' ? '全部' : channelLabel(item)}<span>{item === '全部' ? games.length : channelCounts[item] || 0}</span></button>)}</div>
          <div className="section-title"><div><h2>游戏列表</h2><p>浏览和筛选收录的游戏产品</p></div><span className="count-pill">共 {filtered.length} 款</span></div>
          <div className="filters"><div className="search-field"><Search size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索游戏、开发商或标签..." aria-label="搜索游戏" />{query && <button onClick={() => setQuery('')} aria-label="清除搜索"><X size={16} /></button>}</div><div className="filter-select"><SlidersHorizontal size={16} /><select value={genre} onChange={e => setGenre(e.target.value)} aria-label="筛选游戏类型">{channelGenres.map(item => <option key={item} value={item}>{item === '全部' ? '全部类型' : item}</option>)}</select></div><div className="filter-select"><select value={platform} onChange={e => setPlatform(e.target.value)} aria-label="筛选平台">{platforms.map(item => <option key={item} value={item}>{item === '全部' ? '全部平台' : item}</option>)}</select></div><div className="filter-select sort-select"><ArrowDownUp size={16} /><select value={sort} onChange={e => setSort(e.target.value)} aria-label="排序"><option value="rating">好评率优先</option><option value="reviews">评价数优先</option><option value="release">最新发行</option><option value="name">名称排序</option></select></div></div>
          <div className="genre-tabs" role="group" aria-label="快捷类型筛选">{channelGenres.slice(0, 7).map(item => <button key={item} className={genre === item ? 'selected' : ''} onClick={() => setGenre(item)}>{item}</button>)}</div>
          <div className="table-wrap"><table><thead><tr><th>游戏 / 产品</th><th>分类</th><th>类型</th><th>数据来源</th><th>当前榜单</th><th>采集日期</th><th>平台</th><th>Steam 好评率</th><th>Steam 售价</th>{canWrite && <th><span className="sr-only">操作</span></th>}</tr></thead><tbody>{visibleGames.map(game => { const matches = rankingMatches.get(rankingKey(game.sourceUrl)) || []; return <tr key={game.id} onClick={() => setViewing(game)}><td><div className="game-cell"><Cover game={game} /><div><strong>{game.name}</strong><small>{game.englishName || game.developer || '未录入英文名'} {game.isDemo && <em>演示</em>}</small></div></div></td><td>{channelLabel(game.channel)}</td><td><span className="genre-badge">{game.genre}</span></td><td>{game.sourceUrl ? <a className="catalog-source-link" href={game.sourceUrl} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}>{sourceName(game)} <ExternalLink size={12} /></a> : sourceName(game)}</td><td><RankingStatus game={game} matches={matches} /></td><td>{game.dataAsOf || '未录入'}</td><td><div className="platforms">{game.platforms.slice(0, 2).map(item => <span key={item}>{item}</span>)}{game.platforms.length > 2 && <span>+{game.platforms.length - 2}</span>}</div></td><td><span className="rating"><span />{isSteamRecord(game) && game.rating !== null ? `${game.rating}%` : '未录入'}</span></td><td className="price">{isSteamRecord(game) ? formatSteamPrice(game) : '未录入'}</td>{canWrite && <td><button className="row-action" aria-label={`编辑${game.name}`} onClick={event => { event.stopPropagation(); setEditing(game); }}><ArrowUpRight size={17} /></button></td>}</tr>; })}</tbody></table>{!loading && !filtered.length && <div className="empty-state"><Search size={26} /><strong>没有找到匹配的游戏</strong><p>调整关键词或筛选条件后再试</p></div>}{loading && <div className="empty-state">加载中...</div>}</div>
          {filtered.length > pageSize && <div className="pagination"><span>第 {page} / {totalPages} 页，共 {filtered.length} 款</span><div><button disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button><button disabled={page >= totalPages} onClick={() => setPage(value => value + 1)}>下一页</button></div></div>}
          <div className="data-note">演示记录的指标为样例值。导入样本按来源口径展示；空值表示未取得数据，不等于零。</div>
        </>}
        {view === 'analytics' && <>
          <div className="page-heading"><div><span className="eyebrow">MARKET INSIGHTS / 02</span><h1>可视化分析</h1><p>按产品分类与来源查看当前情报库</p></div><span className="analysis-stamp">当前范围 {analysisGames.length} 条商品记录</span></div>
          <div className="analysis-controls">
            <div className="channel-tabs" role="group" aria-label="分析产品分类">{['全部', '端游', 'App', '小游戏'].map(item => <button key={item} className={analysisChannel === item ? 'selected' : ''} onClick={() => { setAnalysisChannel(item); setAnalysisSource('全部'); }}>{item === '全部' ? item : channelLabel(item)}<span>{item === '全部' ? allAnalysisGames.length : analysisChannelCounts[item] || 0}</span></button>)}</div>
            <label>数据来源<select value={analysisSource} onChange={event => setAnalysisSource(event.target.value)}><option value="全部">全部来源</option>{Object.keys(sourceCounts).sort((left, right) => (sourceCounts[right] || 0) - (sourceCounts[left] || 0)).map(item => <option key={item} value={item}>{item} · {sourceCounts[item]}</option>)}</select></label>
          </div>
          <div className="insight-strip"><div><span>当前范围</span><strong>{analysisGames.length}</strong></div><div><span>来源数量</span><strong>{new Set(analysisGames.map(sourceName)).size}</strong></div><div><span>最多类型</span><strong>{categoryData[0]?.name || '暂无'}</strong></div><div><span>最多平台</span><strong>{platformData[0]?.name || '暂无'}</strong></div></div>
          <div className="channel-summary" aria-label="产品分类分布">{['端游', 'App', '小游戏'].map(item => <div key={item}><span>{channelLabel(item)}</span><strong>{analysisChannelCounts[item] || 0}</strong><small>条商品记录</small></div>)}</div>
          <section className="analysis-source-list" aria-label="来源覆盖">{Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => <div key={name}><span>{name}</span><strong>{count.toLocaleString('zh-CN')}</strong></div>)}</section>
          <div className="analysis-domestic">当前自动小游戏目录来自腾讯应用宝微信小游戏；抖音小游戏展示第三方月度榜单，不与微信小游戏目录混为同一数据源。</div>
          <div className="chart-grid"><section className="chart-panel"><div className="chart-heading"><div><h2>游戏类型分布</h2><p>收录最多的 11 类，其余合并展示</p></div><span>分类视角</span></div><div className="chart-box" style={{ height: Math.max(340, categoryChartData.length * 38) }}><ResponsiveContainer width="100%" height="100%"><BarChart data={categoryChartData} layout="vertical" margin={{ top: 8, right: 18, bottom: 16, left: 10 }}><CartesianGrid stroke="#edf0f2" horizontal={false} /><XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#8b949c', fontSize: 12 }} /><YAxis dataKey="name" type="category" width={92} tickLine={false} axisLine={false} tick={{ fill: '#4b5660', fontSize: 12 }} /><Tooltip cursor={{ fill: '#f6f8f9' }} /><Bar dataKey="value" name="游戏数" radius={[0, 4, 4, 0]} barSize={18}>{categoryChartData.map((item, index) => <Cell key={item.name} fill={palette[index % palette.length]} />)}</Bar></BarChart></ResponsiveContainer></div></section>
          <section className="chart-panel"><div className="chart-heading"><div><h2>平台覆盖</h2><p>单款游戏可计入多个平台</p></div><span>平台视角</span></div><div className="chart-box"><ResponsiveContainer width="100%" height="100%"><BarChart data={platformData} margin={{ top: 16, right: 16, bottom: 0, left: -20 }}><CartesianGrid stroke="#edf0f2" vertical={false} /><XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: '#68737d', fontSize: 12 }} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#8b949c', fontSize: 12 }} /><Tooltip cursor={{ fill: '#f6f8f9' }} /><Bar dataKey="value" name="游戏数" fill="#38a99c" radius={[4, 4, 0, 0]} barSize={30} /></BarChart></ResponsiveContainer></div></section>
          {yearData.length > 0 && <section className="chart-panel chart-wide"><div className="chart-heading"><div><h2>发行年份趋势</h2><p>按发行年份统计收录产品</p></div><span>时间视角</span></div><div className="chart-box year-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={yearData} margin={{ top: 14, right: 22, bottom: 0, left: -20 }}><defs><linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#38a99c" stopOpacity={0.24} /><stop offset="100%" stopColor="#38a99c" stopOpacity={0.01} /></linearGradient></defs><CartesianGrid stroke="#edf0f2" vertical={false} /><XAxis dataKey="year" tickLine={false} axisLine={false} tick={{ fill: '#68737d', fontSize: 12 }} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#8b949c', fontSize: 12 }} /><Tooltip /><Area dataKey="count" name="游戏数" stroke="#279c90" strokeWidth={2.5} fill="url(#areaFill)" /></AreaChart></ResponsiveContainer></div></section>}</div>
          {yearData.length === 0 && <div className="data-note">当前范围没有可核验的发行日期，因此不显示发行年份趋势。</div>}
          {appleRated.length > 0 && <section className="chart-panel analysis-metric-panel"><div className="chart-heading"><div><h2>App Store 美国区五星评分</h2><p>{appleRated.length} 条有评分记录 · 平均 {appleAverage} / 5；评分区间按向上取整展示</p></div><span>iOS 专属口径</span></div><div className="chart-box"><ResponsiveContainer width="100%" height="100%"><BarChart data={appleRatingData} margin={{ top: 16, right: 16, bottom: 0, left: -10 }}><CartesianGrid stroke="#edf0f2" vertical={false} /><XAxis dataKey="name" tickLine={false} axisLine={false} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} /><Tooltip /><Bar dataKey="value" name="游戏数" fill="#de9b3d" radius={[4, 4, 0, 0]} barSize={34} /></BarChart></ResponsiveContainer></div></section>}
          {showSteamSignals && liveGames.length > 0 && <>
            <div className="section-title analysis-steam-heading"><div><h2>Steam 实采信号</h2><p>{liveGames.length} 款游戏 · 最近采集 {formatDateTime(latestCapture)} · 有评价记录 {selectedSteamRated.length} 款，平均好评率 {selectedSteamAverage === null ? '未取得' : `${selectedSteamAverage}%`}</p></div></div>
            <div className="chart-grid live-charts"><section className="chart-panel"><div className="chart-heading"><div><h2><Radio size={16} /> 当前在线排行</h2><p>采集时刻在线人数，非历史峰值</p></div><span>Steam 快照</span></div><div className="chart-box"><ResponsiveContainer width="100%" height="100%"><BarChart data={playerData} layout="vertical" margin={{ top: 0, right: 18, bottom: 0, left: 20 }}><CartesianGrid stroke="#edf0f2" horizontal={false} /><XAxis type="number" tickLine={false} axisLine={false} tick={{ fill: '#8b949c', fontSize: 11 }} /><YAxis dataKey="name" type="category" width={92} tickLine={false} axisLine={false} tick={{ fill: '#4b5660', fontSize: 11 }} /><Tooltip formatter={(value) => Number(value).toLocaleString('zh-CN')} /><Bar dataKey="value" name="当前在线" fill="#38a99c" radius={[0, 4, 4, 0]} barSize={15} /></BarChart></ResponsiveContainer></div></section>
            <section className="chart-panel"><div className="chart-heading"><div><h2><Newspaper size={16} /> 公告时间窗口</h2><p>Steam 官方公告在不同时间窗口的合计</p></div><span>近一年</span></div><div className="chart-box"><ResponsiveContainer width="100%" height="100%"><BarChart data={newsWindowData} margin={{ top: 16, right: 16, bottom: 0, left: -10 }}><CartesianGrid stroke="#edf0f2" vertical={false} /><XAxis dataKey="period" tickLine={false} axisLine={false} tick={{ fill: '#68737d', fontSize: 11 }} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#8b949c', fontSize: 11 }} /><Tooltip /><Bar dataKey="value" name="公告数" fill="#687dd8" radius={[4, 4, 0, 0]} barSize={34} /></BarChart></ResponsiveContainer></div></section></div>
            {recentNews.length > 0 && <section className="news-panel"><div className="chart-heading"><div><h2>最新 Steam 公告</h2><p>按发布时间汇总的最新情报</p></div><span>官方来源</span></div><div className="news-list">{recentNews.map(news => <a key={`${news.gameName}-${news.id}`} href={news.url} target="_blank" rel="noreferrer"><div><strong>{news.title}</strong><span>{news.gameName} · {formatDateTime(news.publishedAt)}</span></div><ExternalLink size={15} /></a>)}</div></section>}
          </>}
          <div className="data-note">数量是当前收录商品记录，不等于全平台游戏总量或市场份额。同一游戏在不同商店可能分别计数；Steam 好评率与 App Store 五星评分口径不同，不直接比较。</div>
        </>}
        {view === 'catalogCompare' && <>
          <div className="page-heading"><div><span className="eyebrow">PRODUCT COMPARISON / 03</span><h1>产品对比</h1><p>并排查看两款游戏的定位与核心指标</p></div></div>
          <div className="compare-pickers"><div><label htmlFor="compare-a">产品 A</label><select id="compare-a" value={a?.id || ''} onChange={e => setCompareA(e.target.value)}>{games.filter(game => game.id !== b?.id).map(game => <option key={game.id} value={game.id}>{game.name}</option>)}</select></div><div className="swap-mark"><ArrowLeftRight size={20} /></div><div><label htmlFor="compare-b">产品 B</label><select id="compare-b" value={b?.id || ''} onChange={e => setCompareB(e.target.value)}>{games.filter(game => game.id !== a?.id).map(game => <option key={game.id} value={game.id}>{game.name}</option>)}</select></div></div>
          {a && b ? <><div className="compare-heroes"><div className="compare-product"><Cover game={a} className="compare-cover" /><div><span className="compare-label">产品 A</span><h2>{a.name}</h2><p>{a.englishName || a.developer}</p><div className="compare-tags">{a.tags.slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}</div></div></div><div className="compare-product"><Cover game={b} className="compare-cover" /><div><span className="compare-label">产品 B</span><h2>{b.name}</h2><p>{b.englishName || b.developer}</p><div className="compare-tags">{b.tags.slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}</div></div></div></div>
          <div className="compare-table">
            <div className="compare-section">基础信息</div>
            {([['游戏类型', a.genre, b.genre], ['开发商', a.developer, b.developer], ['发行商', a.publisher, b.publisher], ['发行日期', a.releaseDate, b.releaseDate], ['覆盖平台', a.platforms.join('、'), b.platforms.join('、')]] as string[][]).map(([label, av, bv]) => <div className="compare-row" key={label}><span>{label}</span><strong>{av || '未录入'}</strong><strong>{bv || '未录入'}</strong></div>)}
            <div className="compare-section">Steam 指标 <small>人民币价格、Steam 用户评价；历史峰值来自 SteamCharts</small></div>
            {([['Steam 售价', isSteamRecord(a) ? formatSteamPrice(a) : '不适用', isSteamRecord(b) ? formatSteamPrice(b) : '不适用'], ['好评率', isSteamRecord(a) && a.rating !== null ? `${a.rating}%` : '不适用', isSteamRecord(b) && b.rating !== null ? `${b.rating}%` : '不适用'], ['评价数', isSteamRecord(a) ? formatNumber(a.reviewCount) : '不适用', isSteamRecord(b) ? formatNumber(b.reviewCount) : '不适用'], ['历史峰值在线', isSteamRecord(a) ? (a.peakPlayers?.toLocaleString('zh-CN') ?? '未录入') : '不适用', isSteamRecord(b) ? (b.peakPlayers?.toLocaleString('zh-CN') ?? '未录入') : '不适用']] as string[][]).map(([label, av, bv]) => <div className="compare-row" key={label}><span>{label}</span><strong>{av}</strong><strong>{bv}</strong></div>)}
            <div className="compare-section">Steam 实采指标 <small>{formatDateTime(latestCapture)}</small></div>
            {([['当前在线', a.hasLiveData ? formatNumber(Number(a.currentPlayers || 0)) : '未采集', b.hasLiveData ? formatNumber(Number(b.currentPlayers || 0)) : '未采集'], ['近365天公告', `${a.steamNewsCounts?.last365Days ?? 0} 条`, `${b.steamNewsCounts?.last365Days ?? 0} 条`], ['近90天公告', `${a.steamNewsCounts?.last90Days ?? 0} 条`, `${b.steamNewsCounts?.last90Days ?? 0} 条`], ['近30天公告', `${a.steamNewsCounts?.last30Days ?? 0} 条`, `${b.steamNewsCounts?.last30Days ?? 0} 条`], ['近7天公告', `${a.steamNewsCounts?.last7Days ?? 0} 条`, `${b.steamNewsCounts?.last7Days ?? 0} 条`]] as string[][]).map(([label, av, bv]) => <div className="compare-row" key={label}><span>{label}</span><strong>{av}</strong><strong>{bv}</strong></div>)}
            {(isAppStoreUrl(a.sourceUrl) || isAppStoreUrl(b.sourceUrl)) && <>
              <div className="compare-section">App Store 美国区指标 <small>美元价格、五星评分；与 Steam 指标不可直接比较</small></div>
              {([['美国区售价', isAppStoreUrl(a.sourceUrl) ? formatUsd(a.sourceExtras?.usPriceUsd) : '不适用', isAppStoreUrl(b.sourceUrl) ? formatUsd(b.sourceExtras?.usPriceUsd) : '不适用'], ['五星评分', isAppStoreUrl(a.sourceUrl) ? (a.sourceExtras?.usRatingOutOf5 == null ? '未录入' : `${a.sourceExtras.usRatingOutOf5} / 5`) : '不适用', isAppStoreUrl(b.sourceUrl) ? (b.sourceExtras?.usRatingOutOf5 == null ? '未录入' : `${b.sourceExtras.usRatingOutOf5} / 5`) : '不适用'], ['评分数', isAppStoreUrl(a.sourceUrl) ? formatNumber(a.sourceExtras?.usRatingCount ?? null) : '不适用', isAppStoreUrl(b.sourceUrl) ? formatNumber(b.sourceExtras?.usRatingCount ?? null) : '不适用']] as string[][]).map(([label, av, bv]) => <div className="compare-row" key={label}><span>{label}</span><strong>{av}</strong><strong>{bv}</strong></div>)}
            </>}
          </div>
          <div className="compare-sources"><MetricSource game={a} /><MetricSource game={b} /></div>
          </> : <div className="empty-state">请至少录入两款游戏以进行对比</div>}
        </>}
      </div>
    </main>
    {viewing && <GameDetail game={viewing} matches={rankingMatches.get(rankingKey(viewing.sourceUrl)) || []} onClose={() => setViewing(null)} />}
    {editing && <Modal key={editing === 'new' ? 'new' : editing.id} game={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSave={saveGame} onDelete={removeGame} />}
  </div>;
}
