import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { evaluateProject } from './scoring.js';
import { getScoreConfig } from './score-config.js';
import { sqliteEnabled, withDatabase, withDatabaseTransaction, dbListProjects, dbSaveProjects } from './db.js';

const defaultFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/projects.json');
const dataFile = () => process.env.PROJECT_DATA_FILE || defaultFile;
const stages = new Set(['concept', 'prototype', 'production', 'live']);
const categories = new Set(['license', 'ip', 'team', 'competition', 'technical']);
const statuses = new Set(['unverified', 'confirmed', 'cleared']);
const severities = new Set(['low', 'medium', 'high', 'catastrophic']);

const inputFields = {
  market: { tam: 'amount', growth12mPct: 'signedRate', concentrationPct: 'percent', survival6mPct: 'percent', benchmarkIrrPct: 'signedRate', benchmarkPaybackMonths: 'months', currency: 'currency', region: 'region', asOf: 'date', basis: 'basis' },
  users: { d1Pct: 'percent', d7Pct: 'percent', d30Pct: 'percent', d90Pct: 'percent', payingD180Pct: 'percent', avgSessionMinutes: 'minutes', monthlyCashDecayPct: 'percent', newUserGrowthPct: 'signedRate', region: 'region', asOf: 'date', basis: 'basis' },
  commercial: { arpu: 'amount', arppu: 'amount', payerPenetrationPct: 'percent', ltv30: 'amount', ltv90: 'amount', cac: 'amount', currency: 'currency', region: 'region', asOf: 'date', basis: 'basis' },
  operations: { versionCycleMonths: 'months', versionRevenueLiftPct: 'percent', contentConsumptionMonths: 'months', economyStabilityScore: 'percent', sentimentScore: 'percent', negativeEventCashShockPct: 'percent', region: 'region', asOf: 'date', basis: 'basis' },
  finance: { currency: 'currency', upfrontCost: 'amount', annualDiscountRatePct: 'percent', basis: 'basis' }
};
const scenarioFields = { month1Revenue: 'amount', monthlyRevenueDecayPct: 'percent', monthlyOperatingCost: 'amount' };
const scenarioNames = ['optimistic', 'base', 'pessimistic'];

export function emptyInvestmentInputs() {
  const result = {};
  for (const [section, fields] of Object.entries(inputFields)) {
    result[section] = {};
    for (const [field, kind] of Object.entries(fields)) {
      result[section][field] = kind === 'currency' ? 'CNY' : ['region', 'date', 'basis'].includes(kind) ? '' : null;
    }
  }
  result.finance.scenarios = Object.fromEntries(scenarioNames.map(name =>
    [name, Object.fromEntries(Object.keys(scenarioFields).map(field => [field, null]))]));
  return result;
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}格式无效`);
  return value;
}

function inputValue(value, kind, label) {
  if (['amount', 'percent', 'signedRate', 'months', 'minutes'].includes(kind)) {
    if (value === undefined || value === null) return null;
    const min = kind === 'signedRate' ? -100 : 0;
    const max = kind === 'amount' ? 1e12 : kind === 'signedRate' ? 1000 : kind === 'percent' ? 100 : kind === 'months' ? 1200 : 1440;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      throw new Error(`${label}必须是 ${min} 到 ${max} 之间的有限数字`);
    }
    return value;
  }
  if (kind === 'currency') {
    if (value === undefined) return 'CNY';
    if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) throw new Error(`${label}必须是三位大写币种代码`);
    return value;
  }
  const text = optionalText(value, label, kind === 'basis' ? 2000 : 100);
  if (kind === 'date' && text) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`)) ||
        new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text) {
      throw new Error(`${label}必须是有效的 YYYY-MM-DD 日期`);
    }
  }
  return text;
}

export function validateInvestmentInputs(input) {
  const source = plainObject(input, '投资测算输入');
  const result = emptyInvestmentInputs();
  for (const [section, fields] of Object.entries(inputFields)) {
    if (source[section] === undefined) continue;
    const sectionInput = plainObject(source[section], `${section} 指标`);
    for (const [field, kind] of Object.entries(fields)) {
      result[section][field] = inputValue(sectionInput[field], kind, `${section}.${field}`);
    }
  }
  if (source.finance?.scenarios !== undefined) {
    const scenarios = plainObject(source.finance.scenarios, '财务情景');
    for (const name of scenarioNames) {
      if (scenarios[name] === undefined) continue;
      const scenario = plainObject(scenarios[name], `${name} 情景`);
      for (const [field, kind] of Object.entries(scenarioFields)) {
        result.finance.scenarios[name][field] = inputValue(scenario[field], kind, `${name}.${field}`);
      }
    }
  }
  return result;
}

function requiredText(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}为必填项`);
  const text = value.trim();
  if (text.length > maxLength) throw new Error(`${label}过长`);
  return text;
}

function optionalText(value, label, maxLength) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw new Error(`${label}格式无效`);
  const text = value.trim();
  if (text.length > maxLength) throw new Error(`${label}过长`);
  return text;
}

function choice(value, options, label) {
  if (typeof value !== 'string' || !options.has(value)) throw new Error(`${label}无效`);
  return value;
}

function evidenceUrl(value) {
  const url = optionalText(value, '证据链接', 2048);
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (['http:', 'https:'].includes(parsed.protocol) && parsed.hostname) return url;
  } catch { /* Use the same error below. */ }
  throw new Error('证据链接必须是有效的 http:// 或 https:// 链接');
}

export function validateProject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('请填写项目信息');
  if (input.risks !== undefined && !Array.isArray(input.risks)) throw new Error('风险清单格式无效');
  if (input.risks?.length > 100) throw new Error('风险清单最多 100 项');
  const riskIds = new Set();
  const risks = (input.risks || []).map((risk, index) => {
    if (!risk || typeof risk !== 'object' || Array.isArray(risk)) throw new Error(`第 ${index + 1} 项风险格式无效`);
    const id = typeof risk.id === 'string' && risk.id.trim() ? risk.id.trim() : randomUUID();
    if (riskIds.has(id)) throw new Error('风险 ID 不可重复');
    riskIds.add(id);
    return {
      id,
      category: choice(risk.category, categories, '风险类别'),
      description: requiredText(risk.description, '风险描述', 1000),
      status: choice(risk.status, statuses, '风险状态'),
      severity: choice(risk.severity, severities, '风险等级'),
      evidenceUrl: evidenceUrl(risk.evidenceUrl)
    };
  });
  if (input.riskReviewComplete !== undefined && typeof input.riskReviewComplete !== 'boolean') {
    throw new Error('风险审核状态必须是布尔值');
  }
  return {
    name: requiredText(input.name, '项目名称', 120),
    genre: requiredText(input.genre, '项目类型', 50),
    studio: optionalText(input.studio, '研发团队', 120),
    stage: choice(input.stage, stages, '项目阶段'),
    description: optionalText(input.description, '项目描述', 2000),
    risks,
    ...(input.investmentInputs === undefined ? {} : { investmentInputs: validateInvestmentInputs(input.investmentInputs) }),
    ...(input.riskReviewComplete === undefined ? {} : { riskReviewComplete: input.riskReviewComplete })
  };
}

function presented(project, config) {
  const normalized = {
    ...project,
    investmentInputs: project.investmentInputs === undefined ? emptyInvestmentInputs() : validateInvestmentInputs(project.investmentInputs),
    riskReviewComplete: project.riskReviewComplete ?? false
  };
  return { ...normalized, ...evaluateProject(normalized, config) };
}

function readProjects() {
  if (sqliteEnabled()) return withDatabase(dbListProjects);
  try { return JSON.parse(fs.readFileSync(dataFile(), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function saveProjects(projects) {
  const file = dataFile();
  const tempFile = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(projects, null, 2));
    fs.renameSync(tempFile, file);
  } finally {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
}

function withWriteLock(operation) {
  const file = dataFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lockFile = `${file}.lock`;
  const deadline = Date.now() + 5000;
  while (true) {
    try {
      const fd = fs.openSync(lockFile, 'wx');
      try { fs.writeFileSync(fd, String(process.pid)); }
      finally { fs.closeSync(fd); }
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const stat = fs.statSync(lockFile);
        if (Date.now() - stat.mtimeMs > 30000) {
          const pid = Number(fs.readFileSync(lockFile, 'utf8'));
          let alive = Number.isSafeInteger(pid) && pid > 0;
          if (alive) {
            try { process.kill(pid, 0); }
            catch (probeError) { alive = probeError.code !== 'ESRCH'; }
          }
          if (!alive) { fs.unlinkSync(lockFile); continue; }
        }
      } catch (readError) {
        if (readError.code !== 'ENOENT') throw readError;
      }
      if (Date.now() >= deadline) throw new Error('项目数据正在写入，请稍后重试');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try { return operation(); }
  finally { fs.unlinkSync(lockFile); }
}

export function listProjects() {
  const config = getScoreConfig();
  return readProjects().map(project => presented(project, config));
}

export function createProject(input) {
  const valid = validateProject(input);
  const operation = db => {
    const now = new Date().toISOString();
    const project = { id: randomUUID(), ...valid,
      investmentInputs: valid.investmentInputs ?? emptyInvestmentInputs(),
      riskReviewComplete: valid.riskReviewComplete ?? false,
      createdAt: now, updatedAt: now };
    const projects = db ? dbListProjects(db) : readProjects();
    projects.unshift(project);
    db ? dbSaveProjects(db, projects) : saveProjects(projects);
    return presented(project, getScoreConfig());
  };
  return sqliteEnabled() ? withDatabaseTransaction(operation) : withWriteLock(() => operation(null));
}

export function updateProject(id, input) {
  const valid = validateProject(input);
  const operation = db => {
    const projects = db ? dbListProjects(db) : readProjects();
    const index = projects.findIndex(project => project.id === id);
    if (index < 0) return null;
    projects[index] = { ...projects[index], ...valid, updatedAt: new Date().toISOString() };
    db ? dbSaveProjects(db, projects) : saveProjects(projects);
    return presented(projects[index], getScoreConfig());
  };
  return sqliteEnabled() ? withDatabaseTransaction(operation) : withWriteLock(() => operation(null));
}

export function deleteProject(id) {
  const operation = db => {
    const projects = db ? dbListProjects(db) : readProjects();
    const kept = projects.filter(project => project.id !== id);
    if (kept.length === projects.length) return false;
    db ? dbSaveProjects(db, kept) : saveProjects(kept);
    return true;
  };
  return sqliteEnabled() ? withDatabaseTransaction(operation) : withWriteLock(() => operation(null));
}
