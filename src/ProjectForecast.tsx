import { useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Project } from './types';

const names = { optimistic: '乐观', base: '基准', pessimistic: '悲观' } as const;
type ScenarioName = keyof typeof names;
const number = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);

export default function ProjectForecast({ forecast }: { forecast: Project['forecast'] }) {
  const [selected, setSelected] = useState<ScenarioName>('base');
  if (!forecast) return <div className="project-detail-section"><h3>三情景财务测算</h3><p className="forecast-missing">尚未取得测算结果。</p></div>;
  const scenario = forecast.scenarios[selected];
  return <div className="project-detail-section"><h3>三情景财务测算</h3>
    <div className="project-forecast-tabs" role="tablist" aria-label="财务情景">{(Object.keys(names) as ScenarioName[]).map(name => <button key={name} type="button" role="tab" aria-selected={selected === name} className={selected === name ? 'selected' : ''} onClick={() => setSelected(name)}>{names[name]}</button>)}</div>
    {scenario.status === 'incomplete' ? <p className="forecast-missing">数据未齐，暂无法测算。缺少：{scenario.missingFields.join('、') || '必要财务假设'}</p> : <>
      <div className="forecast-stat-grid"><div><span>净现值 NPV</span><strong>{number(scenario.npv)} {forecast.currency}</strong></div><div><span>年化 IRR</span><strong>{scenario.annualIrrPct === null ? '不可定义' : `${number(scenario.annualIrrPct)}%`}</strong></div><div><span>回本月份</span><strong>{scenario.paybackMonth === null ? '未回本' : `第 ${scenario.paybackMonth} 月`}</strong></div><div><span>最大累计亏损</span><strong>{number(scenario.maximumCumulativeLoss)} {forecast.currency}</strong></div></div>
      <div className="forecast-chart" role="img" aria-label={`${names[selected]}情景 ${scenario.horizonMonths} 个月现金流曲线`}><ResponsiveContainer width="100%" height="100%"><LineChart data={scenario.months} margin={{ top: 10, right: 12, left: 8, bottom: 2 }}><CartesianGrid stroke="#edf1f2" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} /><YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={54} tickFormatter={number} /><Tooltip formatter={(value, name) => [`${number(Number(value))} ${forecast.currency}`, name === 'cumulativeCashFlow' ? '累计现金流' : name === 'cashFlow' ? '当月现金流' : '收入']} labelFormatter={label => `第 ${label} 月`} /><Line type="monotone" dataKey="revenue" name="收入" stroke="#2c9c8f" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="cashFlow" name="当月现金流" stroke="#cb8d42" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="cumulativeCashFlow" name="累计现金流" stroke="#597b9e" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div>
      <div className="forecast-legend"><span>● 收入</span><span>● 当月现金流</span><span>● 累计现金流</span></div>
    </>}
  </div>;
}
