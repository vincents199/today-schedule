/**
 * 工具函数模块
 */

// 生成唯一任务ID
function generateId() {
  var timestamp = Date.now().toString(36);
  var random = Math.random().toString(36).substring(2, 8);
  return timestamp + random;
}

// 获取今天的日期字符串 (YYYY-MM-DD)
function getToday() {
  var now = new Date();
  return formatDateNum(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

// 格式化数字为 YYYY-MM-DD
function formatDateNum(y, m, d) {
  var mm = m < 10 ? '0' + m : '' + m;
  var dd = d < 10 ? '0' + d : '' + d;
  return y + '-' + mm + '-' + dd;
}

// 获取星期几（0=周日, 1=周一, ... 6=周六）
function getDayOfWeek(dateStr) {
  return new Date(dateStr + 'T00:00:00').getDay();
}

// 星期几的中文名
var DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

function getDayName(dayIndex) {
  return DAY_NAMES[dayIndex] || '';
}

// 格式化日期为中文显示
function formatDate(dateStr) {
  var date = new Date(dateStr + 'T00:00:00');
  var month = date.getMonth() + 1;
  var day = date.getDate();
  var weekday = DAY_NAMES[date.getDay()];
  return month + '月' + day + '日 星期' + weekday;
}

// 短日期：6月4日
function formatDateShort(dateStr) {
  var date = new Date(dateStr + 'T00:00:00');
  return (date.getMonth() + 1) + '月' + date.getDate() + '日';
}

// 根据重复规则生成所有满足条件的日期
function generateRepeatDates(startDate, daysOfWeek, endDate) {
  var dates = [];
  var current = new Date(startDate + 'T00:00:00');
  var end = new Date(endDate + 'T00:00:00');

  while (current <= end) {
    var dow = current.getDay(); // 0=Sun
    if (daysOfWeek.indexOf(dow) !== -1) {
      var y = current.getFullYear();
      var m = current.getMonth() + 1;
      var d = current.getDate();
      dates.push(formatDateNum(y, m, d));
    }
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

// 解析重复天数为中文描述
function describeRepeatDays(daysOfWeek) {
  if (!daysOfWeek || daysOfWeek.length === 0) return '';
  var names = daysOfWeek.map(function (d) { return '周' + DAY_NAMES[d]; });
  return '每' + names.join('');
}

// 轻微震动反馈
function vibrate() {
  wx.vibrateShort({ type: 'light' }).catch(function () {});
}

module.exports = {
  generateId: generateId,
  getToday: getToday,
  formatDate: formatDate,
  formatDateShort: formatDateShort,
  formatDateNum: formatDateNum,
  getDayOfWeek: getDayOfWeek,
  getDayName: getDayName,
  generateRepeatDates: generateRepeatDates,
  describeRepeatDays: describeRepeatDays,
  vibrate: vibrate
};
