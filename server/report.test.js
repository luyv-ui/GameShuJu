import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { emptyInvestmentInputs } from './projects.js';
import { defaultScoreConfig } from './score-config.js';
import { evaluateProject } from './scoring.js';
import { generateInvestmentReport, renderInvestmentReportPdf } from './report.js';

function project() {
  const investmentInputs = emptyInvestmentInputs();
  Object.assign(investmentInputs.market, { growth12mPct: 20, survival6mPct: 50, region: 'CN', asOf: '2026-10-01', basis: '市场调研' });
  Object.assign(investmentInputs.users, { payingD180Pct: 20, monthlyCashDecayPct: 0, region: 'CN', asOf: '2026-10-01', basis: '用户测试' });
  Object.assign(investmentInputs.commercial, { ltv90: 300, cac: 100, region: 'CN', asOf: '2026-10-01', basis: '商业化测试' });
  Object.assign(investmentInputs.finance, { upfrontCost: 100, annualDiscountRatePct: 10, basis: '内部测算' });
  for (const scenario of Object.values(investmentInputs.finance.scenarios)) {
    Object.assign(scenario, { month1Revenue: 20, monthlyRevenueDecayPct: 0, monthlyOperatingCost: 1 });
  }
  const item = { id: 'project-1', name: '测试游戏', investmentInputs, riskReviewComplete: true, risks: [] };
  return { ...item, ...evaluateProject(item, defaultScoreConfig) };
}

test('report uses calculated rating and all three scenario results', () => {
  const item = project();
  const report = generateInvestmentReport(item, '2026-10-03T00:00:00.000Z');
  assert.equal(report.projectId, item.id);
  assert.equal(report.generatedAt, '2026-10-03T00:00:00.000Z');
  assert.equal(report.score, item.assessment.score);
  assert.equal(report.conclusion, item.assessment.conclusion);
  assert.equal(report.sections.returns.filter(line => line.includes('情景：')).length, 3);
  assert.ok(report.sections.sustainability.some(line => line.includes('D180')));
  assert.ok(report.sections.recommendation.includes('推荐立项'));
});

test('report explains retention and content cadence from entered operating data', () => {
  const item = project();
  Object.assign(item.investmentInputs.users, { d1Pct: 45, d7Pct: 23, d30Pct: 12, d90Pct: 6, avgSessionMinutes: 32, newUserGrowthPct: 8 });
  Object.assign(item.investmentInputs.operations, { versionCycleMonths: 3, contentConsumptionMonths: 2,
    versionRevenueLiftPct: 15, economyStabilityScore: 80, sentimentScore: 76,
    negativeEventCashShockPct: 11, region: 'CN', asOf: '2026-10-01', basis: '运营周报' });
  const report = generateInvestmentReport(item);
  assert.ok(report.sections.sustainability.some(line => line.includes('D1/D7/D30/D90')));
  assert.ok(report.sections.sustainability.some(line => line.includes('短 1 个月')));
  assert.ok(report.assumptions.some(line => line.includes('运营周报')));
  item.investmentInputs.users.d7Pct = 50;
  assert.ok(generateInvestmentReport(item).sections.sustainability.some(line => line.includes('同一批用户')));
});

test('veto stays first even when financial inputs are incomplete', () => {
  const item = project();
  item.risks = [{ id: 'veto', category: 'ip', status: 'confirmed', severity: 'catastrophic', description: '版权冲突', evidenceUrl: '' }];
  item.investmentInputs.finance.scenarios.base.month1Revenue = null;
  Object.assign(item, evaluateProject(item, defaultScoreConfig));
  const report = generateInvestmentReport(item);
  assert.equal(report.status, 'vetoed');
  assert.equal(report.score, 0);
  assert.equal(report.conclusion, '禁止立项');
  assert.match(report.sections.recommendation, /一票否决/);
  assert.ok(report.sections.returns.some(line => line.includes('资料缺失')));
});

test('missing inputs cannot produce a recommendation', () => {
  const item = project();
  item.investmentInputs.commercial.cac = null;
  Object.assign(item, evaluateProject(item, defaultScoreConfig));
  const report = generateInvestmentReport(item);
  assert.equal(report.status, 'pending');
  assert.equal(report.score, null);
  assert.match(report.sections.recommendation, /暂不评级/);
  assert.ok(report.sections.risks.some(line => line.includes('CAC')));
  assert.ok(report.sections.returns.some(line => line.includes('无法计算')));
});

test('financial gate reason and capped score carry into the report', () => {
  const item = project();
  item.investmentInputs.finance.scenarios.base.month1Revenue = 0;
  Object.assign(item, evaluateProject(item, defaultScoreConfig));
  const report = generateInvestmentReport(item);
  assert.equal(report.score, 49);
  assert.equal(report.conclusion, '不推荐立项');
  assert.match(report.sections.recommendation, /财务硬门槛/);
  assert.ok(report.sections.risks.some(line => line.includes('NPV')));
});

test('PDF exports a valid document using the bundled Chinese font', async () => {
  const report = generateInvestmentReport(project());
  const pdf = await renderInvestmentReportPdf(report);
  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 5000);
  assert.match(pdf.toString('latin1'), /%%EOF/);
});

test('report HTTP endpoints serve JSON and PDF and return 404 for an unknown project', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-api-test-'));
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const item = project();
  fs.writeFileSync(path.join(dir, 'projects.json'), JSON.stringify([{ id: item.id, name: item.name, genre: '策略', stage: 'concept',
    investmentInputs: item.investmentInputs, riskReviewComplete: item.riskReviewComplete, risks: item.risks }]));
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', PROJECT_DATA_FILE: path.join(dir, 'projects.json'),
      SCORE_CONFIG_FILE: path.join(dir, 'score-config.json'), DINGTALK_CLIENT_ID: '', DINGTALK_CLIENT_SECRET: '' },
    stdio: 'ignore'
  });
  const url = `http://127.0.0.1:${port}/api/projects/${item.id}/report`;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        const response = await fetch(url);
        if (response.ok) { ready = true; break; }
      } catch { /* Wait for the child server. */ }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(ready, true, 'report API did not start');
    const response = await fetch(url);
    assert.equal(response.status, 200);
    const report = await response.json();
    assert.equal(report.conclusion, item.assessment.conclusion);
    assert.equal(report.score, item.assessment.score);
    const pdfResponse = await fetch(`${url}.pdf`);
    assert.equal(pdfResponse.status, 200);
    assert.match(pdfResponse.headers.get('content-type'), /application\/pdf/);
    assert.equal(Buffer.from(await pdfResponse.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/projects/missing/report`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/projects/missing/report.pdf`)).status, 404);
  } finally {
    server.kill();
    await new Promise(resolve => server.once('close', resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
