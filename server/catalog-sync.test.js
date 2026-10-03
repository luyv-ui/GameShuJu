import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectApple, collectMissingAppleIcons, collectSteam, createCatalogSync, steamUsdPrice } from './catalog-sync.js';

test('Steam collection enriches directory rows with official details, USD price and reviews', async () => {
  const getJson = async url => {
    if (url.includes('/search/results/')) return { results_html: '<a class="search_result_row" data-ds-appid="5118740"><img src="https://example.com/capsule.jpg"><span class="title">Puke and Seek</span><div class="search_released">Oct 2, 2026</div><div class="discount_final_price">$9.99</div></a>' };
    if (url.includes('/api/appdetails')) return { 5118740: { success: true, data: {
      name: '吐迷藏', short_description: '官方简介', developers: ['Cyborg Dreams'], publishers: ['Cyborg Dreams'],
      genres: [{ description: '休闲' }, { description: '多人' }], header_image: 'https://example.com/header.jpg',
      price_overview: { currency: 'USD', final: 999 }, release_date: { date: 'Oct 2, 2026' }, platforms: { windows: true, mac: false, linux: false }
    } } };
    return { success: 1, query_summary: { total_reviews: 4, total_positive: 3 } };
  };
  const games = await collectSteam('2026-10-04', 1, getJson);
  assert.equal(games[0].name, '吐迷藏');
  assert.equal(games[0].englishName, 'Puke and Seek');
  assert.equal(games[0].developer, 'Cyborg Dreams');
  assert.equal(games[0].publisher, 'Cyborg Dreams');
  assert.equal(games[0].genre, '休闲');
  assert.equal(games[0].price, 9.99);
  assert.equal(games[0].rating, 75);
  assert.equal(games[0].reviewCount, 4);
  assert.equal(games[0].description, '官方简介');
  assert.equal(games.warnings.length, 0);
  assert.equal(steamUsdPrice('$1,299.99'), 1299.99);
  assert.equal(steamUsdPrice('Free To Play'), 0);
});

test('Apple collection enriches US metrics with the official Chinese name and icon', async () => {
  const getJson = async url => {
    if (url.includes('/search?')) return { results: [{
      primaryGenreName: 'Games', trackId: 512939461, trackName: 'Subway Surfers',
      trackViewUrl: 'https://apps.apple.com/us/app/subway-surfers/id512939461?uo=4',
      genres: ['Games', 'Action'], artistName: 'SYBO Games', price: 0,
      averageUserRating: 4.6, userRatingCount: 100, artworkUrl100: 'https://example.com/us.png'
    }] };
    return { results: [{ trackId: 512939461, trackName: '地铁跑酷', artworkUrl100: 'https://example.com/cn.png' }] };
  };
  const games = await collectApple('2026-10-04', ['game'], getJson);
  assert.equal(games[0].name, '地铁跑酷');
  assert.equal(games[0].englishName, 'Subway Surfers');
  assert.equal(games[0].iconUrl, 'https://example.com/cn.png');
  assert.equal(games[0].sourceExtras.usRatingCount, 100);
});

test('Apple icon backfill looks up existing catalog IDs without an icon', async () => {
  const existing = [{
    channel: 'App', name: 'Legacy Game', englishName: 'Legacy Game', genre: '角色扮演', platforms: ['iOS'],
    releaseDate: '', developer: 'Studio', publisher: 'Studio', price: null, rating: null, reviewCount: null,
    peakPlayers: null, tags: [], description: '', iconUrl: '', steamAppId: null,
    sourceUrl: 'https://apps.apple.com/us/app/legacy-game/id123456789?uo=4', metricsSourceUrl: '',
    dataAsOf: '2026-10-03', metricScope: 'Apple App Store 美国区商品',
    sourceExtras: { appStoreId: 123456789, usPriceUsd: 0, usRatingOutOf5: null, usRatingCount: null }, isDemo: false
  }];
  const games = await collectMissingAppleIcons('2026-10-04', existing, async () => ({
    results: [{ trackId: 123456789, artworkUrl100: 'https://example.com/icon.png' }]
  }));
  assert.equal(games.length, 1);
  assert.equal(games[0].iconUrl, 'https://example.com/icon.png');
  assert.equal(games[0].dataAsOf, '2026-10-04');
});

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

test('sync status hides sources that are no longer configured', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-sync-status-'));
  const file = path.join(directory, 'status.json');
  fs.writeFileSync(file, JSON.stringify({ sources: {
    steam: { state: 'ok', url: 'https://store.steampowered.com/search/' },
    google: { state: 'error', url: 'https://play.google.com/store/games' }
  } }));
  try {
    const sync = createCatalogSync({ file, collectors: { steam: async () => [] } });
    assert.deepEqual(Object.keys(sync.getStatus().sources), ['steam']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('catalog sources collect in parallel', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-sync-parallel-'));
  const file = path.join(directory, 'status.json');
  let active = 0;
  let maximum = 0;
  const failedCollector = async () => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 20));
    active--;
    throw new Error('expected');
  };
  try {
    const sync = createCatalogSync({ file, collectors: { steam: failedCollector, apple: failedCollector } });
    await sync.run();
    assert.equal(maximum, 2);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
