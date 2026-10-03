import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createProject, deleteProject, emptyInvestmentInputs, listProjects, updateProject,
  validateInvestmentInputs, validateProject } from './projects.js';

const base = { name: '新项目', genre: '策略', studio: '研发组', stage: 'concept', description: '待评估', risks: [] };

function withTemporaryStore(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-store-test-'));
  const previous = process.env.PROJECT_DATA_FILE;
  process.env.PROJECT_DATA_FILE = path.join(dir, 'projects.json');
  try { return run(process.env.PROJECT_DATA_FILE); }
  finally {
    if (previous === undefined) delete process.env.PROJECT_DATA_FILE;
    else process.env.PROJECT_DATA_FILE = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('a project without financial evidence stays unrated and client conclusions are ignored', () => withTemporaryStore(file => {
  const project = createProject({ ...base, score: 99, conclusion: '推荐立项', assessment: { status: 'approved' } });
  assert.equal(project.assessment.status, 'pending');
  assert.equal(project.assessment.score, null);
  assert.equal(project.assessment.conclusion, '资料不足，暂不评级');
  assert.deepEqual(project.assessment.vetoRiskIds, []);
  assert.ok(project.assessment.missing.includes('风险审核未完成'));
  assert.equal(listProjects()[0].assessment.score, null);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))[0];
  assert.equal(Object.hasOwn(saved, 'assessment'), false);
  assert.equal(Object.hasOwn(saved, 'score'), false);
  assert.equal(Object.hasOwn(saved, 'conclusion'), false);
}));

test('only confirmed catastrophic risks veto, regardless of submitted score', () => withTemporaryStore(() => {
  const risks = [
    { id: 'r1', category: 'license', description: '版号待核查', status: 'unverified', severity: 'catastrophic', evidenceUrl: '' },
    { id: 'r2', category: 'ip', description: '版权争议已确认', status: 'confirmed', severity: 'catastrophic', evidenceUrl: 'https://example.com/evidence' },
    { id: 'r3', category: 'team', description: '核心成员离职', status: 'confirmed', severity: 'high', evidenceUrl: '' }
  ];
  const project = createProject({ ...base, risks, score: 100, conclusion: '推荐立项' });
  assert.equal(project.assessment.status, 'vetoed');
  assert.equal(project.assessment.score, 0);
  assert.equal(project.assessment.conclusion, '禁止立项');
  assert.deepEqual(project.assessment.vetoRiskIds, ['r2']);
  const updated = updateProject(project.id, { ...base, risks: risks.map(risk =>
    risk.id === 'r2' ? { ...risk, status: 'cleared' } : risk) });
  assert.equal(updated.assessment.status, 'pending');
  assert.equal(listProjects()[0].assessment.score, null);
}));

test('project CRUD preserves identity and timestamps and handles missing IDs', () => withTemporaryStore(() => {
  assert.deepEqual(listProjects(), []);
  const created = createProject(base);
  const updated = updateProject(created.id, { ...base, name: '改名项目', stage: 'prototype' });
  assert.equal(updated.id, created.id);
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.name, '改名项目');
  assert.equal(updated.stage, 'prototype');
  assert.equal(listProjects().length, 1);
  assert.equal(updateProject('missing', base), null);
  assert.equal(deleteProject('missing'), false);
  assert.equal(deleteProject(created.id), true);
  assert.deepEqual(listProjects(), []);
}));

test('project and risk fields reject invalid values and evidence links', () => {
  assert.throws(() => validateProject({ ...base, name: '' }), /项目名称/);
  assert.throws(() => validateProject({ ...base, stage: 'unknown' }), /项目阶段/);
  assert.throws(() => validateProject({ ...base, risks: [{}] }), /风险类别/);
  assert.throws(() => validateProject({ ...base, risks: [{ category: 'ip', description: '争议',
    status: 'confirmed', severity: 'catastrophic', evidenceUrl: 'javascript:alert(1)' }] }), /证据链接/);
  assert.throws(() => validateProject({ ...base, risks: [{ id: 'duplicate', category: 'ip',
    description: '争议', status: 'confirmed', severity: 'high' }, { id: 'duplicate', category: 'ip',
    description: '争议', status: 'cleared', severity: 'low' }] }), /不可重复/);
});

test('investment inputs preserve missing values as null and valid zero values as zero', () => withTemporaryStore(file => {
  const empty = emptyInvestmentInputs();
  assert.equal(empty.market.tam, null);
  assert.equal(empty.market.currency, 'CNY');
  assert.equal(empty.finance.scenarios.base.month1Revenue, null);
  const inputs = validateInvestmentInputs({
    market: { tam: 0, growth12mPct: 0, currency: 'USD', asOf: '2024-02-29' },
    finance: { scenarios: { base: { month1Revenue: 0 } } }
  });
  assert.equal(inputs.market.tam, 0);
  assert.equal(inputs.market.currency, 'USD');
  assert.equal(inputs.market.benchmarkIrrPct, null);
  assert.equal(inputs.finance.scenarios.base.month1Revenue, 0);
  assert.equal(inputs.finance.scenarios.optimistic.month1Revenue, null);
  const rates = validateInvestmentInputs({ market: { growth12mPct: -25, benchmarkIrrPct: 250 },
    users: { newUserGrowthPct: 1000 } });
  assert.equal(rates.market.growth12mPct, -25);
  assert.equal(rates.market.benchmarkIrrPct, 250);
  assert.equal(rates.users.newUserGrowthPct, 1000);

  const project = createProject({ ...base, investmentInputs: inputs, riskReviewComplete: true });
  assert.equal(project.investmentInputs.market.tam, 0);
  assert.equal(project.riskReviewComplete, true);
  const updated = updateProject(project.id, { ...base, name: '更新但保留测算' });
  assert.deepEqual(updated.investmentInputs, inputs);
  assert.equal(updated.riskReviewComplete, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8'))[0].investmentInputs, inputs);
}));

test('new and legacy projects expose independent empty investment templates', () => withTemporaryStore(file => {
  const created = createProject(base);
  assert.deepEqual(created.investmentInputs, emptyInvestmentInputs());
  assert.equal(created.riskReviewComplete, false);
  const legacy = { ...base, id: 'legacy', createdAt: created.createdAt, updatedAt: created.updatedAt };
  fs.writeFileSync(file, JSON.stringify([legacy]));
  const read = listProjects()[0];
  assert.deepEqual(read.investmentInputs, emptyInvestmentInputs());
  assert.equal(read.riskReviewComplete, false);
  read.investmentInputs.finance.scenarios.base.month1Revenue = 100;
  assert.equal(listProjects()[0].investmentInputs.finance.scenarios.base.month1Revenue, null);
  const updated = updateProject('legacy', { ...base, name: '旧项目更新' });
  assert.deepEqual(updated.investmentInputs, emptyInvestmentInputs());
  assert.equal(updated.riskReviewComplete, false);
}));

test('investment inputs reject invalid ranges, dates, strings, and review flags', () => {
  const invalid = [
    [{ market: { tam: -1 } }, /market.tam/],
    [{ market: { tam: '100' } }, /market.tam/],
    [{ market: { growth12mPct: -101 } }, /market.growth12mPct/],
    [{ market: { growth12mPct: 1001 } }, /market.growth12mPct/],
    [{ market: { benchmarkIrrPct: -101 } }, /market.benchmarkIrrPct/],
    [{ users: { newUserGrowthPct: 1001 } }, /users.newUserGrowthPct/],
    [{ users: { d30Pct: 101 } }, /users.d30Pct/],
    [{ users: { d30Pct: Number.NaN } }, /users.d30Pct/],
    [{ finance: { annualDiscountRatePct: Infinity } }, /finance.annualDiscountRatePct/],
    [{ finance: { scenarios: { base: { monthlyOperatingCost: -1 } } } }, /base.monthlyOperatingCost/],
    [{ market: { benchmarkPaybackMonths: 1201 } }, /market.benchmarkPaybackMonths/],
    [{ market: { asOf: '2025-02-29' } }, /market.asOf/],
    [{ commercial: { currency: 'usd' } }, /commercial.currency/],
    [{ operations: { basis: 'x'.repeat(2001) } }, /operations.basis/],
    [{ users: [] }, /users 指标/]
  ];
  for (const [input, error] of invalid) assert.throws(() => validateInvestmentInputs(input), error);
  assert.throws(() => validateProject({ ...base, riskReviewComplete: 'true' }), /风险审核状态/);
  assert.throws(() => validateProject({ ...base, investmentInputs: null }), /投资测算输入/);
});

test('project HTTP routes return a full project and expected status codes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-api-test-'));
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', AUTH_MODE: 'local', PROJECT_DATA_FILE: path.join(dir, 'projects.json'),
      SCORE_CONFIG_FILE: path.join(dir, 'score-config.json'),
      DINGTALK_CLIENT_ID: '', DINGTALK_CLIENT_SECRET: '' },
    stdio: 'ignore'
  });
  const url = `http://127.0.0.1:${port}/api/projects`;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/auth/me`);
        if (response.ok) { ready = true; break; }
      } catch { /* Wait for the child server. */ }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(ready, true, 'project API did not start');
    const me = await fetch(`http://127.0.0.1:${port}/api/auth/me`);
    const sessionCookie = me.headers.get('set-cookie').split(';')[0];
    const csrfToken = (await me.json()).csrfToken;
    const request = (path, options = {}) => fetch(path, {
      ...options, headers: { Cookie: sessionCookie, 'X-CSRF-Token': csrfToken, ...options.headers }
    });
    assert.deepEqual(await (await request(url)).json(), []);
    const create = await request(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...base, assessment: { status: 'vetoed', score: 0 } }) });
    assert.equal(create.status, 201);
    const project = await create.json();
    assert.deepEqual(project.risks, []);
    assert.equal(project.assessment.status, 'pending');
    assert.equal((await (await request(url)).json())[0].id, project.id);
    const configUrl = `http://127.0.0.1:${port}/api/score-config`;
    const config = await (await request(configUrl)).json();
    assert.deepEqual(config.weights, { market: 20, returns: 30, sustainability: 30, riskReserve: 20 });
    const modified = { ...config, thresholds: { ...config.thresholds, recommendScore: 75 } };
    const saveConfig = await request(configUrl, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(modified) });
    assert.equal(saveConfig.status, 200);
    assert.equal((await (await request(configUrl)).json()).thresholds.recommendScore, 75);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'score-config.json'), 'utf8')).thresholds.recommendScore, 75);
    const invalidConfig = await request(configUrl, { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...modified, weights: { ...modified.weights, market: 19 } }) });
    assert.equal(invalidConfig.status, 400);
    assert.equal((await (await request(configUrl)).json()).weights.market, 20);
    const update = await request(`${url}/${project.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...base, stage: 'prototype' }) });
    assert.equal(update.status, 200);
    assert.equal((await update.json()).stage, 'prototype');
    assert.equal((await request(`${url}/${project.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await request(`${url}/${project.id}`, { method: 'DELETE' })).status, 404);
  } finally {
    server.kill();
    await new Promise(resolve => server.once('close', resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
