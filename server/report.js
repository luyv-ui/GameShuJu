import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const fontFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/fonts/NotoSansSC-Regular.otf');
const scenarioLabels = { optimistic: '乐观', base: '基准', pessimistic: '悲观' };
const riskCategories = { license: '版号合规', ip: '版权/IP', team: '核心团队', competition: '竞品冲击', technical: '技术与服务' };
const riskStatus = { unverified: '待核实', confirmed: '已确认', cleared: '已排除' };
const riskSeverity = { low: '低', medium: '中', high: '高', catastrophic: '毁灭性' };
const scenarioFields = {
  upfrontCost: '前期投入', annualDiscountRatePct: '年折现率', month1Revenue: '首月收入',
  monthlyRevenueDecayPct: '月收入衰减率', monthlyOperatingCost: '月运营成本'
};

const present = value => value !== null && value !== undefined;
const number = value => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);
const percent = value => present(value) ? `${number(value)}%` : '资料缺失';
const money = (value, currency) => present(value) ? `${currency} ${number(value)}` : '资料缺失';

function scenarioLine(name, result, currency) {
  const label = `${scenarioLabels[name]}情景`;
  if (result.status !== 'complete') {
    const missing = result.missingFields.map(field => scenarioFields[field] || field).join('、');
    return `${label}：资料缺失（${missing}），无法测算。`;
  }
  const irr = present(result.annualIrrPct) ? percent(result.annualIrrPct) : '不可定义';
  const payback = present(result.paybackMonth) ? `第 ${result.paybackMonth} 个月` : '24 个月内未回本';
  return `${label}：24 个月 NPV ${money(result.npv, currency)}；年化 IRR ${irr}；回本 ${payback}；最大累计亏损 ${money(result.maximumCumulativeLoss, currency)}。`;
}

function decision(assessment) {
  if (assessment.status === 'vetoed') return '禁止立项。已确认的毁灭性风险触发一票否决，分数归零；财务优势不得覆盖该结论。';
  if (assessment.status === 'pending') return '资料不足，暂不评级。补齐缺失指标、来源及风险审核后重新生成报告。';
  if (assessment.financialGate?.triggered) {
    return `不推荐立项。${assessment.financialGate.reasons.join('；')}，根据财务硬门槛综合分封顶 49。`;
  }
  return `${assessment.conclusion}。综合评分 ${assessment.score} 分；该结论由当前评分参数和已录入数据自动计算。`;
}

export function generateInvestmentReport(project, generatedAt = new Date().toISOString()) {
  const { assessment, forecast, investmentInputs: inputs } = project;
  const strengths = [];
  if (assessment.status !== 'vetoed' && assessment.breakdown) {
    const { market, returns, sustainability } = assessment.breakdown;
    if (market >= 12) strengths.push(`市场机会得分 ${number(market)} 分，已录入的赛道增速与新品存活率支持该评分。`);
    if (returns >= 18) strengths.push(`投资收益得分 ${number(returns)} 分，依据基准情景 IRR、回本期和 LTV/CAC 测算。`);
    if (sustainability >= 18) strengths.push(`现金流持续性得分 ${number(sustainability)} 分，依据付费 D180 留存与月现金流衰减率测算。`);
  }
  if (!strengths.length) strengths.push(assessment.status === 'vetoed' ? '存在一票否决风险，优势不参与立项判断。' : '当前数据尚不能形成可验证的优势判断。');

  const risks = project.risks.filter(risk => risk.status !== 'cleared').map(risk =>
    `${riskCategories[risk.category] || risk.category}（${riskStatus[risk.status] || risk.status}，${riskSeverity[risk.severity] || risk.severity}）：${risk.description}${risk.evidenceUrl ? `；证据：${risk.evidenceUrl}` : '；证据链接未提供'}`
  );
  if (assessment.status === 'vetoed') risks.unshift('已确认毁灭性风险触发一票否决。');
  if (assessment.financialGate?.triggered) risks.push(`财务硬门槛：${assessment.financialGate.reasons.join('；')}。`);
  if (assessment.status === 'pending') risks.push(`尚待补齐：${assessment.missing.join('、')}。`);
  if (!risks.length) risks.push('当前风险清单未记录未排除风险；这不代表不存在其他风险。');

  const returns = ['以下为录入假设下的 24 个月测算，不代表实际收入承诺。'];
  for (const [name, result] of Object.entries(forecast.scenarios)) {
    returns.push(scenarioLine(name, result, forecast.currency));
  }
  const ltv90 = inputs.commercial.ltv90;
  const cac = inputs.commercial.cac;
  returns.push(present(ltv90) && present(cac) && cac > 0
    ? `LTV90/CAC：${number(ltv90 / cac)}（LTV90 ${money(ltv90, inputs.commercial.currency)}，CAC ${money(cac, inputs.commercial.currency)}）。`
    : 'LTV90/CAC：资料缺失或 CAC 为 0，无法计算。');

  const sustainability = [
    `付费用户 D180 留存：${percent(inputs.users.payingD180Pct)}；月度现金流自然衰减率：${percent(inputs.users.monthlyCashDecayPct)}。`,
    `版本更新周期：${present(inputs.operations.versionCycleMonths) ? `${number(inputs.operations.versionCycleMonths)} 个月` : '资料缺失'}；版本流水拉升：${percent(inputs.operations.versionRevenueLiftPct)}；内容消耗周期：${present(inputs.operations.contentConsumptionMonths) ? `${number(inputs.operations.contentConsumptionMonths)} 个月` : '资料缺失'}。`
  ];
  if (assessment.breakdown) sustainability.push(`现金流持续性得分：${number(assessment.breakdown.sustainability)} 分。`);
  else sustainability.push('关键数据尚未齐备，暂不判断长线稳定性。');

  const assumptions = [
    `市场数据：${inputs.market.region || '地区缺失'}，${inputs.market.asOf || '日期缺失'}；依据：${inputs.market.basis || '未提供'}。`,
    `用户数据：${inputs.users.region || '地区缺失'}，${inputs.users.asOf || '日期缺失'}；依据：${inputs.users.basis || '未提供'}。`,
    `商业化数据：${inputs.commercial.region || '地区缺失'}，${inputs.commercial.asOf || '日期缺失'}；依据：${inputs.commercial.basis || '未提供'}。`,
    `财务假设：前期投入 ${money(inputs.finance.upfrontCost, inputs.finance.currency)}，年折现率 ${percent(inputs.finance.annualDiscountRatePct)}；依据：${inputs.finance.basis || '未提供'}。`,
    ...Object.entries(inputs.finance.scenarios).map(([name, scenario]) =>
      `${scenarioLabels[name]}情景输入：首月收入 ${money(scenario.month1Revenue, inputs.finance.currency)}，月收入衰减率 ${percent(scenario.monthlyRevenueDecayPct)}，月运营成本 ${money(scenario.monthlyOperatingCost, inputs.finance.currency)}。`)
  ];

  return {
    projectId: project.id,
    generatedAt,
    projectName: project.name,
    status: assessment.status,
    conclusion: assessment.conclusion,
    score: assessment.score,
    sections: { strengths, risks, returns, sustainability, recommendation: decision(assessment) },
    assumptions
  };
}

export function renderInvestmentReportPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `${report.projectName} - 投资立项报告`, Author: '游戏投资立项决策情报系统' } });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    try {
      doc.registerFont('Chinese', fontFile);
      doc.font('Chinese').fillColor('#1b2838').fontSize(20).text('投资立项决策报告');
      doc.moveDown(0.3).fontSize(15).text(report.projectName);
      doc.moveDown(0.4).fontSize(9).fillColor('#5f6b76').text(`生成时间：${report.generatedAt}    项目 ID：${report.projectId}`);
      doc.moveDown(1).fillColor('#1b2838').fontSize(11).text(`结论：${report.conclusion}    综合评分：${present(report.score) ? `${report.score} 分` : '暂不评级'}`);
      doc.moveDown(1);
      const section = (title, lines) => {
        doc.fontSize(13).fillColor('#1b2838').text(title, { continued: false });
        doc.moveDown(0.3).fontSize(9.5).fillColor('#334155');
        for (const line of lines) doc.text(`• ${line}`, { lineGap: 3 }).moveDown(0.3);
        doc.moveDown(0.6);
      };
      section('项目优势', report.sections.strengths);
      section('风险与缺口', report.sections.risks);
      section('收益测算', report.sections.returns);
      section('持续性判断', report.sections.sustainability);
      section('最终立项建议', [report.sections.recommendation]);
      section('数据依据与假设', report.assumptions);
      doc.end();
    } catch (error) { reject(error); }
  });
}
