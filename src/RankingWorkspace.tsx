import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ExternalLink, Gamepad2, RefreshCw, Search, TrendingUp } from 'lucide-react';
import './rankings.css';

type RankingGame = { rank: number; id: string; name: string; icon: string; developer: string; tags: string[]; description: string; url: string };
type Board = { label: string; url: string; items: RankingGame[]; fetchedAt: string | null; error: string | null };
type RankingData = { source: string; boards: Record<'popular' | 'bestSell' | 'new', Board> };
type RankingKey = keyof RankingData['boards'];
const boardKeys: RankingKey[] = ['popular', 'bestSell', 'new'];
const boardNames: Record<RankingKey, string> = { popular: '最受欢迎', bestSell: '畅销榜', new: '热门新游' };

function requestWithXhr(url: string): Promise<RankingData> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('GET', url);
    request.timeout = 20000;
    request.onload = () => {
      if (request.status !== 200) return reject(new Error(`榜单接口返回 HTTP ${request.status}`));
      try { resolve(JSON.parse(request.responseText) as RankingData); }
      catch { reject(new Error('榜单接口返回了无法解析的数据')); }
    };
    request.onerror = () => reject(new Error('浏览器无法连接榜单接口'));
    request.ontimeout = () => reject(new Error('榜单接口请求超时'));
    request.send();
  });
}

async function requestRankings(force: boolean): Promise<RankingData> {
  const url = `${window.location.origin}/api/rankings${force ? '?refresh=1' : ''}`;
  try {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`榜单接口返回 HTTP ${response.status}`);
    const data = await response.json() as RankingData;
    if (!data.boards?.bestSell) throw new Error('榜单接口返回的数据不完整');
    return data;
  } catch (error) {
    const fallback = await requestWithXhr(url);
    if (!fallback.boards?.bestSell) throw error;
    return fallback;
  }
}

function hypotheses(game: RankingGame) {
  const text = `${game.tags.join(' ')} ${game.description} ${game.name}`;
  if (/策略|SLG|三国|塔防|战争|国战/.test(text)) return {
    loop: '关卡推进、阵容养成与联盟协作可能形成长期目标。',
    revenue: '优先核实抽卡、成长礼包、月卡及赛季活动等内购入口；付费设计可能围绕养成速度与稀缺资源。',
    retention: '观察联盟任务、限时活动、赛季重置与回流奖励是否带动留存。',
    cost: '重点核实买量成本、美术与内容更新、服务器及客服成本。',
    metrics: ['付费转化率与 ARPPU', '首日/7日/30日留存', '用户获取成本与回本周期', '活动收入及付费集中度']
  };
  if (/经营|模拟|放置|养成|农场|餐厅/.test(text)) return {
    loop: '经营扩张、设施升级及离线收益可能推动反复回访。',
    revenue: '核实加速道具、资源礼包、通行证和激励广告的实际存在与占比。',
    retention: '观察每日订单、连续签到、新场景解锁及活动周期。',
    cost: '重点核实内容产能、买量、广告分成与持续运营成本。',
    metrics: ['广告展示率与 eCPM', '付费转化率与客单价', '7日/30日留存', '获客成本与 LTV']
  };
  if (/消除|休闲|益智|解谜|跑酷|闯关|合成/.test(text)) return {
    loop: '短局关卡、挑战进度与难度阶梯可能提高重复游玩。',
    revenue: '核实激励视频、插屏广告、去广告商品及关卡道具等变现入口。',
    retention: '观察关卡卡点、每日挑战和新关卡供给对回访的影响。',
    cost: '重点核实广告变现效率、关卡制作、买量与平台分成。',
    metrics: ['人均广告展示与 eCPM', '关卡完成率', 'D1/D7 留存', '买量成本与广告 LTV']
  };
  return {
    loop: '需要体验产品后确认核心玩法循环、进度系统与长期目标。',
    revenue: '先核实商品页和游戏内是否存在内购、广告、订阅或其他付费入口。',
    retention: '核实每日任务、社交玩法、活动更新及回流机制。',
    cost: '核实流量采购、研发内容、服务器、渠道分成与客服成本。',
    metrics: ['收入结构与付费转化率', 'D1/D7/D30 留存', '获客成本与 LTV', '毛利与回本周期']
  };
}

function GameIcon({ game }: { game: RankingGame }) {
  const [failed, setFailed] = useState(false);
  return <span className="ranking-icon">{game.icon && !failed ? <img src={game.icon} alt="" loading="lazy" onError={() => setFailed(true)} /> : <Gamepad2 size={22} />}</span>;
}

export default function RankingWorkspace({ mode }: { mode: 'boards' | 'breakdown' }) {
  const [data, setData] = useState<RankingData | null>(null);
  const [active, setActive] = useState<RankingKey>('popular');
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function reload(force = false) {
    setLoading(true); setError('');
    try {
      setData(await requestRankings(force));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '榜单加载失败'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void reload(); }, []);
  const board = data?.boards[active];
  const bestSell = data?.boards.bestSell;
  const selected = bestSell?.items.find(game => game.id === selectedId) || bestSell?.items[0];
  const analysis = selected ? hypotheses(selected) : null;
  const filtered = useMemo(() => board?.items.filter(game => `${game.name} ${game.developer} ${game.tags.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase())) || [], [board, query]);
  const boardTime = mode === 'boards' ? board?.fetchedAt : bestSell?.fetchedAt;
  const boardError = mode === 'boards' ? board?.error : bestSell?.error;

  return <div className="ranking-workspace">
    <div className="page-heading ranking-heading"><div><span className="eyebrow">WECHAT GAME INTELLIGENCE</span><h1>{mode === 'boards' ? '游戏榜单' : '畅销游戏盈利拆解'}</h1><p>{mode === 'boards' ? '查看腾讯应用宝微信小游戏热门、畅销与新游排名' : '从畅销榜逐款研究产品定位与可能的盈利路径'}</p></div><button className="secondary-button" onClick={() => void reload(true)} disabled={loading} title="重新获取三个榜单"><RefreshCw size={16} className={loading ? 'ranking-spinning' : ''} />{loading ? '更新中' : '更新榜单'}</button></div>
    <div className="ranking-source"><div><strong>腾讯应用宝 · 微信小游戏榜单</strong><span>{boardTime ? `采集时间：${new Date(boardTime).toLocaleString('zh-CN')}` : loading ? '正在获取榜单' : '尚无成功快照'}</span></div><a href={mode === 'boards' ? board?.url || data?.boards.popular.url : bestSell?.url} target="_blank" rel="noreferrer">查看来源 <ExternalLink size={14} /></a></div>
    {(error || boardError) && <div className="ranking-warning" role="alert">{boardTime ? '本次更新失败，显示上次成功快照。' : '暂时无法获取榜单。'} {error || boardError}</div>}
    {mode === 'boards' ? <>
      <div className="ranking-controls"><div className="ranking-tabs" role="tablist" aria-label="榜单类型">{boardKeys.map(key => <button key={key} role="tab" aria-selected={active === key} className={active === key ? 'selected' : ''} onClick={() => { setActive(key); setQuery(''); }}>{boardNames[key]}</button>)}</div><label className="ranking-search"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索榜单游戏" aria-label="搜索榜单游戏" /></label></div>
      <div className="ranking-list-head"><strong>{boardNames[active]}</strong><span>{board?.items.length || 0} 款 · 页面展示顺序</span></div>
      <div className="ranking-list">{filtered.map(game => <div className="ranking-row" key={game.id}><span className={`ranking-position ${game.rank <= 3 ? 'top' : ''}`}>{String(game.rank).padStart(2, '0')}</span><GameIcon game={game} /><div className="ranking-game"><strong>{game.name}</strong><span>{game.developer || '开发商未公开'}{game.tags.length ? ` · ${game.tags.slice(0, 2).join(' / ')}` : ''}</span></div><a href={game.url} target="_blank" rel="noreferrer" title={`查看${game.name}商品页`} aria-label={`查看${game.name}商品页`}><ExternalLink size={17} /></a></div>)}{!loading && !filtered.length && <div className="ranking-empty">{board?.items.length ? '没有匹配的游戏' : '暂无榜单数据'}</div>}</div>
      <p className="ranking-footnote">排名为应用宝页面显示顺序，只代表该平台微信小游戏榜单，不代表全平台热度、真实销量或收入。</p>
    </> : <>
      <div className="breakdown-layout"><div className="breakdown-rail"><div className="ranking-list-head"><strong>畅销榜游戏</strong><span>{bestSell?.items.length || 0} 款</span></div><div className="breakdown-game-list">{bestSell?.items.map(game => <button key={game.id} className={selected?.id === game.id ? 'selected' : ''} onClick={() => setSelectedId(game.id)}><span>{String(game.rank).padStart(2, '0')}</span><GameIcon game={game} /><strong>{game.name}</strong><ArrowRight size={15} /></button>)}{!loading && !bestSell?.items.length && <div className="ranking-empty">暂无畅销榜数据</div>}</div></div>
        <div className="breakdown-detail">{selected && analysis ? <><div className="breakdown-hero"><GameIcon game={selected} /><div><span className="breakdown-kicker">畅销榜第 {selected.rank} 名 · 腾讯应用宝微信小游戏</span><h2>{selected.name}</h2><p>{selected.developer || '开发商未公开'}{selected.tags.length ? ` · ${selected.tags.join(' / ')}` : ''}</p></div><a href={selected.url} target="_blank" rel="noreferrer" title="查看官方商品页"><ExternalLink size={17} /></a></div>
          {selected.description && <p className="breakdown-description">{selected.description}</p>}
          <div className="breakdown-note"><TrendingUp size={17} /><span>以下是根据公开类型与商品简介形成的分析假设，尚未经产品体验或经营数据验证。</span></div>
          <div className="breakdown-grid"><section><span>01 / 玩法与回访</span><h3>核心循环假设</h3><p>{analysis.loop}</p></section><section><span>02 / 收入</span><h3>变现路径假设</h3><p>{analysis.revenue}</p></section><section><span>03 / 运营</span><h3>留存抓手</h3><p>{analysis.retention}</p></section><section><span>04 / 成本</span><h3>主要成本环节</h3><p>{analysis.cost}</p></section></div>
          <div className="breakdown-verify"><h3>下一步需要核实</h3><div>{analysis.metrics.map(metric => <span key={metric}>{metric}</span>)}</div></div>
          <p className="ranking-footnote">应用宝排名不等于实际盈利。当前未取得该游戏收入、利润、DAU、付费率或投放成本，不能据此计算 ROI。</p>
        </> : <div className="ranking-empty">选择一款畅销游戏查看分析</div>}</div></div>
    </>}
  </div>;
}
