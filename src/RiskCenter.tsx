import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, ExternalLink, ShieldAlert } from 'lucide-react';
import type { Project, ProjectRisk } from './types';
import './stage3-dashboard.css';

export const riskCategories: Record<ProjectRisk['category'], string> = { license: '版号合规', ip: '版权 / IP', team: '核心团队', competition: '竞品冲击', technical: '技术与安全' };
export const riskSeverities: Record<ProjectRisk['severity'], string> = { low: '低', medium: '中', high: '高', catastrophic: '毁灭性' };
export const riskStatuses: Record<ProjectRisk['status'], string> = { unverified: '待核实', confirmed: '已确认', cleared: '已排除' };
const severityOrder: Record<ProjectRisk['severity'], number> = { catastrophic: 4, high: 3, medium: 2, low: 1 };

export function isVetoRisk(risk: ProjectRisk) { return risk.status === 'confirmed' && risk.severity === 'catastrophic'; }
export function activeHighRisks(project: Project) { return project.risks.filter(risk => risk.status !== 'cleared' && (risk.severity === 'high' || risk.severity === 'catastrophic')); }

type RiskItem = { project: Project; risk: ProjectRisk };
export type RiskCenterProps = { projects: Project[]; onOpenProject?: (projectId: string) => void };

export default function RiskCenter({ projects, onOpenProject }: RiskCenterProps) {
  const [category, setCategory] = useState<'all' | ProjectRisk['category']>('all');
  const [severity, setSeverity] = useState<'all' | ProjectRisk['severity']>('all');
  const [status, setStatus] = useState<'all' | ProjectRisk['status']>('all');
  const items = useMemo(() => projects.flatMap(project => project.risks.map(risk => ({ project, risk }))), [projects]);
  const filtered = useMemo(() => items.filter(({ risk }) =>
    (category === 'all' || risk.category === category) &&
    (severity === 'all' || risk.severity === severity) &&
    (status === 'all' || risk.status === status)
  ).sort((a, b) => Number(isVetoRisk(b.risk)) - Number(isVetoRisk(a.risk)) ||
    Number(b.risk.status !== 'cleared') - Number(a.risk.status !== 'cleared') ||
    severityOrder[b.risk.severity] - severityOrder[a.risk.severity] ||
    b.project.updatedAt.localeCompare(a.project.updatedAt)), [items, category, severity, status]);
  const vetoProjects = projects.filter(project => project.assessment.status === 'vetoed');
  const highRiskProjects = projects.filter(project => activeHighRisks(project).length);

  return <div className="stage3-page risk-center">
    <header className="page-heading stage3-heading"><div><span className="eyebrow">RISK MONITORING</span><h1>风险监控中心</h1><p>按项目汇总已录入的风险事实与审核状态</p></div></header>
    <div className="stage3-summary"><div><span>风险记录</span><strong>{items.length}</strong></div><div><span>高风险项目</span><strong>{highRiskProjects.length}</strong></div><div><span>一票否决项目</span><strong className="stage3-danger-text">{vetoProjects.length}</strong></div><div><span>待核实风险</span><strong>{items.filter(({ risk }) => risk.status === 'unverified').length}</strong></div></div>
    {vetoProjects.length > 0 && <section className="stage3-veto-alert" role="alert"><ShieldAlert size={20} /><div><strong>{vetoProjects.length} 个项目已触发一票否决</strong><p>{vetoProjects.map(project => project.name).join('、')}</p></div></section>}
    <div className="stage3-section-head"><div><h2>全项目风险清单</h2><p>已确认的毁灭性风险置顶</p></div><span>{filtered.length} 条</span></div>
    <div className="stage3-risk-filters">
      <label>风险类型<select value={category} onChange={event => setCategory(event.target.value as typeof category)}><option value="all">全部类型</option>{Object.entries(riskCategories).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <label>风险等级<select value={severity} onChange={event => setSeverity(event.target.value as typeof severity)}><option value="all">全部等级</option>{Object.entries(riskSeverities).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <label>审核状态<select value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="all">全部状态</option>{Object.entries(riskStatuses).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
    </div>
    {filtered.length === 0 ? <div className="stage3-empty"><AlertTriangle size={21} /><strong>{items.length ? '没有符合筛选条件的风险' : '尚未录入风险记录'}</strong></div> :
      <div className="stage3-risk-list">{filtered.map(({ project, risk }: RiskItem) => <article key={`${project.id}-${risk.id}`} className={`stage3-risk-row ${isVetoRisk(risk) ? 'is-veto' : ''}`}>
        <div className="stage3-risk-main"><div className="stage3-risk-tags">{isVetoRisk(risk) && <span className="stage3-veto-tag"><ShieldAlert size={13} />一票否决</span>}<span>{riskCategories[risk.category]}</span><span className={`stage3-severity stage3-severity-${risk.severity}`}>{riskSeverities[risk.severity]}风险</span><span>{riskStatuses[risk.status]}</span></div><p>{risk.description || '未填写风险描述'}</p></div>
        <div className="stage3-risk-side"><button type="button" className="stage3-text-button" onClick={() => onOpenProject?.(project.id)} disabled={!onOpenProject}>{project.name}<ChevronRight size={14} /></button>{risk.evidenceUrl && <a href={risk.evidenceUrl} target="_blank" rel="noreferrer">查看证据<ExternalLink size={13} /></a>}</div>
      </article>)}</div>}
  </div>;
}
