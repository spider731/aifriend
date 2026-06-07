/**
 * 主动消息调度器（增强版）
 * L1: 定时问候 — 时间窗口+随机偏移
 * L2: 随机分享 — 概率检查
 * L3: 情绪漂移 — 每2小时自然变化
 */

const cron = require('node-cron');
const claude = require('../ai/claude');
const memory = require('../ai/memory');
const db = require('../store/db');
const personality = require('../ai/personality');

let pushService = null;

function setPushService(service) { pushService = service; }

// ========== 发送判断 ==========
function canSendProactive() {
  const now = new Date();
  const hour = now.getHours();
  const sleepH = parseInt(db.config.get('sleep_time', '23:00').split(':')[0]);
  const wakeH = parseInt(db.config.get('wake_time', '08:30').split(':')[0]);

  if (hour >= sleepH || hour < wakeH) return false; // 她在睡觉

  const unreplied = memory.getUnrepliedCount();
  if (unreplied >= 5) { console.log('  ⏸️ 5条未回复，暂停'); return false; }
  if (unreplied >= 3 && Math.random() > 0.3) {
    console.log('  ⏸️ 3条未回复，30%概率通过(未通过)'); return false;
  }

  // 15分钟内有用户消息 → 跳过
  const lastUser = db.messages.getLastUserMessage();
  if (lastUser) {
    const minsAgo = (now - new Date(lastUser.created_at.replace(' ', 'T'))) / 60000;
    if (minsAgo < 15) { console.log('  ⏸️ 对话活跃中'); return false; }
  }

  // 上一条主动消息间隔≥30分钟
  const lastPro = db.proactive.getLastProactive();
  if (lastPro) {
    const minsAgo = (now - new Date(lastPro.sent_at.replace(' ', 'T'))) / 60000;
    if (minsAgo < 30) return false;
  }

  // 今日上限6条
  if (db.proactive.getTodayCount() >= 6) { console.log('  ⏸️ 今日已达上限'); return false; }

  return true;
}

// ========== 发送 ==========
async function sendProactiveMessage(triggerType, topicType = null) {
  if (!canSendProactive()) return null;

  try {
    let type = topicType;
    if (!type) {
      const avail = personality.TOPIC_LIST.filter(t => !db.sentTopics.wasSentRecently(t, 24));
      type = avail.length > 0
        ? avail[Math.floor(Math.random() * avail.length)]
        : personality.TOPIC_LIST[Math.floor(Math.random() * personality.TOPIC_LIST.length)];
    }

    const message = await claude.proactiveMessage(type);

    db.proactive.add(triggerType, message, type);
    db.messages.add('assistant', message, type);
    db.sentTopics.add(type);
    db.herState.drainEnergy(5);

    // 发送推送通知
    if (pushService) {
      await pushService.sendAll(`💕 ${personality.getGFName()}`, message);
    }

    console.log(`  ✅ 主动消息已发送 (${triggerType}: ${type})`);
    return message;
  } catch (e) {
    console.error(`  ❌ 主动消息失败: ${e.message}`);
    return null;
  }
}

// ========== L1: 定时问候 ==========
function scheduleGreetings() {
  const [wakeH, wakeM] = db.config.get('wake_time', '08:30').split(':').map(Number);
  const [sleepH, sleepM] = db.config.get('sleep_time', '23:00').split(':').map(Number);
  const tz = process.env.TZ || 'Asia/Shanghai';

  // 早安 — 唤醒后0-90分钟随机
  const randM = Math.floor(Math.random() * 90);
  const mTotal = wakeM + randM;
  const mH = wakeH + Math.floor(mTotal / 60);
  const mM = mTotal % 60;
  console.log(`  ⏰ 早安: ${String(mH).padStart(2,'0')}:${String(mM).padStart(2,'0')}`);
  cron.schedule(`${mM} ${mH} * * *`, () => {
    if (Math.random() < 0.9) sendProactiveMessage('morning', '早安问候');
  }, { timezone: tz });

  // 午餐 — 11:45-13:00
  const nMin = 45 + Math.floor(Math.random() * 75);
  console.log(`  ⏰ 午餐: ${String(11+Math.floor(nMin/60)).padStart(2,'0')}:${String(nMin%60).padStart(2,'0')}`);
  cron.schedule(`${nMin%60} ${11+Math.floor(nMin/60)} * * *`, () => {
    if (Math.random() < 0.8) sendProactiveMessage('noon', '午餐关心');
  }, { timezone: tz });

  // 傍晚 — 17:30-19:00
  const eMin = 30 + Math.floor(Math.random() * 90);
  console.log(`  ⏰ 傍晚: ${String(17+Math.floor(eMin/60)).padStart(2,'0')}:${String(eMin%60).padStart(2,'0')}`);
  cron.schedule(`${eMin%60} ${17+Math.floor(eMin/60)} * * *`, () => {
    if (Math.random() < 0.85) sendProactiveMessage('evening', '傍晚问候');
  }, { timezone: tz });

  // 晚安
  const nightM = Math.floor(Math.random() * Math.min(sleepM || 0, 45));
  console.log(`  ⏰ 晚安: ${String(sleepH).padStart(2,'0')}:${String(nightM).padStart(2,'0')}`);
  cron.schedule(`${nightM} ${sleepH} * * *`, () => {
    const last = db.messages.getLastUserMessage();
    if (last) {
      const mins = (Date.now() - new Date(last.created_at.replace(' ', 'T'))) / 60000;
      if (mins < 30) { console.log('  🌙 聊天中，跳过晚安'); return; }
    }
    if (Math.random() < 0.7) sendProactiveMessage('night', '晚安');
  }, { timezone: tz });
}

// ========== L2: 随机分享 ==========
let randomTimer = null;
function scheduleRandomShares() {
  console.log('  🎲 随机分享: 每30分钟检查（25-30%概率）');
  randomTimer = setInterval(async () => {
    const h = new Date().getHours();
    const sleepH = parseInt(db.config.get('sleep_time', '23:00').split(':')[0]);
    const wakeH = parseInt(db.config.get('wake_time', '08:30').split(':')[0]);
    if (h >= sleepH || h < wakeH) return;
    const inWindow = (h >= 10 && h < 12) || (h >= 14 && h < 17) || (h >= 20 && h < 22);
    if (!inWindow) return;
    if (Math.random() < (0.25 + Math.random() * 0.05)) {
      console.log('  🎲 随机分享触发');
      await sendProactiveMessage('random');
    }
  }, 30 * 60 * 1000);
}

// ========== L3: 情绪漂移 ==========
let moodTimer = null;
function scheduleMoodDrift() {
  console.log('  🎭 情绪漂流: 每2小时');
  moodTimer = setInterval(() => {
    const s = db.herState.get();
    if (!s) return;
    if (Math.random() < 0.4) {
      const moods = ['happy', 'neutral', 'playful', 'tired'];
      const other = moods.filter(m => m !== s.mood);
      const next = (s.energy < 30 && Math.random() < 0.5) ? 'tired' : other[Math.floor(Math.random() * other.length)];
      db.herState.update({ mood: next });
      console.log(`  🎭 心情: ${s.mood} → ${next}`);
    }
  }, 2 * 60 * 60 * 1000);
}

// ========== 启动/停止 ==========
function start() {
  console.log('\n📅 启动主动消息调度器...');
  scheduleGreetings();
  scheduleRandomShares();
  scheduleMoodDrift();
  console.log('✅ 调度器已启动\n');
  return () => {
    if (randomTimer) clearInterval(randomTimer);
    if (moodTimer) clearInterval(moodTimer);
  };
}

module.exports = { setPushService, start, sendProactiveMessage };
