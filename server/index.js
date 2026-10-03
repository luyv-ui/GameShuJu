import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listGames, createGame, updateGame, deleteGame } from './store.js';
import { searchGames } from './query.js';
import { getDingTalkBotStatus, startDingTalkBot } from './dingtalk.js';

const app = express();
app.use(express.json({ limit: '100kb' }));

app.get('/api/games', (req, res) => {
  const games = searchGames(listGames(), req.query.q, req.query.genre, req.query.platform);
  res.json(games);
});
app.get('/api/bot/status', (req, res) => {
  res.json(getDingTalkBotStatus());
});
app.post('/api/games', (req, res) => {
  try { res.status(201).json(createGame(req.body)); }
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
app.use(express.static(path.join(root, 'dist')));
app.get('/{*path}', (req, res) => res.sendFile(path.join(root, 'dist/index.html')));

const port = Number(process.env.PORT || 3001);
app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
startDingTalkBot(listGames).catch(error => console.error('DingTalk bot failed:', error));
