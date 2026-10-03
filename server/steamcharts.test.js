import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectSteamCharts, parseAllTimePeak } from './steamcharts.js';

const page = '<div id="app-heading"><div class="app-stat"><span class="num">12</span><br>playing</div><div class="app-stat"><span class="num">34</span><br>24-hour peak</div><div class="app-stat"><span class="num">2,406,967</span><br>all-time peak</div></div>';

test('SteamCharts parser reads all-time peak rather than current or daily players', () => {
  assert.equal(parseAllTimePeak(page), 2406967);
  assert.throws(() => parseAllTimePeak('<div id="app-heading"><span class="num">12</span></div>'), /全历史峰值/);
});

test('collector records a source for real Steam games and keeps prior data on failure', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'steamcharts-test-'));
  const file = path.join(dir, 'peaks.json');
  try {
    const games = [
      { steamAppId: 2358720, sourceUrl: 'https://store.steampowered.com/app/2358720/', reviewCount: 12, isDemo: false },
      { steamAppId: 1245620, sourceUrl: 'https://store.steampowered.com/app/1245620/', reviewCount: 8, isDemo: false },
      { steamAppId: 3, sourceUrl: 'https://store.steampowered.com/app/3/', reviewCount: 4, isDemo: true }
    ];
    const result = await collectSteamCharts(games, { file, fetchHtml: async url => {
      if (url.endsWith('/1245620')) throw new Error('HTTP 503');
      return page;
    } });
    assert.equal(result.collected, 1);
    assert.equal(result.failures.length, 1);
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(saved.games.length, 1);
    assert.equal(saved.games[0].peakPlayers, 2406967);
    assert.equal(saved.games[0].sourceUrl, 'https://steamcharts.com/app/2358720');
    assert.ok(Date.parse(saved.games[0].capturedAt));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
