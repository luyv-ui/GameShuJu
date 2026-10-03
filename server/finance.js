import { zero } from 'brent-zero-generator';

const REQUIRED_FIELDS = [
  'upfrontCost', 'annualDiscountRatePct', 'month1Revenue',
  'monthlyRevenueDecayPct', 'monthlyOperatingCost'
];
const HORIZON_MONTHS = 24;

function validateNumber(value, field, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new Error(`${field} must be a finite number between 0 and ${maximum}`);
  }
}

function npvAtQ(cashFlows, q) {
  let total = cashFlows[cashFlows.length - 1];
  for (let index = cashFlows.length - 2; index >= 0; index--) total = total * q + cashFlows[index];
  return total;
}

function annualIrr(cashFlows) {
  if (cashFlows[0] >= 0) return null;
  // A negative operating month after a positive month can produce two IRRs.
  // Return no single IRR for this ambiguous cash-flow shape.
  if (cashFlows.slice(1).some(value => value < 0)) return null;
  if (!cashFlows.slice(1).some(value => value > 0)) return null;

  let upperQ = 1;
  while (npvAtQ(cashFlows, upperQ) <= 0 && upperQ < 1e12) upperQ *= 2;
  if (upperQ >= 1e12 || !Number.isFinite(npvAtQ(cashFlows, upperQ))) return null;

  const q = zero(value => npvAtQ(cashFlows, value), 0, upperQ);
  if (!Number.isFinite(q) || q <= 0) return null;
  const annualRate = (Math.pow(q, -12) - 1) * 100;
  return Number.isFinite(annualRate) ? annualRate : null;
}

export function calculateScenario(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('scenario input must be an object');
  if (input.horizonMonths !== undefined && input.horizonMonths !== HORIZON_MONTHS) {
    throw new Error('horizonMonths must be 24');
  }

  const missingFields = REQUIRED_FIELDS.filter(field => input[field] === undefined || input[field] === null || input[field] === '');
  for (const field of REQUIRED_FIELDS.filter(field => !missingFields.includes(field))) {
    validateNumber(input[field], field, field === 'annualDiscountRatePct' || field === 'monthlyRevenueDecayPct' ? 100 : 1e15);
  }
  if (missingFields.length) return { status: 'incomplete', missingFields };

  const monthlyDiscountRate = Math.pow(1 + input.annualDiscountRatePct / 100, 1 / 12) - 1;
  const retention = 1 - input.monthlyRevenueDecayPct / 100;
  const months = [];
  const cashFlows = [-input.upfrontCost];
  let cumulativeCashFlow = -input.upfrontCost;
  let minimumCumulativeCashFlow = cumulativeCashFlow;
  let paybackMonth = input.upfrontCost === 0 ? 0 : null;
  let npv = -input.upfrontCost;

  for (let month = 1; month <= HORIZON_MONTHS; month++) {
    const revenue = input.month1Revenue * Math.pow(retention, month - 1);
    const cashFlow = revenue - input.monthlyOperatingCost;
    cumulativeCashFlow += cashFlow;
    npv += cashFlow / Math.pow(1 + monthlyDiscountRate, month);
    if (![revenue, cashFlow, cumulativeCashFlow, npv].every(Number.isFinite)) {
      throw new Error('scenario result exceeds the supported numeric range');
    }
    if (paybackMonth === null && cumulativeCashFlow >= 0) paybackMonth = month;
    minimumCumulativeCashFlow = Math.min(minimumCumulativeCashFlow, cumulativeCashFlow);
    months.push({ month, revenue, cashFlow, cumulativeCashFlow });
    cashFlows.push(cashFlow);
  }

  return {
    status: 'complete',
    horizonMonths: HORIZON_MONTHS,
    months,
    npv,
    annualIrrPct: annualIrr(cashFlows),
    paybackMonth,
    maximumCumulativeLoss: -minimumCumulativeCashFlow
  };
}
