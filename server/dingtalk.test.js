import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRobotMessage } from './dingtalk.js';

const game = { name: '测试游戏', englishName: '', genre: '解谜', platforms: ['PC'], tags: [], rating: null, price: null, isDemo: false };
const message = { senderCorpId: 'corp', chatbotCorpId: 'corp', msgtype: 'text', text: { content: '测试游戏' }, sessionWebhook: 'https://oapi.dingtalk.com/robot/send' };

test('bot rejects messages from another organization or webhook host', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('fetch should not run'); };
  try {
    await handleRobotMessage({ ...message, senderCorpId: 'other' }, () => [game]);
    await handleRobotMessage({ ...message, sessionWebhook: 'https://example.com/robot/send' }, () => [game]);
  } finally { globalThis.fetch = originalFetch; }
});

test('bot retries a failed reply and ignores an already delivered message', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => ({ ok: ++calls > 1, status: 503 });
  try {
    const incoming = { ...message, msgId: 'retry-test' };
    await assert.rejects(handleRobotMessage(incoming, () => [game]), /HTTP 503/);
    await handleRobotMessage(incoming, () => [game]);
    await handleRobotMessage(incoming, () => [game]);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; }
});
