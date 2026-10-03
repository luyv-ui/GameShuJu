import { calculateScenario } from './finance.js';

const scenarioNames = ['optimistic', 'base', 'pessimistic'];
const scenarioLabels = { optimistic: '乐观', base: '基准', pessimistic: '悲观' };
const financeFields = {
  upfrontCost: '前期投入', annualDiscountRatePct: '年折现率',
  month1Revenue: '首月收入', monthlyRevenueDecayPct: '月收入衰减率', monthlyOperatingCost: '月运营成本'
};

const clamp01 = value => Math.min(1, Math.max(0, value));
const round2 = value => Math.round((value + Number.EPSILON) * 100) / 100;

function forecastProject(inputs) {
  const finance = inputs.finance;
  const scenarios = Object.fromEntries(scenarioNames.map(name => [name, calculateScenario({
    upfrontCost: finance.upfrontCost,
    annualDiscountRatePct: finance.annualDiscountRatePct,
    ...finance.scenarios[name]
  })]));
  return { currency: finance.currency, scenarios };
}

function missingInputs(project, forecast) {
  const inputs = project.investmentInputs;
  const missing = [];
  if (!project.riskReviewComplete) missing.push('风险审核未完成');
  if (project.risks.some(risk => risk.status === 'unverified')) missing.push('存在待核实风险');
  const fields = [
    [inputs.market.growth12mPct, '市场 12 个月增速'],
    [inputs.market.survival6mPct, '赛道新品 6 个月存活率'],
    [inputs.users.payingD180Pct, '付费用户 D180 留存'],
    [inputs.users.monthlyCashDecayPct, '月度现金流衰减率'],
    [inputs.commercial.ltv90, 'LTV90'],
    [inputs.commercial.cac, 'CAC']
  ];
  for (const [value, label] of fields) if (value === null || value === undefined) missing.push(label);
  if (inputs.commercial.cac === 0) missing.push('CAC 必须大于 0 才能计算 LTV/CAC');
  for (const [group, label] of [['market', '市场'], ['users', '用户'], ['commercial', '商业化']]) {
    if (!inputs[group].region) missing.push(`${label}数据地区`);
    if (!inputs[group].asOf) missing.push(`${label}数据日期`);
    if (!inputs[group].basis) missing.push(`${label}数据依据`);
  }
  if (!inputs.finance.basis) missing.push('财务情景依据');
  for (const name of scenarioNames) {
    const result = forecast.scenarios[name];
    if (result.status === 'incomplete') {
      for (const field of result.missingFields) missing.push(`${scenarioLabels[name]}情景${financeFields[field]}`);
    }
  }
  return missing;
}

export function evaluateProject(project, config) {
  const forecast = forecastProject(project.investmentInputs);
  const vetoRiskIds = project.risks
    .filter(risk => risk.status === 'confirmed' && risk.severity === 'catastrophic')
    .map(risk => risk.id);
  if (vetoRiskIds.length) return {
    forecast,
    assessment: {
      status: 'vetoed', score: 0, conclusion: '禁止立项', vetoRiskIds,
      missing: [], breakdown: null, financialGate: null
    }
  };

  const missing = missingInputs(project, forecast);
  const base = forecast.scenarios.base;
  const financialGateReasons = base.status === 'complete' ? [
    ...(base.npv <= 0 ? ['基准情景 NPV 不大于 0'] : []),
    ...(base.paybackMonth === null ? ['24 个月内未回本'] : [])
  ] : [];
  if (base.status === 'complete' && base.annualIrrPct === null && !financialGateReasons.length) {
    missing.push('基准情景 IRR 不可定义');
  }
  if (missing.length) return {
    forecast,
    assessment: {
      status: 'pending', score: null, conclusion: '资料不足，暂不评级', vetoRiskIds: [],
      missing, breakdown: null, financialGate: null
    }
  };

  const inputs = project.investmentInputs;
  const { weights, thresholds, riskPenalties } = config;
  const ltvCac = inputs.commercial.ltv90 / inputs.commercial.cac;
  const market = weights.market * (
    0.5 * clamp01(inputs.market.growth12mPct / thresholds.growthTargetPct) +
    0.5 * clamp01(inputs.market.survival6mPct / thresholds.survivalTargetPct)
  );
  const payback = base.paybackMonth === null ? 0 : base.paybackMonth === 0 ? 1 :
    clamp01(thresholds.paybackTargetMonths / base.paybackMonth);
  const returns = weights.returns * (
    0.4 * clamp01((base.annualIrrPct ?? 0) / thresholds.irrTargetPct) +
    0.3 * payback +
    0.3 * clamp01(ltvCac / thresholds.ltvCacTarget)
  );
  const cashDecay = inputs.users.monthlyCashDecayPct === 0 ? 1 :
    clamp01(thresholds.cashDecayTargetPct / inputs.users.monthlyCashDecayPct);
  const sustainability = weights.sustainability * (
    0.5 * clamp01(inputs.users.payingD180Pct / thresholds.payingD180TargetPct) +
    0.5 * cashDecay
  );
  const riskPenalty = Math.min(weights.riskReserve, project.risks
    .filter(risk => risk.status === 'confirmed')
    .reduce((total, risk) => total + (riskPenalties[risk.severity] || 0), 0));
  const uncappedScore = Math.max(0, Math.min(100, Math.round(market + returns + sustainability + weights.riskReserve - riskPenalty)));
  const score = financialGateReasons.length ? Math.min(uncappedScore, 49, Math.max(0, Math.ceil(thresholds.cautionScore) - 1)) : uncappedScore;
  const conclusion = financialGateReasons.length ? '不推荐立项' :
    score >= thresholds.recommendScore ? '推荐立项' :
      score >= thresholds.cautionScore ? '谨慎立项' : '不推荐立项';
  return {
    forecast,
    assessment: {
      status: 'rated', score, conclusion, vetoRiskIds: [], missing: [],
      breakdown: {
        market: round2(market), returns: round2(returns), sustainability: round2(sustainability),
        riskReserve: weights.riskReserve, riskPenalty: round2(riskPenalty)
      },
      financialGate: { triggered: Boolean(financialGateReasons.length), reasons: financialGateReasons, uncappedScore }
    }
  };
}
