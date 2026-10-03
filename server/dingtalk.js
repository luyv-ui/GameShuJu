import { DWClient, TOPIC_ROBOT } from 'dingtalk-stream';
import { answerQuery } from './query.js';

const recentMessages = new Map();
let activeClient;
const botStatus = {
  configured: false,
  connected: false,
  connectedAt: null,
  lastMessageAt: null,
  lastReplyAt: null,
  lastError: null
};

export function getDingTalkBotStatus() {
  return { ...botStatus };
}

function rememberMessage(id) {
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
  if (!message.senderCorpId || message.senderCorpId !== message.chatbotCorpId || (corpId && message.senderCorpId !== corpId)) return;
  if (message.msgtype !== 'text' || !message.text?.content || !validWebhook(message.sessionWebhook)) return;
  if (!rememberMessage(message.msgId)) return;
  botStatus.lastMessageAt = new Date().toISOString();
  const content = answerQuery(getGames(), message.text.content.slice(0, 120), { webUrl: process.env.PUBLIC_WEB_URL });
  const response = await fetch(message.sessionWebhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msgtype: 'text', text: { content } })
  });
  if (!response.ok) throw new Error(`DingTalk reply failed: HTTP ${response.status}`);
  botStatus.lastReplyAt = new Date().toISOString();
  botStatus.lastError = null;
}

export async function startDingTalkBot(getGames) {
  const clientId = process.env.DINGTALK_CLIENT_ID;
  const clientSecret = process.env.DINGTALK_CLIENT_SECRET;
  botStatus.configured = Boolean(clientId && clientSecret);
  if (!clientId || !clientSecret) {
    console.log('DingTalk bot disabled: set DINGTALK_CLIENT_ID and DINGTALK_CLIENT_SECRET to enable it.');
    return;
  }
  if (activeClient) return;
  activeClient = new DWClient({ clientId, clientSecret });
  activeClient.registerCallbackListener(TOPIC_ROBOT, event => {
    activeClient.socketCallBackResponse(event.headers.messageId, { status: 'SUCCESS' });
    try {
      const message = JSON.parse(event.data);
      handleRobotMessage(message, getGames).catch(error => {
        botStatus.lastError = error.message;
        console.error('DingTalk message error:', error);
      });
    } catch (error) {
      botStatus.lastError = error.message;
      console.error('DingTalk payload error:', error);
    }
  });
  await activeClient.connect();
  botStatus.connected = true;
  botStatus.connectedAt = new Date().toISOString();
  botStatus.lastError = null;
  console.log('DingTalk bot connected.');
}
