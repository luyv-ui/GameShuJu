import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { InvestmentInputs } from './types';

type SourceSection = 'market' | 'users' | 'commercial' | 'operations';
type Row = { label: string; value: number | null; unit?: string };

const format = (value: number, digits = 2) => value.toLocaleString('zh-CN', { maximumFractionDigits: digits });
const shown = (value: number | null, unit = '') => value === null ? '未录入' : `${format(value)}${unit}`;
const available = (value: number | null) => value !== null && Number.isFinite(value);

function MetricGroup({ title, source, rows }: { title: string; source: InvestmentInputs[SourceSection]; rows: Row[] }) {
  const filled = rows.filter(row => available(row.value)).length;
  return <section className="operations-group">
    <div className="operations-group-heading"><h3>{title}</h3><span>{filled} / {rows.length} 项已录入</span></div>
    <div className="project-operations-grid">{rows.map(row => <div key={row.label}><span>{row.label}</span><strong>{shown(row.value, row.unit)}</strong></div>)}</div>
    <p>地区：{source.region || '未录入'} · 截至：{source.asOf || '未录入'}</p>
    <p>依据：{source.basis || '未录入'}</p>
  </section>;
}

export default function OperationsAnalysis({ inputs }: { inputs: InvestmentInputs }) {
  const { market, users, commercial, operations } = inputs;
  const retention = [
    { day: 'D1', value: users.d1Pct }, { day: 'D7', value: users.d7Pct },
    { day: 'D30', value: users.d30Pct }, { day: 'D90', value: users.d90Pct }
  ];
  const retentionCount = retention.filter(point => available(point.value)).length;
  const ltvCac = available(commercial.ltv90) && available(commercial.cac) && commercial.cac! > 0
    ? commercial.ltv90! / commercial.cac! : null;
  const versionGap = available(operations.versionCycleMonths) && available(operations.contentConsumptionMonths)
    ? operations.contentConsumptionMonths! - operations.versionCycleMonths! : null;
  const retentionOrdered = retention.every((point, index) => index === 0 || !available(point.value) ||
    !available(retention[index - 1].value) || point.value! <= retention[index - 1].value!);
  const provenance = [
    { name: '用户与留存', source: users }, { name: '商业化', source: commercial },
    { name: '版本运营', source: operations }
  ];
  const readySources = provenance.filter(item => item.source.region && item.source.asOf && item.source.basis).length;
  const findings = [
    { title: '获客回收', value: ltvCac === null ? '待计算' : `${format(ltvCac)} 倍`,
      detail: ltvCac === null ? commercial.cac === 0 ? 'CAC 为 0，无法计算 LTV90/CAC。' : '录入 LTV90 与大于 0 的 CAC 后显示。'
        : ltvCac < 1 ? '90 天用户价值尚未覆盖获客成本；这不是完整利润测算。' : '90 天用户价值已覆盖获客成本；尚未扣除运营及研发成本。',
      tone: ltvCac !== null && ltvCac < 1 ? 'attention' : '' },
    { title: '留存走势', value: available(users.d1Pct) && available(users.d90Pct) ? `${format(users.d1Pct!)}% → ${format(users.d90Pct!)}%` : '待计算',
      detail: !retentionOrdered ? '相邻留存点出现上升，请核对是否来自同一批用户及同一统计口径。'
        : retentionCount < 2 ? '至少录入两个留存节点后可观察变化。' : 'D1、D7、D30、D90 为用户留存；付费 D180 属于另一人群，单独展示。',
      tone: retentionOrdered ? '' : 'attention' },
    { title: '内容供给', value: versionGap === null ? '待计算' : versionGap < 0 ? `缺口 ${format(-versionGap)} 个月` : versionGap === 0 ? '周期相同' : `余量 ${format(versionGap)} 个月`,
      detail: versionGap === null ? '录入版本周期与内容消耗周期后显示。' : versionGap < 0
        ? '内容预计先于下个大版本消耗完，请复核更新计划。' : '按录入周期比较；不代表内容质量或实际留存。',
      tone: versionGap !== null && versionGap < 0 ? 'attention' : '' },
    { title: '现金流韧性', value: available(users.monthlyCashDecayPct) ? shown(users.monthlyCashDecayPct, '% / 月') : '待录入',
      detail: available(operations.versionRevenueLiftPct) ? `版本流水拉升 ${shown(operations.versionRevenueLiftPct, '%')}；两个指标统计窗口不同，不直接相抵。`
        : '同时录入版本流水拉升，可对照自然衰减与更新效果。', tone: '' }
  ];

  return <div className="project-operations operations-analysis">
    <div className="operations-summary">
      <div><span>获客回收 · LTV90/CAC</span><strong>{ltvCac === null ? '—' : `${format(ltvCac)} 倍`}</strong></div>
      <div><span>付费用户 D180 留存</span><strong>{shown(users.payingD180Pct, '%')}</strong></div>
      <div><span>版本收入提升</span><strong>{shown(operations.versionRevenueLiftPct, '%')}</strong></div>
      <div><span>数据依据完整</span><strong>{readySources} / {provenance.length}</strong></div>
    </div>

    <section className="operations-diagnostics"><div className="operations-group-heading"><h3>运营诊断</h3><span>基于已录入数据</span></div>
      <div className="operations-findings">{findings.map(item => <div className={item.tone} key={item.title}><span>{item.title}</span><strong>{item.value}</strong><p>{item.detail}</p></div>)}</div>
    </section>

    <section className="operations-retention"><div className="operations-group-heading"><h3>用户留存曲线</h3><span>{retentionCount} / 4 个节点</span></div>
      {retentionCount ? <div className="operations-retention-chart" role="img" aria-label="D1、D7、D30、D90 用户留存曲线"><ResponsiveContainer width="100%" height="100%"><LineChart data={retention} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}><CartesianGrid stroke="#e9eff0" vertical={false} /><XAxis dataKey="day" axisLine={false} tickLine={false} /><YAxis width={46} domain={[0, 100]} unit="%" axisLine={false} tickLine={false} /><Tooltip formatter={value => `${format(Number(value))}%`} /><Line type="linear" dataKey="value" connectNulls={false} stroke="#199788" strokeWidth={2.5} dot={{ r: 4 }} name="用户留存" /></LineChart></ResponsiveContainer></div>
        : <p className="operations-empty">尚未录入留存节点。</p>}
      <p className="operations-note">曲线只表示已录入的同一口径用户留存，不将付费用户 D180 留存混入普通用户曲线。</p>
    </section>

    <MetricGroup title="用户与留存" source={users} rows={[
      { label: 'D1 留存', value: users.d1Pct, unit: '%' }, { label: 'D7 留存', value: users.d7Pct, unit: '%' },
      { label: 'D30 留存', value: users.d30Pct, unit: '%' }, { label: 'D90 留存', value: users.d90Pct, unit: '%' },
      { label: '付费用户 D180 留存', value: users.payingD180Pct, unit: '%' },
      { label: '平均单次时长', value: users.avgSessionMinutes, unit: ' 分钟' },
      { label: '新用户增长', value: users.newUserGrowthPct, unit: '%' },
      { label: '月现金流自然衰减', value: users.monthlyCashDecayPct, unit: '%' }
    ]} />
    <MetricGroup title="商业化与获客" source={commercial} rows={[
      { label: 'ARPU', value: commercial.arpu, unit: ` ${commercial.currency}` },
      { label: 'ARPPU', value: commercial.arppu, unit: ` ${commercial.currency}` },
      { label: '付费渗透率', value: commercial.payerPenetrationPct, unit: '%' },
      { label: 'LTV30', value: commercial.ltv30, unit: ` ${commercial.currency}` },
      { label: 'LTV90', value: commercial.ltv90, unit: ` ${commercial.currency}` },
      { label: '获客成本 CAC', value: commercial.cac, unit: ` ${commercial.currency}` }
    ]} />
    <MetricGroup title="版本运营与健康度" source={operations} rows={[
      { label: '大版本周期', value: operations.versionCycleMonths, unit: ' 月' },
      { label: '版本流水拉升', value: operations.versionRevenueLiftPct, unit: '%' },
      { label: '内容消耗周期', value: operations.contentConsumptionMonths, unit: ' 月' },
      { label: '经济系统稳定性', value: operations.economyStabilityScore, unit: ' 分' },
      { label: '用户口碑', value: operations.sentimentScore, unit: ' 分' },
      { label: '负面事件现金流冲击', value: operations.negativeEventCashShockPct, unit: '%' }
    ]} />
    <MetricGroup title="赛道背景" source={market} rows={[
      { label: '可触达市场规模', value: market.tam, unit: ` ${market.currency}` },
      { label: '12 个月增速', value: market.growth12mPct, unit: '%' },
      { label: '新品 6 个月存活率', value: market.survival6mPct, unit: '%' },
      { label: '市场集中度', value: market.concentrationPct, unit: '%' },
      { label: '同类项目 IRR', value: market.benchmarkIrrPct, unit: '%' },
      { label: '同类项目回本周期', value: market.benchmarkPaybackMonths, unit: ' 月' }
    ]} />
  </div>;
}
