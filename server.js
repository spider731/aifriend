/**
 * AI 电子女友 — 后端服务器
 * PWA + Express + Claude API + 主动消息 + Web Push
 */

require('dotenv').config();
const express = require('express');
const path = require('path');

const db = require('./src/store/db');
const claude = require('./src/ai/claude');
const memory = require('./src/ai/memory');
const proactive = require('./src/scheduler/proactive');
const webpush = require('./src/push/webpush');
const personality = require('./src/ai/personality');

const PORT = parseInt(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ========== 健康检查 ==========
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', name: personality.getGFName(), uptime: process.uptime() });
});

// ========== 聊天 ==========
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: '消息不能为空' });

    db.messages.add('user', message.trim());
    memory.extractAndSaveMemory(message.trim());
    db.proactive.markLastReplied();
    db.herState.update({ last_active_at: new Date().toISOString() });
    db.herState.bumpEnergy(3);

    const reply = await claude.chatReply(message.trim());
    db.messages.add('assistant', reply);

    res.json({ reply });
  } catch (error) {
    console.error('聊天错误:', error.message);
    const msg = error.message.includes('API Key') ? 'API Key 无效' :
      error.message.includes('频繁') ? '请求太频繁～' : '服务器错误';
    res.status(500).json({ error: msg });
  }
});

// ========== 消息历史 ==========
app.get('/api/messages', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({ messages: db.messages.getRecent(limit) });
});

// ========== 推送订阅 ==========
app.post('/api/subscribe', (req, res) => {
  try {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: '无效订阅信息' });
    }
    db.subscriptions.add(endpoint, keys.p256dh, keys.auth);
    console.log(`  📱 新订阅: ${endpoint.substring(0, 50)}...`);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/unsubscribe', (req, res) => {
  try {
    const { endpoint } = req.body;
    if (endpoint) db.subscriptions.remove(endpoint);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/vapid-public-key', (_req, res) => {
  res.json({ publicKey: webpush.getPublicKey() });
});

// ========== 记忆 ==========
app.post('/api/memory', (req, res) => {
  const { key, value } = req.body;
  if (key && value) db.memories.set(key, value);
  res.json({ success: true });
});

app.get('/api/memory', (_req, res) => {
  res.json({ memories: db.memories.getAll() });
});

// ========== 状态 ==========
app.get('/api/state', (_req, res) => {
  const state = db.herState.get();
  const cfg = db.config.getAll();
  res.json({
    name: personality.getGFName(),
    mood: state?.mood || 'neutral',
    energy: state?.energy || 80,
    config: cfg,
  });
});

// ========== 配置（隐藏敏感信息） ==========
app.get('/api/config', (_req, res) => {
  const cfg = db.config.getAll();
  // 隐藏密钥
  for (const k of Object.keys(cfg)) {
    if (k.includes('key') || k.includes('secret') || k.includes('token')) {
      if (cfg[k].length > 8) cfg[k] = cfg[k].substring(0, 8) + '...';
    }
  }
  res.json({ config: cfg });
});

// ========== 清空 ==========
app.post('/api/clear', (_req, res) => {
  db.clearAll();
  res.json({ success: true });
});

// ========== 手动触发主动消息（调试） ==========
app.post('/api/proactive', async (_req, res) => {
  try {
    const msg = await proactive.sendProactiveMessage('manual');
    res.json({ message: msg });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== 启动 ==========
function getLocalIP() {
  const nets = require('os').networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

async function main() {
  // 检查必要配置
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ 请设置 ANTHROPIC_API_KEY 环境变量');
    console.error('   复制 .env.example 为 .env 并填入你的 API Key');
    process.exit(1);
  }

  // 初始化数据库
  await db.init();

  // 初始化 Web Push
  try { webpush.init(); } catch (e) { console.warn('  ⚠️ Web Push 初始化失败:', e.message); }

  // 设置推送引用
  proactive.setPushService(webpush);

  // 启动调度器
  const cancelScheduler = proactive.start();

  // 启动 HTTP
  app.listen(PORT, HOST, () => {
    const ip = getLocalIP();
    console.log('');
    console.log('  ╔══════════════════════════════════════╗');
    console.log('  ║     💕 AI 电子女友已启动 💕          ║');
    console.log('  ╠══════════════════════════════════════╣');
    console.log(`  ║  本地: http://localhost:${PORT}         ║`);
    console.log(`  ║  手机: http://${ip}:${PORT}     ║`);
    console.log('  ║  手机打开 → 添加到主屏幕 = App      ║');
    console.log('  ║  /health — 健康检查                 ║');
    console.log('  ╚══════════════════════════════════════╝');
    console.log('');
  });

  // 优雅退出
  const cleanup = () => {
    console.log('\n🛑 关闭中...');
    if (cancelScheduler) cancelScheduler();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch(e => { console.error('❌ 启动失败:', e.message); process.exit(1); });
