import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, ClipboardList, Plus, Search, Settings2, ShieldAlert, Trash2, X } from 'lucide-react';
import type { Project, ProjectInput, ProjectRisk } from './types';
import InvestmentInputsEditor, { emptyInvestmentInputs } from './InvestmentInputsEditor';
import ProjectDetail from './ProjectDetail';
import ScoreConfigEditor from './ScoreConfigEditor';
import { apiFetch, useAuth } from './auth';

const stages: Record<Project['stage'], string> = { concept: '概念阶段', prototype: '原型验证', production: '研发中', live: '已上线' };
const categories: Record<ProjectRisk['category'], string> = { license: '版号合规', ip: '版权 / IP', team: '核心团队', competition: '竞品冲击', technical: '技术与安全' };
const statuses: Record<ProjectRisk['status'], string> = { unverified: '待核实', confirmed: '已确认', cleared: '已排除' };
const severities: Record<ProjectRisk['severity'], string> = { low: '低', medium: '中', high: '高', catastrophic: '毁灭性' };
const emptyProject: ProjectInput = { name: '', genre: '', studio: '', stage: 'concept', description: '', risks: [], investmentInputs: emptyInvestmentInputs(), riskReviewComplete: false };

function isVetoRisk(risk: ProjectRisk) { return risk.status === 'confirmed' && risk.severity === 'catastrophic'; }
function dateText(date: string) { return date ? new Date(date).toLocaleDateString('zh-CN') : '未记录'; }

async function projectRequest(path: string, method?: string, body?: ProjectInput) {
  const response = await apiFetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) {
    let message = '操作失败，请稍后重试';
    try { const data = await response.json(); message = data.error || message; } catch { /* Keep the fallback for non-JSON errors. */ }
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}

function ProjectEditor({ project, onClose, onSaved }: { project?: Project; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<ProjectInput>(project ? { name: project.name, genre: project.genre, studio: project.studio, stage: project.stage, description: project.description, risks: project.risks.map(risk => ({ ...risk })), investmentInputs: project.investmentInputs ?? emptyInvestmentInputs(), riskReviewComplete: project.riskReviewComplete ?? false } : emptyProject);
  const [tab, setTab] = useState<'project' | 'metrics' | 'finance'>('project');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function setRisk(id: string, patch: Partial<ProjectRisk>) {
    setForm(current => ({ ...current, risks: current.risks.map(risk => risk.id === id ? { ...risk, ...patch } : risk) }));
  }
  function addRisk() {
    setForm(current => ({ ...current, risks: [...current.risks, { id: crypto.randomUUID(), category: 'license', description: '', status: 'unverified', severity: 'medium', evidenceUrl: '' }] }));
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim() || !form.genre.trim()) { setTab('project'); setError('请先填写项目名称和游戏类型。'); return; }
    if (form.risks.some(risk => !risk.description.trim())) { setTab('project'); setError('请填写每条风险的事实描述，或删除空白风险。'); return; }
    setBusy(true); setError('');
    try {
      await projectRequest(project ? `/api/projects/${project.id}` : '/api/projects', project ? 'PUT' : 'POST', form);
      await onSaved(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div className="modal project-modal" role="dialog" aria-modal="true" aria-label={project ? '编辑立项项目' : '新建立项项目'} onMouseDown={event => event.stopPropagation()}>
      <div className="modal-header"><div><span className="eyebrow">立项项目</span><h2>{project ? '编辑项目与风险事实' : '新建立项项目'}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={19} /></button></div>
      <form onSubmit={save}>
        <div className="project-editor-tabs" role="tablist" aria-label="项目编辑内容"><button type="button" role="tab" aria-selected={tab === 'project'} className={tab === 'project' ? 'selected' : ''} onClick={() => setTab('project')}>项目与风险</button><button type="button" role="tab" aria-selected={tab === 'metrics'} className={tab === 'metrics' ? 'selected' : ''} onClick={() => setTab('metrics')}>投资指标</button><button type="button" role="tab" aria-selected={tab === 'finance'} className={tab === 'finance' ? 'selected' : ''} onClick={() => setTab('finance')}>财务情景</button></div>
        <div hidden={tab !== 'project'}>
        <div className="form-grid project-form-grid">
          <label>项目名称 <span>*</span><input autoFocus required={tab === 'project'} maxLength={120} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
          <label>游戏类型 <span>*</span><input required={tab === 'project'} maxLength={50} value={form.genre} onChange={e => setForm({ ...form, genre: e.target.value })} placeholder="例如：模拟经营" /></label>
          <label>研发团队 / 工作室<input maxLength={120} value={form.studio} onChange={e => setForm({ ...form, studio: e.target.value })} /></label>
          <label>当前阶段<select value={form.stage} onChange={e => setForm({ ...form, stage: e.target.value as Project['stage'] })}>{Object.entries(stages).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="span-two">项目概述<textarea rows={3} maxLength={2000} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
        </div>
        <div className="project-risk-heading"><h3>风险事实</h3><button type="button" className="secondary-button" onClick={addRisk}><Plus size={15} /> 添加风险</button></div>
        {form.risks.length === 0 && <div className="project-risk-empty">尚未录入风险事实</div>}
        <div className="project-risk-editor-list">{form.risks.map((risk, index) => <div className="project-risk-editor" key={risk.id}>
          <div className="project-risk-editor-title"><strong>风险 {index + 1}</strong><button type="button" className="icon-button" title="删除风险" aria-label={`删除风险 ${index + 1}`} onClick={() => setForm(current => ({ ...current, risks: current.risks.filter(item => item.id !== risk.id) }))}><Trash2 size={16} /></button></div>
          <div className="form-grid project-form-grid"><label>类型<select value={risk.category} onChange={e => setRisk(risk.id, { category: e.target.value as ProjectRisk['category'] })}>{Object.entries(categories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>严重程度<select value={risk.severity} onChange={e => setRisk(risk.id, { severity: e.target.value as ProjectRisk['severity'] })}>{Object.entries(severities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>核实状态<select value={risk.status} onChange={e => setRisk(risk.id, { status: e.target.value as ProjectRisk['status'] })}>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>证据链接<input type="url" value={risk.evidenceUrl} onChange={e => setRisk(risk.id, { evidenceUrl: e.target.value })} placeholder="https://" /></label><label className="span-two">事实描述 <span>*</span><textarea required={tab === 'project'} rows={2} maxLength={1000} value={risk.description} onChange={e => setRisk(risk.id, { description: e.target.value })} /></label></div>
          {isVetoRisk(risk) && <div className="project-risk-warning"><ShieldAlert size={15} /> 已确认的毁灭性风险将触发禁止立项。</div>}
        </div>)}</div>
        <label className="project-review-toggle"><input type="checkbox" checked={form.riskReviewComplete} onChange={event => setForm({ ...form, riskReviewComplete: event.target.checked })} /><span>风险事实已完成审核</span></label>
        </div>
        {tab !== 'project' && <InvestmentInputsEditor value={form.investmentInputs} tab={tab} onChange={investmentInputs => setForm(current => ({ ...current, investmentInputs }))} />}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions"><span className="spacer" /><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={busy}><Check size={16} />{busy ? '保存中...' : '保存项目'}</button></div>
      </form>
    </div>
  </div>;
}

export default function ProjectWorkspace({ initialSelectedId = null, onOpenBenchmark }: { initialSelectedId?: string | null; onOpenBenchmark?: () => void }) {
  const { canWrite, canAdmin } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [editing, setEditing] = useState<Project | 'new' | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [busy, setBusy] = useState(false);
  async function refresh() {
    try {
      const data = await projectRequest('/api/projects') as Project[];
      setProjects(data); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '加载失败'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  const sorted = useMemo(() => [...projects].sort((a, b) => Number(b.assessment.status === 'vetoed') - Number(a.assessment.status === 'vetoed') || b.updatedAt.localeCompare(a.updatedAt)), [projects]);
  const filtered = sorted.filter(project => [project.name, project.genre, project.studio].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const selected = projects.find(project => project.id === selectedId) || null;
  const vetoed = projects.filter(project => project.assessment.status === 'vetoed');
  async function removeProject(project: Project) {
    if (!window.confirm(`确认删除“${project.name}”及其风险记录？`)) return;
    setBusy(true);
    try { await projectRequest(`/api/projects/${project.id}`, 'DELETE'); setSelectedId(null); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '删除失败'); }
    finally { setBusy(false); }
  }
  return <>
    <div className="page-heading project-heading"><div><span className="eyebrow">INVESTMENT PROJECTS / 02</span><h1>立项项目</h1><p>项目、风险与投资评估</p></div><div className="heading-actions">{canAdmin && <button className="secondary-button" onClick={() => setShowConfig(true)}><Settings2 size={16} /> 评分参数</button>}{canWrite && <button className="primary-button" onClick={() => setEditing('new')}><Plus size={17} /> 新建项目</button>}</div></div>
    {error && <div className="error-banner" role="alert">{error}<button onClick={() => void refresh()}>重试</button></div>}
    {vetoed.length > 0 && <div className="project-alert" role="alert"><ShieldAlert size={21} /><div><strong>{vetoed.length} 个项目触发一票否决</strong><span>已确认的毁灭性风险优先处理，结论已锁定为禁止立项。</span></div></div>}
    <div className="project-overview"><div><span>待立项项目</span><strong>{projects.length}</strong></div><div><span>禁止立项</span><strong className="danger">{vetoed.length}</strong></div><div><span>已完成评分</span><strong>{projects.filter(project => project.assessment.status === 'rated').length}</strong></div><div><span>资料不足</span><strong>{projects.filter(project => project.assessment.status === 'pending').length}</strong></div></div>
    <div className="project-list-head"><h2>项目清单</h2><div className="search-field"><Search size={17} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索项目、类型或团队" aria-label="搜索立项项目" />{query && <button onClick={() => setQuery('')} aria-label="清除搜索"><X size={15} /></button>}</div></div>
    <div className="project-list">
      {loading && <div className="project-empty">正在加载项目...</div>}
      {!loading && projects.length === 0 && <div className="project-empty"><ClipboardList size={28} /><strong>还没有立项项目</strong>{canWrite && <button className="primary-button" onClick={() => setEditing('new')}><Plus size={16} /> 新建项目</button>}</div>}
      {!loading && projects.length > 0 && filtered.length === 0 && <div className="project-empty">没有匹配的项目</div>}
      {filtered.map(project => <button className={`project-list-row ${project.assessment.status === 'vetoed' ? 'vetoed' : ''}`} key={project.id} onClick={() => setSelectedId(project.id)}><div className="project-row-main"><strong>{project.name}</strong><span>{project.genre} · {project.studio || '未录入团队'}</span></div><span className="project-stage">{stages[project.stage]}</span><span className={`project-result ${project.assessment.status}`}>{project.assessment.status === 'vetoed' && <ShieldAlert size={15} />}{project.assessment.conclusion}</span><span className="project-row-date">{dateText(project.updatedAt)}</span><ChevronRight size={17} /></button>)}
    </div>
    {selected && <ProjectDetail key={selected.id} project={selected} busy={busy} canWrite={canWrite} onClose={() => setSelectedId(null)} onDelete={() => void removeProject(selected)} onEdit={() => { setEditing(selected); setSelectedId(null); }} onOpenBenchmark={onOpenBenchmark} />}
    {editing && <ProjectEditor key={editing === 'new' ? 'new' : editing.id} project={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    {showConfig && <ScoreConfigEditor onClose={() => setShowConfig(false)} onSaved={refresh} />}
  </>;
}
