/**
 * Web Push 推送服务
 * VAPID 密钥优先从环境变量读取，否则自动生成
 */

const webpush = require('web-push');
const db = require('../store/db');

let vapidKeys = null;
let gfName = '小七';

function init() {
  gfName = db.config.get('gf_name', '小七');

  const envPub = process.env.VAPID_PUBLIC_KEY;
  const envPriv = process.env.VAPID_PRIVATE_KEY;

  if (envPub && envPriv) {
    vapidKeys = { publicKey: envPub, privateKey: envPriv };
    console.log('  🔑 VAPID: 从环境变量加载');
  } else {
    // 尝试从数据库读取
    const dbPub = db.config.get('vapid_public_key');
    const dbPriv = db.config.get('vapid_private_key');
    if (dbPub && dbPriv) {
      vapidKeys = { publicKey: dbPub, privateKey: dbPriv };
      console.log('  🔑 VAPID: 从数据库加载');
    } else {
      // 生成新的
      vapidKeys = webpush.generateVAPIDKeys();
      db.config.set('vapid_public_key', vapidKeys.publicKey);
      db.config.set('vapid_private_key', vapidKeys.privateKey);
      console.log('  🔑 VAPID: 已生成新密钥（已保存到数据库）');
    }
  }

  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
  webpush.setVapidDetails(subject, vapidKeys.publicKey, vapidKeys.privateKey);
  console.log('  ✅ Web Push 已初始化');
}

async function sendAll(title, body) {
  const subs = db.subscriptions.getAll();
  if (subs.length === 0) {
    console.log('  📭 无推送订阅');
    return;
  }

  const results = await Promise.allSettled(
    subs.map(sub => {
      const subscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      return webpush.sendNotification(subscription, JSON.stringify({
        title, body,
        icon: '/icon-192.png',
        badge: '/icon-72.png',
        data: { url: '/' },
        actions: [{ action: 'open', title: '打开聊天' }],
        vibrate: [200, 100, 200],
        tag: 'gf-message',
        renotify: true,
      })).catch(err => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          db.subscriptions.remove(sub.endpoint);
        }
        throw err;
      });
    })
  );

  const ok = results.filter(r => r.status === 'fulfilled').length;
  console.log(`  📤 推送: ${ok}/${subs.length}`);
}

function getPublicKey() {
  return vapidKeys ? vapidKeys.publicKey : '';
}

module.exports = { init, sendAll, getPublicKey };
