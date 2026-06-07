/**
 * SQLite 数据库层（sql.js — WebAssembly，零原生依赖）
 *
 * 从 JSON 文件存储升级为 SQLite，更适合云端部署。
 * API 保持向后兼容。
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'girlfriend.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db = null;
let saveTimer = null;
let _ready = false;

async function init() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    try {
      const buffer = fs.readFileSync(DB_PATH);
      db = new SQL.Database(buffer);
      console.log(`📂 数据库已加载: ${DB_PATH} (${buffer.length} bytes)`);
    } catch (e) {
      console.warn('⚠️ 数据库损坏，创建新库');
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA foreign_keys=ON');
  createTables();
  initDefaults();
  _ready = true;
  console.log('✅ 数据库就绪');
  return db;
}

function createTables() {
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL CHECK(role IN ('user','assistant')),
    content TEXT NOT NULL,
    topic TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS proactive_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger_type TEXT NOT NULL,
    topic_type TEXT,
    content TEXT NOT NULL,
    user_replied INTEGER DEFAULT 0,
    sent_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS her_state (
    id INTEGER PRIMARY KEY CHECK(id=1),
    mood TEXT DEFAULT 'neutral',
    energy INTEGER DEFAULT 80,
    last_active_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS sent_topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_type TEXT NOT NULL,
    sent_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);

  // 确保 her_state 有一行
  const r = db.exec('SELECT COUNT(*) as c FROM her_state');
  if ((r[0]?.values[0]?.[0] || 0) === 0) {
    db.run("INSERT INTO her_state (id) VALUES (1)");
  }

  autoSave();
}

function initDefaults() {
  const defs = {
    gf_name: process.env.GF_NAME || '小七',
    wake_time: process.env.GF_WAKE_TIME || '08:30',
    sleep_time: process.env.GF_SLEEP_TIME || '23:00',
    timezone: process.env.TZ || 'Asia/Shanghai',
  };
  for (const [k, v] of Object.entries(defs)) {
    if (!config.get(k)) config.set(k, v);
  }
}

// ========== 自动保存 ==========
function autoSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(), 500);
}

function save() {
  if (!db) return;
  try {
    fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  } catch (e) {
    console.error('❌ DB保存失败:', e.message);
  }
}

// ========== 查询辅助 ==========
function query(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    if (params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  } catch (e) {
    console.error('❌ 查询错误:', e.message, sql);
    return [];
  }
}

function run(sql, params = []) {
  try {
    db.run(sql, params);
    autoSave();
    const r = db.exec('SELECT last_insert_rowid()');
    return { lastInsertRowid: r[0]?.values[0]?.[0] || 0, changes: db.getRowsModified() };
  } catch (e) {
    console.error('❌ 执行错误:', e.message, sql);
    return { lastInsertRowid: 0, changes: 0 };
  }
}

function getOne(sql, params = []) {
  const rows = query(sql, params);
  return rows[0] || null;
}

// ========== 消息 ==========
const messages = {
  add(role, content, topic = null) {
    return run('INSERT INTO messages (role,content,topic) VALUES (?,?,?)', [role, content, topic]);
  },
  getRecent(limit = 50) {
    return query('SELECT * FROM messages ORDER BY id DESC LIMIT ?', [limit]).reverse();
  },
  getSince(sinceId) {
    return query('SELECT * FROM messages WHERE id > ? ORDER BY id', [sinceId]);
  },
  getLastUserMessage() {
    return getOne("SELECT * FROM messages WHERE role='user' ORDER BY id DESC LIMIT 1");
  },
  clear() {
    return run('DELETE FROM messages');
  },
  count() {
    return getOne('SELECT COUNT(*) as count FROM messages')?.count || 0;
  },
};

// ========== 主动消息 ==========
const proactive = {
  add(triggerType, content, topicType = null) {
    return run('INSERT INTO proactive_log (trigger_type,topic_type,content) VALUES (?,?,?)',
      [triggerType, topicType, content]);
  },
  getRecent(limit = 20) {
    return query('SELECT * FROM proactive_log ORDER BY id DESC LIMIT ?', [limit]).reverse();
  },
  markReplied(id) {
    return run('UPDATE proactive_log SET user_replied=1 WHERE id=?', [id]);
  },
  markLastReplied() {
    const r = getOne("SELECT id FROM proactive_log WHERE user_replied=0 ORDER BY id DESC LIMIT 1");
    return r ? proactive.markReplied(r.id) : { changes: 0 };
  },
  getUnrepliedCount() {
    return getOne("SELECT COUNT(*) as count FROM proactive_log WHERE user_replied=0 AND trigger_type='random'")?.count || 0;
  },
  getLastProactive() {
    return getOne('SELECT * FROM proactive_log ORDER BY id DESC LIMIT 1');
  },
  getTodayCount() {
    return getOne("SELECT COUNT(*) as count FROM proactive_log WHERE date(sent_at)=date('now','localtime')")?.count || 0;
  },
};

// ========== 记忆 ==========
const memories = {
  set(key, value) {
    if (memories.get(key)) {
      return run("UPDATE memories SET value=?, updated_at=datetime('now','localtime') WHERE key=?", [value, key]);
    }
    return run('INSERT INTO memories (key,value) VALUES (?,?)', [key, value]);
  },
  get(key) {
    const r = getOne('SELECT key,value FROM memories WHERE key=?', [key]);
    return r ? r.value : null;
  },
  getAll() {
    return query('SELECT key,value FROM memories ORDER BY key');
  },
  delete(key) {
    return run('DELETE FROM memories WHERE key=?', [key]);
  },
};

// ========== 她的状态 ==========
const herState = {
  get() {
    return getOne('SELECT mood,energy,last_active_at,updated_at FROM her_state WHERE id=1');
  },
  update(fields = {}) {
    const parts = []; const vals = [];
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'id') continue;
      parts.push(`${k}=?`); vals.push(v);
    }
    if (!parts.length) return;
    parts.push("updated_at=datetime('now','localtime')");
    return run(`UPDATE her_state SET ${parts.join(',')} WHERE id=1`, vals);
  },
  bumpEnergy(n = 5) {
    return run("UPDATE her_state SET energy=MIN(100,energy+?), updated_at=datetime('now','localtime') WHERE id=1", [n]);
  },
  drainEnergy(n = 10) {
    return run("UPDATE her_state SET energy=MAX(0,energy-?), updated_at=datetime('now','localtime') WHERE id=1", [n]);
  },
};

// ========== 话题去重 ==========
const sentTopics = {
  add(topicType) {
    return run('INSERT INTO sent_topics (topic_type) VALUES (?)', [topicType]);
  },
  wasSentRecently(topicType, hours = 24) {
    const r = getOne("SELECT COUNT(*) as c FROM sent_topics WHERE topic_type=? AND sent_at > datetime('now','localtime',?)",
      [topicType, `-${hours} hours`]);
    return (r?.c || 0) > 0;
  },
  cleanOld(days = 7) {
    return run("DELETE FROM sent_topics WHERE sent_at < datetime('now','localtime',?)", [`-${days} days`]);
  },
};

// ========== 推送订阅 ==========
const subscriptions = {
  add(endpoint, p256dh, auth) {
    const existing = getOne('SELECT id FROM push_subscriptions WHERE endpoint=?', [endpoint]);
    if (existing) {
      return run('UPDATE push_subscriptions SET p256dh=?, auth=? WHERE endpoint=?', [p256dh, auth, endpoint]);
    }
    return run('INSERT INTO push_subscriptions (endpoint,p256dh,auth) VALUES (?,?,?)', [endpoint, p256dh, auth]);
  },
  remove(endpoint) {
    return run('DELETE FROM push_subscriptions WHERE endpoint=?', [endpoint]);
  },
  getAll() {
    return query('SELECT endpoint,p256dh,auth FROM push_subscriptions');
  },
};

// ========== 配置 ==========
const config = {
  get(key, def = null) {
    const r = getOne('SELECT value FROM config WHERE key=?', [key]);
    return r ? r.value : def;
  },
  set(key, value) {
    if (config.get(key) !== null) {
      return run('UPDATE config SET value=? WHERE key=?', [String(value), key]);
    }
    return run('INSERT INTO config (key,value) VALUES (?,?)', [key, String(value)]);
  },
  getAll() {
    const rows = query('SELECT key,value FROM config');
    const o = {};
    for (const r of rows) o[r.key] = r.value;
    return o;
  },
};

// ========== 清空 & 关闭 ==========
function clearAll() {
  run('DELETE FROM messages');
  run('DELETE FROM memories');
  run('DELETE FROM proactive_log');
  run('DELETE FROM sent_topics');
  run("UPDATE her_state SET mood='neutral', energy=80");
  console.log('🗑️ 数据已清空');
}

function close() {
  if (saveTimer) { clearTimeout(saveTimer); save(); }
  if (db) { db.close(); db = null; }
}

module.exports = {
  init, save, close, run, clearAll, query, getOne,
  messages, proactive, memories, herState, sentTopics, subscriptions, config,
  DATA_DIR, DB_PATH,
};
