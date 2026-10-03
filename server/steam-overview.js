import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const steamOverviewCacheFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/collected/steam-overview.json');

export function parseSteamPlatformOverview(html) {
  const normalized = String(html || '').replaceAll('\\"', '"');
  const match = normalized.match(/(\[\{"msDate":\d+,"nUsers":\d+\}(?:,\{"msDate":\d+,"nUsers":\d+\})*\]),"nPeak":(\d+),"nCurrent":(\d+)/);
  if (!match) throw new Error('Steam 未返回全平台在线数据');
  const history = JSON.parse(match[1]).map(point => ({ capturedAt: new Date(point.msDate).toISOString(), count: Number(point.nUsers) }))
    .filter(point => Number.isFinite(point.count) && point.count > 0);
  return { current: Number(match[3]), peak: Number(match[2]), history };
}

function readCache(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

function writeCache(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}

async function defaultFetchPage(url) {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GameIntelligenceResearch/1.0)' }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  } catch {
    return (await execFileAsync('curl', ['--fail', '--location', '--silent', '--show-error', '--connect-timeout', '6', '--max-time', '25',
      '--user-agent', 'Mozilla/5.0 (compatible; GameIntelligenceResearch/1.0)', url], { maxBuffer: 5 * 1024 * 1024 })).stdout;
  }
}

export function createSteamOverview({ fetchPage = defaultFetchPage, now = () => Date.now(), cacheFile = process.env.STEAM_OVERVIEW_CACHE_FILE || steamOverviewCacheFile } = {}) {
  let cached = readCache(cacheFile);
  let pending = null;
  async function refresh() {
    if (pending) return pending;
    pending = (async () => {
      const platform = parseSteamPlatformOverview(await fetchPage('https://store.steampowered.com/charts/?l=schinese'));
      cached = { capturedAt: new Date(now()).toISOString(), sourceUrl: 'https://store.steampowered.com/charts/', ...platform };
      writeCache(cacheFile, cached);
      return cached;
    })();
    try { return await pending; }
    finally { pending = null; }
  }
  async function get(force = false) {
    if (!cached) cached = readCache(cacheFile);
    if (force) {
      try { return await refresh(); }
      catch (error) { if (cached) return { ...cached, refreshError: error instanceof Error ? error.message : '更新失败' }; throw error; }
    }
    if (cached) return cached;
    return refresh();
  }
  return { get, refresh };
}
