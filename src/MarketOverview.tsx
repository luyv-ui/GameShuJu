import { useEffect, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { ExternalLink, Gamepad2, Users } from 'lucide-react';
import { apiUrl } from './api-url';
import './market-overview.css';

type RankedGame = { id: string; rank: number; name: string; icon: string; tags: string[]; description: string; developer: string; url: string };
type RankingResponse = { boards?: { bestSell?: { items?: RankedGame[] } } };
const chinaSource = 'http://www.gamelook.com.cn/2025/12/584413/';
const globalSource = 'http://www.gamelook.com.cn/2026/09/602281/';
const colors = ['#229b8d', '#e5a23e', '#547ca5', '#d27069', '#87969d'];
const charts = [
  { title: '中国游戏市场', subtitle: '2025 年 · 实际销售收入份额', source: chinaSource, note: '移动、客户端、网页与主机按报告披露值计算；“其他”是总收入扣除以上类别的余额。', rows: [
    { name: '移动游戏', value: 73.29 }, { name: '客户端游戏', value: 22.28 }, { name: '网页游戏', value: 1.23 }, { name: '主机游戏', value: 2.38 }, { name: '其他', value: 0.82 }
  ] },
  { title: '全球游戏市场', subtitle: '2026 年 · Newzoo 收入预测', source: globalSource, note: '全球口径包含中国，不能解释为“中国以外”市场份额；按 1211/459/469 亿美元计算。', rows: [
    { name: '移动游戏', value: 56.6 }, { name: 'PC 游戏', value: 21.5 }, { name: '主机游戏', value: 21.9 }
  ] },
  { title: '中国自研手游海外收入', subtitle: '2025 年 · 前百产品品类份额', source: chinaSource, note: '仅覆盖收入前 100 的中国自研出海移动游戏，并非整个海外游戏市场。', rows: [
    { name: '策略（含 SLG）', value: 49.96 }, { name: '射击', value: 9.69 }, { name: '角色扮演', value: 9.39 }, { name: '其他类型', value: 30.96 }
  ] }
];

function persona(game: RankedGame) {
  const words = `${game.name} ${game.tags.join(' ')} ${game.description}`;
  if (/策略|三国|战争|国战|SLG|塔防/.test(words)) return {
    motivation: '可能偏好阵容构筑、资源规划、竞争排名与联盟协作。',
    behavior: '重点观察中长期养成、赛季活动、社交组队与连续回访。',
    purchase: '核实加速资源、角色养成、月卡和活动礼包是否存在，以及不同付费层级的价值。',
    validation: '访谈战略玩法用户；核对 D1/D7/D30 留存、联盟参与率、付费转化与 ARPPU。'
  };
  if (/经营|模拟|放置|养成|农场|花园|餐厅/.test(words)) return {
    motivation: '可能看重轻量经营、收集进度与持续解锁的正反馈。',
    behavior: '关注碎片化回访、每日任务、离线收益和活动节奏。',
    purchase: '核实加速道具、装饰内容、激励广告和去广告付费路径。',
    validation: '观察单次游玩时长、回访频次、广告完成率、付费率与长期留存。'
  };
  if (/消除|休闲|益智|合成|闯关|跑酷|解谜/.test(words)) return {
    motivation: '可能追求短时娱乐、关卡挑战和即时成就感。',
    behavior: '重点观察短局游玩、关卡卡点与每日挑战带来的回访。',
    purchase: '核实提示、体力、关卡道具、激励广告及去广告购买。',
    validation: '核对关卡完成率、广告曝光与 eCPM、D1/D7 留存及买量回收。'
  };
  return {
    motivation: '公开商品资料不足以推断明确的玩家动机，需要先体验游戏并访谈用户。',
    behavior: '核实核心玩法、单次游玩时长、社交系统和回访机制。',
    purchase: '核实游戏内购、广告与订阅入口是否存在。',
    validation: '收集用户访谈、留存分群、渠道来源、付费率与消费分布。'
  };
}

async function loadBestSellers(): Promise<RankedGame[]> {
  const url = `${window.location.origin}${apiUrl('/api/rankings')}`;
  try {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return ((await response.json()) as RankingResponse).boards?.bestSell?.items || [];
  } catch {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('GET', url);
      request.timeout = 20000;
      request.onload = () => {
        try {
          if (request.status !== 200) throw new Error(`HTTP ${request.status}`);
          resolve((JSON.parse(request.responseText) as RankingResponse).boards?.bestSell?.items || []);
        } catch (error) { reject(error); }
      };
      request.onerror = () => reject(new Error('榜单接口连接失败'));
      request.ontimeout = () => reject(new Error('榜单接口请求超时'));
      request.send();
    });
  }
}

function ShareChart({ chart }: { chart: typeof charts[number] }) {
  return <section className="market-chart">
    <div className="market-chart-head"><div><h3>{chart.title}</h3><span>{chart.subtitle}</span></div><a href={chart.source} target="_blank" rel="noreferrer" aria-label={`查看${chart.title}数据来源`} title="查看数据来源"><ExternalLink size={16} /></a></div>
    <div className="market-chart-body"><div className="market-pie"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={chart.rows} dataKey="value" nameKey="name" innerRadius={53} outerRadius={78} paddingAngle={1} stroke="none">{chart.rows.map((row, index) => <Cell key={row.name} fill={colors[index]} />)}</Pie><Tooltip formatter={(value) => `${Number(value).toFixed(2)}%`} /></PieChart></ResponsiveContainer></div><div className="market-legend">{chart.rows.map((row, index) => <div key={row.name}><i style={{ background: colors[index] }} /><span>{row.name}</span><strong>{row.value.toFixed(row.value % 1 ? 2 : 0)}%</strong></div>)}</div></div>
    <p>{chart.note}</p>
  </section>;
}

export default function MarketOverview() {
  const [games, setGames] = useState<RankedGame[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [rankError, setRankError] = useState('');
  useEffect(() => {
    let active = true;
    loadBestSellers().then(items => { if (active) setGames(items); })
      .catch(() => { if (active) setRankError('畅销榜暂时不可用，玩家画像无法展示。'); });
    return () => { active = false; };
  }, []);
  const game = games.find(item => item.id === selectedId) || games[0];
  const profile = game ? persona(game) : null;
  return <div className="market-overview">
    <div className="page-heading"><div><span className="eyebrow">MARKET LANDSCAPE</span><h1>市场概况</h1><p>市场发展、收入结构与畅销产品的用户需求观察</p></div><span className="market-asof">报告口径：2025 实绩 / 2026 预测</span></div>
    <section className="market-stage"><div><span className="market-section-label">全球发展阶段</span><h2>成熟市场中的结构性增长</h2><p>全球游戏已进入多平台并行、长期运营与细分品类竞争阶段。移动游戏仍贡献最大收入；PC 与主机保持增长，但头部产品、内容更新和用户获取效率对新产品更关键。</p></div><div className="market-stage-stats"><div><span>2026 全球规模预测</span><strong>2,139 亿美元</strong></div><div><span>预计全球玩家</span><strong>37 亿</strong></div><a href={globalSource} target="_blank" rel="noreferrer">Newzoo 报告摘要 <ExternalLink size={14} /></a></div></section>
    <div className="market-section-title"><h2>发展趋势</h2><span>基于 2025 中国报告与 2026 Newzoo 预测的归纳</span></div>
    <div className="market-trends"><div><b>01</b><strong>跨端发行持续</strong><p>移动新品同步覆盖 PC，客户端与主机收入比重上升。</p></div><div><b>02</b><strong>小游戏增长</strong><p>小程序游戏延续增长，轻量内容与持续运营并行。</p></div><div><b>03</b><strong>长线经营竞争</strong><p>成熟市场更依赖稳定更新、社区与付费体验，而非单次上线。</p></div></div>
    <div className="market-section-title"><h2>市场份额</h2><span>每张图独立口径，不能跨图相加</span></div>
    <div className="market-chart-grid">{charts.map(chart => <ShareChart key={chart.title} chart={chart} />)}</div>
    <div className="market-section-title market-persona-title"><h2>畅销游戏玩家画像</h2><span>腾讯应用宝微信小游戏畅销榜 · 逐款选择</span></div>
    <div className="market-persona-layout"><div className="market-game-picker"><label htmlFor="market-game">选择畅销游戏</label><select id="market-game" value={game?.id || ''} onChange={event => setSelectedId(event.target.value)}>{games.map(item => <option key={item.id} value={item.id}>#{item.rank} {item.name}</option>)}</select><span>{games.length ? `当前可分析 ${games.length} 款榜单游戏` : rankError || '正在获取畅销榜'}</span></div>{game && profile ? <div className="market-persona"><div className="market-persona-head">{game.icon ? <img src={game.icon} alt="" /> : <Gamepad2 size={28} />}<div><span>畅销榜第 {game.rank} 名</span><h3>{game.name}</h3><p>{game.tags.join(' / ') || '类型未公开'}</p></div><a href={game.url} target="_blank" rel="noreferrer" title="查看官方商品页"><ExternalLink size={17} /></a></div><div className="market-persona-note"><Users size={16} /> 玩家画像为品类需求假设；公开榜单不提供年龄、性别、地域或真实消费数据。</div><div className="market-persona-grid"><div><span>需求动机</span><p>{profile.motivation}</p></div><div><span>游玩行为</span><p>{profile.behavior}</p></div><div><span>可能的付费触点</span><p>{profile.purchase}</p></div><div><span>验证方式</span><p>{profile.validation}</p></div></div></div> : <div className="market-persona-empty">{rankError || '正在加载榜单游戏'}</div>}</div>
  </div>;
}
