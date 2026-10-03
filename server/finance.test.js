import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateScenario } from './finance.js';

const base = {
  upfrontCost: 1000,
  annualDiscountRatePct: 12,
  month1Revenue: 100,
  monthlyRevenueDecayPct: 0,
  monthlyOperatingCost: 0
};

test('24 monthly cash flows, effective annual discounting, payback and IRR', () => {
  const result = calculateScenario(base);
  const monthlyRate = Math.pow(1.12, 1 / 12) - 1;
  const expectedNpv = -1000 + 100 * (1 - Math.pow(1 + monthlyRate, -24)) / monthlyRate;
  assert.equal(result.status, 'complete');
  assert.equal(result.months.length, 24);
  assert.equal(result.months[0].cumulativeCashFlow, -900);
  assert.equal(result.months[23].cumulativeCashFlow, 1400);
  assert.ok(Math.abs(result.npv - expectedNpv) < 1e-7);
  assert.equal(result.paybackMonth, 10);
  assert.equal(result.maximumCumulativeLoss, 1000);
  const monthlyIrr = Math.pow(1 + result.annualIrrPct / 100, 1 / 12) - 1;
  const irrNpv = -1000 + 100 * (1 - Math.pow(1 + monthlyIrr, -24)) / monthlyIrr;
  assert.ok(Math.abs(irrNpv) < 1e-6);
});

test('no payback and no IRR with all negative cash flows', () => {
  const result = calculateScenario({ ...base, month1Revenue: 0, monthlyOperatingCost: 10 });
  assert.equal(result.paybackMonth, null);
  assert.equal(result.annualIrrPct, null);
  assert.equal(result.maximumCumulativeLoss, 1240);
});

test('missing inputs stay incomplete and zero is a valid explicit value', () => {
  assert.deepEqual(calculateScenario({ upfrontCost: 0 }), {
    status: 'incomplete',
    missingFields: ['annualDiscountRatePct', 'month1Revenue', 'monthlyRevenueDecayPct', 'monthlyOperatingCost']
  });
  assert.equal(calculateScenario({ ...base, upfrontCost: 0 }).paybackMonth, 0);
});

test('invalid rates, amounts and horizon are rejected', () => {
  assert.throws(() => calculateScenario({ ...base, monthlyRevenueDecayPct: 101 }), /monthlyRevenueDecayPct/);
  assert.throws(() => calculateScenario({ ...base, annualDiscountRatePct: -1 }), /annualDiscountRatePct/);
  assert.throws(() => calculateScenario({ ...base, month1Revenue: NaN }), /month1Revenue/);
  assert.throws(() => calculateScenario({ ...base, upfrontCost: -1 }), /upfrontCost/);
  assert.throws(() => calculateScenario({ ...base, horizonMonths: 12 }), /horizonMonths/);
});

test('declining revenue produces a declining cash-flow curve', () => {
  const result = calculateScenario({ ...base, month1Revenue: 200, monthlyRevenueDecayPct: 10, monthlyOperatingCost: 20 });
  assert.equal(result.months[0].revenue, 200);
  assert.equal(result.months[1].revenue, 180);
  assert.ok(result.months.every((row, index) => index === 0 || row.cashFlow < result.months[index - 1].cashFlow));
});

test('potential multiple IRRs return null instead of an arbitrary root', () => {
  const result = calculateScenario({ ...base, upfrontCost: 100, month1Revenue: 1000,
    monthlyRevenueDecayPct: 100, monthlyOperatingCost: 30 });
  assert.equal(result.annualIrrPct, null);
  assert.ok(result.npv > 0);
});
