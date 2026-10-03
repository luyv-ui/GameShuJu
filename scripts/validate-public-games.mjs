import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const isText = value => typeof value === 'string' && value.trim().length > 0;
const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const isUrl = value => {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
};
const isNumber = value => typeof value === 'number' && Number.isFinite(value);

export function validatePublicGames(document, { expectedCount } = {}) {
  const errors = [];
  if (!document || typeof document !== 'object' || Array.isArray(document)) return ['快照必须是 JSON 对象'];
  const fetchedAt = document.fetchedAt;
  if (!isText(fetchedAt) || Number.isNaN(Date.parse(fetchedAt)) || new Date(fetchedAt).toISOString() !== fetchedAt) {
    errors.push('fetchedAt 必须是 ISO UTC 时间');
  }
  if (!isText(document.methodology)) errors.push('缺少采集方法和指标口径');
  if (!Array.isArray(document.sources) || !document.sources.length || !document.sources.every(isText)) errors.push('缺少来源列表');
  if (!Array.isArray(document.limitations) || !document.limitations.length || !document.limitations.every(isText)) errors.push('缺少局限说明');
  if (!Array.isArray(document.failures) || document.failures.length) errors.push('采集有失败项目，禁止发布快照');
  if (!Array.isArray(document.games) || !document.games.length) return [...errors, 'games 必须是非空数组'];
  if (expectedCount !== undefined && document.games.length !== expectedCount) errors.push(`预期 ${expectedCount} 款，实际 ${document.games.length} 款`);

  const seen = new Set();
  document.games.forEach((game, index) => {
    const prefix = `games[${index}]`;
    if (!game || typeof game !== 'object' || Array.isArray(game)) { errors.push(`${prefix} 必须是对象`); return; }
    for (const field of ['name', 'genre', 'sourceUrl', 'dataAsOf', 'metricScope']) {
      if (!isText(game[field])) errors.push(`${prefix}.${field} 不能为空`);
    }
    if (!isUrl(game.sourceUrl)) errors.push(`${prefix}.sourceUrl 必须是 HTTPS 链接`);
    if (!isDate(game.dataAsOf) || (isText(fetchedAt) && game.dataAsOf !== fetchedAt.slice(0, 10))) errors.push(`${prefix}.dataAsOf 与采集日期不符`);
    if (!Array.isArray(game.platforms) || game.platforms.length !== 1 || !isText(game.platforms[0])) errors.push(`${prefix}.platforms 必须保留唯一已核验平台`);
    const key = `${game.platforms?.[0]}:${game.steamAppId ?? game.sourceUrl}`;
    if (seen.has(key)) errors.push(`${prefix} 重复来源 ${key}`);
    seen.add(key);
    for (const field of ['price', 'rating', 'reviewCount', 'peakPlayers']) {
      if (game[field] !== null && (!isNumber(game[field]) || game[field] < 0)) errors.push(`${prefix}.${field} 必须是非负数或 null`);
    }
    if (isNumber(game.rating) && game.rating > 100) errors.push(`${prefix}.rating 超出百分比范围`);
    if (game.platforms?.[0] === 'PC') {
      if (!Number.isInteger(game.steamAppId) || game.steamAppId <= 0) errors.push(`${prefix}.steamAppId 无效`);
      if (!isUrl(game.metricsSourceUrl)) errors.push(`${prefix}.metricsSourceUrl 缺失`);
      if (!isNumber(game.rating) || !Number.isInteger(game.reviewCount) || game.reviewCount <= 0) errors.push(`${prefix} 缺少 Steam 评价指标`);
    } else {
      if (game.price !== null || game.rating !== null || game.reviewCount !== null || game.peakPlayers !== null) errors.push(`${prefix} 非 Steam 指标必须为 null，保留在 sourceExtras`);
      if (game.platforms?.[0] === 'iOS' && (!game.sourceExtras || !Number.isInteger(game.sourceExtras.appStoreId))) errors.push(`${prefix}.sourceExtras.appStoreId 缺失`);
    }
  });
  return errors;
}

export async function publishPublicGames(document, directory = 'data/imports', options = {}) {
  const errors = validatePublicGames(document, options);
  if (errors.length) throw new Error(`快照校验失败:\n${errors.join('\n')}`);
  await fs.mkdir(directory, { recursive: true });
  const stamp = document.fetchedAt.replace(/[:.]/g, '-');
  const destination = path.join(directory, `public-games-${stamp}.json`);
  const temporary = path.join(directory, `.public-games-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { flag: 'wx' });
    await fs.link(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return destination;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const filename = process.argv[2];
  if (!filename) {
    console.error('用法: node scripts/validate-public-games.mjs data/imports/<快照>.json');
    process.exitCode = 2;
  } else {
    try {
      const document = JSON.parse(await fs.readFile(filename, 'utf8'));
      const errors = validatePublicGames(document);
      if (errors.length) throw new Error(errors.join('\n'));
      console.log(`校验通过：${document.games.length} 款，${filename}`);
    } catch (error) {
      console.error(`校验失败：${error.message}`);
      process.exitCode = 1;
    }
  }
}
