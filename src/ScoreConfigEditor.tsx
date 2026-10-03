import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { ScoreConfig } from './types';

const groups: { key: keyof ScoreConfig; title: string; fields: { key: string; label: string; unit?: string }[] }[] = [
  { key: 'weights', title: '评分权重', fields: [{ key: 'market', label: '市场' }, { key: 'returns', label: '收益' }, { key: 'sustainability', label: '持续性' }, { key: 'riskReserve', label: '风险保留' }] },
  { key: 'thresholds', title: '目标与结论阈值', fields: [{ key: 'growthTargetPct', label: '市场 12 个月增速目标', unit: '%' }, { key: 'survivalTargetPct', label: '新品存活率目标', unit: '%' }, { key: 'irrTargetPct', label: 'IRR 目标', unit: '%' }, { key: 'paybackTargetMonths', label: '回本周期目标', unit: '月' }, { key: 'ltvCacTarget', label: 'LTV / CAC 目标' }, { key: 'payingD180TargetPct', label: '付费 D180 留存目标', unit: '%' }, { key: 'cashDecayTargetPct', label: '月现金流衰减目标', unit: '%' }, { key: 'cautionScore', label: '谨慎立项分界', unit: '分' }, { key: 'recommendScore', label: '推荐立项分界', unit: '分' }] },
  { key: 'riskPenalties', title: '已确认风险扣分', fields: [{ key: 'low', label: '低风险' }, { key: 'medium', label: '中风险' }, { key: 'high', label: '高风险' }] }
];

export default function ScoreConfigEditor({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [config, setConfig] = useState<ScoreConfig | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch('/api/score-config').then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '读取评分配置失败');
      setConfig(data);
    }).catch(cause => setError(cause instanceof Error ? cause.message : '读取评分配置失败'));
  }, []);
  function update(group: keyof ScoreConfig, key: string, value: number) {
    if (!config) return;
    setConfig({ ...config, [group]: { ...config[group], [key]: value } });
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!config) return;
    const total = Object.values(config.weights).reduce((sum, value) => sum + value, 0);
    if (Math.abs(total - 100) > 1e-9) { setError('四项权重之和必须为 100。'); return; }
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/score-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '保存评分配置失败');
      await onSaved(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存评分配置失败'); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal score-config-modal" role="dialog" aria-modal="true" aria-label="评分参数" onMouseDown={event => event.stopPropagation()}>
    <div className="modal-header"><div><span className="eyebrow">投资评估</span><h2>评分参数</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={19} /></button></div>
    {config ? <form onSubmit={save}>{groups.map(group => <section className="investment-section" key={group.key}><h3>{group.title}</h3><div className="form-grid project-form-grid">{group.fields.map(field => <label key={field.key}>{field.label}{field.unit ? `（${field.unit}）` : ''}<input required type="number" min="0" step="any" value={config[group.key][field.key as keyof typeof config[typeof group.key]]} onChange={event => update(group.key, field.key, Number(event.target.value))} /></label>)}</div></section>)}
      <p className="score-config-note">总分 = 市场 + 收益 + 持续性 + 风险保留 − 风险扣分；四项权重合计 100。</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions"><span className="spacer" /><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={busy}><Check size={16} />{busy ? '保存中...' : '保存参数'}</button></div>
    </form> : <div className="score-config-loading">{error || '正在加载评分参数...'}</div>}
  </div></div>;
}
