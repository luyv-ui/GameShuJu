import { AlertTriangle, ArrowUpRight, CalendarClock, FileText, Flame, ShieldAlert } from 'lucide-react';
import type { Game, Project } from './types';
import { activeHighRisks } from './RiskCenter';
import './stage3-dashboard.css';

export type DashboardReport = { id: string; projectId: string; title: string; createdAt: string };
export type InvestmentDashboardProps = {
  projects: Project[];
  games: Game[];
  reports?: DashboardReport[];
  onOpenProject?: (projectId: string) => void;
  onOpenRiskCenter?: () => void;
  onOpenReport?: (reportId: string) => void;
};

function number(value: number | null | undefined, digits = 1) {
  return value == null || !Number.isFinite(value) ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: digits });
}
function date(value: string) { return value?.slice(0, 10) || '日期未录入'; }
function baseForecast(project: Project) {
  const result = project.forecast?.scenarios.base;
  return result?.status === 'complete' ? result : null;
}
function heatClass(value: number, values: number[]) {
  if (values.length < 2) return 'stage3-heat-unranked';
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return 'stage3-heat-mid';
  const rank = (value - min) / (max - min);
  return rank >= 0.67 ? 'stage3-heat-high' : rank >= 0.34 ? 'stage3-heat-mid' : 'stage3-heat-low';
}

export default function InvestmentDashboard({ projects, games, reports, onOpenProject, onOpenRiskCenter, onOpenReport }: InvestmentDashboardProps) {
  const pending = projects.filter(project => project.assessment.status === 'pending');
  const highRisk = projects.filter(project => activeHighRisks(project).length > 0);
  const vetoed = projects.filter(project => project.assessment.status === 'vetoed');
  const sortedProjects = [...projects].sort((a, b) => Number(b.assessment.status === 'vetoed') - Number(a.assessment.status === 'vetoed') || b.updatedAt.localeCompare(a.updatedAt));
  const sortedReports = [...(reports ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  const marketProjects = projects.filter(project => {
    const market = project.investmentInputs?.market;
    return market && market.growth12mPct !== null && market.survival6mPct !== null && Boolean(market.region && market.asOf && market.basis);
  });
  const growthValues = marketProjects.map(project => project.investmentInputs.market.growth12mPct as number);
  const survivalValues = marketProjects.map(project => project.investmentInputs.market.survival6mPct as number);
  const realGames = games.filter(game => !game.isDemo);

  return <div className="stage3-page investment-dashboard">
    <header className="page-heading stage3-heading"><div><span className="eyebrow">INVESTMENT OVERVIEW</span><h1>投资总览</h1><p>项目判断、财务结果与风险信号</p></div></header>
    {vetoed.length > 0 && <section className="stage3-veto-alert" role="alert"><ShieldAlert size={22} /><div><strong>{vetoed.length} 个项目触发一票否决</strong><p>{vetoed.map(project => project.name).join('、')}</p></div>{onOpenRiskCenter && <button type="button" onClick={onOpenRiskCenter}>查看风险<ArrowUpRight size={15} /></button>}</section>}
    {vetoed.length === 0 && highRisk.length > 0 && <section className="stage3-warning" role="status"><AlertTriangle size={18} /><span>{highRisk.length} 个项目存在未排除的高等级风险</span>{onOpenRiskCenter && <button type="button" onClick={onOpenRiskCenter}>查看风险<ArrowUpRight size={14} /></button>}</section>}
    <div className="stage3-kpi-grid">
      <div className="stage3-kpi"><span className="stage3-kpi-icon teal"><CalendarClock size={19} /></span><span>待评估项目</span><strong>{pending.length}</strong><small>资料待补齐或风险待核实</small></div>
      <div className="stage3-kpi"><span className="stage3-kpi-icon coral"><ShieldAlert size={19} /></span><span>高风险项目</span><strong>{highRisk.length}</strong><small>存在未排除的高或毁灭性风险</small></div>
      <div className="stage3-kpi"><span className="stage3-kpi-icon blue"><ArrowUpRight size={19} /></span><span>本月新增竞品</span><strong className="stage3-unknown">不可判断</strong><small>{realGames.length ? `${realGames.length} 条真实游戏档案缺少入库时间与竞品关联` : '暂无可核实的竞品入库记录'}</small></div>
      <div className="stage3-kpi"><span className="stage3-kpi-icon amber"><Flame size={19} /></span><span>赛道机会信号</span><strong className="stage3-unknown">不可判断</strong><small>缺少统一覆盖范围与机会判定规则</small></div>
    </div>

    <section className="stage3-section"><div className="stage3-section-head"><div><h2>项目投资判断</h2><p>财务指标采用各项目基准情景；未完成测算显示为 —</p></div><span>{projects.length} 个项目</span></div>
      {sortedProjects.length === 0 ? <div className="stage3-empty"><FileText size={23} /><strong>暂无投资项目</strong></div> : <div className="stage3-table-scroll"><table className="stage3-table"><thead><tr><th>项目</th><th>评分</th><th>年化 IRR</th><th>回本周期</th><th>最大累计亏损</th><th>立项结论</th></tr></thead><tbody>{sortedProjects.map(project => {
        const forecast = baseForecast(project);
        return <tr key={project.id}><td><button type="button" className="stage3-project-link" onClick={() => onOpenProject?.(project.id)} disabled={!onOpenProject}><strong>{project.name}</strong><small>{project.genre || '类型未录入'}</small></button></td><td>{project.assessment.score == null ? '—' : `${project.assessment.score} 分`}</td><td>{forecast ? forecast.annualIrrPct === null ? '不可定义' : `${number(forecast.annualIrrPct)}%` : '—'}</td><td>{forecast ? forecast.paybackMonth === null ? '24 个月内未回本' : `第 ${forecast.paybackMonth} 月` : '—'}</td><td>{forecast ? `${number(forecast.maximumCumulativeLoss)} ${project.forecast?.currency || ''}` : '—'}</td><td><span className={`stage3-conclusion ${project.assessment.status}`}>{project.assessment.conclusion}</span></td></tr>;
      })}</tbody></table></div>}
    </section>

    <div className="stage3-lower-grid"><section className="stage3-section"><div className="stage3-section-head"><div><h2>赛道市场指标热力视图</h2><p>仅展示已记录地区、日期及依据的项目市场数据；颜色按当前样本相对高低表示</p></div></div>
      {marketProjects.length === 0 ? <div className="stage3-empty"><Flame size={22} /><strong>暂无可比较的赛道数据</strong><p>需录入增长率、存活率、地区、日期及依据。</p></div> : <div className="stage3-heat-table"><div className="stage3-heat-head"><span>项目 / 赛道</span><span>12 个月增速</span><span>新品 6 个月存活率</span></div>{marketProjects.map(project => {
        const market = project.investmentInputs.market;
        return <div className="stage3-heat-row" key={project.id}><div><strong>{project.genre || '类型未录入'}</strong><small>{project.name} · {market.region} · {date(market.asOf)}</small></div><span className={heatClass(market.growth12mPct as number, growthValues)}>{number(market.growth12mPct)}%</span><span className={heatClass(market.survival6mPct as number, survivalValues)}>{number(market.survival6mPct)}%</span></div>;
      })}</div>}
      <p className="stage3-source-note">样本数 {marketProjects.length}；不同地区与采样口径不可直接推断赛道机会，具体依据请查看项目资料。</p>
    </section>
    <section className="stage3-section"><div className="stage3-section-head"><div><h2>{reports === undefined ? '项目报告' : '最新报告'}</h2><p>{reports === undefined ? '打开项目查看实时生成的投资报告' : '已生成的投资研判报告'}</p></div><span>{reports === undefined ? `${projects.length} 个项目` : `${reports.length} 份`}</span></div>
      {reports === undefined ? sortedProjects.length === 0 ? <div className="stage3-empty"><FileText size={22} /><strong>暂无可查看的项目报告</strong></div> : <div className="stage3-report-list">{sortedProjects.slice(0, 5).map(project => <button type="button" key={project.id} disabled={!onOpenProject} onClick={() => onOpenProject?.(project.id)}><FileText size={18} /><span><strong>{project.name}</strong><small>{project.assessment.conclusion} · 更新于 {date(project.updatedAt)}</small></span><ArrowUpRight size={15} /></button>)}</div> : sortedReports.length === 0 ? <div className="stage3-empty"><FileText size={22} /><strong>暂无已生成报告</strong></div> : <div className="stage3-report-list">{sortedReports.map(report => <button type="button" key={report.id} disabled={!onOpenReport} onClick={() => onOpenReport?.(report.id)}><FileText size={18} /><span><strong>{report.title}</strong><small>{projects.find(project => project.id === report.projectId)?.name || '项目已移除'} · {date(report.createdAt)}</small></span><ArrowUpRight size={15} /></button>)}</div>}
    </section></div>
  </div>;
}
