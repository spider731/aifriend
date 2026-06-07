/**
 * 对话记忆管理
 * - 短期记忆：最近 N 轮对话（滑动窗口）
 * - 长期记忆：从对话中提取重要信息存储
 */

const db = require('../store/db');

// 短期记忆窗口大小
const SHORT_TERM_WINDOW = 20;

/**
 * 获取短期记忆（最近的消息）
 */
function getShortTermMemory(limit = SHORT_TERM_WINDOW) {
  return db.messages.getRecent(limit);
}

/**
 * 获取长期记忆（存储的关键信息）
 */
function getLongTermMemory() {
  return db.memories.getAll();
}

/**
 * 格式化记忆用于 Prompt
 */
function formatMemoriesForPrompt() {
  const longTerm = getLongTermMemory();
  const shortTerm = getShortTermMemory();

  // 格式化最近的对话
  const recentChat = shortTerm.map(m =>
    `${m.role === 'user' ? '他' : db.config.get('gf_name', '小七')}: ${m.content}`
  ).join('\n');

  return {
    memories: longTerm,
    recentChat,
    recentMessages: shortTerm,
  };
}

/**
 * 尝试从用户消息中提取重要信息并存储
 * 这通过规则 + 关键词来简单实现（不需要额外 API 调用）
 */
function extractAndSaveMemory(userMessage) {
  const patterns = [
    // 工作相关
    { regex: /我是(?:做|搞|在)([^，。,.!！\n]{2,20})的/, key: 'user_job', format: '他的工作是$1' },
    { regex: /我在([^，。,.!！\n]{2,20})上班/, key: 'user_job', format: '他在$1上班' },
    // 喜好
    { regex: /我(?:喜欢|爱吃|爱喝)([^，。,.!！\n]{1,10})/, key: 'user_likes', format: '他喜欢$1' },
    { regex: /我(?:不喜欢|讨厌|不吃)([^，。,.!！\n]{1,10})/, key: 'user_dislikes', format: '他不喜欢$1' },
    // 生日
    { regex: /我(?:生日|的生日)(?:是|在)?(\d{1,2}[月\-]\d{1,2})/, key: 'user_birthday', format: '他生日是$1' },
    // 名字
    { regex: /我叫([^\s，。,.!！\n]{2,4})/, key: 'user_name', format: '他的名字是$1' },
    // 地点
    { regex: /我在([^，。,.!！\n]{2,10})[城市省]/, key: 'user_location', format: '他在$1' },
    // 最近在忙什么
    { regex: /(?:最近|我)(?:在)?(?:忙|加班|做项目|备考)([^，。,.!！\n]{1,20})/, key: 'user_busy', format: '他最近在忙$1' },
  ];

  for (const { regex, key, format } of patterns) {
    const match = userMessage.match(regex);
    if (match) {
      const value = format.replace('$1', match[1]);
      // 检查是否已有相同记忆
      const existing = db.memories.get(key);
      if (!existing || existing !== value) {
        db.memories.set(key, value);
        console.log(`  🧠 记住: ${value}`);
      }
    }
  }
}

/**
 * 获取未回复的主动消息数量（用于退避判断）
 */
function getUnrepliedCount() {
  return db.proactive.getUnrepliedCount();
}

module.exports = {
  getShortTermMemory,
  getLongTermMemory,
  formatMemoriesForPrompt,
  extractAndSaveMemory,
  getUnrepliedCount,
};
