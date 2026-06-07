/**
 * 天气服务 — wttr.in（免费，无需 API Key）
 */

const https = require('https');

let cache = null;
let cacheTime = 0;
const TTL = 30 * 60 * 1000;

async function getWeatherSummary(city = 'Shanghai') {
  const now = Date.now();
  if (cache && (now - cacheTime) < TTL) return cache;
  try {
    const data = await fetchWeather(city);
    const summary = parseWeather(data);
    cache = summary; cacheTime = now;
    return summary;
  } catch (e) {
    console.log('  🌤️ 天气获取失败:', e.message);
    return cache;
  }
}

function fetchWeather(city) {
  return new Promise((resolve, reject) => {
    https.get(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, { timeout: 10000 }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
  });
}

function parseWeather(data) {
  const c = data?.current_condition?.[0];
  if (!c) return null;
  const map = {
    'Sunny': '晴天☀️', 'Clear': '晴朗🌙', 'Partly cloudy': '多云⛅',
    'Cloudy': '阴天☁️', 'Overcast': '阴天☁️', 'Mist': '薄雾🌫️', 'Fog': '有雾🌫️',
    'Light rain': '小雨🌧️', 'Light drizzle': '毛毛雨🌧️', 'Moderate rain': '中雨🌧️',
    'Heavy rain': '大雨🌧️', 'Light snow': '小雪❄️', 'Moderate snow': '中雪❄️',
    'Thunder': '雷阵雨⛈️', 'Patchy rain possible': '可能有雨🌧️',
    'Patchy light rain': '局部小雨🌧️',
  };
  return `${map[c.weatherDesc?.[0]?.value] || c.weatherDesc?.[0]?.value || '未知'}，${c.temp_C}°C`;
}

module.exports = { getWeatherSummary, fetchWeather };
