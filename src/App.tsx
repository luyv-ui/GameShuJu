import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownUp, ArrowLeftRight, ArrowUpRight, BarChart3, Check, ChevronDown, CircleHelp, ClipboardList, Database, ExternalLink, Gamepad2, LayoutDashboard, Menu, Newspaper, Plus, Radio, Search, SlidersHorizontal, Trash2, Upload, X } from 'lucide-react';
import type { Game, GameInput } from './types';
import './catalog.css';
import ProjectWorkspace from './ProjectWorkspace';

type View = 'projects' | 'library' | 'analytics' | 'compare';
const palette = ['#e9a236', '#37a89b', '#687dd8', '#e16f72', '#889db2', '#b37ac5'];
const emptyGame: GameInput = { channel: '端游', name: '', englishName: '', genre: '', platforms: [], releaseDate: '', developer: '', publisher: '', price: null, rating: null, reviewCount: null, peakPlayers: null, tags: [], description: '', steamAppId: null, sourceUrl: '', isDemo: false };

function formatNumber(value: number | null) {
  if (value === null) return '未录入';
  if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}万`;
  return value.toLocaleString('zh-CN');
}
function formatPrice(value: number | null) { return value === null ? '未录入' : `¥${value}`; }
function formatUsd(value: number | null | undefined) { return value == null ? '未录入' : `$${value.toFixed(2)}`; }
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
  if (sourceHost(game.sourceUrl) === 'store.steampowered.com') return 'Steam';
  if (sourceHost(game.sourceUrl) === 'sj.qq.com') return '腾讯应用宝';
  return game.sourceUrl ? '其他来源' : '未录入';
}
function isSteamRecord(game: Game) { return sourceName(game) === 'Steam'; }

function gameCover(game: Game) {
  return game.steamAppId ? `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${game.steamAppId}/header.jpg` : '';
}

function Cover({ game, className = '' }: { game: Game; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = gameCover(game);
  return <div className={`cover ${className}`}>
    {src && !failed ? <img src={src} alt={`${game.name} 封面`} loading="lazy" onError={() => setFailed(true)} /> : <Gamepad2 size={28} />}
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
    </div>
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
          <label>产品分类<select value={form.channel} onChange={e => set('channel', e.target.value)}><option value="端游">端游（PC/主机）</option><option value="App">App</option><option value="小游戏">小游戏（微信/抖音等）</option></select></label>
          <label>游戏类型 <span>*</span><input required value={form.genre} onChange={e => set('genre', e.target.value)} placeholder="例如：模拟经营" /></label>
          <label>发行日期<input type="date" value={form.releaseDate} onChange={e => set('releaseDate', e.target.value)} /></label>
          <label>开发商<input value={form.developer} onChange={e => set('developer', e.target.value)} /></label>
          <label>发行商<input value={form.publisher} onChange={e => set('publisher', e.target.value)} /></label>
          <label>Steam 中国区售价（元）<input type="number" min="0" value={form.price ?? ''} onChange={e => setForm(prev => ({ ...prev, price: e.target.value === '' ? null : Number(e.target.value) }))} /></label>
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
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<View>('projects');
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState('全部');
  const [channel, setChannel] = useState('全部');
  const [platform, setPlatform] = useState('全部');
  const [sort, setSort] = useState('rating');
  const [editing, setEditing] = useState<Game | null | 'new'>(null);
  const [compareA, setCompareA] = useState('1');
  const [compareB, setCompareB] = useState('2');
  const [menuOpen, setMenuOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [importMessage, setImportMessage] = useState('');

  async function refresh() {
    try {
      const response = await fetch('/api/games');
      if (!response.ok) throw new Error('无法读取游戏数据');
      const data: Game[] = await response.json();
      setGames(data); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '加载失败'); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  async function saveGame(value: GameInput) {
    const response = await fetch(editing && editing !== 'new' ? `/api/games/${editing.id}` : '/api/games', { method: editing && editing !== 'new' ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    if (!response.ok) throw new Error((await response.json()).error || '保存失败');
    await refresh();
  }
  async function removeGame(id: string) {
    const response = await fetch(`/api/games/${id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('删除失败');
    await refresh();
  }
  async function importDocument(file: File) {
    setImportMessage('正在导入...');
    try {
      const document = JSON.parse(await file.text());
      const response = await fetch('/api/games/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(document) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '导入失败');
      setImportMessage(`新增 ${result.added} 款，更新演示记录 ${result.replaced} 款，跳过重复 ${result.skipped} 款`);
      await refresh();
    } catch (cause) { setImportMessage(cause instanceof Error ? cause.message : '导入失败'); }
  }

  const genres = useMemo(() => ['全部', ...new Set(games.map(game => game.genre))], [games]);
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
  const channelCounts = useMemo(() => games.reduce<Record<string, number>>((counts, game) => { counts[game.channel] = (counts[game.channel] || 0) + 1; return counts; }, {}), [games]);
  const analysisGames = useMemo(() => games.filter(game => !game.isDemo), [games]);
  const analysisChannelCounts = useMemo(() => analysisGames.reduce<Record<string, number>>((counts, game) => { counts[game.channel] = (counts[game.channel] || 0) + 1; return counts; }, {}), [analysisGames]);
  const categoryData = useMemo(() => Object.entries(analysisGames.reduce<Record<string, number>>((acc, game) => { acc[game.genre] = (acc[game.genre] || 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value })), [analysisGames]);
  const categoryChartData = categoryData.length > 12 ? [...categoryData.slice(0, 11), { name: '其他类型', value: categoryData.slice(11).reduce((sum, item) => sum + item.value, 0) }] : categoryData;
  const platformData = useMemo(() => Object.entries(analysisGames.reduce<Record<string, number>>((acc, game) => { game.platforms.forEach(item => { acc[item] = (acc[item] || 0) + 1; }); return acc; }, {})).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value })), [analysisGames]);
  const yearData = useMemo(() => Object.entries(analysisGames.reduce<Record<string, number>>((acc, game) => { const year = game.releaseDate.slice(0, 4); if (year) acc[year] = (acc[year] || 0) + 1; return acc; }, {})).sort((a, b) => a[0].localeCompare(b[0])).map(([year, count]) => ({ year, count })), [analysisGames]);
  const a = games.find(game => game.id === compareA) || analysisGames[0] || games[0];
  const b = games.find(game => game.id === compareB) || analysisGames.find(game => game.id !== a?.id) || games.find(game => game.id !== a?.id);
  const ratedGames = analysisGames.filter(game => isSteamRecord(game) && game.rating !== null);
  const avgRating = ratedGames.length ? Math.round(ratedGames.reduce((sum, game) => sum + (game.rating || 0), 0) / ratedGames.length) : null;
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
  const nav = (next: View) => { setView(next); setMenuOpen(false); };

  return <div className="app-shell">
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
      <div className="brand"><span className="brand-mark"><Gamepad2 size={21} strokeWidth={2.3} /></span><div><strong>游观</strong><small>GAME INTELLIGENCE</small></div></div>
      <div className="workspace-label">工作空间 <ChevronDown size={14} /></div>
      <div className="workspace-name"><span className="workspace-avatar">点</span><span>点触科技<br /><small>游戏情报工作台</small></span></div>
      <nav className="side-nav" aria-label="主导航">
        <span className="nav-caption">投资研判</span>
        <button className={view === 'projects' ? 'active' : ''} onClick={() => nav('projects')}><ClipboardList size={18} /> 立项项目</button>
        <span className="nav-caption nav-caption-secondary">竞品情报</span>
        <button className={view === 'library' ? 'active' : ''} onClick={() => nav('library')}><LayoutDashboard size={18} /> 情报库 <span className="nav-count">{games.length}</span></button>
        <button className={view === 'analytics' ? 'active' : ''} onClick={() => nav('analytics')}><BarChart3 size={18} /> 可视化分析</button>
        <button className={view === 'compare' ? 'active' : ''} onClick={() => nav('compare')}><ArrowLeftRight size={18} /> 产品对比</button>
      </nav>
      <div className="side-bottom"><div className="side-tip"><Database size={17} /><span>本地情报库<small>团队协作数据</small></span></div><div className="side-profile"><span className="profile-avatar">DC</span><span>点触科技<small>项目工作空间</small></span><CircleHelp size={16} /></div></div>
    </aside>
    {menuOpen && <button className="mobile-scrim" aria-label="关闭菜单" onClick={() => setMenuOpen(false)} />}
    <main className="main">
      <header className="topbar"><div className="top-left"><button className="icon-button mobile-menu" onClick={() => setMenuOpen(true)} aria-label="打开菜单"><Menu size={20} /></button><span>工作空间</span><span className="breadcrumb-sep">/</span><strong>{view === 'projects' ? '立项项目' : view === 'library' ? '游戏情报库' : view === 'analytics' ? '可视化分析' : '产品对比'}</strong></div><div className="top-right">{view !== 'projects' && <span className={`top-status ${error ? 'disconnected' : ''}`}><span /> {error ? '连接失败' : loading ? '连接中' : '数据已连接'}</span>}<span className="top-avatar">DC</span></div></header>
      <div className="content">
        {view === 'projects' && <ProjectWorkspace />}
        {view !== 'projects' && error && <div className="error-banner" role="alert">{error}<button onClick={refresh}>重试</button></div>}
        {view === 'library' && <>
          <div className="page-heading"><div><span className="eyebrow">GAME DATABASE / 01</span><h1>游戏情报库</h1><p>集中查看游戏资料、市场信号与产品定位</p></div><div className="heading-actions"><label className="secondary-button import-button"><Upload size={17} /> 导入 JSON<input type="file" accept="application/json,.json" onChange={event => { const file = event.target.files?.[0]; if (file) void importDocument(file); event.target.value = ''; }} /></label><button className="primary-button" onClick={() => setEditing('new')}><Plus size={18} /> 录入游戏</button></div></div>
          {importMessage && <div className="data-note" role="status">{importMessage}</div>}
          <div className="stat-grid"><div className="stat"><div className="stat-icon teal"><Gamepad2 size={20} /></div><span>收录游戏</span><strong>{games.length}<small> 款</small></strong><p>覆盖 {genres.length - 1} 个游戏类型</p></div><div className="stat"><div className="stat-icon amber"><SlidersHorizontal size={20} /></div><span>游戏类型</span><strong>{genres.length - 1}<small> 类</small></strong><p>多维度分类检索</p></div><div className="stat"><div className="stat-icon blue"><BarChart3 size={20} /></div><span>平均好评率</span><strong>{avgRating ?? '—'}{avgRating !== null && <small> %</small>}</strong><p>仅非演示且有 Steam 好评率的记录</p></div><div className="stat"><div className="stat-icon coral"><ArrowUpRight size={20} /></div><span>覆盖平台</span><strong>{platforms.length - 1}<small> 个</small></strong><p>按来源已核验的平台</p></div></div>
          <div className="insight-strip"><div><span>Steam 实采游戏</span><strong>{liveGames.length}</strong></div><div><span>当前在线合计</span><strong>{formatNumber(totalCurrentPlayers)}</strong></div><div><span>近90天公告</span><strong>{totalNews90Days}</strong></div><div><span>最近采集</span><strong className="capture-time">{formatDateTime(latestCapture)}</strong></div></div>
          <div className="channel-tabs" role="group" aria-label="产品分类筛选">{['全部', '端游', 'App', '小游戏'].map(item => <button key={item} className={channel === item ? 'selected' : ''} onClick={() => setChannel(item)}>{item}<span>{item === '全部' ? games.length : channelCounts[item] || 0}</span></button>)}</div>
          <div className="section-title"><div><h2>游戏列表</h2><p>浏览和筛选收录的游戏产品</p></div><span className="count-pill">共 {filtered.length} 款</span></div>
          <div className="filters"><div className="search-field"><Search size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索游戏、开发商或标签..." aria-label="搜索游戏" />{query && <button onClick={() => setQuery('')} aria-label="清除搜索"><X size={16} /></button>}</div><div className="filter-select"><SlidersHorizontal size={16} /><select value={genre} onChange={e => setGenre(e.target.value)} aria-label="筛选游戏类型">{genres.map(item => <option key={item} value={item}>{item === '全部' ? '全部类型' : item}</option>)}</select></div><div className="filter-select"><select value={platform} onChange={e => setPlatform(e.target.value)} aria-label="筛选平台">{platforms.map(item => <option key={item} value={item}>{item === '全部' ? '全部平台' : item}</option>)}</select></div><div className="filter-select sort-select"><ArrowDownUp size={16} /><select value={sort} onChange={e => setSort(e.target.value)} aria-label="排序"><option value="rating">好评率优先</option><option value="reviews">评价数优先</option><option value="release">最新发行</option><option value="name">名称排序</option></select></div></div>
          <div className="genre-tabs" role="group" aria-label="快捷类型筛选">{genres.slice(0, 7).map(item => <button key={item} className={genre === item ? 'selected' : ''} onClick={() => setGenre(item)}>{item}</button>)}</div>
          <div className="table-wrap"><table><thead><tr><th>游戏 / 产品</th><th>分类</th><th>类型</th><th>数据来源</th><th>采集日期</th><th>平台</th><th>Steam 好评率</th><th>Steam 人民币售价</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>{visibleGames.map(game => <tr key={game.id} onClick={() => setEditing(game)}><td><div className="game-cell"><Cover game={game} /><div><strong>{game.name}</strong><small>{game.englishName || game.developer || '未录入英文名'} {game.isDemo && <em>演示</em>}</small></div></div></td><td>{game.channel}</td><td><span className="genre-badge">{game.genre}</span></td><td>{sourceName(game)}</td><td>{game.dataAsOf || '未录入'}</td><td><div className="platforms">{game.platforms.slice(0, 2).map(item => <span key={item}>{item}</span>)}{game.platforms.length > 2 && <span>+{game.platforms.length - 2}</span>}</div></td><td><span className="rating"><span />{isSteamRecord(game) && game.rating !== null ? `${game.rating}%` : '未录入'}</span></td><td className="price">{isSteamRecord(game) ? formatPrice(game.price) : '未录入'}</td><td><button className="row-action" aria-label={`编辑${game.name}`} onClick={event => { event.stopPropagation(); setEditing(game); }}><ArrowUpRight size={17} /></button></td></tr>)}</tbody></table>{!loading && !filtered.length && <div className="empty-state"><Search size={26} /><strong>没有找到匹配的游戏</strong><p>调整关键词或筛选条件后再试</p></div>}{loading && <div className="empty-state">加载中...</div>}</div>
          {filtered.length > pageSize && <div className="pagination"><span>第 {page} / {totalPages} 页，共 {filtered.length} 款</span><div><button disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button><button disabled={page >= totalPages} onClick={() => setPage(value => value + 1)}>下一页</button></div></div>}
          <div className="data-note">演示记录的指标为样例值。导入样本按来源口径展示；空值表示未取得数据，不等于零。</div>
        </>}
        {view === 'analytics' && <>
          <div className="page-heading"><div><span className="eyebrow">MARKET INSIGHTS / 02</span><h1>可视化分析</h1><p>从类型、平台和发行时间观察当前情报库</p></div><span className="analysis-stamp">基于 {analysisGames.length} 款非演示游戏</span></div>
          <div className="insight-strip"><div><span>非演示游戏</span><strong>{analysisGames.length}</strong></div><div><span>Steam 平均好评率</span><strong>{avgRating === null ? '未录入' : `${avgRating}%`}</strong></div><div><span>最多类型</span><strong>{categoryData[0]?.name || '暂无'}</strong></div><div><span>最广平台</span><strong>{platformData[0]?.name || '暂无'}</strong></div></div>
          <div className="chart-grid live-charts"><section className="chart-panel"><div className="chart-heading"><div><h2><Radio size={16} /> 当前在线排行</h2><p>采集时刻 Steam 在线人数，非历史峰值</p></div><span>实时快照</span></div><div className="chart-box"><ResponsiveContainer width="100%" height="100%"><BarChart data={playerData} layout="vertical" margin={{ top: 0, right: 18, bottom: 0, left: 20 }}><CartesianGrid stroke="#edf0f2" horizontal={false} /><XAxis type="number" tickLine={false} axisLine={false} tick={{ fill: '#8b949c', fontSize: 11 }} /><YAxis dataKey="name" type="category" width={92} tickLine={false} axisLine={false} tick={{ fill: '#4b5660', fontSize: 11 }} /><Tooltip formatter={(value) => Number(value).toLocaleString('zh-CN')} /><Bar dataKey="value" name="当前在线" fill="#38a99c" radius={[0, 4, 4, 0]} barSize={15} /></BarChart></ResponsiveContainer></div></section>
          <section className="chart-panel"><div className="chart-heading"><div><h2><Newspaper size={16} /> 公告时间窗口</h2><p>Steam 官方公告在不同时间窗口的合计</p></div><span>近一年</span></div><div className="chart-box"><ResponsiveContainer width="100%" height="100%"><BarChart data={newsWindowData} margin={{ top: 16, right: 16, bottom: 0, left: -10 }}><CartesianGrid stroke="#edf0f2" vertical={false} /><XAxis dataKey="period" tickLine={false} axisLine={false} tick={{ fill: '#68737d', fontSize: 11 }} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#8b949c', fontSize: 11 }} /><Tooltip /><Bar dataKey="value" name="公告数" fill="#687dd8" radius={[4, 4, 0, 0]} barSize={34} /></BarChart></ResponsiveContainer></div></section></div>
          <section className="news-panel"><div className="chart-heading"><div><h2>最新 Steam 公告</h2><p>按发布时间汇总的最新情报</p></div><span>官方来源</span></div><div className="news-list">{recentNews.map(news => <a key={`${news.gameName}-${news.id}`} href={news.url} target="_blank" rel="noreferrer"><div><strong>{news.title}</strong><span>{news.gameName} · {formatDateTime(news.publishedAt)}</span></div><ExternalLink size={15} /></a>)}</div></section>
          <div className="channel-summary" aria-label="产品分类分布">{['端游', 'App', '小游戏'].map(item => <div key={item}><span>{item}</span><strong>{analysisChannelCounts[item] || 0}</strong><small>款</small></div>)}</div>
          <div className="chart-grid"><section className="chart-panel"><div className="chart-heading"><div><h2>游戏类型分布</h2><p>收录最多的 11 类，其余合并展示</p></div><span>分类视角</span></div><div className="chart-box" style={{ height: Math.max(290, categoryChartData.length * 34) }}><ResponsiveContainer width="100%" height="100%"><BarChart data={categoryChartData} layout="vertical" margin={{ top: 0, right: 18, bottom: 0, left: 10 }}><CartesianGrid stroke="#edf0f2" horizontal={false} /><XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#8b949c', fontSize: 12 }} /><YAxis dataKey="name" type="category" width={92} tickLine={false} axisLine={false} tick={{ fill: '#4b5660', fontSize: 12 }} /><Tooltip cursor={{ fill: '#f6f8f9' }} /><Bar dataKey="value" name="游戏数" radius={[0, 4, 4, 0]} barSize={18}>{categoryChartData.map((item, index) => <Cell key={item.name} fill={palette[index % palette.length]} />)}</Bar></BarChart></ResponsiveContainer></div></section>
          <section className="chart-panel"><div className="chart-heading"><div><h2>平台覆盖</h2><p>单款游戏可计入多个平台</p></div><span>平台视角</span></div><div className="chart-box"><ResponsiveContainer width="100%" height="100%"><BarChart data={platformData} margin={{ top: 16, right: 16, bottom: 0, left: -20 }}><CartesianGrid stroke="#edf0f2" vertical={false} /><XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: '#68737d', fontSize: 12 }} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#8b949c', fontSize: 12 }} /><Tooltip cursor={{ fill: '#f6f8f9' }} /><Bar dataKey="value" name="游戏数" fill="#38a99c" radius={[4, 4, 0, 0]} barSize={30} /></BarChart></ResponsiveContainer></div></section>
          <section className="chart-panel chart-wide"><div className="chart-heading"><div><h2>发行年份趋势</h2><p>按发行年份统计收录产品</p></div><span>时间视角</span></div><div className="chart-box year-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={yearData} margin={{ top: 14, right: 22, bottom: 0, left: -20 }}><defs><linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#38a99c" stopOpacity={0.24} /><stop offset="100%" stopColor="#38a99c" stopOpacity={0.01} /></linearGradient></defs><CartesianGrid stroke="#edf0f2" vertical={false} /><XAxis dataKey="year" tickLine={false} axisLine={false} tick={{ fill: '#68737d', fontSize: 12 }} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#8b949c', fontSize: 12 }} /><Tooltip /><Area dataKey="count" name="游戏数" stroke="#279c90" strokeWidth={2.5} fill="url(#areaFill)" /></AreaChart></ResponsiveContainer></div></section></div>
          <div className="data-note">图表只统计非演示记录。类型和平台数量反映当前选取的样本，不能视为全球市场规模或收入份额；平均好评率只计算有 Steam 评价的记录。</div>
        </>}
        {view === 'compare' && <>
          <div className="page-heading"><div><span className="eyebrow">PRODUCT COMPARISON / 03</span><h1>产品对比</h1><p>并排查看两款游戏的定位与核心指标</p></div></div>
          <div className="compare-pickers"><div><label htmlFor="compare-a">产品 A</label><select id="compare-a" value={a?.id || ''} onChange={e => setCompareA(e.target.value)}>{games.filter(game => game.id !== b?.id).map(game => <option key={game.id} value={game.id}>{game.name}</option>)}</select></div><div className="swap-mark"><ArrowLeftRight size={20} /></div><div><label htmlFor="compare-b">产品 B</label><select id="compare-b" value={b?.id || ''} onChange={e => setCompareB(e.target.value)}>{games.filter(game => game.id !== a?.id).map(game => <option key={game.id} value={game.id}>{game.name}</option>)}</select></div></div>
          {a && b ? <><div className="compare-heroes"><div className="compare-product"><Cover game={a} className="compare-cover" /><div><span className="compare-label">产品 A</span><h2>{a.name}</h2><p>{a.englishName || a.developer}</p><div className="compare-tags">{a.tags.slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}</div></div></div><div className="compare-product"><Cover game={b} className="compare-cover" /><div><span className="compare-label">产品 B</span><h2>{b.name}</h2><p>{b.englishName || b.developer}</p><div className="compare-tags">{b.tags.slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}</div></div></div></div>
          <div className="compare-table">
            <div className="compare-section">基础信息</div>
            {([['游戏类型', a.genre, b.genre], ['开发商', a.developer, b.developer], ['发行商', a.publisher, b.publisher], ['发行日期', a.releaseDate, b.releaseDate], ['覆盖平台', a.platforms.join('、'), b.platforms.join('、')]] as string[][]).map(([label, av, bv]) => <div className="compare-row" key={label}><span>{label}</span><strong>{av || '未录入'}</strong><strong>{bv || '未录入'}</strong></div>)}
            <div className="compare-section">Steam 指标 <small>人民币价格、Steam 用户评价</small></div>
            {([['中国区售价', isSteamRecord(a) ? formatPrice(a.price) : '不适用', isSteamRecord(b) ? formatPrice(b.price) : '不适用'], ['好评率', isSteamRecord(a) && a.rating !== null ? `${a.rating}%` : '不适用', isSteamRecord(b) && b.rating !== null ? `${b.rating}%` : '不适用'], ['评价数', isSteamRecord(a) ? formatNumber(a.reviewCount) : '不适用', isSteamRecord(b) ? formatNumber(b.reviewCount) : '不适用'], ['历史峰值在线', isSteamRecord(a) ? formatNumber(a.peakPlayers) : '不适用', isSteamRecord(b) ? formatNumber(b.peakPlayers) : '不适用']] as string[][]).map(([label, av, bv]) => <div className="compare-row" key={label}><span>{label}</span><strong>{av}</strong><strong>{bv}</strong></div>)}
            <div className="compare-section">Steam 实采指标 <small>{formatDateTime(latestCapture)}</small></div>
            {([['当前在线', a.hasLiveData ? formatNumber(Number(a.currentPlayers || 0)) : '未采集', b.hasLiveData ? formatNumber(Number(b.currentPlayers || 0)) : '未采集'], ['近365天公告', `${a.steamNewsCounts?.last365Days ?? 0} 条`, `${b.steamNewsCounts?.last365Days ?? 0} 条`], ['近90天公告', `${a.steamNewsCounts?.last90Days ?? 0} 条`, `${b.steamNewsCounts?.last90Days ?? 0} 条`], ['近30天公告', `${a.steamNewsCounts?.last30Days ?? 0} 条`, `${b.steamNewsCounts?.last30Days ?? 0} 条`], ['近7天公告', `${a.steamNewsCounts?.last7Days ?? 0} 条`, `${b.steamNewsCounts?.last7Days ?? 0} 条`]] as string[][]).map(([label, av, bv]) => <div className="compare-row" key={label}><span>{label}</span><strong>{av}</strong><strong>{bv}</strong></div>)}
            <div className="compare-section">App Store 美国区指标 <small>美元价格、五星评分；与 Steam 指标不可直接比较</small></div>
            {([['美国区售价', formatUsd(a.sourceExtras?.usPriceUsd), formatUsd(b.sourceExtras?.usPriceUsd)], ['五星评分', a.sourceExtras?.usRatingOutOf5 == null ? '未录入' : `${a.sourceExtras.usRatingOutOf5} / 5`, b.sourceExtras?.usRatingOutOf5 == null ? '未录入' : `${b.sourceExtras.usRatingOutOf5} / 5`], ['评分数', formatNumber(a.sourceExtras?.usRatingCount ?? null), formatNumber(b.sourceExtras?.usRatingCount ?? null)]] as string[][]).map(([label, av, bv]) => <div className="compare-row" key={label}><span>{label}</span><strong>{av}</strong><strong>{bv}</strong></div>)}
          </div>
          <div className="compare-sources"><MetricSource game={a} /><MetricSource game={b} /></div>
          </> : <div className="empty-state">请至少录入两款游戏以进行对比</div>}
        </>}
      </div>
    </main>
    {editing && <Modal key={editing === 'new' ? 'new' : editing.id} game={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSave={saveGame} onDelete={removeGame} />}
  </div>;
}
