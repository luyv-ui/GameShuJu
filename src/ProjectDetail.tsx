import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowUpRight, Download, ExternalLink, FileText, Pencil, ShieldAlert, Trash2, X } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Project, ProjectRisk } from './types';
import ProjectForecast from './ProjectForecast';
import './stage3-detail.css';

type Tab = 'overview' | 'finance' | 'operations' | 'risks';
type Report = {
  projectId: string;
  generatedAt: string;
  projectName: string;
  status: string;
  conclusion: string;
  score: number | null;
  sections: {
    strengths: string[];
    risks: string[];
    returns: string[];
    sustainability: string[];
    recommendation: string;
  };
};

const tabs: { key: Tab; label: string }[] = [
  { key: 'overview', label: '投资总览' }, { key: 'finance', label: '财务测算' },
  { key: 'operations', label: '运营数据' }, { key: 'risks', label: '风险清单' }
];
const stageNames: Record<Project['stage'], string> = { concept: '概念阶段', prototype: '原型验证', production: '研发中', live: '已上线' };
const riskCategories: Record<ProjectRisk['category'], string> = { license: '版号合规', ip: '版权 / IP', team: '核心团队', competition: '竞品冲击', technical: '技术与安全' };
const riskStatuses: Record<ProjectRisk['status'], string> = { unverified: '待核实', confirmed: '已确认', cleared: '已排除' };
const riskSeverities: Record<ProjectRisk['severity'], string> = { low: '低', medium: '中', high: '高', catastrophic: '毁灭性' };
const breakdownLabels: Record<string, string> = { market: '市场', returns: '收益', sustainability: '持续性', riskReserve: '风险保留', riskPenalty: '风险扣分' };
const number = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);
const metric = (value: number | null, unit = '') => value === null ? '未录入' : `${number(value)}${unit}`;
const isVetoRisk = (risk: ProjectRisk) => risk.status === 'confirmed' && risk.severity === 'catastrophic';

function ReportSection({ title, lines }: { title: string; lines: string[] }) {
  return <section className="project-report-section"><h4>{title}</h4>{lines.length ? <ul>{lines.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ul> : <p>暂无可核实的依据。</p>}</section>;
}

function ReportPanel({ project }: { project: Project }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setReport(null); setError('');
    fetch(`/api/projects/${encodeURIComponent(project.id)}/report`).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '报告生成失败');
      if (active) setReport(data);
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '报告生成失败'); });
    return () => { active = false; };
  }, [project.id, project.updatedAt]);
  return <div className="project-report">
    <div className="project-report-heading"><div><h3>投资研判报告</h3><span>根据当前项目数据实时生成</span></div><a className="secondary-button" href={`/api/projects/${encodeURIComponent(project.id)}/report.pdf`} download={`${project.name}-投资研判报告.pdf`}><Download size={15} /> 导出 PDF</a></div>
    {error ? <p className="project-report-error" role="alert">{error}</p> : !report ? <p className="project-report-loading">正在生成报告...</p> : <>
      <div className="project-report-grid"><ReportSection title="项目优势" lines={report.sections.strengths} /><ReportSection title="主要风险" lines={report.sections.risks} /><ReportSection title="收益测算" lines={report.sections.returns} /><ReportSection title="持续性判断" lines={report.sections.sustainability} /></div>
      <ReportSection title="最终建议" lines={[report.sections.recommendation]} />
    </>}
  </div>;
}

function Overview({ project, onOpenBenchmark }: { project: Project; onOpenBenchmark?: () => void }) {
  const { assessment } = project;
  return <>
    <div className={`project-conclusion ${assessment.status}`}><div className="project-conclusion-icon">{assessment.status === 'vetoed' ? <ShieldAlert size={23} /> : <AlertTriangle size={23} />}</div><div><span>当前立项结论</span><strong>{assessment.conclusion}{assessment.score !== null ? ` · ${assessment.score} 分` : ''}</strong><p>{assessment.status === 'vetoed' ? '已确认的毁灭性风险触发一票否决。' : assessment.status === 'rated' ? '依据已录入数据与评分参数计算。' : '关键资料不足，暂不提供量化评分。'}</p></div></div>
    {assessment.financialGate?.triggered && <div className="project-financial-gate" role="alert"><AlertTriangle size={17} /><div><strong>基准情景触发财务门槛，最终评分封顶 49 分</strong><p>{assessment.financialGate.reasons.join('；')}。门槛前评分：{assessment.financialGate.uncappedScore} 分。</p></div></div>}
    {assessment.status === 'rated' && assessment.breakdown && <div className="project-score-breakdown">{Object.entries(assessment.breakdown).map(([key, value]) => <div key={key}><span>{breakdownLabels[key] || key}</span><strong>{key === 'riskPenalty' ? '−' : ''}{value}</strong></div>)}</div>}
    {assessment.status === 'pending' && Boolean(assessment.missing?.length) && <div className="project-missing"><strong>待补齐 {assessment.missing?.length} 项依据</strong><p>{assessment.missing?.slice(0, 5).join('、')}{(assessment.missing?.length || 0) > 5 ? '等' : ''}</p></div>}
    <div className="project-detail-meta"><div><span>游戏类型</span><strong>{project.genre}</strong></div><div><span>研发团队</span><strong>{project.studio || '未录入'}</strong></div><div><span>当前阶段</span><strong>{stageNames[project.stage]}</strong></div><div><span>更新时间</span><strong>{new Date(project.updatedAt).toLocaleDateString('zh-CN')}</strong></div></div>
    {project.description && <div className="project-detail-section"><h3>项目概述</h3><p>{project.description}</p></div>}
    <div className="project-benchmark-summary"><div><h3>竞品对标</h3><p>公开竞品库尚缺同口径的收入、留存和投资成本；当前不能据此判断相对收益。可选择最多 4 款竞品查看已核实的商品资料。</p></div>{onOpenBenchmark && <button className="secondary-button" onClick={onOpenBenchmark}>赛道对标 <ArrowUpRight size={15} /></button>}</div>
    <ReportPanel project={project} />
  </>;
}

function CombinedForecast({ project }: { project: Project }) {
  const scenarios = project.forecast?.scenarios;
  if (!scenarios || Object.values(scenarios).some(scenario => scenario.status !== 'complete')) return <p className="project-combined-empty">三情景录入完整后显示现金流对比。</p>;
  const data = Array.from({ length: 24 }, (_, index) => ({ month: index + 1,
    optimistic: scenarios.optimistic.status === 'complete' ? scenarios.optimistic.months[index].cumulativeCashFlow : null,
    base: scenarios.base.status === 'complete' ? scenarios.base.months[index].cumulativeCashFlow : null,
    pessimistic: scenarios.pessimistic.status === 'complete' ? scenarios.pessimistic.months[index].cumulativeCashFlow : null
  }));
  return <section className="project-combined"><h3>三情景累计现金流</h3><div className="project-combined-chart" role="img" aria-label="乐观、基准、悲观三情景 24 个月累计现金流对比"><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 8, right: 12, bottom: 2, left: 5 }}><CartesianGrid stroke="#edf1f2" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} /><YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={65} tickFormatter={number} /><Tooltip formatter={(value, name) => [`${number(Number(value))} ${project.forecast?.currency}`, name === 'optimistic' ? '乐观' : name === 'base' ? '基准' : '悲观']} labelFormatter={label => `第 ${label} 月`} /><Legend formatter={name => name === 'optimistic' ? '乐观' : name === 'base' ? '基准' : '悲观'} /><Line type="monotone" dataKey="optimistic" stroke="#259989" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="base" stroke="#587b9e" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="pessimistic" stroke="#c78655" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div></section>;
}

function Operations({ project }: { project: Project }) {
  const { market, users, commercial, operations } = project.investmentInputs;
  const groups = [
    { title: '市场', source: market, rows: [['市场规模 TAM', market.tam, market.currency], ['12 个月增速', market.growth12mPct, '%'], ['新品 6 个月存活率', market.survival6mPct, '%'], ['集中度', market.concentrationPct, '%']] },
    { title: '用户与留存', source: users, rows: [['D1 留存', users.d1Pct, '%'], ['D7 留存', users.d7Pct, '%'], ['D30 留存', users.d30Pct, '%'], ['D90 留存', users.d90Pct, '%'], ['付费 D180 留存', users.payingD180Pct, '%'], ['月现金流衰减', users.monthlyCashDecayPct, '%']] },
    { title: '商业化', source: commercial, rows: [['LTV90', commercial.ltv90, commercial.currency], ['CAC', commercial.cac, commercial.currency], ['ARPU', commercial.arpu, commercial.currency], ['付费渗透率', commercial.payerPenetrationPct, '%']] },
    { title: '运营健康', source: operations, rows: [['版本周期', operations.versionCycleMonths, '月'], ['版本流水提升', operations.versionRevenueLiftPct, '%'], ['经济系统稳定性', operations.economyStabilityScore, '分'], ['舆情得分', operations.sentimentScore, '分'], ['负面事件现金流冲击', operations.negativeEventCashShockPct, '%']] }
  ];
  return <div className="project-operations">{groups.map(group => <section key={group.title}><h3>{group.title}</h3><div className="project-operations-grid">{group.rows.map(([label, value, unit]) => <div key={String(label)}><span>{label}</span><strong>{metric(value as number | null, unit as string)}</strong></div>)}</div><p>地区：{group.source.region || '未录入'} · 截至：{group.source.asOf || '未录入'}</p><p>依据：{group.source.basis || '未录入'}</p></section>)}</div>;
}

function Risks({ project }: { project: Project }) {
  const sorted = [...project.risks].sort((a, b) => Number(isVetoRisk(b)) - Number(isVetoRisk(a)));
  return <div className="project-detail-section project-risk-tab"><h3>风险清单 <span>{project.risks.length}</span></h3><p className="project-review-status">审核状态：{project.riskReviewComplete ? '已完成' : '未完成'}</p>{sorted.length === 0 ? <p>尚未录入风险事实。</p> : <div className="project-detail-risks">{sorted.map(risk => <div key={risk.id} className={`project-detail-risk ${isVetoRisk(risk) ? 'vetoed' : ''}`}><div><strong>{isVetoRisk(risk) && <ShieldAlert size={16} />}{riskCategories[risk.category]}</strong><span>{riskStatuses[risk.status]} · {riskSeverities[risk.severity]}</span></div><p>{risk.description}</p>{risk.evidenceUrl && <a href={risk.evidenceUrl} target="_blank" rel="noreferrer">查看证据 <ExternalLink size={13} /></a>}</div>)}</div>}</div>;
}

export default function ProjectDetail({ project, busy, onClose, onDelete, onEdit, onOpenBenchmark }: { project: Project; busy: boolean; onClose: () => void; onDelete: () => void; onEdit: () => void; onOpenBenchmark?: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal project-detail-modal stage3-project-detail" role="dialog" aria-modal="true" aria-label={`${project.name}项目详情`} onMouseDown={event => event.stopPropagation()}>
    <div className="modal-header"><div><span className="eyebrow">立项项目 / {stageNames[project.stage]}</span><h2>{project.name}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={19} /></button></div>
    <div className="project-detail-tabs" role="tablist" aria-label="项目详情视图">{tabs.map(item => <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} className={tab === item.key ? 'selected' : ''} onClick={() => setTab(item.key)}>{item.label}</button>)}</div>
    <div className="project-detail-body" role="tabpanel">{tab === 'overview' && <Overview project={project} onOpenBenchmark={onOpenBenchmark} />}{tab === 'finance' && <><CombinedForecast project={project} /><ProjectForecast forecast={project.forecast} /><div className="project-finance-basis"><FileText size={14} /> 财务假设：{project.investmentInputs.finance.basis || '未录入'}</div></>}{tab === 'operations' && <Operations project={project} />}{tab === 'risks' && <Risks project={project} />}</div>
    <div className="project-detail-actions"><button className="text-danger" disabled={busy} onClick={onDelete}><Trash2 size={15} /> 删除项目</button><span className="spacer" /><button className="primary-button" onClick={onEdit}><Pencil size={15} /> 编辑项目</button></div>
  </div></div>;
}
