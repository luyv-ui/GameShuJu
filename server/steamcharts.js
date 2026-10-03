import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { load } from 'cheerio';

export const steamChartsFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/collected/steamcharts-latest.json');
const execFileAsync = promisify(execFile);

export function parseAllTimePeak(html) {
  const $ = load(html);
  const stats = $('#app-heading .app-stat');
  const match = stats.toArray().find(element => /all-time peak/i.test($(element).text()));
  const value = match && Number($(match).find('.num').first().text().replace(/,/g, '').trim());
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('SteamCharts 页面没有有效的全历史峰值');
  return value;
}

async function fetchPage(url) {
  try {
    const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 GameIntelligenceResearch/1.0' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch {
    const { stdout } = await execFileAsync('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '20', url], { maxBuffer: 4 * 1024 * 1024 });
    return stdout;
  }
}

export async function collectSteamCharts(games, { file = process.env.STEAMCHARTS_DATA_FILE || steamChartsFile, fetchHtml = fetchPage } = {}) {
  const ids = [...new Set(games.filter(game => !game.isDemo && game.sourceUrl?.startsWith('https://store.steampowered.com/app/') &&
    Number.isSafeInteger(game.steamAppId) && game.steamAppId > 0 && game.reviewCount !== null)
    .map(game => game.steamAppId))].slice(0, 40);
  const results = [];
  const failures = [];
  for (const steamAppId of ids) {
    const sourceUrl = `https://steamcharts.com/app/${steamAppId}`;
    try {
      const peakPlayers = parseAllTimePeak(await fetchHtml(sourceUrl));
      results.push({ steamAppId, peakPlayers, sourceUrl, capturedAt: new Date().toISOString() });
    } catch (error) { failures.push({ steamAppId, error: String(error.message || error) }); }
  }
  if (results.length) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const previous = await fs.readFile(file, 'utf8').then(JSON.parse).catch(() => ({ games: [] }));
    const merged = new Map((previous.games || []).map(game => [game.steamAppId, game]));
    for (const result of results) merged.set(result.steamAppId, result);
    const temp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify({ source: 'SteamCharts', games: [...merged.values()] }, null, 2)}\n`);
    await fs.rename(temp, file);
  }
  return { collected: results.length, failures };
}
