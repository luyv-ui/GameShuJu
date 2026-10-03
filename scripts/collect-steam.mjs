import fs from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const seedPath = path.join(projectRoot, 'data', 'seed.json');
const outputDir = path.join(projectRoot, 'data', 'collected');
const now = new Date();
const DAY_MS = 24 * 60 * 60 * 1000;
const windows = [365, 90, 30, 7];

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function fetchJson(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'GameShuJu/0.1 data collector' },
        signal: AbortSignal.timeout(20_000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(500 * (2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

function plainText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-zA-Z#0-9]+;/g, ' ')
    .replace(/\\/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

async function collectNews(appId) {
  const cutoff = Math.floor((now.getTime() - 365 * DAY_MS) / 1000);
  let enddate = Math.floor(now.getTime() / 1000) + 24 * 60 * 60;
  const items = new Map();

  for (let page = 0; page < 20; page += 1) {
    const url = new URL('https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/');
    url.searchParams.set('appid', String(appId));
    url.searchParams.set('count', '100');
    url.searchParams.set('maxlength', '1200');
    url.searchParams.set('enddate', String(enddate));

    const payload = await fetchJson(url);
    const pageItems = payload?.appnews?.newsitems || [];
    if (!pageItems.length) break;

    for (const item of pageItems) {
      if (item.date >= cutoff && item.date <= enddate) {
        items.set(String(item.gid), {
          id: String(item.gid),
          title: String(item.title || ''),
          url: String(item.url || ''),
          author: String(item.author || ''),
          publishedAt: new Date(item.date * 1000).toISOString(),
          feed: String(item.feedlabel || item.feedname || ''),
          tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
          excerpt: plainText(item.contents)
        });
      }
    }

    const oldest = Math.min(...pageItems.map(item => Number(item.date)).filter(Number.isFinite));
    if (!Number.isFinite(oldest) || oldest <= cutoff) break;
    enddate = oldest - 1;
    await sleep(150);
  }

  return [...items.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

async function collectCurrentPlayers(appId) {
  const url = new URL('https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/');
  url.searchParams.set('appid', String(appId));
  const payload = await fetchJson(url);
  if (payload?.response?.result !== 1) return null;
  return Number(payload.response.player_count);
}

function countWithin(news, days) {
  const cutoff = now.getTime() - days * DAY_MS;
  return news.filter(item => new Date(item.publishedAt).getTime() >= cutoff).length;
}

async function collectGame(game) {
  const base = {
    id: game.id,
    name: game.name,
    englishName: game.englishName,
    steamAppId: game.steamAppId,
    storeUrl: game.sourceUrl,
    capturedAt: now.toISOString()
  };

  try {
    const [news, currentPlayers] = await Promise.all([
      collectNews(game.steamAppId),
      collectCurrentPlayers(game.steamAppId)
    ]);
    return {
      ...base,
      status: 'ok',
      currentPlayers,
      newsCounts: Object.fromEntries(windows.map(days => [`last${days}Days`, countWithin(news, days)])),
      news
    };
  } catch (error) {
    return { ...base, status: 'error', error: String(error?.message || error), currentPlayers: null, news: [] };
  }
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

function markdownReport(dataset) {
  const lines = [
    '# Steam 实际采集结果',
    '',
    `采集时间：${dataset.collectedAt}`,
    '',
    '| 游戏 | 当前玩家数 | 近365天公告 | 近90天 | 近30天 | 近7天 | 状态 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- |'
  ];
  for (const game of dataset.games) {
    lines.push(`| ${game.name} | ${game.currentPlayers ?? '—'} | ${game.newsCounts?.last365Days ?? '—'} | ${game.newsCounts?.last90Days ?? '—'} | ${game.newsCounts?.last30Days ?? '—'} | ${game.newsCounts?.last7Days ?? '—'} | ${game.status} |`);
  }
  lines.push('', '> 当前玩家数是采集时刻的快照，不是历史峰值；公告数量来自 Steam 官方新闻接口。', '');
  return lines.join('\n');
}

const seed = JSON.parse(await fs.readFile(seedPath, 'utf8'));
const trackedGames = seed.filter(game => Number.isInteger(game.steamAppId) && game.steamAppId > 0);
const games = await runPool(trackedGames, 3, collectGame);
const dataset = {
  schemaVersion: 1,
  collectedAt: now.toISOString(),
  requestedWindowsDays: windows,
  sources: {
    news: 'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/',
    currentPlayers: 'https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/'
  },
  limitations: [
    'currentPlayers 是采集时刻快照，官方接口不提供过去一年的逐日历史',
    'news 仅统计 Steam 新闻源，不能代表全网舆情',
    '国内平台尚未授权，因此本文件不包含微信、抖音或 B站后台指标'
  ],
  games
};

await fs.mkdir(outputDir, { recursive: true });
const date = now.toISOString().slice(0, 10);
await Promise.all([
  fs.writeFile(path.join(outputDir, `steam-${date}.json`), `${JSON.stringify(dataset, null, 2)}\n`),
  fs.writeFile(path.join(outputDir, 'steam-latest.json'), `${JSON.stringify(dataset, null, 2)}\n`),
  fs.writeFile(path.join(outputDir, 'steam-summary.md'), markdownReport(dataset))
]);

const succeeded = games.filter(game => game.status === 'ok').length;
console.log(`Collected ${succeeded}/${games.length} Steam games at ${dataset.collectedAt}`);
console.log(path.join(outputDir, 'steam-summary.md'));
