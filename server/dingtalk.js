import { DWClient, TOPIC_ROBOT } from 'dingtalk-stream';
import { answerQuery } from './query.js';

const recentMessages = new Map();

function rememberMessage(id) {
  if (!id) return true;
  const now = Date.now();
  for (const [key, time] of recentMessages) if (now - time > 10 * 60 * 1000) recentMessages.delete(key);
  if (recentMessages.has(id)) return false;
  recentMessages.set(id, now);
  return true;
}

function validWebhook(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'dingtalk.com' || url.hostname.endsWith('.dingtalk.com'));
  } catch { return false; }
}

export async function handleRobotMessage(message, getGames) {
  const corpId = process.env.DINGTALK_CORP_ID;
  if (!message?.senderCorpId || message.senderCorpId !== message.chatbotCorpId || (corpId && message.senderCorpId !== corpId)) return;
  if (message.msgtype !== 'text' || !message.text?.content || !validWebhook(message.sessionWebhook)) return;
  if (!rememberMessage(message.msgId)) return;
  try {
    const content = answerQuery(getGames(), message.text.content.slice(0, 120));
    const response = await fetch(message.sessionWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content } })
    });
    if (!response.ok) throw new Error(`DingTalk reply failed: HTTP ${response.status}`);
  } catch (error) {
    if (message.msgId) recentMessages.delete(message.msgId);
    throw error;
  }
}

export async function startDingTalkBot(getGames) {
  const clientId = process.env.DINGTALK_CLIENT_ID;
  const clientSecret = process.env.DINGTALK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.log('DingTalk bot disabled: set DINGTALK_CLIENT_ID and DINGTALK_CLIENT_SECRET to enable it.');
    return;
  }
  const client = new DWClient({ clientId, clientSecret });
  client.registerCallbackListener(TOPIC_ROBOT, event => {
    client.socketCallBackResponse(event.headers.messageId, { status: 'SUCCESS' });
    try {
      const message = JSON.parse(event.data);
      handleRobotMessage(message, getGames).catch(error => console.error('DingTalk message error:', error));
    } catch (error) { console.error('DingTalk payload error:', error); }
  });
  await client.connect();
  console.log('DingTalk bot connected.');
}
