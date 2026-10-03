import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSteamPlatformOverview } from './steam-overview.js';

test('parses Steam-wide current players, peak and history', () => {
  const html = String.raw`x[{\"msDate\":1000,\"nUsers\":20},{\"msDate\":2000,\"nUsers\":35}],\"nPeak\":42,\"nCurrent\":35}y`;
  const result = parseSteamPlatformOverview(html);
  assert.equal(result.current, 35);
  assert.equal(result.peak, 42);
  assert.deepEqual(result.history.map(point => point.count), [20, 35]);
});
