import type { InvestmentInputs } from './types';

export function emptyInvestmentInputs(): InvestmentInputs {
  return {
    market: { tam: null, growth12mPct: null, concentrationPct: null, survival6mPct: null, benchmarkIrrPct: null, benchmarkPaybackMonths: null, currency: 'CNY', region: '', asOf: '', basis: '' },
    users: { d1Pct: null, d7Pct: null, d30Pct: null, d90Pct: null, payingD180Pct: null, avgSessionMinutes: null, monthlyCashDecayPct: null, newUserGrowthPct: null, region: '', asOf: '', basis: '' },
    commercial: { arpu: null, arppu: null, payerPenetrationPct: null, ltv30: null, ltv90: null, cac: null, currency: 'CNY', region: '', asOf: '', basis: '' },
    operations: { versionCycleMonths: null, versionRevenueLiftPct: null, contentConsumptionMonths: null, economyStabilityScore: null, sentimentScore: null, negativeEventCashShockPct: null, region: '', asOf: '', basis: '' },
    finance: { currency: 'CNY', upfrontCost: null, annualDiscountRatePct: null, basis: '', scenarios: { optimistic: { month1Revenue: null, monthlyRevenueDecayPct: null, monthlyOperatingCost: null }, base: { month1Revenue: null, monthlyRevenueDecayPct: null, monthlyOperatingCost: null }, pessimistic: { month1Revenue: null, monthlyRevenueDecayPct: null, monthlyOperatingCost: null } } }
  };
}

type SectionName = 'market' | 'users' | 'commercial' | 'operations';
type NumericField = { key: string; label: string; unit?: string; min?: number; max?: number };
const sections: { key: SectionName; title: string; fields: NumericField[] }[] = [
  { key: 'market', title: '市场', fields: [
    { key: 'tam', label: '可触达市场规模', unit: '元', max: 1e12 }, { key: 'growth12mPct', label: '近 12 个月增速', unit: '%', min: -100, max: 1000 },
    { key: 'concentrationPct', label: '市场集中度', unit: '%' }, { key: 'survival6mPct', label: '新品 6 个月存活率', unit: '%' },
    { key: 'benchmarkIrrPct', label: '同类项目 IRR', unit: '%', min: -100, max: 1000 }, { key: 'benchmarkPaybackMonths', label: '同类项目回本周期', unit: '月', max: 1200 }
  ] },
  { key: 'users', title: '用户', fields: [
    { key: 'd1Pct', label: 'D1 留存', unit: '%' }, { key: 'd7Pct', label: 'D7 留存', unit: '%' },
    { key: 'd30Pct', label: 'D30 留存', unit: '%' }, { key: 'd90Pct', label: 'D90 留存', unit: '%' },
    { key: 'payingD180Pct', label: '付费用户 D180 留存', unit: '%' }, { key: 'avgSessionMinutes', label: '平均单次时长', unit: '分钟', max: 1440 },
    { key: 'monthlyCashDecayPct', label: '月现金流衰减', unit: '%' }, { key: 'newUserGrowthPct', label: '新用户增长', unit: '%', min: -100, max: 1000 }
  ] },
  { key: 'commercial', title: '商业化', fields: [
    { key: 'arpu', label: 'ARPU', unit: '元', max: 1e12 }, { key: 'arppu', label: 'ARPPU', unit: '元', max: 1e12 },
    { key: 'payerPenetrationPct', label: '付费渗透率', unit: '%' }, { key: 'ltv30', label: 'LTV 30', unit: '元', max: 1e12 },
    { key: 'ltv90', label: 'LTV 90', unit: '元', max: 1e12 }, { key: 'cac', label: '获客成本 CAC', unit: '元', max: 1e12 }
  ] },
  { key: 'operations', title: '运营与持续性', fields: [
    { key: 'versionCycleMonths', label: '版本周期', unit: '月', max: 1200 }, { key: 'versionRevenueLiftPct', label: '版本收入提升', unit: '%' },
    { key: 'contentConsumptionMonths', label: '内容消耗周期', unit: '月', max: 1200 }, { key: 'economyStabilityScore', label: '经济系统稳定性', unit: '分' },
    { key: 'sentimentScore', label: '用户口碑', unit: '分' }, { key: 'negativeEventCashShockPct', label: '负面事件现金流冲击', unit: '%' }
  ] }
];
const scenarioNames = { optimistic: '乐观', base: '基准', pessimistic: '悲观' } as const;
const scenarioFields: NumericField[] = [
  { key: 'month1Revenue', label: '首月收入', unit: '元', max: 1e12 },
  { key: 'monthlyRevenueDecayPct', label: '月收入衰减', unit: '%' },
  { key: 'monthlyOperatingCost', label: '月运营成本', unit: '元', max: 1e12 }
];

function NumberField({ field, value, onChange }: { field: NumericField; value: number | null; onChange: (value: number | null) => void }) {
  return <label>{field.label}{field.unit ? `（${field.unit}）` : ''}<input type="number" min={field.min ?? 0} max={field.max ?? 100} step="any" inputMode="decimal" value={value ?? ''} onChange={event => onChange(event.target.value === '' ? null : Number(event.target.value))} /></label>;
}

export default function InvestmentInputsEditor({ value, onChange, tab }: { value: InvestmentInputs; onChange: (value: InvestmentInputs) => void; tab: 'metrics' | 'finance' }) {
  function updateSection(section: SectionName, key: string, next: string | number | null) {
    onChange({ ...value, [section]: { ...value[section], [key]: next } });
  }
  function updateFinance(key: string, next: string | number | null) {
    onChange({ ...value, finance: { ...value.finance, [key]: next } });
  }
  function updateScenario(name: keyof InvestmentInputs['finance']['scenarios'], key: string, next: number | null) {
    onChange({ ...value, finance: { ...value.finance, scenarios: { ...value.finance.scenarios, [name]: { ...value.finance.scenarios[name], [key]: next } } } });
  }
  if (tab === 'finance') return <div className="investment-editor">
    <section className="investment-section"><h3>财务基础</h3><div className="form-grid project-form-grid">
      <label>币种<input maxLength={3} value={value.finance.currency} onChange={event => updateFinance('currency', event.target.value.toUpperCase())} /></label>
      <NumberField field={{ key: 'upfrontCost', label: '前期总投入', unit: '元', max: 1e12 }} value={value.finance.upfrontCost} onChange={next => updateFinance('upfrontCost', next)} />
      <NumberField field={{ key: 'annualDiscountRatePct', label: '年折现率', unit: '%' }} value={value.finance.annualDiscountRatePct} onChange={next => updateFinance('annualDiscountRatePct', next)} />
      <label className="span-two">财务假设与来源<textarea rows={2} maxLength={2000} value={value.finance.basis} onChange={event => updateFinance('basis', event.target.value)} /></label>
    </div></section>
    {(Object.entries(scenarioNames) as [keyof typeof scenarioNames, string][]).map(([name, label]) => <section className="investment-section" key={name}><h3>{label}情景</h3><div className="form-grid project-form-grid">{scenarioFields.map(field => <NumberField key={field.key} field={field} value={value.finance.scenarios[name][field.key as keyof typeof value.finance.scenarios.base]} onChange={next => updateScenario(name, field.key, next)} />)}</div></section>)}
  </div>;
  return <div className="investment-editor">{sections.map(section => <section className="investment-section" key={section.key}>
    <h3>{section.title}</h3><div className="form-grid project-form-grid">
      {section.fields.map(field => <NumberField key={field.key} field={field} value={(value[section.key] as unknown as Record<string, number | null>)[field.key]} onChange={next => updateSection(section.key, field.key, next)} />)}
      {'currency' in value[section.key] && <label>币种<input maxLength={3} value={String((value[section.key] as unknown as Record<string, string>).currency)} onChange={event => updateSection(section.key, 'currency', event.target.value.toUpperCase())} /></label>}
      <label>地区<input maxLength={100} value={value[section.key].region} onChange={event => updateSection(section.key, 'region', event.target.value)} /></label>
      <label>数据截至日期<input type="date" value={value[section.key].asOf} onChange={event => updateSection(section.key, 'asOf', event.target.value)} /></label>
      <label className="span-two">来源与统计口径<textarea rows={2} maxLength={2000} value={value[section.key].basis} onChange={event => updateSection(section.key, 'basis', event.target.value)} /></label>
    </div>
  </section>)}</div>;
}
