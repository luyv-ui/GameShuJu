import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownUp, ArrowLeftRight, ArrowUpRight, BarChart3, Check, ChevronDown, CircleHelp, Database, ExternalLink, Gamepad2, LayoutDashboard, Menu, Plus, Search, SlidersHorizontal, Trash2, X } from 'lucide-react';
import type { Game, GameInput } from './types';

type View = 'library' | 'analytics' | 'compare';
const palette = ['#e9a236', '#37a89b', '#687dd8', '#e16f72', '#889db2', '#b37ac5'];
const emptyGame: GameInput = { name: '', englishName: '', genre: '', platforms: [], releaseDate: '', developer: '', publisher: '', price: 0, rating: 0, reviewCount: 0, peakPlayers: 0, tags: [], description: '', steamAppId: null, sourceUrl: '', isDemo: false };

function formatNumber(value: number) {
  if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}万`;
  return value.toLocaleString('zh-CN');
}

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

function Modal({ game, onClose, onSave, onDelete }: { game?: Game; onClose: () => void; onSave: (value: GameInput) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const [form, setForm] = useState<GameInput>(game ? { ...game } : emptyGame);
  const [platformText, setPlatformText] = useState(game?.platforms.join('、') || '');
  const [tagText, setTagText] = useState(game?.tags.join('、') || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key: keyof GameInput, value: string | number | boolean) => setForm(prev => ({ ...prev, [key]: value }));
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
          <label>游戏类型 <span>*</span><input required value={form.genre} onChange={e => set('genre', e.target.value)} placeholder="例如：模拟经营" /></label>
          <label>发行日期<input type="date" value={form.releaseDate} onChange={e => set('releaseDate', e.target.value)} /></label>
          <label>开发商<input value={form.developer} onChange={e => set('developer', e.target.value)} /></label>
          <label>发行商<input value={form.publisher} onChange={e => set('publisher', e.target.value)} /></label>
          <label>售价（元）<input type="number" min="0" value={form.price} onChange={e => set('price', Number(e.target.value))} /></label>
          <label>好评率（%）<input type="number" min="0" max="100" value={form.rating} onChange={e => set('rating', Number(e.target.value))} /></label>
          <label>评价数<input type="number" min="0" value={form.reviewCount} onChange={e => set('reviewCount', Number(e.target.value))} /></label>
          <label>历史峰值在线<input type="number" min="0" value={form.peakPlayers} onChange={e => set('peakPlayers', Number(e.target.value))} /></label>
          <label>平台（用顿号分隔）<input value={platformText} onChange={e => setPlatformText(e.target.value)} placeholder="PC、Switch、PS5" /></label>
          <label>标签（用顿号分隔）<input value={tagText} onChange={e => setTagText(e.target.value)} placeholder="开放世界、多人" /></label>
          <label>Steam App ID<input type="number" min="1" value={form.steamAppId || ''} onChange={e => set('steamAppId', Number(e.target.value))} placeholder="用于显示游戏封面" /></label>
          <label>来源链接<input type="url" value={form.sourceUrl} onChange={e => set('sourceUrl', e.target.value)} placeholder="https://" /></label>
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
  const [view, setView] = useState<View>('library');
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState('全部');
  const [platform, setPlatform] = useState('全部');
  const [sort, setSort] = useState('rating');
  const [editing, setEditing] = useState<Game | null | 'new'>(null);
  const [compareA, setCompareA] = useState('1');
  const [compareB, setCompareB] = useState('2');
  const [menuOpen, setMenuOpen] = useState(false);

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

  const genres = useMemo(() => ['全部', ...new Set(games.map(game => game.genre))], [games]);
  const platforms = useMemo(() => ['全部', ...new Set(games.flatMap(game => game.platforms))], [games]);
  const filtered = useMemo(() => games.filter(game => {
    const text = [game.name, game.englishName, game.developer, game.publisher, ...game.tags].join(' ').toLocaleLowerCase();
    return text.includes(query.trim().toLocaleLowerCase()) && (genre === '全部' || game.genre === genre) && (platform === '全部' || game.platforms.includes(platform));
  }).sort((a, b) => sort === 'rating' ? b.rating - a.rating : sort === 'reviews' ? b.reviewCount - a.reviewCount : sort === 'release' ? b.releaseDate.localeCompare(a.releaseDate) : a.name.localeCompare(b.name, 'zh-CN')), [games, query, genre, platform, sort]);
  const categoryData = useMemo(() => Object.entries(games.reduce<Record<string, number>>((acc, game) => { acc[game.genre] = (acc[game.genre] || 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value })), [games]);
  const platformData = useMemo(() => Object.entries(games.reduce<Record<string, number>>((acc, game) => { game.platforms.forEach(item => { acc[item] = (acc[item] || 0) + 1; }); return acc; }, {})).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value })), [games]);
  const yearData = useMemo(() => Object.entries(games.reduce<Record<string, number>>((acc, game) => { const year = game.releaseDate.slice(0, 4); if (year) acc[year] = (acc[year] || 0) + 1; return acc; }, {})).sort((a, b) => a[0].localeCompare(b[0])).map(([year, count]) => ({ year, count })), [games]);
  const a = games.find(game => game.id === compareA) || games[0];
  const b = games.find(game => game.id === compareB) || games.find(game => game.id !== a?.id);
  const avgRating = games.length ? Math.round(games.reduce((sum, game) => sum + game.rating, 0) / games.length) : 0;
  const nav = (next: View) => { setView(next); setMenuOpen(false); };

  return <div className="app-shell">
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
      <div className="brand"><span className="brand-mark"><Gamepad2 size={21} strokeWidth={2.3} /></span><div><strong>游观</strong><small>GAME INTELLIGENCE</small></div></div>
      <div className="workspace-label">工作空间 <ChevronDown size={14} /></div>
      <div className="workspace-name"><span className="workspace-avatar">点</span><span>点触科技<br /><small>游戏情报工作台</small></span></div>
      <nav className="side-nav" aria-label="主导航">
        <span className="nav-caption">探索</span>
        <button className={view === 'library' ? 'active' : ''} onClick={() => nav('library')}><LayoutDashboard size={18} /> 情报库 <span className="nav-count">{games.length}</span></button>
        <button className={view === 'analytics' ? 'active' : ''} onClick={() => nav('analytics')}><BarChart3 size={18} /> 可视化分析</button>
        <button className={view === 'compare' ? 'active' : ''} onClick={() => nav('compare')}><ArrowLeftRight size={18} /> 产品对比</button>
      </nav>
      <div className="side-bottom"><div className="side-tip"><Database size={17} /><span>本地情报库<small>团队协作数据</small></span></div><div className="side-profile"><span className="profile-avatar">DC</span><span>点触科技<small>项目工作空间</small></span><CircleHelp size={16} /></div></div>
    </aside>
    {menuOpen && <button className="mobile-scrim" aria-label="关闭菜单" onClick={() => setMenuOpen(false)} />}
    <main className="main">
      <header className="topbar"><div className="top-left"><button className="icon-button mobile-menu" onClick={() => setMenuOpen(true)} aria-label="打开菜单"><Menu size={20} /></button><span>工作空间</span><span className="breadcrumb-sep">/</span><strong>{view === 'library' ? '游戏情报库' : view === 'analytics' ? '可视化分析' : '产品对比'}</strong></div><div className="top-right"><span className={`top-status ${error ? 'disconnected' : ''}`}><span /> {error ? '连接失败' : loading ? '连接中' : '数据已连接'}</span><span className="top-avatar">DC</span></div></header>
      <div className="content">
        {error && <div className="error-banner" role="alert">{error}<button onClick={refresh}>重试</button></div>}
        {view === 'library' && <>
          <div className="page-heading"><div><span className="eyebrow">GAME DATABASE / 01</span><h1>游戏情报库</h1><p>集中查看游戏资料、市场信号与产品定位</p></div><button className="primary-button" onClick={() => setEditing('new')}><Plus size={18} /> 录入游戏</button></div>
          <div className="stat-grid"><div className="stat"><div className="stat-icon teal"><Gamepad2 size={20} /></div><span>收录游戏</span><strong>{games.length}<small> 款</small></strong><p>覆盖 {genres.length - 1} 个游戏类型</p></div><div className="stat"><div className="stat-icon amber"><SlidersHorizontal size={20} /></div><span>游戏类型</span><strong>{genres.length - 1}<small> 类</small></strong><p>多维度分类检索</p></div><div className="stat"><div className="stat-icon blue"><BarChart3 size={20} /></div><span>平均好评率</span><strong>{avgRating}<small> %</small></strong><p>基于当前情报库</p></div><div className="stat"><div className="stat-icon coral"><ArrowUpRight size={20} /></div><span>覆盖平台</span><strong>{platforms.length - 1}<small> 个</small></strong><p>PC、主机与移动端</p></div></div>
          <div className="section-title"><div><h2>游戏列表</h2><p>浏览和筛选收录的游戏产品</p></div><span className="count-pill">共 {filtered.length} 款</span></div>
          <div className="filters"><div className="search-field"><Search size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索游戏、开发商或标签..." aria-label="搜索游戏" />{query && <button onClick={() => setQuery('')} aria-label="清除搜索"><X size={16} /></button>}</div><div className="filter-select"><SlidersHorizontal size={16} /><select value={genre} onChange={e => setGenre(e.target.value)} aria-label="筛选游戏类型">{genres.map(item => <option key={item} value={item}>{item === '全部' ? '全部类型' : item}</option>)}</select></div><div className="filter-select"><select value={platform} onChange={e => setPlatform(e.target.value)} aria-label="筛选平台">{platforms.map(item => <option key={item} value={item}>{item === '全部' ? '全部平台' : item}</option>)}</select></div><div className="filter-select sort-select"><ArrowDownUp size={16} /><select value={sort} onChange={e => setSort(e.target.value)} aria-label="排序"><option value="rating">好评率优先</option><option value="reviews">评价数优先</option><option value="release">最新发行</option><option value="name">名称排序</option></select></div></div>
          <div className="genre-tabs" role="group" aria-label="快捷类型筛选">{genres.slice(0, 7).map(item => <button key={item} className={genre === item ? 'selected' : ''} onClick={() => setGenre(item)}>{item}</button>)}</div>
          <div className="table-wrap"><table><thead><tr><th>游戏 / 产品</th><th>类型</th><th>发行日期</th><th>平台</th><th>好评率</th><th>售价</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>{filtered.map(game => <tr key={game.id} onClick={() => setEditing(game)}><td><div className="game-cell"><Cover game={game} /><div><strong>{game.name}</strong><small>{game.englishName || game.developer || '未录入英文名'} {game.isDemo && <em>演示</em>}</small></div></div></td><td><span className="genre-badge">{game.genre}</span></td><td>{game.releaseDate || '未录入'}</td><td><div className="platforms">{game.platforms.slice(0, 2).map(item => <span key={item}>{item}</span>)}{game.platforms.length > 2 && <span>+{game.platforms.length - 2}</span>}</div></td><td><span className="rating"><span />{game.rating ? `${game.rating}%` : '未录入'}</span></td><td className="price">¥{game.price}</td><td><button className="row-action" aria-label={`编辑${game.name}`} onClick={event => { event.stopPropagation(); setEditing(game); }}><ArrowUpRight size={17} /></button></td></tr>)}</tbody></table>{!loading && !filtered.length && <div className="empty-state"><Search size={26} /><strong>没有找到匹配的游戏</strong><p>调整关键词或筛选条件后再试</p></div>}{loading && <div className="empty-state">加载中...</div>}</div>
          <div className="data-note">演示记录的价格、好评率、评价数与在线峰值为样例值；实际分析请录入有来源的真实数据。</div>
        </>}
        {view === 'analytics' && <>
          <div className="page-heading"><div><span className="eyebrow">MARKET INSIGHTS / 02</span><h1>可视化分析</h1><p>从类型、平台和发行时间观察当前情报库</p></div><span className="analysis-stamp">基于 {games.length} 款游戏</span></div>
          <div className="insight-strip"><div><span>收录游戏</span><strong>{games.length}</strong></div><div><span>平均好评率</span><strong>{avgRating}%</strong></div><div><span>最多类型</span><strong>{categoryData[0]?.name || '暂无'}</strong></div><div><span>最广平台</span><strong>{platformData[0]?.name || '暂无'}</strong></div></div>
          <div className="chart-grid"><section className="chart-panel"><div className="chart-heading"><div><h2>游戏类型分布</h2><p>各类型收录数量</p></div><span>分类视角</span></div><div className="chart-box"><ResponsiveContainer width="100%" height="100%"><BarChart data={categoryData} layout="vertical" margin={{ top: 0, right: 18, bottom: 0, left: 10 }}><CartesianGrid stroke="#edf0f2" horizontal={false} /><XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#8b949c', fontSize: 12 }} /><YAxis dataKey="name" type="category" width={92} tickLine={false} axisLine={false} tick={{ fill: '#4b5660', fontSize: 12 }} /><Tooltip cursor={{ fill: '#f6f8f9' }} /><Bar dataKey="value" name="游戏数" radius={[0, 4, 4, 0]} barSize={18}>{categoryData.map((item, index) => <Cell key={item.name} fill={palette[index % palette.length]} />)}</Bar></BarChart></ResponsiveContainer></div></section>
          <section className="chart-panel"><div className="chart-heading"><div><h2>平台覆盖</h2><p>单款游戏可计入多个平台</p></div><span>平台视角</span></div><div className="chart-box"><ResponsiveContainer width="100%" height="100%"><BarChart data={platformData} margin={{ top: 16, right: 16, bottom: 0, left: -20 }}><CartesianGrid stroke="#edf0f2" vertical={false} /><XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: '#68737d', fontSize: 12 }} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#8b949c', fontSize: 12 }} /><Tooltip cursor={{ fill: '#f6f8f9' }} /><Bar dataKey="value" name="游戏数" fill="#38a99c" radius={[4, 4, 0, 0]} barSize={30} /></BarChart></ResponsiveContainer></div></section>
          <section className="chart-panel chart-wide"><div className="chart-heading"><div><h2>发行年份趋势</h2><p>按发行年份统计收录产品</p></div><span>时间视角</span></div><div className="chart-box year-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={yearData} margin={{ top: 14, right: 22, bottom: 0, left: -20 }}><defs><linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#38a99c" stopOpacity={0.24} /><stop offset="100%" stopColor="#38a99c" stopOpacity={0.01} /></linearGradient></defs><CartesianGrid stroke="#edf0f2" vertical={false} /><XAxis dataKey="year" tickLine={false} axisLine={false} tick={{ fill: '#68737d', fontSize: 12 }} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#8b949c', fontSize: 12 }} /><Tooltip /><Area dataKey="count" name="游戏数" stroke="#279c90" strokeWidth={2.5} fill="url(#areaFill)" /></AreaChart></ResponsiveContainer></div></section></div>
          <div className="data-note">图表只统计当前情报库；演示记录的部分指标为样例值。</div>
        </>}
        {view === 'compare' && <>
          <div className="page-heading"><div><span className="eyebrow">PRODUCT COMPARISON / 03</span><h1>产品对比</h1><p>并排查看两款游戏的定位与核心指标</p></div></div>
          <div className="compare-pickers"><div><label htmlFor="compare-a">产品 A</label><select id="compare-a" value={a?.id || ''} onChange={e => setCompareA(e.target.value)}>{games.filter(game => game.id !== b?.id).map(game => <option key={game.id} value={game.id}>{game.name}</option>)}</select></div><div className="swap-mark"><ArrowLeftRight size={20} /></div><div><label htmlFor="compare-b">产品 B</label><select id="compare-b" value={b?.id || ''} onChange={e => setCompareB(e.target.value)}>{games.filter(game => game.id !== a?.id).map(game => <option key={game.id} value={game.id}>{game.name}</option>)}</select></div></div>
          {a && b ? <><div className="compare-heroes"><div className="compare-product"><Cover game={a} className="compare-cover" /><div><span className="compare-label">产品 A</span><h2>{a.name}</h2><p>{a.englishName || a.developer}</p><div className="compare-tags">{a.tags.slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}</div></div></div><div className="compare-product"><Cover game={b} className="compare-cover" /><div><span className="compare-label">产品 B</span><h2>{b.name}</h2><p>{b.englishName || b.developer}</p><div className="compare-tags">{b.tags.slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}</div></div></div></div>
          <div className="compare-table"><div className="compare-section">基础信息</div>{([['游戏类型', a.genre, b.genre], ['开发商', a.developer, b.developer], ['发行商', a.publisher, b.publisher], ['发行日期', a.releaseDate, b.releaseDate], ['覆盖平台', a.platforms.join('、'), b.platforms.join('、')]] as string[][]).map(([label, av, bv]) => <div className="compare-row" key={label}><span>{label}</span><strong>{av || '未录入'}</strong><strong>{bv || '未录入'}</strong></div>)}<div className="compare-section">市场指标 <small>演示记录为样例值</small></div>{([['售价', `¥${a.price}`, `¥${b.price}`], ['好评率', `${a.rating}%`, `${b.rating}%`], ['评价数', formatNumber(a.reviewCount), formatNumber(b.reviewCount)], ['历史峰值在线', formatNumber(a.peakPlayers), formatNumber(b.peakPlayers)]] as string[][]).map(([label, av, bv]) => <div className="compare-row" key={label}><span>{label}</span><strong>{av}</strong><strong>{bv}</strong></div>)}</div>
          <div className="compare-links">{[a, b].map(game => game.sourceUrl && <a key={game.id} href={game.sourceUrl} target="_blank" rel="noreferrer">查看 {game.name} 来源 <ExternalLink size={15} /></a>)}</div></> : <div className="empty-state">请至少录入两款游戏以进行对比</div>}
        </>}
      </div>
    </main>
    {editing && <Modal key={editing === 'new' ? 'new' : editing.id} game={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSave={saveGame} onDelete={removeGame} />}
  </div>;
}
