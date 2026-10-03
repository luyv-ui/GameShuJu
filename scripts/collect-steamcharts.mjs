import { listGames } from '../server/store.js';
import { collectSteamCharts } from '../server/steamcharts.js';

const result = await collectSteamCharts(listGames());
console.log(`SteamCharts: ${result.collected} collected, ${result.failures.length} failed`);
for (const failure of result.failures) console.error(`${failure.steamAppId}: ${failure.error}`);
if (!result.collected) process.exitCode = 1;
