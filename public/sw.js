/**
 * Service Worker
 * - 推送通知处理
 * - 离线缓存
 */

const CACHE_NAME = 'gf-cache-v1';
const CACHE_FILES = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
];

// ========== 安装 & 缓存 ==========
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CACHE_FILES);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
      );
    })
  );
  self.clients.claim();
});

// ========== 网络请求 (Cache First) ==========
self.addEventListener('fetch', (event) => {
  // 跳过 API 请求
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        // 缓存成功的 GET 请求
        if (event.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

// ========== 推送通知 ==========
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const options = {
      body: data.body || '',
      icon: data.icon || '/icon-192.png',
      badge: data.badge || '/icon-72.png',
      vibrate: data.vibrate || [200, 100, 200],
      tag: data.tag || 'gf-message',
      renotify: data.renotify || true,
      data: data.data || { url: '/' },
      actions: data.actions || [
        { action: 'open', title: '打开聊天' },
      ],
      requireInteraction: false,
      timestamp: Date.now(),
    };

    event.waitUntil(
      self.registration.showNotification(data.title || '💕 小七', options)
    );
  } catch (e) {
    // 纯文本消息
    event.waitUntil(
      self.registration.showNotification('💕 小七', {
        body: event.data.text(),
        icon: '/icon-192.png',
        vibrate: [200, 100, 200],
        tag: 'gf-message',
      })
    );
  }
});

// ========== 点击通知 ==========
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      // 如果已有打开的窗口，聚焦它
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // 否则打开新窗口
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});
