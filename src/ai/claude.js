/**
 * Claude API 客户端
 * API Key 从环境变量读取，带 prompt caching
 */

const Anthropic = require('@anthropic-ai/sdk');
const personality = require('./personality');
const memory = require('./memory');
const db = require('../store/db');

let client = null;

function getClient() {
  if (client) return client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('请设置 ANTHROPIC_API_KEY 环境变量');
  client = new Anthropic({ apiKey: key });
  return client;
}

function getModel() {
  return process.env.CLAUDE_MODEL || 'claude-sonnet-4-6-20250514';
}

/**
 * 聊天回复
 */
async function chatReply(userMessage) {
  const c = getClient();
  const model = getModel();
  const { memories, recentMessages } = memory.formatMemoriesForPrompt();
  const systemPrompt = personality.chatSystemPrompt(memories, recentMessages);

  const messages = [
    ...recentMessages.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  console.log(`  💬 用户: ${userMessage.substring(0, 50)}...`);

  try {
    const response = await c.messages.create({
      model,
      max_tokens: 400,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages,
    });

    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock) throw new Error('非文本回复');

    const reply = textBlock.text.trim();
    db.messages.add('assistant', reply);

    if (response.usage?.cache_read_input_tokens > 0) {
      console.log(`  💰 Cache hit: ${response.usage.cache_read_input_tokens} tokens`);
    }
    return reply;
  } catch (e) {
    console.error('  ❌ Claude API:', e.message);
    if (e.status === 401) throw new Error('API Key 无效，请检查 ANTHROPIC_API_KEY');
    if (e.status === 429) throw new Error('请求太频繁，稍后再试');
    throw e;
  }
}

/**
 * 主动消息
 */
async function proactiveMessage(topicType) {
  const c = getClient();
  const model = getModel();
  const { memories, recentChat: recentMessages } = memory.formatMemoriesForPrompt();

  let weatherInfo = null;
  if (topicType === '早安问候') {
    try {
      const weather = require('../services/weather');
      weatherInfo = await weather.getWeatherSummary();
    } catch (_) {}
  }

  const userMessage = personality.proactivePrompt(topicType, memories, recentMessages, weatherInfo);

  console.log(`  📤 主动消息 (${topicType})...`);

  const response = await c.messages.create({
    model,
    max_tokens: 250,
    system: [{ type: 'text', text: personality.chatSystemPrompt(memories, recentMessages), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMessage }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error('非文本回复');
  return textBlock.text.trim();
}

module.exports = { chatReply, proactiveMessage, getClient };
