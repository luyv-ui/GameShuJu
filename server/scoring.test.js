import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyInvestmentInputs } from './projects.js';
import { defaultScoreConfig } from './score-config.js';
import { evaluateProject } from './scoring.js';

function completeProject() {
  const investmentInputs = emptyInvestmentInputs();
  Object.assign(investmentInputs.market, { growth12mPct: 20, survival6mPct: 50,
    region: 'CN', asOf: '2026-10-01', basis: '市场调研' });
  Object.assign(investmentInputs.users, { payingD180Pct: 20, monthlyCashDecayPct: 0,
    region: 'CN', asOf: '2026-10-01', basis: '用户测试' });
  Object.assign(investmentInputs.commercial, { ltv90: 300, cac: 100,
    region: 'CN', asOf: '2026-10-01', basis: '商业化测试' });
  Object.assign(investmentInputs.finance, { upfrontCost: 100, annualDiscountRatePct: 10,
    basis: '内部测算' });
  for (const scenario of Object.values(investmentInputs.finance.scenarios)) {
    Object.assign(scenario, { month1Revenue: 20, monthlyRevenueDecayPct: 0, monthlyOperatingCost: 1 });
  }
  return { investmentInputs, riskReviewComplete: true, risks: [] };
}

test('complete evidence can reach 100 points and exposes all three scenarios', () => {
  const result = evaluateProject(completeProject(), defaultScoreConfig);
  assert.equal(result.assessment.status, 'rated');
  assert.equal(result.assessment.score, 100);
  assert.equal(result.assessment.conclusion, '推荐立项');
  assert.deepEqual(result.assessment.breakdown, {
    market: 20, returns: 30, sustainability: 30, riskReserve: 20, riskPenalty: 0
  });
  assert.equal(result.assessment.financialGate.triggered, false);
  assert.equal(result.forecast.scenarios.base.months.length, 24);
  assert.equal(result.forecast.scenarios.optimistic.status, 'complete');
  assert.equal(result.forecast.scenarios.pessimistic.status, 'complete');
});

test('confirmed risks deduct points, while a confirmed catastrophic risk always vetoes', () => {
  const project = completeProject();
  project.risks = [{ id: 'high', status: 'confirmed', severity: 'high' }];
  assert.equal(evaluateProject(project, defaultScoreConfig).assessment.score, 90);
  project.risks.push({ id: 'veto', status: 'confirmed', severity: 'catastrophic' });
  const veto = evaluateProject(project, defaultScoreConfig).assessment;
  assert.equal(veto.status, 'vetoed');
  assert.equal(veto.score, 0);
  assert.deepEqual(veto.vetoRiskIds, ['veto']);
});

test('missing evidence and unverified risks hold the rating', () => {
  const project = completeProject();
  project.investmentInputs.commercial.cac = null;
  project.risks = [{ id: 'unknown', status: 'unverified', severity: 'high' }];
  const assessment = evaluateProject(project, defaultScoreConfig).assessment;
  assert.equal(assessment.status, 'pending');
  assert.equal(assessment.score, null);
  assert.ok(assessment.missing.includes('CAC'));
  assert.ok(assessment.missing.includes('存在待核实风险'));
});

test('configurable thresholds change the result and preserve score bands', () => {
  const project = completeProject();
  const strict = structuredClone(defaultScoreConfig);
  strict.thresholds.growthTargetPct = 100;
  strict.thresholds.survivalTargetPct = 100;
  strict.thresholds.payingD180TargetPct = 100;
  strict.thresholds.cashDecayTargetPct = 1;
  project.investmentInputs.users.monthlyCashDecayPct = 5;
  const score = evaluateProject(project, strict).assessment;
  assert.equal(score.status, 'rated');
  assert.equal(score.conclusion, '谨慎立项');
  assert.ok(score.score >= 50 && score.score < 70);
  strict.thresholds.cautionScore = 80;
  strict.thresholds.recommendScore = 90;
  assert.equal(evaluateProject(project, strict).assessment.conclusion, '不推荐立项');
});

test('nonpositive base NPV caps the score at 49 and blocks recommendation', () => {
  const project = completeProject();
  project.investmentInputs.finance.scenarios.base.month1Revenue = 0;
  const assessment = evaluateProject(project, defaultScoreConfig).assessment;
  assert.equal(assessment.status, 'rated');
  assert.equal(assessment.score, 49);
  assert.equal(assessment.conclusion, '不推荐立项');
  assert.ok(assessment.financialGate.reasons.includes('基准情景 NPV 不大于 0'));
  assert.ok(assessment.financialGate.reasons.includes('24 个月内未回本'));
});

test('no 24-month payback triggers its own financial gate reason', () => {
  const project = completeProject();
  Object.assign(project.investmentInputs.finance, { upfrontCost: 100, annualDiscountRatePct: 0 });
  Object.assign(project.investmentInputs.finance.scenarios.base, {
    month1Revenue: 20, monthlyRevenueDecayPct: 0, monthlyOperatingCost: 16
  });
  const assessment = evaluateProject(project, defaultScoreConfig).assessment;
  assert.equal(assessment.status, 'rated');
  assert.equal(assessment.financialGate.triggered, true);
  assert.ok(assessment.financialGate.reasons.includes('24 个月内未回本'));
  assert.equal(assessment.score, 49);
});
