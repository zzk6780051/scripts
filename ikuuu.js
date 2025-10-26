const { appendFileSync, mkdirSync, existsSync } = require("fs");
const { join } = require("path");

const DEFAULT_CONFIG = {
  DOMAIN: '',
  ACCOUNTS: [],
  TG_BOT_TOKEN: '',
  TG_CHAT_ID: '',
  QYWX_WEBHOOK: '',
  WECOM_CORPID: '',
  WECOM_AGENT_ID: '',
  WECOM_SECRET: '',
  WECOM_TO_USER: '@all',
  MAX_RETRY: 3,
  ENABLE_HISTORY: true,
  // GitHub 配置 - 使用 IKUUU_GH_ 前缀避免冲突
  GH_TOKEN: '',
  GH_REPO: '',
  GH_BRANCH: 'main'
};

let config = { ...DEFAULT_CONFIG };

// 历史记录功能
class HistoryLogger {
  constructor() {
    this.historyDir = join(__dirname, 'history');
    this.ensureHistoryDir();
  }
  
  // 确保历史目录存在
  ensureHistoryDir() {
    if (!existsSync(this.historyDir)) {
      try {
        mkdirSync(this.historyDir, { recursive: true });
        console.log(`✅ 创建历史记录目录: ${this.historyDir}`);
      } catch (error) {
        console.log(`❌ 创建历史记录目录失败: ${error.message}`);
      }
    }
  }
  
  // 获取用户目录路径
  getUserDir(email) {
    const safeName = email.replace(/[@.]/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
    return join(this.historyDir, safeName);
  }
  
  // 确保用户目录存在
  ensureUserDir(email) {
    const userDir = this.getUserDir(email);
    if (!existsSync(userDir)) {
      try {
        mkdirSync(userDir, { recursive: true });
      } catch (error) {
        console.log(`❌ 创建用户历史目录失败: ${error.message}`);
        return false;
      }
    }
    return true;
  }
  
  // 记录签到历史
  logCheckin(account, result, isSuccess) {
    if (!config.ENABLE_HISTORY) return;
    
    try {
      if (!this.ensureUserDir(account.email)) return;
      
      const userDir = this.getUserDir(account.email);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const date = new Date().toISOString().split('T')[0];
      const logFile = join(userDir, `${date}.log`);
      
      const status = isSuccess ? 'SUCCESS' : 'FAILED';
      const logEntry = `[${new Date().toLocaleString('zh-CN')}] ${status} - ${result}\n`;
      
      appendFileSync(logFile, logEntry, 'utf8');
      console.log(`📝 已记录 ${account.name} 的签到历史`);
      
      // 同时记录到月统计文件
      this.logMonthlyStats(account, date, isSuccess);
      
    } catch (error) {
      console.log(`❌ 记录历史失败: ${error.message}`);
    }
  }
  
  // 记录月统计
  logMonthlyStats(account, date, isSuccess) {
    try {
      const userDir = this.getUserDir(account.email);
      const yearMonth = date.substring(0, 7);
      const statsFile = join(userDir, `${yearMonth}_stats.json`);
      
      let stats = { total: 0, success: 0, failed: 0, dates: {} };
      
      // 读取现有统计
      if (existsSync(statsFile)) {
        try {
          const fs = require('fs');
          const data = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
          stats = data;
        } catch (e) {
          console.log(`⚠️ 统计文件损坏，重新创建: ${e.message}`);
        }
      }
      
      // 更新统计
      stats.total++;
      if (isSuccess) {
        stats.success++;
      } else {
        stats.failed++;
      }
      
      // 记录日期状态
      if (!stats.dates[date]) {
        stats.dates[date] = { success: 0, failed: 0 };
      }
      
      if (isSuccess) {
        stats.dates[date].success++;
      } else {
        stats.dates[date].failed++;
      }
      
      // 保存统计
      const fs = require('fs');
      fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2), 'utf8');
      
    } catch (error) {
      console.log(`❌ 记录月统计失败: ${error.message}`);
    }
  }
  
  // 获取用户签到统计
  getUserStats(email) {
    try {
      const userDir = this.getUserDir(email);
      const currentDate = new Date().toISOString().split('T')[0];
      const yearMonth = currentDate.substring(0, 7);
      const statsFile = join(userDir, `${yearMonth}_stats.json`);
      
      if (existsSync(statsFile)) {
        const fs = require('fs');
        const stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
        return stats;
      }
    } catch (error) {
      console.log(`⚠️ 获取用户统计失败: ${error.message}`);
    }
    return { total: 0, success: 0, failed: 0 };
  }
  
  // 生成历史报告
  generateHistoryReport(accounts, results) {
    if (!config.ENABLE_HISTORY) return '';
    
    let report = '\n📊 本月签到统计:\n';
    
    accounts.forEach((account, index) => {
      const stats = this.getUserStats(account.email);
      const successRate = stats.total > 0 ? ((stats.success / stats.total) * 100).toFixed(1) : 0;
      
      const displayName = account.email.split('@')[0] + '_' + account.email.split('@')[1].split('.')[0];
      
      report += `\n${displayName}:\n`;
      report += `  ✅ 成功: ${stats.success}次\n`;
      report += `  📈 成功率: ${successRate}%\n`;
      report += `  📋 总计: ${stats.total}次\n`;
    });
    
    return report;
  }
}

// GitHub 通知更新功能
class GitHubNotifier {
  constructor() {
    this.baseUrl = 'https://api.github.com';
  }
  
  // 获取 data.json 文件的 SHA
  async getFileSha() {
    try {
      const url = `${this.baseUrl}/repos/${config.GH_REPO}/contents/data.json`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `token ${config.GH_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`获取文件信息失败: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      return data.sha;
    } catch (error) {
      console.log(`❌ 获取文件 SHA 失败: ${error.message}`);
      throw error;
    }
  }
  
  // 简化消息内容
  simplifyMessage(result) {
    if (result.success) {
      if (result.message && result.message.includes('重复签到')) {
        return '重复签到';
      }
      const trafficMatch = result.message.match(/获得了\s*([\d.]+\s*[GMK]B)/);
      if (trafficMatch) {
        return `获得 ${trafficMatch[1]}`;
      }
      return '签到成功';
    } else {
      return '签到失败';
    }
  }
  
  // 更新 GitHub 通知
  async updateGitHubNotification(results) {
    if (!config.GH_TOKEN || !config.GH_REPO) {
      console.log('⚠️ GitHub 配置不完整，跳过更新通知');
      return;
    }
    
    try {
      console.log('🔄 开始更新 GitHub 通知...');
      
      const url = `${this.baseUrl}/repos/${config.GH_REPO}/contents/data.json`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `token ${config.GH_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`获取 data.json 失败: ${response.status} ${response.statusText}`);
      }
      
      const fileData = await response.json();
      const content = Buffer.from(fileData.content, 'base64').toString('utf8');
      const jsonData = JSON.parse(content);
      
      const timeString = new Date().toLocaleString('zh-CN', { 
        timeZone: 'Asia/Shanghai',
        hour12: false 
      });
      
      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;
      
      const simplifiedResults = results.map(result => ({
        ...result,
        simplifiedMessage: this.simplifyMessage(result)
      }));
      
      const resultLines = simplifiedResults.map(result => {
        const icon = result.success ? '✅' : '❌';
        return `${icon} ${result.displayName}: ${result.simplifiedMessage}`;
      }).join('<br>');
      
      const newNotification = {
        id: 2,
        title: "ikuuu 签到状态",
        content: `签到状态更新 - ${timeString}<br><br>✅ 成功: ${successCount}个账号<br>❌ 失败: ${failCount}个账号<br><br>详细结果:<br>${resultLines}`,
        date: new Date().toISOString()
      };
      
      const notificationIndex = jsonData.notifications.findIndex(n => n.id === 2);
      if (notificationIndex !== -1) {
        jsonData.notifications[notificationIndex] = newNotification;
      } else {
        jsonData.notifications.push(newNotification);
      }
      
      jsonData.notifications.sort((a, b) => new Date(b.date) - new Date(a.date));
      
      const updateResponse = await fetch(url, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${config.GH_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: `更新 ikuuu 签到状态 - ${timeString}`,
          content: Buffer.from(JSON.stringify(jsonData, null, 2)).toString('base64'),
          sha: fileData.sha,
          branch: config.GH_BRANCH
        })
      });
      
      if (!updateResponse.ok) {
        const errorData = await updateResponse.json();
        throw new Error(`更新文件失败: ${updateResponse.status} - ${errorData.message}`);
      }
      
      console.log('✅ GitHub 通知更新成功');
      
    } catch (error) {
      console.log(`❌ 更新 GitHub 通知失败: ${error.message}`);
      throw error;
    }
  }
}

// 创建历史记录器和 GitHub 通知器实例
const historyLogger = new HistoryLogger();
const githubNotifier = new GitHubNotifier();

// 初始化配置 - 完全从环境变量读取
function initializeConfig() {
  const env = process.env;
  
  // 账户配置解析
  let accounts = [];
  const accountsEnv = env.IKUUU_ACCOUNTS;
  if (accountsEnv) {
    try {
      accounts = JSON.parse(accountsEnv);
      console.log(`✅ 从环境变量解析 ${accounts.length} 个账户`);
    } catch (e) {
      console.log(`❌ 账户信息格式错误: ${e.message}`);
      console.log('💡 请检查 IKUUU_ACCOUNTS 的 JSON 格式');
    }
  } else {
    console.log('❌ 未找到 IKUUU_ACCOUNTS 环境变量');
  }
  
  config = {
    DOMAIN: env.IKUUU_DOMAIN || 'ikuuu.eu',
    ACCOUNTS: accounts,
    TG_BOT_TOKEN: env.IKUUU_TG_BOT_TOKEN || env.TG_BOT_TOKEN,
    TG_CHAT_ID: env.IKUUU_TG_CHAT_ID || env.TG_CHAT_ID,
    QYWX_WEBHOOK: env.IKUUU_QYWX_WEBHOOK || env.QYWX_WEBHOOK,
    WECOM_CORPID: env.IKUUU_WECOM_CORPID || env.WECOM_CORPID,
    WECOM_AGENT_ID: env.IKUUU_WECOM_AGENT_ID || env.WECOM_AGENT_ID,
    WECOM_SECRET: env.IKUUU_WECOM_SECRET || env.WECOM_SECRET,
    WECOM_TO_USER: env.IKUUU_WECOM_TO_USER || env.WECOM_TO_USER || '@all',
    MAX_RETRY: parseInt(env.IKUUU_MAX_RETRY || env.MAX_RETRY || '3'),
    ENABLE_HISTORY: env.IKUUU_ENABLE_HISTORY !== 'false',
    // GitHub 配置 - 使用 IKUUU_GH_ 前缀
    GH_TOKEN: env.IKUUU_GH_TOKEN || env.GH_TOKEN,
    GH_REPO: env.IKUUU_GH_REPO || env.GH_REPO,
    GH_BRANCH: env.IKUUU_GH_BRANCH || env.GH_BRANCH || 'main'
  };

  console.log('✅ 配置初始化完成');
  console.log(`🌐 域名: ${config.DOMAIN}`);
  console.log(`👥 账户数: ${config.ACCOUNTS.length}`);
  console.log(`🔄 最大重试: ${config.MAX_RETRY}`);
  console.log(`📚 历史记录: ${config.ENABLE_HISTORY ? '启用' : '禁用'}`);
  console.log(`🐙 GitHub 通知: ${config.GH_TOKEN && config.GH_REPO ? '启用' : '禁用'}`);
}

// 主签到函数
async function checkAllAccounts() {
  if (!config.ACCOUNTS.length) {
    throw new Error('未配置有效的签到账户');
  }

  console.log(`\n🚀 开始处理 ${config.ACCOUNTS.length} 个账户的签到...`);
  
  const results = [];
  for (const account of config.ACCOUNTS) {
    try {
      console.log(`\n🔍 正在处理: ${account.name} (${maskString(account.email)})`);
      const result = await withRetry(() => checkin(account), config.MAX_RETRY);
      
      const displayName = account.email.split('@')[0] + '_' + account.email.split('@')[1].split('.')[0];
      
      let simplifiedMessage;
      if (result.includes('重复签到')) {
        simplifiedMessage = '重复签到';
      } else {
        const trafficMatch = result.match(/获得了\s*([\d.]+\s*[GMK]B)/);
        simplifiedMessage = trafficMatch ? `获得 ${trafficMatch[1]}` : '签到成功';
      }
      
      results.push({success: true, displayName, message: result, simplifiedMessage});
      console.log(`✅ ${account.name} 签到成功: ${simplifiedMessage}`);
      
      historyLogger.logCheckin(account, result, true);
    } catch (error) {
      const displayName = account.email.split('@')[0] + '_' + account.email.split('@')[1].split('.')[0];
      results.push({success: false, displayName, message: error.message, simplifiedMessage: '签到失败'});
      console.log(`❌ ${account.name} 签到失败: ${error.message}`);
      
      historyLogger.logCheckin(account, error.message, false);
    }
  }
  return results;
}

// 单个账户签到流程
async function checkin(account) {
  // 登录
  const loginResponse = await fetch(`https://${config.DOMAIN}/auth/login`, {
    method: 'POST',
    headers: createHeaders('login'),
    body: JSON.stringify({ 
      email: account.email, 
      passwd: account.passwd,
      code: "",
      remember_me: "on"
    })
  });
  
  if (!loginResponse.ok) {
    throw new Error(`登录请求失败: ${loginResponse.status}`);
  }
  
  const loginResult = await loginResponse.json();
  
  if (loginResult.ret !== 1) {
    throw new Error(`登录失败: ${loginResult.msg}`);
  }
  
  // 获取Cookie
  const rawCookieArray = loginResponse.headers.get('set-cookie')?.split(',') || [];
  const cookies = formatCookie(rawCookieArray);
  
  if (!cookies) {
    throw new Error('获取Cookie失败');
  }
  
  // 等待后签到
  await delay(1000);
  
  const checkinResponse = await fetch(`https://${config.DOMAIN}/user/checkin`, {
    method: 'POST',
    headers: { 
      ...createHeaders('checkin'), 
      Cookie: cookies 
    }
  });
  
  if (!checkinResponse.ok) {
    throw new Error(`签到请求失败: ${checkinResponse.status}`);
  }
  
  const checkinResult = await checkinResponse.json();
  
  // 修改：将重复签到视为成功
  if (checkinResult.ret !== 1) {
    if (checkinResult.msg && 
        (checkinResult.msg.includes('已经') || 
         checkinResult.msg.includes('重复') || 
         checkinResult.msg.includes('already'))) {
      return `重复签到：${checkinResult.msg}`;
    } else {
      throw new Error(`签到失败: ${checkinResult.msg}`);
    }
  }
  
  return checkinResult.msg;
}

// 格式化 Cookie
function formatCookie(rawCookieArray) {
  const cookiePairs = new Map();
  for (const cookieString of rawCookieArray) {
    const match = cookieString.match(/^\s*([^=]+)=([^;]*)/);
    if (match) {
      cookiePairs.set(match[1].trim(), match[2].trim());
    }
  }
  return Array.from(cookiePairs)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

// 统一通知函数
async function sendNotifications(results) {
  const timeString = new Date().toLocaleString('zh-CN', { 
    timeZone: 'Asia/Shanghai',
    hour12: false 
  });

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  
  let resultLines = results.map(result => {
    const icon = result.success ? '✅' : '❌';
    return `${icon} ${result.displayName.padEnd(20, ' ')}：${result.simplifiedMessage}`;
  }).join('\n');

  let fullMessage = `📋 ikuuu签到\n` +
                   `⏰ 执行时间: ${timeString}\n\n` +
                   `${resultLines}`;

  // 添加历史统计报告
  if (config.ENABLE_HISTORY) {
    const historyReport = historyLogger.generateHistoryReport(config.ACCOUNTS, results);
    fullMessage += historyReport;
  }

  console.log('\n📤 发送通知消息...');
  
  // 并行发送通知
  await Promise.allSettled([
    sendTelegramNotification(fullMessage),
    sendWechatWorkNotification(fullMessage),
    githubNotifier.updateGitHubNotification(results)
  ]);
}

// Telegram通知
async function sendTelegramNotification(message) {
  if (!config.TG_BOT_TOKEN || !config.TG_CHAT_ID) {
    console.log('⚠️ Telegram配置不完整，跳过通知');
    return;
  }

  const payload = {
    chat_id: config.TG_CHAT_ID,
    text: message,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };

  const telegramAPI = `https://api.telegram.org/bot${config.TG_BOT_TOKEN}/sendMessage`;
  
  try {
    const response = await fetch(telegramAPI, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (response.ok) {
      console.log('✅ Telegram通知发送成功');
    } else {
      const errorText = await response.text();
      console.log(`❌ Telegram通知发送失败: ${errorText}`);
    }
  } catch (error) {
    console.log(`❌ Telegram通知异常: ${error.message}`);
  }
}

// 企业微信通知
async function sendWechatWorkNotification(message) {
  if (config.QYWX_WEBHOOK) {
    await sendWecomBotNotification(message);
  }
  else if (config.WECOM_CORPID && config.WECOM_AGENT_ID && config.WECOM_SECRET) {
    await sendWecomAppNotification(message);
  } else {
    console.log('⚠️ 企业微信配置不完整，跳过通知');
  }
}

// 企业微信机器人通知
async function sendWecomBotNotification(message) {
  const msgData = {
    msgtype: "text",
    text: {
      content: message
    }
  };

  try {
    const response = await fetch(config.QYWX_WEBHOOK, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(msgData),
    });

    if (response.ok) {
      console.log("✅ 企业微信机器人通知发送成功");
    } else {
      console.log(`❌ 企业微信机器人通知发送失败: ${response.status}`);
    }
  } catch (error) {
    console.log(`❌ 企业微信机器人通知发送错误: ${error.message}`);
  }
}

// 企业微信应用通知
async function sendWecomAppNotification(message) {
  try {
    const tokenUrl = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${config.WECOM_CORPID}&corpsecret=${config.WECOM_SECRET}`;
    const tokenResponse = await fetch(tokenUrl);
    const tokenData = await tokenResponse.json();
    
    if (tokenData.errcode !== 0) {
      console.error('❌ 获取企业微信Token失败:', tokenData.errmsg);
      return;
    }

    const accessToken = tokenData.access_token;

    const messageUrl = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`;
    const payload = {
      touser: config.WECOM_TO_USER,
      msgtype: "text",
      agentid: config.WECOM_AGENT_ID,
      text: {
        content: message
      },
      safe: 0
    };

    const msgResponse = await fetch(messageUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await msgResponse.json();
    if (result.errcode === 0) {
      console.log('✅ 企业微信应用通知发送成功');
    } else {
      console.error('❌ 企业微信应用通知失败:', result.errmsg);
    }
  } catch (error) {
    console.error('❌ 企业微信应用通知异常:', error);
  }
}

// 工具函数
function maskString(str, visibleStart = 2, visibleEnd = 2) {
  if (!str) return '';
  if (str.length <= visibleStart + visibleEnd) return str;
  return `${str.substring(0, visibleStart)}****${str.substring(str.length - visibleEnd)}`;
}

function createHeaders(type = 'default') {
  const common = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Origin': `https://${config.DOMAIN}`
  };

  const headers = {
    login: { 
      ...common, 
      'Content-Type': 'application/json', 
      'Referer': `https://${config.DOMAIN}/auth/login` 
    },
    checkin: { 
      ...common, 
      'Referer': `https://${config.DOMAIN}/user/panel`, 
      'X-Requested-With': 'XMLHttpRequest' 
    }
  };

  return headers[type] || common;
}

async function withRetry(fn, retries) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;
      console.log(`🔄 第${i + 1}次尝试失败，${retries - i - 1}次重试机会`);
      await delay(2000 * (i + 1));
    }
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 主函数
async function main() {
  console.log('🚀 开始 ikuuu 签到任务...');
  console.log('========================================\n');
  
  try {
    // 初始化配置
    initializeConfig();
    
    if (!config.ACCOUNTS.length) {
      throw new Error('未配置有效的账户信息，请设置 IKUUU_ACCOUNTS 环境变量');
    }
    
    // 执行签到
    const results = await checkAllAccounts();
    
    // 发送通知
    await sendNotifications(results);
    
    // 统计结果
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    
    console.log('\n========================================');
    console.log('✅ 签到任务完成！');
    console.log(`✅ 成功: ${successCount}个`);
    console.log(`❌ 失败: ${failCount}个`);
    
    // 显示历史目录信息
    if (config.ENABLE_HISTORY) {
      console.log(`📁 历史记录: ${historyLogger.historyDir}`);
    }
    
    console.log('========================================\n');
    
    // 如果有失败，退出码为1
    if (failCount > 0) {
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n❌ 任务执行失败:', error.message);
    
    // 发送错误通知
    const errorMessage = `❌ ikuuu 签到任务失败\n\n错误信息: ${error.message}`;
    await Promise.allSettled([
      sendTelegramNotification(errorMessage),
      sendWechatWorkNotification(errorMessage)
    ]);
    
    process.exit(1);
  }
}

// 执行主函数
if (require.main === module) {
  main().catch(error => {
    console.error('❌ 未捕获的错误:', error);
    process.exit(1);
  });
}

module.exports = { main, historyLogger, githubNotifier };