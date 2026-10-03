import { Fragment, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ExternalLink, Plus, X } from 'lucide-react';
import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer } from 'recharts';
import type { Game, Project, ScoreConfig } from './types';
import './stage3-compare.css';
import { apiUrl } from './api-url';

type Props = { projects: Project[]; games: Game[]; onOpenProject?: (projectId: string) => void };
type Cell = string;
type Row = { label: string; project: Cell; games: Cell[] };

const missing = '未取得';
const stageLabel: Record<Project['stage'], string> = { concept: '概念阶段', prototype: '原型验证', production: '研发中', live: '已上线' };
const number = (value: number | null | undefined, suffix = '') => value == null || !Number.isFinite(value) ? missing : `${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}${suffix}`;
const text = (value: string | null | undefined) => value?.trim() || missing;
const percent = (value: number | null | undefined) => number(value, '%');
const cash = (value: number | null | undefined, currency: string) => value == null ? missing : `${number(value)} ${currency || '币种未录入'}`;
const sourceLabel = (game: Game) => {
  try {
    const host = new URL(game.sourceUrl).hostname.toLowerCase();
    if (host === 'store.steampowered.com') return 'Steam';
    if (host === 'apps.apple.com') return 'App Store 美国区';
    return host;
  } catch { return missing; }
};
const steam = (game: Game) => sourceLabel(game) === 'Steam';
const appStore = (game: Game) => sourceLabel(game) === 'App Store 美国区';
const scoped = (game: Game, field: 'price' | 'rating' | 'reviewCount' | 'peakPlayers') => steam(game) ? field === 'price' && game.price != null ? `${game.metricScope?.includes('美元') ? '$' : '¥'}${game.price.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}` : number(game[field], field === 'rating' ? '%' : '') : '不适用';
const appScoped = (game: Game, field: 'usPriceUsd' | 'usRatingOutOf5' | 'usRatingCount') => appStore(game) ? number(game.sourceExtras?.[field], field === 'usPriceUsd' ? ' 美元' : field === 'usRatingOutOf5' ? ' / 5' : '') : '不适用';

function RadarPanel({ project, config }: { project: Project; config: ScoreConfig | null }) {
  const breakdown = project.assessment.status === 'rated' ? project.assessment.breakdown : null;
  const dimensions = breakdown && config ? [
    { label: '市场', value: breakdown.market, max: config.weights.market },
    { label: '收益', value: breakdown.returns, max: config.weights.returns },
    { label: '持续性', value: breakdown.sustainability, max: config.weights.sustainability },
    { label: '风险保留', value: breakdown.riskReserve - breakdown.riskPenalty, max: config.weights.riskReserve },
    { label: '资料覆盖', value: 100, max: 100 }
  ] : [];
  const data = dimensions.map(item => ({ axis: item.label, value: item.max > 0 ? Math.max(0, Math.min(100, Math.round(item.value / item.max * 100))) : 0, raw: `${number(item.value)} / ${item.max}` }));
  return <section className="investment-compare-panel">
    <div className="investment-compare-panel-head"><h2>五维评估雷达</h2><span>目标项目</span></div>
    {breakdown && config ? <><div className="investment-radar" role="img" aria-label={`${project.name}五维评估：${data.map(item => `${item.axis} ${item.value}%`).join('，')}`}>
      <ResponsiveContainer width="100%" height="100%"><RadarChart data={data} outerRadius="68%" margin={{ top: 14, right: 26, bottom: 14, left: 26 }}><PolarGrid stroke="#dfe8e8" /><PolarAngleAxis dataKey="axis" tick={{ fill: '#586b73', fontSize: 11 }} /><Radar name={project.name} dataKey="value" stroke="#218f83" fill="#40a99b" fillOpacity={0.25} strokeWidth={2} /></RadarChart></ResponsiveContainer>
    </div><div className="investment-radar-values">{data.map(item => <span key={item.axis}>{item.axis} <strong>{item.raw}</strong></span>)}</div></> : <div className="investment-compare-empty">{!breakdown ? '项目尚未完成评分，暂时无法绘制雷达图。' : '评分参数暂不可用，无法正确绘制雷达图。'}</div>}
    <p className="investment-compare-note"><AlertCircle size={15} /> 竞品缺少同口径的五维投资数据，因此仅显示目标项目；图中“资料覆盖”表示该项目已满足评分所需输入，不代表竞品表现。其余四维依据当前评分权重归一化。</p>
  </section>;
}

export default function InvestmentCompare({ projects, games, onOpenProject }: Props) {
  const [projectId, setProjectId] = useState('');
  const [gameIds, setGameIds] = useState<string[]>([]);
  const [nextGameId, setNextGameId] = useState('');
  const [scoreConfig, setScoreConfig] = useState<ScoreConfig | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(apiUrl('/api/score-config'), { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error('评分参数加载失败');
      return response.json() as Promise<ScoreConfig>;
    }).then(setScoreConfig).catch(() => { if (!controller.signal.aborted) setScoreConfig(null); });
    return () => controller.abort();
  }, []);
  const project = projects.find(item => item.id === projectId) || projects[0];
  const selectedGames = useMemo(() => gameIds.map(id => games.find(game => game.id === id)).filter((game): game is Game => Boolean(game)).slice(0, 4), [gameIds, games]);
  const available = games.filter(game => !selectedGames.some(selected => selected.id === game.id));
  const base = project?.forecast?.scenarios.base;
  const finance = project?.investmentInputs.finance;
  const inputs = project?.investmentInputs;
  const rows: { section: string; rows: Row[] }[] = project && inputs ? [
    { section: '基础资料', rows: [
      { label: '游戏类型', project: text(project.genre), games: selectedGames.map(game => text(game.genre)) },
      { label: '阶段 / 发行日期', project: stageLabel[project.stage], games: selectedGames.map(game => text(game.releaseDate)) },
      { label: '研发方', project: text(project.studio), games: selectedGames.map(game => text(game.developer)) },
      { label: '来源及采集日期', project: '内部项目录入', games: selectedGames.map(game => `${sourceLabel(game)} · ${text(game.dataAsOf)}`) }
    ] },
    { section: '投资与运营指标 · 项目内部假设', rows: [
      { label: '综合评分', project: project.assessment.score == null ? missing : `${project.assessment.score} / 100`, games: selectedGames.map(() => missing) },
      { label: '基准 NPV', project: base?.status === 'complete' ? cash(base.npv, finance?.currency || '') : missing, games: selectedGames.map(() => missing) },
      { label: '基准年化 IRR', project: base?.status === 'complete' ? percent(base.annualIrrPct) : missing, games: selectedGames.map(() => missing) },
      { label: '基准回本月', project: base?.status === 'complete' ? base.paybackMonth == null ? '24 个月内未回本' : `第 ${base.paybackMonth} 月` : missing, games: selectedGames.map(() => missing) },
      { label: '付费用户 D180 留存', project: percent(inputs.users.payingD180Pct), games: selectedGames.map(() => missing) },
      { label: 'LTV90 / CAC', project: inputs.commercial.ltv90 != null && inputs.commercial.cac != null && inputs.commercial.cac > 0 ? number(inputs.commercial.ltv90 / inputs.commercial.cac) : missing, games: selectedGames.map(() => missing) },
      { label: '月现金流衰减', project: percent(inputs.users.monthlyCashDecayPct), games: selectedGames.map(() => missing) }
    ] },
    { section: '公开商品信息 · 来源及口径见下方', rows: [
      { label: 'Steam 售价', project: '不适用', games: selectedGames.map(game => scoped(game, 'price')) },
      { label: 'Steam 好评率', project: '不适用', games: selectedGames.map(game => scoped(game, 'rating')) },
      { label: 'Steam 评价数', project: '不适用', games: selectedGames.map(game => scoped(game, 'reviewCount')) },
      { label: 'Steam 历史峰值在线', project: '不适用', games: selectedGames.map(game => scoped(game, 'peakPlayers')) },
      { label: 'App Store 美国区售价', project: '不适用', games: selectedGames.map(game => appScoped(game, 'usPriceUsd')) },
      { label: 'App Store 美国区五星评分', project: '不适用', games: selectedGames.map(game => appScoped(game, 'usRatingOutOf5')) },
      { label: 'App Store 美国区评分数', project: '不适用', games: selectedGames.map(game => appScoped(game, 'usRatingCount')) }
    ] }
  ] : [];
  const sameGenre = selectedGames.filter(game => game.genre.trim() && game.genre.trim().toLowerCase() === project?.genre.trim().toLowerCase());

  return <div className="investment-compare">
    <div className="page-heading"><div><span className="eyebrow">INVESTMENT BENCHMARK / 03</span><h1>赛道对标</h1><p>目标项目与公开竞品资料</p></div></div>
    <div className="investment-compare-controls"><label>目标项目<select value={project?.id || ''} onChange={event => setProjectId(event.target.value)} disabled={!projects.length}>{projects.length ? projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>) : <option value="">暂无项目</option>}</select></label><label>添加竞品（最多 4 个）<span className="investment-add-game"><select value={nextGameId} onChange={event => setNextGameId(event.target.value)} disabled={selectedGames.length >= 4 || !available.length}><option value="">选择游戏</option>{available.map(game => <option key={game.id} value={game.id}>{game.name}</option>)}</select><button type="button" className="secondary-button" title="添加竞品" aria-label="添加竞品" disabled={!nextGameId || selectedGames.length >= 4} onClick={() => { if (nextGameId && selectedGames.length < 4 && available.some(game => game.id === nextGameId)) setGameIds(current => [...current, nextGameId]); setNextGameId(''); }}><Plus size={17} /></button></span></label></div>
    {selectedGames.length > 0 && <div className="investment-selected-games" aria-label="已选竞品">{selectedGames.map(game => <span key={game.id}>{game.name}<button type="button" aria-label={`移除 ${game.name}`} title={`移除 ${game.name}`} onClick={() => setGameIds(current => current.filter(id => id !== game.id))}><X size={14} /></button></span>)}</div>}
    {!project ? <div className="investment-compare-empty">请先建立一个目标项目。</div> : <>
      <div className="investment-compare-top"><RadarPanel project={project} config={scoreConfig} /><section className="investment-compare-panel investment-conclusion"><div className="investment-compare-panel-head"><h2>对标结论</h2><span>基于当前可用数据</span></div><p>{project.name}当前结论为<strong>{project.assessment.conclusion}</strong>{project.assessment.score != null ? `（${project.assessment.score} 分）` : '，暂不能量化评级'}。</p><p>{selectedGames.length ? `已选 ${selectedGames.length} 款竞品，其中 ${sameGenre.length} 款与目标项目的游戏类型字段一致。` : '尚未选择竞品，添加后可查看公开商品资料。'}</p><p>竞品库当前没有收入、现金流、留存及投资成本数据，无法计算竞品 NPV、IRR 或投资评分，也无法据此判断目标项目相对收益高低。</p>{project.assessment.financialGate?.triggered && <p className="investment-conclusion-warning">基准情景触发财务门槛：{project.assessment.financialGate.reasons.join('；')}。</p>}{onOpenProject && <button className="secondary-button" onClick={() => onOpenProject(project.id)}>查看项目详情</button>}</section></div>
      <section className="investment-compare-panel investment-table-panel"><div className="investment-compare-panel-head"><h2>指标对比</h2><span>{selectedGames.length + 1} 个对象</span></div><div className="investment-table-scroll"><table><thead><tr><th scope="col">指标</th><th scope="col">{project.name}<small>目标项目</small></th>{selectedGames.map(game => <th scope="col" key={game.id}>{game.name}<small>{game.channel}竞品</small></th>)}</tr></thead><tbody>{rows.map(section => <Fragment key={section.section}><tr className="investment-table-section"><th colSpan={selectedGames.length + 2} scope="colgroup">{section.section}</th></tr>{section.rows.map(row => <tr key={`${section.section}-${row.label}`}><th scope="row">{row.label}</th><td>{row.project}</td>{row.games.map((value, index) => <td key={selectedGames[index].id}>{value}</td>)}</tr>)}</Fragment>)}</tbody></table></div><p className="investment-compare-note">“未取得”表示当前库没有可验证数据；“不适用”表示指标来源或对象不同。Steam 和 App Store 的价格、评价口径不可直接混合比较；评价数和好评率不用于推算销量或收入。</p></section>
      {selectedGames.length > 0 && <section className="investment-source-list"><h2>竞品数据来源</h2><div>{selectedGames.map(game => <div key={game.id}><strong>{game.name}</strong><span>{sourceLabel(game)} · 采集日期 {text(game.dataAsOf)} · {text(game.metricScope)}</span><span>{game.sourceUrl && <a href={game.sourceUrl} target="_blank" rel="noreferrer">商品页 <ExternalLink size={13} /></a>}{game.metricsSourceUrl && <a href={game.metricsSourceUrl} target="_blank" rel="noreferrer">指标来源 <ExternalLink size={13} /></a>}</span></div>)}</div></section>}
    </>}
  </div>;
}
