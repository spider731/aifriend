/**
 * AI 电子女友 — 前端聊天逻辑
 */

// ========== 全局状态 ==========
const state = {
  messages: [],
  isLoading: false,
  pushEnabled: false,
  swRegistration: null,
  installPrompt: null,
};

// ========== DOM 元素 ==========
const $ = (sel) => document.querySelector(sel);
const messagesEl = $('#messages');
const inputEl = $('#input');
const btnSend = $('#btn-send');
const typingEl = $('#typing-indicator');
const settingsOverlay = $('#settings-overlay');
const pushStatus = $('#push-status');
const apiStatus = $('#api-status');

// ========== 初始化 ==========
async function init() {
  loadMessages();
  setupEventListeners();
  checkApiConfig();
  checkHerState();
  registerSW();
  checkInstallable();

  // 滚动到底部
  scrollToBottom();

  // 聚焦输入框
  setTimeout(() => inputEl.focus(), 500);
}

// ========== 检查她的状态 ==========
async function checkHerState() {
  try {
    const res = await fetch('/api/state');
    const data = await res.json();
    if (data.name) {
      $('#header-name').textContent = data.name + ' 💕';
    }
    if (data.mood) {
      const statusMap = {
        happy: '心情很好 ✨',
        neutral: '在线',
        sad: '有点低落 😢',
        playful: '想逗你玩 😝',
        tired: '有点累了 💤',
      };
      const statusEl = $('#header-status');
      statusEl.textContent = statusMap[data.mood] || '在线';
      if (data.mood === 'tired' || data.mood === 'sad') {
        statusEl.style.color = '#e74c3c';
      } else {
        statusEl.style.color = '#07c160';
      }
    }
    // 每5分钟刷新一次状态
    setTimeout(checkHerState, 5 * 60 * 1000);
  } catch (e) {
    // ignore
  }
}

// ========== 加载历史消息 ==========
async function loadMessages() {
  try {
    const res = await fetch('/api/messages?limit=50');
    const data = await res.json();
    state.messages = data.messages || [];
    renderMessages();
  } catch (e) {
    console.error('加载消息失败:', e);
  }
}

// ========== 渲染消息 ==========
function renderMessages() {
  messagesEl.innerHTML = '';

  if (state.messages.length === 0) {
    messagesEl.innerHTML = `
      <div style="text-align:center; color:#999; padding:60px 20px;">
        <div style="font-size:48px; margin-bottom:16px;">💕</div>
        <div style="font-size:16px;">你们的故事从这里开始~</div>
        <div style="font-size:13px; margin-top:8px;">发一条消息，她会回复你的</div>
      </div>
    `;
    return;
  }

  let lastDate = '';
  state.messages.forEach((msg, i) => {
    // 时间分隔
    const msgDate = (msg.created_at || '').substring(0, 10);
    if (msgDate && msgDate !== lastDate) {
      lastDate = msgDate;
      const div = document.createElement('div');
      div.className = 'time-divider';
      div.textContent = formatDate(msg.created_at);
      messagesEl.appendChild(div);
    }

    const row = document.createElement('div');
    row.className = `message-row ${msg.role === 'user' ? 'me' : 'her'}`;
    row.innerHTML = `
      <div class="message-avatar">${msg.role === 'user' ? '🙋' : '👧'}</div>
      <div class="message-bubble">${escapeHtml(msg.content)}</div>
    `;
    messagesEl.appendChild(row);
  });

  scrollToBottom();
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);

  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const month = d.getMonth() + 1;
  const day = d.getDate();

  if (diffDays === 0) return time;
  if (diffDays === 1) return `昨天 ${time}`;
  if (diffDays < 7) return `${diffDays}天前 ${time}`;
  return `${month}月${day}日 ${time}`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function scrollToBottom() {
  setTimeout(() => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }, 100);
}

// ========== 发送消息 ==========
async function sendMessage() {
  const message = inputEl.value.trim();
  if (!message || state.isLoading) return;

  inputEl.value = '';
  state.isLoading = true;
  btnSend.disabled = true;

  // 显示用户消息
  addMessageLocal('user', message);
  showTyping(true);

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || '请求失败');
    }

    const data = await res.json();
    addMessageLocal('assistant', data.reply);

    // 如果有推送通知，可能收到通知
    if (state.pushEnabled && document.hidden) {
      // 页面在后台，Service Worker 会处理通知
    }
  } catch (error) {
    addMessageLocal('assistant', `唔…好像出了点问题 (｡•́︿•̀｡)\n${error.message}`);
  } finally {
    showTyping(false);
    state.isLoading = false;
    btnSend.disabled = false;
    inputEl.focus();
  }
}

function addMessageLocal(role, content) {
  const msg = { role, content, created_at: new Date().toISOString() };
  state.messages.push(msg);
  renderMessages();
}

function showTyping(show) {
  typingEl.style.display = show ? 'block' : 'none';
  scrollToBottom();
}

// ========== Service Worker + 推送 ==========
async function registerSW() {
  if (!('serviceWorker' in navigator)) {
    console.log('⚠️ 浏览器不支持 Service Worker');
    return;
  }

  try {
    state.swRegistration = await navigator.serviceWorker.register('/sw.js');
    console.log('✅ Service Worker 已注册');

    // 检查是否已订阅推送
    const subscription = await state.swRegistration.pushManager.getSubscription();
    if (subscription) {
      state.pushEnabled = true;
      updatePushUI();
    }
  } catch (e) {
    console.error('Service Worker 注册失败:', e);
  }
}

async function togglePush() {
  if (state.pushEnabled) {
    // 取消订阅
    const subscription = await state.swRegistration.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
      await fetch('/api/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
    }
    state.pushEnabled = false;
    updatePushUI();
    return;
  }

  // 订阅推送
  try {
    // 获取 VAPID 公钥
    const res = await fetch('/api/vapid-public-key');
    const { publicKey } = await res.json();

    if (!publicKey) {
      alert('推送服务未配置，请在服务器端生成 VAPID 密钥');
      return;
    }

    const subscription = await state.swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    // 发送订阅到服务器
    await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription.toJSON ? subscription.toJSON() : subscription),
    });

    state.pushEnabled = true;
    updatePushUI();
  } catch (e) {
    console.error('推送订阅失败:', e);
    alert('无法开启通知: ' + e.message);
  }
}

function updatePushUI() {
  if (state.pushEnabled) {
    pushStatus.textContent = '已开启';
    pushStatus.className = 'badge badge-on';
    $('#btn-push-toggle').textContent = '关闭通知';
  } else {
    pushStatus.textContent = '未开启';
    pushStatus.className = 'badge badge-off';
    $('#btn-push-toggle').textContent = '开启通知';
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// ========== 检查 API 配置 ==========
async function checkApiConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    if (data.config?.claude?.apiKey && !data.config.claude.apiKey.includes('YOUR_')) {
      apiStatus.textContent = '已配置';
      apiStatus.className = 'badge badge-on';
    }
  } catch (e) {
    // 忽略
  }
}

// ========== PWA 安装 ==========
function checkInstallable() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.installPrompt = e;
    $('#btn-install').style.display = 'block';
    $('#install-banner').style.display = 'block';
  });

  // 检测是否已安装
  if (window.matchMedia('(display-mode: standalone)').matches) {
    $('#install-banner').style.display = 'none';
  }
}

async function installApp() {
  if (!state.installPrompt) {
    alert('长按浏览器菜单 → 点击"添加到主屏幕"');
    return;
  }
  state.installPrompt.prompt();
  const result = await state.installPrompt.userChoice;
  if (result.outcome === 'accepted') {
    $('#install-banner').style.display = 'none';
  }
}

// ========== 事件监听 ==========
function setupEventListeners() {
  // 发送
  btnSend.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // 设置面板
  $('#btn-menu').addEventListener('click', () => {
    settingsOverlay.style.display = 'block';
  });
  $('#btn-close-settings').addEventListener('click', () => {
    settingsOverlay.style.display = 'none';
  });
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) {
      settingsOverlay.style.display = 'none';
    }
  });

  // 推送开关
  $('#btn-push-toggle').addEventListener('click', togglePush);

  // 清空聊天
  $('#btn-clear-chat').addEventListener('click', async () => {
    if (confirm('确定要清空所有聊天记录吗？')) {
      await fetch('/api/clear', { method: 'POST' });
      state.messages = [];
      renderMessages();
      settingsOverlay.style.display = 'none';
    }
  });

  // 安装
  $('#btn-install').addEventListener('click', installApp);
  $('#btn-show-install').addEventListener('click', installApp);
  $('#btn-dismiss-banner').addEventListener('click', () => {
    $('#install-banner').style.display = 'none';
  });

  // 消息轮询（每30秒检查新消息）
  setInterval(checkNewMessages, 30000);
}

async function checkNewMessages() {
  if (state.messages.length === 0) return;
  const lastId = state.messages[state.messages.length - 1]?.id || 0;
  try {
    const res = await fetch(`/api/messages?limit=5`);
    const data = await res.json();
    const newMsgs = (data.messages || []).filter(m => m.id > lastId);
    if (newMsgs.length > 0) {
      state.messages = [...state.messages, ...newMsgs];
      renderMessages();
    }
  } catch (e) {
    // 忽略轮询错误
  }
}

// ========== 启动 ==========
document.addEventListener('DOMContentLoaded', init);
