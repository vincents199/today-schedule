/**
 * 云函数调用封装
 * 所有与后端的通信统一通过此模块
 */

// 内部调用（支持静默模式）
function _call(action, data, silent) {
  return new Promise(function (resolve, reject) {
    if (!silent) wx.showLoading({ title: '加载中...', mask: true });
    wx.cloud.callFunction({
      name: 'data',
      data: Object.assign({ action: action }, data)
    }).then(function (res) {
      wx.hideLoading();
      if (res.result && res.result.code === 0) {
        resolve(res.result);
      } else {
        var msg = (res.result && res.result.msg) || '操作失败';
        wx.showToast({ title: msg, icon: 'none' });
        reject(new Error(msg));
      }
    }).catch(function (err) {
      wx.hideLoading();
      console.error('云函数调用失败:', err);
      wx.showModal({
        title: '云函数调用失败',
        content: '错误信息: ' + (err.errMsg || JSON.stringify(err)) + '\n\n检查云环境是否已关联',
        showCancel: false
      });
      reject(err);
    });
  });
}

function call(action, data) { return _call(action, data, false); }

// 调用 reminders 云函数（独立于 data 云函数）
function _callReminders(action, data, silent) {
  return new Promise(function (resolve, reject) {
    if (!silent) wx.showLoading({ title: '加载中...', mask: true });
    wx.cloud.callFunction({
      name: 'reminders',
      data: Object.assign({ action: action }, data)
    }).then(function (res) {
      wx.hideLoading();
      if (res.result && res.result.code === 0) {
        resolve(res.result);
      } else {
        var msg = (res.result && res.result.msg) || '操作失败';
        wx.showToast({ title: msg, icon: 'none' });
        reject(new Error(msg));
      }
    }).catch(function (err) {
      wx.hideLoading();
      console.error('reminders 云函数调用失败:', err);
      reject(err);
    });
  });
}
function callReminders(action, data) { return _callReminders(action, data, false); }

// 封装常用操作
var cloudAPI = {
  login: function () {
    return call('login');
  },
  familyCreate: function () {
    return call('familyCreate');
  },
  familyJoin: function (inviteCode, memberName) {
    return call('familyJoin', { inviteCode: inviteCode, memberName: memberName });
  },
  familyGetInfo: function () {
    return call('familyGetInfo');
  },
  loadTasks: function () {
    return call('loadTasks');
  },
  addTask: function (task) {
    return call('addTask', { task: task });
  },
  addTaskSilent: function (task) {
    return _call('addTask', { task: task }, true);
  },
  updateTask: function (taskId, task) {
    return call('updateTask', { taskId: taskId, task: task });
  },
  loadAllData: function (silent) {
    return _call('loadAllData', {}, silent);
  },
  deleteTask: function (taskId) {
    return call('deleteTask', { taskId: taskId });
  },
  skipDate: function (taskId, date) {
    return call('skipDate', { taskId: taskId, date: date });
  },
  toggleComplete: function (taskId, date, completed) {
    return call('toggleComplete', {
      taskId: taskId,
      date: date,
      completed: completed
    });
  },
  loadCompletions: function () {
    return call('loadCompletions');
  },
  resetToday: function (date) {
    return call('resetToday', { date: date });
  },
  syncHolidays: function (year) {
    return _call('syncHolidays', { year: year }, true);
  },
  loadHolidays: function () {
    return call('loadHolidays');
  },
  updateMemberInfo: function (targetOpenid, memberName, role) {
    return call('updateMemberInfo', { targetOpenid: targetOpenid, memberName: memberName, role: role });
  },

  // ===== 提醒相关（全局自动提醒） =====
  enableAutoReminder: function (data) {
    return _callReminders('enable', data, true);
  },
  disableAutoReminder: function () {
    return _callReminders('disable', {}, true);
  },
  checkAutoReminderStatus: function () {
    return _callReminders('checkStatus', {}, true);
  },
  testReminder: function () {
    return _callReminders('testReminder', {}, false);
  }
};

module.exports = cloudAPI;
