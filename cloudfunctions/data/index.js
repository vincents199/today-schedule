/**
 * 云函数 data - 统一处理所有数据操作
 * 所有数据库操作均通过此函数，前端不直接访问数据库
 * 安全机制：每次操作验证调用者是否为家庭成员
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const https = require('https');
const http = require('http');
const urlMod = require('url');

// 生成4位数字邀请码
function generateCode() {
  return String(1000 + Math.floor(Math.random() * 9000));
}

// 校验 openid 是否为家庭成员
async function getFamilyByMember(openid) {
  var res = await db.collection('families').where({
    members: openid
  }).get();
  if (res.data.length === 0) return null;
  return res.data[0];
}

// 校验是否管理员
function isAdmin(family, openid) {
  var info = family.memberInfo || {};
  return info[openid] && info[openid].role === 'admin';
}

// 校验是否可编辑日程（admin 或 editor）
function canEditTasks(family, openid) {
  var info = family.memberInfo || {};
  var role = info[openid] ? info[openid].role : '';
  return role === 'admin' || role === 'editor';
}

// 校验 familyId 是否存在且用户是成员
async function verifyFamilyMember(familyId, openid) {
  try {
    var res = await db.collection('families').doc(familyId).get();
    if (!res.data) return null;
    if (res.data.members.indexOf(openid) === -1) return null;
    return res.data;
  } catch (e) {
    return null;
  }
}

exports.main = async (event, context) => {
  var wxContext = cloud.getWXContext();
  var openid = wxContext.OPENID;
  var action = event.action;

  var BUILTIN_HOLIDAYS = {
    '2025': {
      '2025-01-01': { name: '元旦' },
      '2025-01-28': { name: '除夕' },
      '2025-01-29': { name: '春节' },
      '2025-01-30': { name: '春节' },
      '2025-01-31': { name: '春节' },
      '2025-02-01': { name: '春节' },
      '2025-02-02': { name: '春节' },
      '2025-02-03': { name: '春节' },
      '2025-02-04': { name: '春节' },
      '2025-04-04': { name: '清明节' },
      '2025-05-01': { name: '劳动节' },
      '2025-05-31': { name: '端午节' },
      '2025-10-01': { name: '国庆节' },
      '2025-10-02': { name: '国庆节' },
      '2025-10-03': { name: '国庆节' },
      '2025-10-06': { name: '国庆节' },
      '2025-10-07': { name: '国庆节' },
      '2025-10-08': { name: '国庆节' }
    },
    '2026': {
      '2026-01-01': { name: '元旦' },
      '2026-02-15': { name: '除夕' },
      '2026-02-16': { name: '春节' },
      '2026-02-17': { name: '春节' },
      '2026-02-18': { name: '春节' },
      '2026-02-19': { name: '春节' },
      '2026-02-20': { name: '春节' },
      '2026-02-21': { name: '春节' },
      '2026-02-22': { name: '春节' },
      '2026-04-05': { name: '清明节' },
      '2026-05-01': { name: '劳动节' },
      '2026-06-19': { name: '端午节' },
      '2026-10-01': { name: '国庆节' },
      '2026-10-02': { name: '国庆节' },
      '2026-10-03': { name: '国庆节' },
      '2026-10-05': { name: '国庆节' },
      '2026-10-06': { name: '国庆节' },
      '2026-10-07': { name: '国庆节' },
      '2026-10-08': { name: '国庆节' }
    }
  };

  try {
    switch (action) {

      // ===== 登录 & 家庭检测 =====
      case 'login': {
        var family = await getFamilyByMember(openid);
        if (family && (!family.memberInfo || Object.keys(family.memberInfo).length === 0)) {
          family.memberInfo = {};
          var members = family.members;
          for (var mi = 0; mi < members.length; mi++) {
            family.memberInfo[members[mi]] = {
              name: mi === 0 ? '管理员' : '家庭成员' + mi,
              role: mi === 0 ? 'admin' : 'member'
            };
          }
          await db.collection('families').doc(family._id).update({
            data: { memberInfo: family.memberInfo }
          });
        }
        return { code: 0, openid: openid, family: family };
      }

      // ===== 创建家庭 =====
      case 'familyCreate': {
        var existing = await getFamilyByMember(openid);
        if (existing) {
          return { code: -1, msg: '你已在家庭中', family: existing };
        }
        var code, dup;
        do {
          code = generateCode();
          dup = await db.collection('families').where({ inviteCode: code }).get();
        } while (dup.data.length > 0);

        var res = await db.collection('families').add({
          data: {
            inviteCode: code,
            members: [openid],
            memberInfo: {},
            createdAt: db.serverDate()
          }
        });
        var initMemberInfo = {};
        initMemberInfo['memberInfo.' + openid] = { name: '我', role: 'admin' };
        await db.collection('families').doc(res._id).update({
          data: initMemberInfo
        });
        return {
          code: 0,
          familyId: res._id,
          inviteCode: code,
          members: [openid]
        };
      }

      // ===== 加入家庭 =====
      case 'familyJoin': {
        var inviteCode = event.inviteCode;
        var famRes = await db.collection('families').where({ inviteCode: inviteCode }).get();
        if (famRes.data.length === 0) {
          return { code: -1, msg: '邀请码无效，请核对后重试' };
        }
        var family = famRes.data[0];
        if (family.members.indexOf(openid) !== -1) {
          return { code: -1, msg: '你已是该家庭成员' };
        }
        family.members.push(openid);
        var updateData = { members: family.members };
        updateData['memberInfo.' + openid] = { name: event.memberName || '家庭成员', role: 'member' };
        await db.collection('families').doc(family._id).update({
          data: updateData
        });
        // re-read to get updated memberInfo
        var updated = await db.collection('families').doc(family._id).get();
        return {
          code: 0,
          familyId: family._id,
          inviteCode: family.inviteCode,
          members: family.members,
          openid: openid,
          familyMemberInfo: updated.data.memberInfo || {}
        };
      }

      // ===== 获取家庭信息 =====
      case 'familyGetInfo': {
        var family = await getFamilyByMember(openid);
        if (!family) return { code: -1, msg: '未加入任何家庭' };
        return { code: 0, family: family };
      }

      // ===== 更新成员信息（管理员可用） =====
      case 'updateMemberInfo': {
        var family = await getFamilyByMember(openid);
        if (!family) return { code: -1, msg: '未加入家庭' };
        if (!isAdmin(family, openid)) return { code: -1, msg: '仅管理员可修改成员信息' };
        var targetOpenid = event.targetOpenid;
        var info = family.memberInfo || {};
        var oldRole = info[targetOpenid] ? info[targetOpenid].role : 'member';
        var newRole = event.role || oldRole;
        var newName = event.memberName || (info[targetOpenid] ? info[targetOpenid].name : '家庭成员');
        var update = {};
        update['memberInfo.' + targetOpenid] = { name: newName, role: newRole };
        await db.collection('families').doc(family._id).update({ data: update });
        return { code: 0 };
      }

      // ===== 加载全部任务 =====
      case 'loadTasks': {
        var family = await getFamilyByMember(openid);
        if (!family) return { code: -1, msg: '未加入家庭' };
        var res = await db.collection('tasks').where({
          familyId: family._id
        }).limit(1000).get();
        return { code: 0, tasks: res.data };
      }

      // ===== 添加任务 =====
      case 'addTask': {
        var family = await getFamilyByMember(openid);
        if (!family) return { code: -1, msg: '未加入家庭' };
        if (!canEditTasks(family, openid)) return { code: -1, msg: '无权限添加任务' };
        var task = event.task;
        task.familyId = family._id;
        task.createdBy = openid;
        task.createdAt = db.serverDate();
        var res = await db.collection('tasks').add({ data: task });
        return { code: 0, taskId: res._id };
      }

      // ===== 更新任务 =====
      case 'updateTask': {
        var family = await getFamilyByMember(openid);
        if (!family) return { code: -1, msg: '未加入家庭' };
        if (!canEditTasks(family, openid)) return { code: -1, msg: '无权限修改任务' };
        var taskId = event.taskId;
        var update = event.task;
        var taskRes = await db.collection('tasks').doc(taskId).get();
        if (!taskRes.data || taskRes.data.familyId !== family._id) {
          return { code: -1, msg: '无权操作该任务' };
        }
        delete update.familyId;
        delete update.createdBy;
        delete update.createdAt;
        update.updatedAt = db.serverDate();
        await db.collection('tasks').doc(taskId).update({ data: update });
        return { code: 0 };
      }

      // ===== 删除任务 =====
      case 'deleteTask': {
        var family = await getFamilyByMember(openid);
        if (!family) return { code: -1, msg: '未加入家庭' };
        if (!canEditTasks(family, openid)) return { code: -1, msg: '无权限删除任务' };
        var taskId = event.taskId;
        var taskRes = await db.collection('tasks').doc(taskId).get();
        if (!taskRes.data || taskRes.data.familyId !== family._id) {
          return { code: -1, msg: '无权操作该任务' };
        }
        await db.collection('tasks').doc(taskId).remove();
        // 同时删除相关完成记录
        await db.collection('completions').where({
          taskId: taskId
        }).remove();
        return { code: 0 };
      }

      // ===== 跳过重复任务的某一天 =====
      case 'skipDate': {
        var family = await getFamilyByMember(openid);
        if (!family) return { code: -1, msg: '未加入家庭' };
        if (!canEditTasks(family, openid)) return { code: -1, msg: '无权限操作' };
        var taskId = event.taskId;
        var date = event.date;
        var taskRes = await db.collection('tasks').doc(taskId).get();
        if (!taskRes.data || taskRes.data.familyId !== family._id) {
          return { code: -1, msg: '无权操作该任务' };
        }
        var task = taskRes.data;
        if (!task.repeatRule) return { code: -1, msg: '非重复任务' };
        if (!task.repeatRule.skippedDates) task.repeatRule.skippedDates = [];
        if (task.repeatRule.skippedDates.indexOf(date) === -1) {
          task.repeatRule.skippedDates.push(date);
        }
        await db.collection('tasks').doc(taskId).update({
          data: { repeatRule: task.repeatRule }
        });
        return { code: 0 };
      }

      // ===== 切换完成状态 =====
      case 'toggleComplete': {
        var family = await getFamilyByMember(openid);
        if (!family) return { code: -1, msg: '未加入家庭' };
        var taskId = event.taskId;
        var date = event.date;
        var completed = event.completed;

        var existRes = await db.collection('completions').where({
          familyId: family._id,
          taskId: taskId,
          date: date
        }).get();

        if (existRes.data.length > 0) {
          await db.collection('completions').doc(existRes.data[0]._id).update({
            data: {
              completed: completed,
              updatedBy: openid,
              updatedAt: db.serverDate()
            }
          });
        } else {
          await db.collection('completions').add({
            data: {
              familyId: family._id,
              taskId: taskId,
              date: date,
              completed: completed,
              updatedBy: openid,
              updatedAt: db.serverDate()
            }
          });
        }
        return { code: 0 };
      }

      // ===== 加载完成记录 =====
      case 'loadCompletions': {
        var family = await getFamilyByMember(openid);
        if (!family) return { code: -1, msg: '未加入家庭' };
        var res = await db.collection('completions').where({
          familyId: family._id
        }).limit(2000).get();
        return { code: 0, completions: res.data };
      }

      // ===== 重置今日 =====
      case 'resetToday': {
        var family = await getFamilyByMember(openid);
        if (!family) return { code: -1, msg: '未加入家庭' };
        if (!canEditTasks(family, openid)) return { code: -1, msg: '无权限重置' };
        var date = event.date;
        await db.collection('completions').where({
          familyId: family._id,
          date: date
        }).remove();
        return { code: 0 };
      }

      // ===== 一次加载所有数据(任务+完成记录) =====
      case 'loadAllData': {
        var family = await getFamilyByMember(openid);
        if (!family) return { code: -1, msg: '未加入家庭' };
        var tasksRes = await db.collection('tasks').where({
          familyId: family._id
        }).limit(1000).get();
        var compsRes = await db.collection('completions').where({
          familyId: family._id
        }).limit(2000).get();
        var holData = [];
        try { var holRes = await db.collection('holidays').limit(20).get(); holData = holRes.data; } catch (e) {}
        return { code: 0, tasks: tasksRes.data, completions: compsRes.data, holidays: holData };
      }

      // ===== 加载节假日 =====
      case 'loadHolidays': {
        var holData = [];
        try { var holRes = await db.collection('holidays').limit(20).get(); holData = holRes.data; } catch (e) {}
        return { code: 0, holidays: holData };
      }

      // ===== 同步节假日（从公开 API 抓取，兜底内置数据） =====
      case 'syncHolidays': {
        var year = event.year || String(new Date().getFullYear() + 1);
        var holidayMap = {};
        var lastErr = '';

        var apiList = [
          { url: 'http://timor.tech/api/holiday/year/' + year + '/', format: 'timor' },
          { url: 'https://timor.tech/api/holiday/year/' + year + '/', format: 'timor' },
          { url: 'https://holiday.ailcc.com/api/holiday/year/' + year, format: 'ailcc' }
        ];

        for (var i = 0; i < apiList.length; i++) {
          try {
            var apiData = await new Promise(function (resolve, reject) {
              var parsedUrl = urlMod.parse(apiList[i].url);
              var mod = parsedUrl.protocol === 'https:' ? https : http;
              var opts = {
                hostname: parsedUrl.hostname,
                port: Number(parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80)),
                path: parsedUrl.path,
                method: 'GET',
                rejectUnauthorized: false
              };
              var req = mod.get(opts, function (resp) {
                var body = '';
                resp.setEncoding('utf8');
                resp.on('data', function (chunk) { body += chunk; });
                resp.on('end', function () {
                  if (resp.statusCode !== 200) { reject(new Error('HTTP ' + resp.statusCode)); return; }
                  try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
                });
              });
              req.on('error', reject);
              setTimeout(function () { req.destroy(); reject(new Error('超时')); }, 6000);
            });

            if (apiData.code === 0) {
              var holidays = apiData.holidays;
              if (holidays && typeof holidays === 'object') {
                for (var d in holidays) {
                  var h = holidays[d];
                  if (h && h.holiday === true && h.name) {
                    holidayMap[d] = { name: h.name.replace(/（休）|\(休\)/g, '') };
                  }
                }
              }
              if (Object.keys(holidayMap).length > 0) break;
            }
            lastErr = 'API返回异常';
          } catch (e) {
            lastErr = e.message;
          }
        }

        if (Object.keys(holidayMap).length === 0) {
          // 兜底：使用内置数据
          var builtin = BUILTIN_HOLIDAYS[year];
          if (builtin) {
            for (var d in builtin) { holidayMap[d] = builtin[d]; }
          }
        }
        if (Object.keys(holidayMap).length === 0) {
          return { code: -1, msg: '获取节假日数据失败: ' + lastErr };
        }

        try {
          var existing = await db.collection('holidays').where({ year: year }).get();
          if (existing.data.length > 0) {
            await db.collection('holidays').doc(existing.data[0]._id).update({
              data: { year: year, holidays: holidayMap, updatedAt: db.serverDate() }
            });
          } else {
            await db.collection('holidays').add({
              data: { year: year, holidays: holidayMap, updatedAt: db.serverDate() }
            });
          }
        } catch (e) {
          return { code: -1, msg: '数据已获取，但存储失败。请在云开发控制台创建 holidays 集合', data: holidayMap };
        }
        return { code: 0, year: year, holidays: holidayMap };
      }

      default:
        return { code: -1, msg: '未知操作类型: ' + action };
    }
  } catch (err) {
    return { code: -1, msg: err.message };
  }
};
