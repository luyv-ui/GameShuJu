import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultScoreConfig, getScoreConfig, putScoreConfig, validateScoreConfig } from './score-config.js';

test('the approved weights total 100 with a 20 point risk reserve', () => {
  const config = validateScoreConfig(defaultScoreConfig);
  assert.deepEqual(config.weights, { market: 20, returns: 30, sustainability: 30, riskReserve: 20 });
});

test('configuration rejects incomplete weights and invalid decision thresholds', () => {
  assert.throws(() => validateScoreConfig({ ...defaultScoreConfig, weights: { ...defaultScoreConfig.weights, market: 21 } }), /总和/);
  assert.throws(() => validateScoreConfig({ ...defaultScoreConfig, thresholds: { ...defaultScoreConfig.thresholds, recommendScore: 40 } }), /推荐阈值/);
  assert.throws(() => validateScoreConfig({ ...defaultScoreConfig, riskPenalties: { ...defaultScoreConfig.riskPenalties, high: -1 } }), /风险扣分/);
});

test('configuration persists outside the source tree and can be changed without code edits', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'score-config-test-'));
  const previous = process.env.SCORE_CONFIG_FILE;
  process.env.SCORE_CONFIG_FILE = path.join(directory, 'score-config.json');
  try {
    assert.deepEqual(getScoreConfig(), defaultScoreConfig);
    const changed = { ...defaultScoreConfig, thresholds: { ...defaultScoreConfig.thresholds, irrTargetPct: 25 } };
    assert.equal(putScoreConfig(changed).thresholds.irrTargetPct, 25);
    assert.equal(getScoreConfig().thresholds.irrTargetPct, 25);
  } finally {
    if (previous === undefined) delete process.env.SCORE_CONFIG_FILE;
    else process.env.SCORE_CONFIG_FILE = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
