import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCatalogSync } from './catalog-sync.js';

test('sync imports valid source and reports a failed source without deleting data', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-sync-'));
  const previous = process.env.GAME_DATA_FILE;
  process.env.GAME_DATA_FILE = path.join(directory, 'games.json');
  fs.writeFileSync(process.env.GAME_DATA_FILE, '[]');
  t.after(() => {
    if (previous === undefined) delete process.env.GAME_DATA_FILE;
    else process.env.GAME_DATA_FILE = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const sync = createCatalogSync({ file: path.join(directory, 'status.json'),
    now: () => new Date('2026-10-03T12:00:00.000Z'),
    collectors: {
      steam: async asOf => [{ name: 'Fresh Game', genre: '策略', platforms: ['PC'],
        steamAppId: 123456789, sourceUrl: 'https://store.steampowered.com/app/123456789/',
        metricsSourceUrl: '', dataAsOf: asOf, metricScope: 'Steam 搜索目录商品资料',
        price: null, rating: null, reviewCount: null, peakPlayers: null, isDemo: false }],
      apple: async () => { throw new Error('source unavailable'); }
    } });
  const result = await sync.run();
  assert.equal(result.sources.steam.added, 1);
  assert.equal(result.sources.apple.state, 'error');
  assert.equal(result.running, false);
  assert.equal(JSON.parse(fs.readFileSync(process.env.GAME_DATA_FILE, 'utf8')).length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'status.json'), 'utf8')).sources.steam.state, 'ok');
});
