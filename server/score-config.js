import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const defaultFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/score-config.json');
const configFile = () => process.env.SCORE_CONFIG_FILE || defaultFile;

export const defaultScoreConfig = Object.freeze({
  weights: { market: 20, returns: 30, sustainability: 30, riskReserve: 20 },
  thresholds: {
    growthTargetPct: 20,
    survivalTargetPct: 50,
    irrTargetPct: 20,
    paybackTargetMonths: 24,
    ltvCacTarget: 3,
    payingD180TargetPct: 20,
    cashDecayTargetPct: 5,
    cautionScore: 50,
    recommendScore: 70
  },
  riskPenalties: { low: 2, medium: 5, high: 10 }
});

function numberInRange(value, label, min, max, allowZero = true) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (!allowZero && value === 0)) {
    throw new Error(`${label}必须是 ${allowZero ? min : `大于 ${min}`} 至 ${max} 的数值`);
  }
  return value;
}

function exactObject(input, keys, label) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) {
    throw new Error(`${label}字段不完整或包含未知字段`);
  }
  return input;
}

export function validateScoreConfig(input) {
  exactObject(input, ['weights', 'thresholds', 'riskPenalties'], '评分配置');
  const weights = exactObject(input.weights, Object.keys(defaultScoreConfig.weights), '权重');
  const thresholds = exactObject(input.thresholds, Object.keys(defaultScoreConfig.thresholds), '阈值');
  const riskPenalties = exactObject(input.riskPenalties, Object.keys(defaultScoreConfig.riskPenalties), '风险扣分');
  const valid = {
    weights: Object.fromEntries(Object.keys(defaultScoreConfig.weights).map(key => [key, numberInRange(weights[key], `权重 ${key}`, 0, 100)])),
    thresholds: {
      growthTargetPct: numberInRange(thresholds.growthTargetPct, '12个月增速目标', 0, 1000, false),
      survivalTargetPct: numberInRange(thresholds.survivalTargetPct, '新品存活率目标', 0, 100, false),
      irrTargetPct: numberInRange(thresholds.irrTargetPct, 'IRR 目标', 0, 1000, false),
      paybackTargetMonths: numberInRange(thresholds.paybackTargetMonths, '回本周期目标', 1, 24),
      ltvCacTarget: numberInRange(thresholds.ltvCacTarget, 'LTV/CAC 目标', 0, 100, false),
      payingD180TargetPct: numberInRange(thresholds.payingD180TargetPct, '付费 D180 留存目标', 0, 100, false),
      cashDecayTargetPct: numberInRange(thresholds.cashDecayTargetPct, '月现金流衰减目标', 0, 100, false),
      cautionScore: numberInRange(thresholds.cautionScore, '谨慎阈值', 0, 100),
      recommendScore: numberInRange(thresholds.recommendScore, '推荐阈值', 0, 100)
    },
    riskPenalties: Object.fromEntries(Object.keys(defaultScoreConfig.riskPenalties).map(key => [key, numberInRange(riskPenalties[key], `风险扣分 ${key}`, 0, 100)]))
  };
  const sum = Object.values(valid.weights).reduce((total, value) => total + value, 0);
  if (Math.abs(sum - 100) > 1e-9) throw new Error('权重总和必须为 100');
  if (valid.thresholds.cautionScore >= valid.thresholds.recommendScore) throw new Error('推荐阈值必须高于谨慎阈值');
  return valid;
}

export function getScoreConfig() {
  try { return validateScoreConfig(JSON.parse(fs.readFileSync(configFile(), 'utf8'))); }
  catch (error) {
    if (error.code === 'ENOENT') return structuredClone(defaultScoreConfig);
    throw error;
  }
}

export function putScoreConfig(input) {
  const config = validateScoreConfig(input);
  const file = configFile();
  const temporary = `${file}.${randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(temporary, JSON.stringify(config, null, 2));
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return config;
}
