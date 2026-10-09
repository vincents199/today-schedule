/**
 * 云函数 reminders - 双重提醒
 *
 * 提醒1：每晚20:00 → 明天日程汇总（一条消息）
 * 提醒2：每个日程开始前1小时 → 单独提醒
 *
 * actions:
 *   enable       - 开启自动提醒
 *   disable      - 关闭自动提醒
 *   checkStatus  - 查询是否开启
 *   checkAndSend - 定时触发器调用
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const http = require('http');
const https = require('https');

const APPID = 'wx5f051a32a828f581';
const APPSECRET = '7161e862b517a91a89e7e92be5c6b111';
const REMIND_TEMPLATE_ID = 'd9Nmor71fyxwHSfxTzBgH_-53T58VJaSMDGYDBb26gk';

function httpGet(url) {
  return new Promise(function (resolve, reject) {
    https.get(url, function (res) {
      var data = '';
      res.on('data', function (chunk) { data += chunk; });
      res.on('end', function () {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function httpPost(url, body) {
  return new Promise(function (resolve, reject) {
    var postData = JSON.stringify(body);
    var parsedUrl = new (require('url').URL)(url);
    var options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    };
    var req = https.request(options, function (res) {
      var data = '';
      res.on('data', function (chunk) { data += chunk; });
      res.on('end', function () {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function getAccessToken() {
  var url = 'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=' + APPID + '&secret=' + APPSECRET;
  var res = await httpGet(url);
  if (res.access_token) return res.access_token;
  throw new Error('获取access_token失败: ' + JSON.stringify(res));
}

async function sendSubscribeMessage(openid, data) {
  var token = await getAccessToken();
  var url = 'https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=' + token;
  var body = { touser: openid, template_id: REMIND_TEMPLATE_ID, data: data, page: 'pages/index/index' };
  return await httpPost(url, body);
}

// 带重试的发送（最多 3 次，指数退避）
async function sendWithRetry(openid, data, maxRetries) {
  maxRetries = maxRetries || 3;
  for (var attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      var res = await sendSubscribeMessage(openid, data);
      if (res.errcode === 0 || res.errcode === 43101) {
        // 43101 = 用户已 unsubscribe，无需重试
        return res;
      }
      if (attempt < maxRetries) {
        console.log('【提醒】第 ' + attempt + ' 次发送失败，' + res.errcode + '，准备重试...');
        await new Promise(function (r) { setTimeout(r, Math.pow(2, attempt) * 1000); });
      }
    } catch (err) {
      if (attempt < maxRetries) {
        console.log('【提醒】第 ' + attempt + ' 次发送异常，准备重试:', err.message);
        await new Promise(function (r) { setTimeout(r, Math.pow(2, attempt) * 1000); });
      } else {
        throw err;
      }
    }
  }
  return null;
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function formatDate(date) {
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

function formatTime(date) {
  return pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

function timeToMinutes(t) {
  if (!t) return -1;
  var p = t.split(':');
  return parseInt(p[0]) * 60 + parseInt(p[1] || 0);
}

// 获取北京时间
// 说明：微信云函数容器默认时区通常是 UTC，服务器日期与北京时间差 8h。
//       这里强制加 8h 确保触发时间和任务时间都用北京时间比较。
//       若部署后在云函数控制台环境变量里设置了 TZ=Asia/Shanghai，此加法会 double-count，
//       届时改为直接用 new Date() 即可。
function getBeijingNow() {
  var utc = Date.now();
  return new Date(utc + 8 * 60 * 60 * 1000);
}

// 检查任务是否匹配指定日期（含重复任务）
function isTaskOnDate(task, dateStr, dow) {
  if (task.date === dateStr) return true;
  if (task.repeatRule && task.repeatRule.type === 'weekly') {
    var rule = task.repeatRule;
    if (dateStr >= rule.startDate && dateStr <= rule.endDate) {
      if (rule.daysOfWeek.indexOf(dow) !== -1) {
        var skipped = rule.skippedDates || [];
        if (skipped.indexOf(dateStr) === -1) return true;
      }
    }
  }
  return false;
}

exports.main = async function (event, context) {
  var wxContext = cloud.getWXContext();
  // timer 触发时 wxContext 为 null，openid 留空由调用方传入或从查询结果获取
  var openid = wxContext ? wxContext.OPENID : '';
  var action = event.action || 'checkAndSend';

  // ===== 开启自动提醒 =====
  if (action === 'enable') {
    if (!REMIND_TEMPLATE_ID) {
      return { code: -1, msg: '模板ID未配置' };
    }
    var familyId = event.familyId;
    var remindAdvanceMinutes = event.remindAdvanceMinutes || 60; // 默认提前 60 分钟，可选 15/30/60/120

    var existing = await db.collection('reminderSubscriptions').where({
      openid: openid,
      taskId: '*'
    }).get();

    if (existing.data.length > 0) {
      await db.collection('reminderSubscriptions').doc(existing.data[0]._id).update({
        data: {
          enabled: true,
          familyId: familyId,
          remindAdvanceMinutes: remindAdvanceMinutes,
          updatedAt: db.serverDate()
        }
      });
    } else {
      await db.collection('reminderSubscriptions').add({
        data: {
          openid: openid,
          familyId: familyId,
          taskId: '*',
          enabled: true,
          remindAdvanceMinutes: remindAdvanceMinutes,
          createdAt: db.serverDate()
        }
      });
    }
    return { code: 0, remindAdvanceMinutes: remindAdvanceMinutes };
  }

  // ===== 关闭自动提醒 =====
  if (action === 'disable') {
    await db.collection('reminderSubscriptions').where({
      openid: openid,
      taskId: '*'
    }).update({
      data: { enabled: false, updatedAt: db.serverDate() }
    });
    return { code: 0 };
  }

  // ===== 查询是否开启 =====
  if (action === 'checkStatus') {
    var res = await db.collection('reminderSubscriptions').where({
      openid: openid,
      taskId: '*',
      enabled: true
    }).get();
    if (res.data.length > 0) {
      return {
        code: 0,
        enabled: true,
        remindAdvanceMinutes: res.data[0].remindAdvanceMinutes || 60
      };
    }
    return { code: 0, enabled: false, remindAdvanceMinutes: 60 };
  }

  // ===== 测试发送（用户点击「测试提醒」按钮时调用） =====
  if (action === 'testReminder') {
    if (!REMIND_TEMPLATE_ID) {
      return { code: -1, msg: '模板ID未配置' };
    }
    // 检查用户是否已开启提醒
    var testRes = await db.collection('reminderSubscriptions').where({
      openid: openid,
      enabled: true
    }).get();
    if (testRes.data.length === 0) {
      return { code: -1, msg: '请先开启自动提醒' };
    }
    // 立即发送一条测试消息
    try {
      var testSendRes = await sendSubscribeMessage(openid, {
        name1: { value: '家庭日程提醒' },
        thing1: { value: '这是一条测试消息，提醒系统运行正常！' },
        thing3: { value: '点击「🔔 提醒」可管理订阅设置' },
        time13: { value: formatDate(getBeijingNow()) }
      });
      if (testSendRes.errcode === 0) {
        return { code: 0, msg: '测试消息已发送' };
      } else {
        return { code: -1, msg: '发送失败: ' + testSendRes.errmsg };
      }
    } catch (err) {
      return { code: -1, msg: '发送异常: ' + err.message };
    }
  }

  // ===== 定时发送 =====
  if (action === 'checkAndSend') {
    if (!REMIND_TEMPLATE_ID) {
      return { code: -1, msg: '模板ID未配置' };
    }

    var now = getBeijingNow();
    var hour = now.getHours();
    var minute = now.getMinutes();
    var today = formatDate(now);
    var todayDow = now.getDay();
    var nowMins = hour * 60 + minute;

    console.log('【提醒触发】北京时间:', now.toLocaleString(), 'hour:', hour, 'minute:', minute, 'today:', today);

    // 查找所有开启提醒的用户
    var enabledUsers = await db.collection('reminderSubscriptions').where({
      enabled: true,
      taskId: '*'
    }).limit(100).get();

    console.log('【提醒触发】开启提醒的用户数:', enabledUsers.data.length);

    if (enabledUsers.data.length === 0) {
      return { code: 0, sent: 0 };
    }

    var sentCount = 0;

    for (var i = 0; i < enabledUsers.data.length; i++) {
      var user = enabledUsers.data[i];
      var familyId = user.familyId;

      // 查询该家庭的提醒设置（获取自定义提前量）
      var userSubRes = await db.collection('reminderSubscriptions').where({
        openid: user.openid,
        enabled: true
      }).get();
      var remindAdvanceMinutes = (userSubRes.data[0] && userSubRes.data[0].remindAdvanceMinutes) || 60;

      // ===== 提醒1：每晚20:00，明天日程汇总 =====
      if (hour === 20 && minute < 5) {
        var tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        var tomorrowStr = formatDate(tomorrow);
        var tomorrowDow = tomorrow.getDay();

        var elderCount = 0;
        var youngerCount = 0;

        for (var j = 0; j < tasksRes.data.length; j++) {
          if (isTaskOnDate(tasksRes.data[j], tomorrowStr, tomorrowDow)) {
            if (tasksRes.data[j].child === 'elder') elderCount++;
            else youngerCount++;
          }
        }

        var totalCount = elderCount + youngerCount;
        if (totalCount > 0) {
          var logKey = 'summary_' + tomorrowStr;
          var logRes = await db.collection('reminderLog').where({
            openid: user.openid,
            logKey: logKey
          }).get();

          if (logRes.data.length === 0) {
            var detail = '';
            if (elderCount > 0 && youngerCount > 0) {
              detail = 'Angel ' + elderCount + '项，Max ' + youngerCount + '项';
            } else if (elderCount > 0) {
              detail = 'Angel ' + elderCount + '项日程';
            } else {
              detail = 'Max ' + youngerCount + '项日程';
            }

            try {
              var testRes = await sendWithRetry(user.openid, {
                name1: { value: '家庭日程提醒' },
                thing3: { value: detail },
                thing4: { value: '点击进入查看明天安排' },
                time13: { value: tomorrowStr }
              }, 3);

              if (testRes && testRes.errcode === 0) {
                await db.collection('reminderLog').add({
                  data: { openid: user.openid, logKey: logKey, sentAt: db.serverDate() }
                });
                sentCount++;
              }
            } catch (err) {
              console.error('汇总提醒失败:', err);
            }
          }
        }
      }

      // ===== 提醒2：每个日程开始前 N 分钟（N 可由用户自定义） =====
      for (var j = 0; j < tasksRes.data.length; j++) {
        var task = tasksRes.data[j];
        if (!task.startTime) continue;
        if (!isTaskOnDate(task, today, todayDow)) continue;

        var taskMins = timeToMinutes(task.startTime);
        var remindMins = taskMins - remindAdvanceMinutes; // 使用自定义提前量

        console.log('【提醒触发】任务:', task.name, 'startTime:', task.startTime, 'taskMins:', taskMins, 'remindMins:', remindMins, 'nowMins:', nowMins);

        // 在提醒窗口内（提前 N 分钟 ~ 到期后 1 分钟）
        if (nowMins >= remindMins && nowMins <= taskMins + 1) {
          var logKey = 'hour_' + today + '_' + task.startTime + '_' + task._id;
          var logRes = await db.collection('reminderLog').where({
            openid: user.openid,
            logKey: logKey
          }).get();

          if (logRes.data.length > 0) {
            console.log('【提醒触发】已发送过，跳过:', logKey);
            continue;
          }

          var childName = task.child === 'elder' ? 'Angel ♊' : 'Max ♏';
          var loc = task.location || '未设置地点';
          var remark = task.remark || ''; // 备注字段

          try {
            var sendMsgData = {
              name1: { value: childName },
              thing3: { value: task.name },
              thing4: { value: loc },
              time13: { value: today + ' ' + task.startTime }
            };
            if (remark) {
              sendMsgData.thing1 = { value: remark };
            }

            var sendRes = await sendWithRetry(user.openid, sendMsgData, 3);

            if (sendRes && sendRes.errcode === 0) {
              await db.collection('reminderLog').add({
                data: { openid: user.openid, logKey: logKey, sentAt: db.serverDate() }
              });
              sentCount++;
              console.log('【提醒触发】发送成功:', task.name);
            } else {
              console.log('【提醒触发】发送失败:', sendRes ? sendRes.errcode : 'unknown');
            }
          } catch (err) {
            console.error('【提醒触发】发送失败:', err);
          }
        }
      }
    }

    return { code: 0, sent: sentCount };
  }

  return { code: -1, msg: '未知操作: ' + action };
};
