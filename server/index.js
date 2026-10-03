import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listGames, createGame, updateGame, deleteGame, importGames } from './store.js';
import { searchGames } from './query.js';
import { getDingTalkBotStatus, startDingTalkBot } from './dingtalk.js';
import { listProjects, createProject, updateProject, deleteProject } from './projects.js';
import { getScoreConfig, putScoreConfig } from './score-config.js';
import { generateInvestmentReport, renderInvestmentReportPdf } from './report.js';
import { createAuth } from './auth.js';
import { createCatalogSync } from './catalog-sync.js';
import { createRankings, enrichRankingCatalog, fillMissingRankingIcons } from './rankings.js';
import { collectSteamCharts } from './steamcharts.js';
import { createSteamGameDetail } from './steam-game-detail.js';
import { createSteamOverview } from './steam-overview.js';

const app = express();
app.use(express.json({ limit: '8mb' }));
app.use('/api/auth/exchange', express.urlencoded({ extended: false, limit: '4kb' }));
const auth = createAuth();
const catalogSync = createCatalogSync({ getExistingGames: listGames });
const rankings = createRankings();
const steamGameDetail = createSteamGameDetail();
const steamOverview = createSteamOverview();
function listBotGames() {
  const primary = listGames();
  const knownSteamIds = new Set(primary.map(game => Number(game.steamAppId)).filter(Boolean));
  return [...primary, ...steamGameDetail.catalogGames().filter(game => !knownSteamIds.has(Number(game.steamAppId)))];
}
auth.routes(app);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/games', (req, res, next) => (req.method === 'GET' ? auth.read : auth.write)(req, res, next));
app.use('/api/projects', (req, res, next) => (req.method === 'GET' ? auth.read : auth.write)(req, res, next));
app.use('/api/score-config', (req, res, next) => (req.method === 'GET' ? auth.read : auth.admin)(req, res, next));

app.get('/api/games', (req, res) => {
  const games = searchGames(listGames(), req.query.q, req.query.genre, req.query.platform, req.query.channel);
  res.json(games);
});
app.get('/api/bot/status', (req, res) => {
  res.json(getDingTalkBotStatus());
});
app.get('/api/catalog-sync', auth.read, (req, res) => res.json(catalogSync.getStatus()));
app.get('/api/rankings', auth.read, async (req, res) => {
  try {
    const data = req.query.scope === 'steam' ? await rankings.refreshSteam(req.query.refresh === '1', String(req.query.region || 'global')) : await rankings.get(req.query.refresh === '1');
    res.json(await fillMissingRankingIcons(enrichRankingCatalog(data, listGames())));
  }
  catch { res.status(502).json({ error: '榜单暂时无法获取' }); }
});
app.get('/api/steam/games/:appid', auth.read, async (req, res) => {
  try { res.json(await steamGameDetail.get(req.params.appid, req.query.refresh === '1')); }
  catch (error) { res.status(error?.status || 502).json({ error: error instanceof Error ? error.message : 'Steam 游戏资料暂时无法获取' }); }
});
app.get('/api/steam/overview', auth.read, async (req, res) => {
  try { res.json({ platform: await steamOverview.get(req.query.refresh === '1'), sample: steamGameDetail.overview() }); }
  catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : 'Steam 整体数据暂时无法获取' }); }
});
app.post('/api/steam/game-cache/refresh', auth.admin, async (req, res) => {
  try {
    const appIds = Array.isArray(req.body?.appIds) ? req.body.appIds.slice(0, 800) : [];
    if (!appIds.length) return res.status(400).json({ error: '没有可更新的 Steam 游戏' });
    res.json(await steamGameDetail.warm(appIds, { force: true, concurrency: 5, replace: true }));
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Steam 游戏缓存更新失败' });
  }
});
app.post('/api/catalog-sync', auth.admin, (req, res) => {
  if (catalogSync.getStatus().running) return res.status(409).json({ error: '同步正在进行' });
  void catalogSync.run().catch(error => console.error('Catalog sync failed:', error));
  res.status(202).json({ started: true });
});
app.post('/api/games', (req, res) => {
  try { res.status(201).json(createGame(req.body)); }
  catch (error) { res.status(400).json({ error: error.message }); }
});
app.post('/api/games/import', (req, res) => {
  try { res.json(importGames(req.body)); }
  catch (error) { res.status(400).json({ error: error.message }); }
});
app.put('/api/games/:id', (req, res) => {
  try {
    const game = updateGame(req.params.id, req.body);
    if (!game) return res.status(404).json({ error: '游戏不存在' });
    res.json(game);
  } catch (error) { res.status(400).json({ error: error.message }); }
});
app.delete('/api/games/:id', (req, res) => {
  if (!deleteGame(req.params.id)) return res.status(404).json({ error: '游戏不存在' });
  res.status(204).end();
});

app.get('/api/projects', (req, res) => {
  try { res.json(listProjects()); }
  catch (error) { res.status(500).json({ error: '项目读取失败' }); }
});
app.post('/api/projects', (req, res) => {
  try { res.status(201).json(createProject(req.body)); }
  catch (error) { res.status(400).json({ error: error.message }); }
});
app.put('/api/projects/:id', (req, res) => {
  try {
    const project = updateProject(req.params.id, req.body);
    if (!project) return res.status(404).json({ error: '项目不存在' });
    res.json(project);
  } catch (error) { res.status(400).json({ error: error.message }); }
});
app.delete('/api/projects/:id', (req, res) => {
  try {
    if (!deleteProject(req.params.id)) return res.status(404).json({ error: '项目不存在' });
    res.status(204).end();
  } catch (error) { res.status(500).json({ error: '项目删除失败' }); }
});

app.get('/api/projects/:id/report', (req, res) => {
  try {
    const project = listProjects().find(item => item.id === req.params.id);
    if (!project) return res.status(404).json({ error: '项目不存在' });
    res.json(generateInvestmentReport(project));
  } catch { res.status(500).json({ error: '报告生成失败' }); }
});
app.get('/api/projects/:id/report.pdf', async (req, res) => {
  try {
    const project = listProjects().find(item => item.id === req.params.id);
    if (!project) return res.status(404).json({ error: '项目不存在' });
    const pdf = await renderInvestmentReportPdf(generateInvestmentReport(project));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="investment-report.pdf"');
    res.send(pdf);
  } catch { res.status(500).json({ error: 'PDF 导出失败' }); }
});

app.get('/api/score-config', (req, res) => {
  try { res.json(getScoreConfig()); }
  catch { res.status(500).json({ error: '评分配置读取失败' }); }
});
app.put('/api/score-config', (req, res) => {
  try { res.json(putScoreConfig(req.body)); }
  catch (error) { res.status(400).json({ error: error.message }); }
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
app.use(express.static(path.join(root, 'dist')));
app.get('/{*path}', (req, res) => res.sendFile(path.join(root, 'dist/index.html')));

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '127.0.0.1';
app.listen(port, host, () => console.log(`API listening on http://${host}:${port}`));
if (process.env.CATALOG_SYNC_ENABLED !== 'false') {
  setTimeout(() => void catalogSync.run().catch(error => console.error('Catalog sync failed:', error)), 10000).unref();
  setInterval(() => void catalogSync.run().catch(error => console.error('Catalog sync failed:', error)), 6 * 60 * 60 * 1000).unref();
}
if (process.env.STEAMCHARTS_SYNC_ENABLED !== 'false') {
  const refreshPeaks = () => void collectSteamCharts(listGames()).catch(error => console.error('SteamCharts sync failed:', error));
  setTimeout(refreshPeaks, 30000).unref();
  setInterval(refreshPeaks, 24 * 60 * 60 * 1000).unref();
}
if (process.env.STEAM_RANKINGS_SYNC_ENABLED !== 'false') {
  const refreshSteamRankings = () => void Promise.all(['global', 'CN', 'US', 'JP'].map(region => rankings.refreshSteam(true, region)))
    .catch(error => console.error('Steam rankings sync failed:', error));
  setTimeout(refreshSteamRankings, 5000).unref();
  setInterval(refreshSteamRankings, 30 * 60 * 1000).unref();
}
startDingTalkBot(listBotGames, () => rankings.get(), appId => steamGameDetail.peek(appId), () => steamGameDetail.overview())
  .catch(error => console.error('DingTalk bot failed:', error));
