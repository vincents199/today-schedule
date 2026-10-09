/**
 * 首页 - 双娃日程看板 + 家庭同步
 *
 * 数据流：
 *   本地缓存 (wx.setStorageSync) → 即时显示
 *   云函数 (data) → 所有操作双向同步
 *   首次配置家庭后，家人间自动共享数据
 */
var util = require('../../utils/util.js');
var cloudAPI = require('../../utils/cloud.js');

// 2026年法定节假日
var HOLIDAYS_2026 = {
  '2026-01-01': { name: '元旦' }, '2026-01-02': { name: '元旦' }, '2026-01-03': { name: '元旦' },
  '2026-02-15': { name: '春节' }, '2026-02-16': { name: '春节' }, '2026-02-17': { name: '春节' },
  '2026-02-18': { name: '春节' }, '2026-02-19': { name: '春节' }, '2026-02-20': { name: '春节' },
  '2026-02-21': { name: '春节' }, '2026-02-22': { name: '春节' }, '2026-02-23': { name: '春节' },
  '2026-04-04': { name: '清明' }, '2026-04-05': { name: '清明' }, '2026-04-06': { name: '清明' },
  '2026-05-01': { name: '劳动节' }, '2026-05-02': { name: '劳动节' }, '2026-05-03': { name: '劳动节' },
  '2026-05-04': { name: '劳动节' }, '2026-05-05': { name: '劳动节' },
  '2026-06-19': { name: '端午' }, '2026-06-20': { name: '端午' }, '2026-06-21': { name: '端午' },
  '2026-09-25': { name: '中秋' }, '2026-09-26': { name: '中秋' }, '2026-09-27': { name: '中秋' },
  '2026-10-01': { name: '国庆' }, '2026-10-02': { name: '国庆' }, '2026-10-03': { name: '国庆' },
  '2026-10-04': { name: '国庆' }, '2026-10-05': { name: '国庆' }, '2026-10-06': { name: '国庆' },
  '2026-10-07': { name: '国庆' }
};

Page({

  childrenConfig: [
    { key: 'elder',   name: 'Angel', color: '#5B8DEF', bgColor: '#F0F6FF', emoji: '⭐' },
    { key: 'younger', name: 'Max',   color: '#FF8C94', bgColor: '#FFF0F3', emoji: '🌸' }
  ],

  data: {
    // ---- 家庭管理 ----
    familyState: 'loading',   // 'loading' | 'setup' | 'ready'
    setupMode: null,          // null | 'create' | 'join'
    joinCode: '',
    memberNameInput: '',
    familyId: '',
    familyInviteCode: '',
    familyMembers: [],
    familyMemberInfo: {},
    isAdmin: false,
    canEditTasks: false,
    showFamilySettings: false,
    memberSettingsOpenid: '',
    memberSettingsName: '',
    memberSettingsRole: '',
    showMemberEdit: false,

    // ---- 日期与进度 ----
    today: '',
    currentViewDate: '',
    viewDateDisplay: '',
    isViewToday: true,
    totalCount: 0,
    completedCount: 0,
    progressPercent: 0,

    // ---- 双栏任务 ----
    elderTasks: [],
    youngerTasks: [],
    elderCompletedCount: 0,
    youngerCompletedCount: 0,

    // ---- 添加/编辑弹窗 ----
    showAddModal: false,
    isEditing: false,
    editingTaskId: null,
    formChildIndex: 0,
    formDate: '',
    formAllDay: false,
    formStartTime: '08:00',
    formEndTime: '09:00',
    formName: '',
    formLocation: '',
    formLocationData: null,
    formRepeatType: 0,
    formRepeatDays: [0,0,0,0,0,0,0],
    formRepeatEndDate: '',

    // ---- 详情弹窗 ----
    showDetail: false,
    detailTask: null,
    hasAutoReminder: false,
    _hasSubscribedThisSession: false,   // 本轮进入已顺路请求过订阅则置 true，避免重复弹框
    // 本地估算订阅额度（见 remindQuota* 辅助函数）
    reminderQuotaLeft: 0,
    reminderQuotaExpired: false,

    // ---- picker 数据 ----
    childPickerNames: ['♊ Angel', '♏ Max'],
    repeatPickerNames: ['不重复', '每周重复'],
    weekDayLabels: ['日', '一', '二', '三', '四', '五', '六'],

    // ---- 月历 ----
    showCalendar: false,
    calendarYear: 0,
    calendarMonth: 0,
    calendarDays: [],
    // ---- 搜索 ----
    showSearch: false,
    searchQuery: '',
    searchResults: [],
    // ---- 触发的节假日 ----
    fetchedHolidays: null,
    // ---- 批量录入 ----
    showBatchInput: false,
    batchChildIndex: 0,
    batchText: '',
    batchPreview: [],
    batchUploading: false
  },

  /** ========== 生命周期 ========== */

  onLoad: function () {
    this.setData({ today: util.formatDate(util.getToday()) });
    this.initApp();
  },

  onShow: function () {
    if (this.data.familyState === 'ready') {
      this.refreshDisplay();
      // ⚠️ 不在 onShow 自动请求订阅——微信要求必须由用户主动点击才能弹出授权框
      // 每次用户打开"提醒"开关时，_batchRequestSubscribe 会被调用，
      // 此时用户已经明确表达了订阅意图，授权弹窗可以正常弹出。
      this._refreshQuotaDisplay();   // 进入时刷新本地估算的剩余次数
    }
  },

  /** ========== 应用初始化 ========== */

  // 第一步：检测家庭状态
  initApp: function () {
    var that = this;
    // 初始化当前查看日期
    var today = util.getToday();
    that.setData({
      currentViewDate: today,
      viewDateDisplay: util.formatDate(today),
      isViewToday: true
    });

    // 先读本地缓存快速展示
    var cachedFamilyId = wx.getStorageSync('familyId');
    if (cachedFamilyId) {
      that.setData({ familyState: 'ready', familyId: cachedFamilyId });
      that.loadLocalCacheForDate(today);
    }

    // 再向云查询最新状态
    cloudAPI.login().then(function (res) {
      if (res.family) {
        var memberInfo = res.family.memberInfo || {};
        var isAdmin = memberInfo[res.openid] && memberInfo[res.openid].role === 'admin';
        var canEdit = memberInfo[res.openid] && (memberInfo[res.openid].role === 'admin' || memberInfo[res.openid].role === 'editor');
        that.setData({
          familyState: 'ready',
          familyId: res.family._id,
          familyInviteCode: res.family.inviteCode,
          familyMembers: res.family.members,
          familyMemberInfo: memberInfo,
          isAdmin: isAdmin,
          canEditTasks: canEdit
        });
        wx.setStorageSync('familyId', res.family._id);
        wx.setStorageSync('familyInviteCode', res.family.inviteCode);
        wx.setStorageSync('familyMembers', res.family.members);
        // 从云端拉取最新数据
        that.syncFromCloud();
        that.checkAutoReminderStatus();
      } else {
        // 没有家庭 → 显示设置页
        that.setData({ familyState: 'setup', setupMode: null });
      }
    }).catch(function () {
      // 云调用失败但本地有缓存 → 仍可正常使用
      if (cachedFamilyId) {
        that.setData({ familyState: 'ready' });
      } else {
        that.setData({ familyState: 'setup', setupMode: null });
      }
    });
  },

  // 从本地缓存加载（即时展示）
  loadLocalCacheForDate: function (dateStr) {
    var cached = wx.getStorageSync('cachedTasks_' + dateStr);
    if (cached) {
      this.setDisplayData(cached.tasks || [], cached.completions || {});
    }
  },

  // 从云同步最新数据
  syncFromCloud: function () {
    var that = this;
    cloudAPI.loadAllData(true).then(function (res) {
      var tasks = res.tasks || [];
      var comps = res.completions || [];
      var compMap = {};
      for (var i = 0; i < comps.length; i++) {
        compMap[comps[i].taskId + '_' + comps[i].date] = comps[i].completed;
      }
      wx.setStorageSync('cachedTasks', tasks);
      wx.setStorageSync('cachedCompletions', compMap);
      // 加载云端节假日
      var holidays = res.holidays || [];
      var fetchedMap = {};
      for (var i = 0; i < holidays.length; i++) {
        if (holidays[i].holidays) {
          for (var d in holidays[i].holidays) {
            fetchedMap[d] = holidays[i].holidays[d];
          }
        }
      }
      if (Object.keys(fetchedMap).length > 0) {
        that.setData({ fetchedHolidays: fetchedMap });
      }
      that.setDisplayData(tasks, compMap);
    }).catch(function () {});
  },

  /** ========== 家庭管理 ========== */

  showSetup: function (e) {
    this.setData({ setupMode: e.currentTarget.dataset.mode, joinCode: '' });
  },

  backSetup: function () {
    this.setData({ setupMode: null, joinCode: '' });
  },

  onJoinCodeInput: function (e) {
    this.setData({ joinCode: e.detail.value });
  },

  onMemberNameInput: function (e) {
    this.setData({ memberNameInput: e.detail.value });
  },

  createFamily: function () {
    var that = this;
    wx.showLoading({ title: '创建中...', mask: true });
    cloudAPI.familyCreate().then(function (res) {
      wx.hideLoading();
      var memberInfo = {};
      memberInfo[res.members[0]] = { name: '我', role: 'admin' };
      that.setData({
        familyState: 'ready',
        familyId: res.familyId,
        familyInviteCode: res.inviteCode,
        familyMembers: res.members,
        familyMemberInfo: memberInfo,
        isAdmin: true,
        canEditTasks: true,
        setupMode: null
      });
      wx.setStorageSync('familyId', res.familyId);
      wx.setStorageSync('familyInviteCode', res.inviteCode);
      wx.setStorageSync('familyMembers', res.members);
      wx.showModal({
        title: '家庭创建成功',
        content: '邀请码: ' + res.inviteCode + '\n\n将此邀请码分享给家人，他们即可加入同步',
        showCancel: false
      });
    }).catch(function () {
      wx.hideLoading();
    });
  },

  joinFamily: function () {
    var code = this.data.joinCode.trim();
    var memberName = this.data.memberNameInput.trim() || '家庭成员';
    if (!code || code.length < 4) {
      wx.showToast({ title: '请输入完整邀请码', icon: 'none' });
      return;
    }
    if (!memberName) {
      wx.showToast({ title: '请输入你的昵称', icon: 'none' });
      return;
    }
    var that = this;
    wx.showLoading({ title: '加入中...', mask: true });
    cloudAPI.familyJoin(code, memberName).then(function (res) {
      wx.hideLoading();
      var memberInfo = res.familyMemberInfo || {};
      var isAdmin = memberInfo[res.openid] && memberInfo[res.openid].role === 'admin';
      var canEdit = memberInfo[res.openid] && (memberInfo[res.openid].role === 'admin' || memberInfo[res.openid].role === 'editor');
      that.setData({
        familyState: 'ready',
        familyId: res.familyId,
        familyInviteCode: res.inviteCode,
        familyMembers: res.members,
        familyMemberInfo: memberInfo,
        isAdmin: isAdmin,
        canEditTasks: canEdit,
        setupMode: null
      });
      wx.setStorageSync('familyId', res.familyId);
      wx.setStorageSync('familyInviteCode', res.inviteCode);
      wx.setStorageSync('familyMembers', res.members);
      wx.showToast({ title: '加入成功！', icon: 'success' });
      that.syncFromCloud();
    }).catch(function () {
      wx.hideLoading();
    });
  },

  showFamilySettings: function () {
    var that = this;
    cloudAPI.familyGetInfo().then(function (res) {
      var memberInfo = res.family.memberInfo || {};
      that.setData({
        showFamilySettings: true,
        familyInviteCode: res.family.inviteCode,
        familyMembers: res.family.members,
        familyMemberInfo: memberInfo
      });
    }).catch(function () {});
  },

  hideFamilySettings: function () {
    this.setData({ showFamilySettings: false, showMemberEdit: false });
  },

  editMember: function (e) {
    var ds = e.currentTarget.dataset;
    this.setData({
      showMemberEdit: true,
      memberSettingsOpenid: ds.openid,
      memberSettingsName: ds.name,
      memberSettingsRole: ds.role
    });
  },

  hideMemberEdit: function () {
    this.setData({ showMemberEdit: false });
  },

  onMemberSettingsNameInput: function (e) {
    this.setData({ memberSettingsName: e.detail.value });
  },

  onRoleSelect: function (e) {
    this.setData({ memberSettingsRole: e.currentTarget.dataset.role });
  },

  saveMemberInfo: function () {
    var that = this;
    var name = this.data.memberSettingsName.trim();
    if (!name) { wx.showToast({ title: '请输入昵称', icon: 'none' }); return; }
    wx.showLoading({ title: '保存中...', mask: true });
    cloudAPI.updateMemberInfo(this.data.memberSettingsOpenid, name, this.data.memberSettingsRole).then(function () {
      wx.hideLoading();
      // refresh family info
      return cloudAPI.familyGetInfo();
    }).then(function (res) {
      var info = res.family.memberInfo || {};
      that.setData({
        familyMemberInfo: info,
        showMemberEdit: false
      });
      wx.showToast({ title: '已更新', icon: 'success' });
    }).catch(function () {
      wx.hideLoading();
    });
  },

  /** ========== 搜索 ========== */

  showSearchModal: function () {
    this.setData({ showSearch: true, searchQuery: '', searchResults: [] });
  },

  hideSearchModal: function () {
    this.setData({ showSearch: false });
  },

  clearSearch: function () {
    this.setData({ searchQuery: '', searchResults: [] });
  },

  onSearchInput: function (e) {
    var q = e.detail.value.trim().toLowerCase();
    this.setData({ searchQuery: e.detail.value });
    if (!q) { this.setData({ searchResults: [] }); return; }
    var tasks = wx.getStorageSync('cachedTasks') || [];
    var results = [];
    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      if (t.name && t.name.toLowerCase().indexOf(q) !== -1) {
        var dateText = t.date ? util.formatDate(t.date) : '';
        var timeDisplay = '';
        if (t.startTime && t.endTime) timeDisplay = t.startTime + '─' + t.endTime;
        else if (t.startTime) timeDisplay = t.startTime;
        else timeDisplay = '全天';
        results.push({
          id: t._id,
          name: t.name,
          child: t.child,
          date: t.date,
          dateText: dateText || '（重复日程）',
          timeDisplay: timeDisplay,
          isRecurring: !!t.repeatRule,
          repeatDesc: t.repeatRule ? util.describeRepeatDays(t.repeatRule.daysOfWeek) : ''
        });
      }
    }
    results.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    this.setData({ searchResults: results.slice(0, 50) });
  },

  goToSearchResult: function (e) {
    var date = e.currentTarget.dataset.date;
    if (!date) {
      wx.showToast({ title: '重复日程，请在日历中查看', icon: 'none' });
      return;
    }
    this.hideSearchModal();
    this.switchViewDate(date);
  },

  /** ========== 节假日同步 ========== */

  syncHolidays: function () {
    var that = this;
    var year = this.data.calendarYear || new Date().getFullYear();
    wx.showLoading({ title: '获取节假日...', mask: true });
    cloudAPI.syncHolidays(year).then(function (res) {
      wx.hideLoading();
      if (res.code === 0) {
        that.setData({ fetchedHolidays: res.holidays });
        wx.setStorageSync('fetchedHolidays_' + year, res.holidays);
        that.refreshCalendar();
        wx.showToast({ title: year + '年节假日已更新', icon: 'success' });
      } else if (res.data && Object.keys(res.data).length > 0) {
        // 存储失败但数据已获取
        that.setData({ fetchedHolidays: res.data });
        wx.setStorageSync('fetchedHolidays_' + year, res.data);
        that.refreshCalendar();
        wx.showToast({ title: '已获取数据（存储失败，请在云开发控制台创建 holidays 集合）', icon: 'none' });
      } else {
        wx.showToast({ title: res.msg || '获取失败', icon: 'none' });
      }
    }).catch(function (err) {
      wx.hideLoading();
      wx.showToast({ title: err && err.message ? err.message : '网络错误', icon: 'none' });
    });
  },

  /** ========== 数据展示 ========== */

  // 根据 tasks + completions 计算并渲染双栏
  setDisplayData: function (tasks, completions) {
    var targetDate = this.data.currentViewDate || util.getToday();
    var todayInstances = this.buildTaskInstances(tasks, completions, targetDate);

    var elder = [];
    var younger = [];
    var elderC = 0;
    var youngerC = 0;

    for (var i = 0; i < todayInstances.length; i++) {
      if (todayInstances[i].child === 'elder') {
        elder.push(todayInstances[i]);
        if (todayInstances[i].completed) elderC++;
      } else {
        younger.push(todayInstances[i]);
        if (todayInstances[i].completed) youngerC++;
      }
    }

    var total = todayInstances.length;
    var completed = elderC + youngerC;
    var percent = total > 0 ? Math.round(completed / total * 100) : 0;

    this.setData({
      elderTasks: elder,
      youngerTasks: younger,
      elderCompletedCount: elderC,
      youngerCompletedCount: youngerC,
      totalCount: total,
      completedCount: completed,
      progressPercent: percent
    });

    if (this.data.showCalendar) this.refreshCalendar();
  },

  // 将 tasks 转换为某天的实例列表（含一次性 + 重复匹配）
  buildTaskInstances: function (tasks, completions, targetDate) {
    var targetDow = util.getDayOfWeek(targetDate);
    var result = [];

    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      var match = false;

      if (t.date && t.date === targetDate) {
        match = true;
      }
      if (!match && t.repeatRule && t.repeatRule.type === 'weekly') {
        var rule = t.repeatRule;
        if (targetDate >= rule.startDate && targetDate <= rule.endDate) {
          if (rule.daysOfWeek.indexOf(targetDow) !== -1) {
            var skipped = rule.skippedDates || [];
            if (skipped.indexOf(targetDate) === -1) {
              match = true;
            }
          }
        }
      }

      if (match) {
        var key = t._id + '_' + targetDate;
        var timeDisplay = '';
        var isAllDay = false;
        if (!t.startTime) {
          timeDisplay = '全天';
          isAllDay = true;
        } else if (!t.endTime) {
          timeDisplay = t.startTime;
        } else {
          timeDisplay = t.startTime + ' ─ ' + t.endTime;
        }
        result.push({
          _id: t._id,
          id: t._id,
          child: t.child,
          name: t.name,
          startTime: t.startTime || '',
          endTime: t.endTime || '',
          timeDisplay: timeDisplay,
          isAllDay: isAllDay,
          location: t.location || '',
          locationData: t.locationData || null,
          date: targetDate,
          completed: !!completions[key],
          isRecurring: !!t.repeatRule,
          repeatDesc: t.repeatRule ? util.describeRepeatDays(t.repeatRule.daysOfWeek) : ''
        });
      }
    }

    function toMins(s) { if (!s) return 0; var p = s.split(':'); return parseInt(p[0]) * 60 + parseInt(p[1] || 0); }
    result.sort(function (a, b) {
      return toMins(a.isAllDay ? '' : a.startTime) - toMins(b.isAllDay ? '' : b.startTime);
    });

    // 冲突检测：同个孩子时间重叠的标记
    for (var ci = 0; ci < result.length; ci++) {
      result[ci].conflictNames = [];
    }
    for (var ci = 0; ci < result.length; ci++) {
      if (result[ci].isAllDay) continue;
      if (!result[ci].endTime) continue;
      var outerS = result[ci].startTime;
      var outerE = result[ci].endTime;
      for (var cj = ci + 1; cj < result.length; cj++) {
        if (result[cj].isAllDay) continue;
        if (result[ci].child !== result[cj].child) continue;
        if (result[cj].endTime) {
          if (result[cj].startTime >= outerE) break;
        } else {
          if (result[cj].startTime < outerS || result[cj].startTime >= outerE) continue;
        }
        result[ci].conflictNames.push(result[cj].name);
        result[cj].conflictNames.push(result[ci].name);
      }
    }

    return result;
  },

  // 从云端刷新显示
  refreshDisplay: function () {
    var that = this;
    cloudAPI.loadAllData(true).then(function (res) {
      var tasks = res.tasks || [];
      var comps = res.completions || [];
      var compMap = {};
      for (var i = 0; i < comps.length; i++) {
        compMap[comps[i].taskId + '_' + comps[i].date] = comps[i].completed;
      }
      wx.setStorageSync('cachedTasks', tasks);
      wx.setStorageSync('cachedCompletions', compMap);
      that.setDisplayData(tasks, compMap);
    }).catch(function () {
      var tasks = wx.getStorageSync('cachedTasks') || [];
      var compMap = wx.getStorageSync('cachedCompletions') || {};
      that.setDisplayData(tasks, compMap);
    });
  },

  /** ========== 详情弹窗 ========== */

  showTaskDetail: function (e) {
    var id = e.currentTarget.dataset.id;
    var date = e.currentTarget.dataset.date || util.getToday();
    var tasks = this.data.elderTasks.concat(this.data.youngerTasks);
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].id === id && tasks[i].date === date) {
        var task = tasks[i];
        task._formattedDate = util.formatDate(task.date);
        this.setData({ showDetail: true, detailTask: task });
        return;
      }
    }
  },

  hideDetail: function () {
    this.setData({ showDetail: false, detailTask: null });
  },

  // ===== 全局自动提醒 =====
  _templateId: 'd9Nmor71fyxwHSfxTzBgH_-53T58VJaSMDGYDBb26gk',

  // ---------- 订阅额度本地估算（微信无剩余次数 API，用本地记录近似） ----------
  // 存储结构：{ quota: 总次数, expiredAt: 过期时间戳 }
  // 每轮小程序进入时按天数线性衰减；续订时重置为上限并延长过期时间
  _QUOTA_STORAGE_KEY: 'reminderQuota',
  _BATCH_SIZE: 10,           // 每次请求订阅一次拿到的额度
  _EXPIRE_DAYS: 14,          // 10 次额度的理论有效期（微信规定最长 14 天）
  _DAILY_USE: 3,             // 每天估算使用次数（20:00 汇总 + 2 条日程前1小时）

  _readQuota: function () {
    try {
      var raw = wx.getStorageSync(this._QUOTA_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  },
  _saveQuota: function (quota) {
    try {
      wx.setStorageSync(this._QUOTA_STORAGE_KEY, JSON.stringify(quota));
    } catch (e) {}
  },
  // 计算并刷新本地展示的剩余次数（按天线性衰减）
  _refreshQuotaDisplay: function () {
    var that = this;
    var now = Date.now();
    var stored = that._readQuota();
    var initial = that._BATCH_SIZE;
    var remaining = initial;

    if (stored) {
      // 如果还没过期，按天衰减；若已过期则回滚到 0
      var daysSince = (now - stored.createdAt) / (24 * 60 * 60 * 1000);
      var maxDays = that._EXPIRE_DAYS;
      if (daysSince < maxDays) {
        remaining = Math.max(0, Math.round(initial * (1 - daysSince / maxDays)));
      } else {
        remaining = 0;
      }
    }

    that.setData({
      reminderQuotaLeft: remaining,
      reminderQuotaExpired: remaining === 0
    });
  },
  // 续订成功后更新本地记录（重置为满额）
  _markQuotaRefreshed: function () {
    var now = Date.now();
    this._saveQuota({ createdAt: now, batch: this._BATCH_SIZE });
    this.setData({
      reminderQuotaLeft: this._BATCH_SIZE,
      reminderQuotaExpired: false
    });
  },

  // 批量请求订阅消息（返回 Promise）
  // ⚠️ 必须在用户点击事件（bindtap）的回调中调用，不能在 onShow/onLoad 等生命周期里调用
  _batchRequestSubscribe: function (count) {
    var templateId = this._templateId;
    var done = 0;
    return new Promise(function (resolve) {
      function requestNext() {
        if (done >= count) { resolve(); return; }
        wx.requestSubscribeMessage({
          tmplIds: [templateId],
          success: function () {
            done++;
            setTimeout(requestNext, 300);
          },
          fail: function () {
            // 静默失败：微信可能在非用户点击场景下拒绝，不干扰正常流程
            done++;
            setTimeout(requestNext, 300);
          }
        });
      }
      requestNext();
    });
  },

  // 开启/关闭提醒
  toggleAutoReminder: function () {
    var that = this;
    if (this.data.hasAutoReminder) {
      cloudAPI.disableAutoReminder().then(function () {
        that.setData({ hasAutoReminder: false });
        wx.showToast({ title: '已关闭提醒', icon: 'success' });
      });
    } else {
      cloudAPI.enableAutoReminder({ familyId: that.data.familyId }).then(function () {
        that.setData({ hasAutoReminder: true });
        wx.showLoading({ title: '授权中...', mask: true });
        that._batchRequestSubscribe(10).then(function () {
          wx.hideLoading();
          that._markQuotaRefreshed();
          wx.showToast({ title: '已开启，可点「补充订阅」续订', icon: 'none' });
        });
      });
    }
  },

  // 用户主动点击「补充订阅」→ 续订 10 次（合法的用户点击触发点）
  // 微信要求订阅授权弹窗必须由用户点击触发，所以"续订"也必须走这里，
  // 不能在 onShow / onLoad 等生命周期里自动调用（会被静默拒绝、弹窗不出现）。
  supplementSubscriptions: function () {
    var that = this;
    if (!this.data.hasAutoReminder) {
      wx.showToast({ title: '请先开启提醒', icon: 'none' });
      return;
    }
    this._batchRequestSubscribe(10).then(function () {
      wx.showToast({ title: '已补充订阅 10 次', icon: 'success' });
      that._markQuotaRefreshed();
    });
  },

  // 点击「测试提醒」按钮 → 发送一条测试消息到当前用户，验证订阅通道是否畅通
  testReminder: function () {
    var that = this;
    if (!this.data.hasAutoReminder) {
      wx.showToast({ title: '请先开启自动提醒', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '发送测试消息...', mask: true });
    cloudAPI.testReminder().then(function (res) {
      wx.hideLoading();
      wx.showToast({ title: res.msg || '测试消息已发送', icon: 'success' });
    }).catch(function (err) {
      wx.hideLoading();
      wx.showToast({ title: err && err.message ? err.message : '发送失败', icon: 'none' });
    });
  },

  // 检查自动提醒状态（只读取开关，不做后台自动续订）
  checkAutoReminderStatus: function () {
    var that = this;
    cloudAPI.checkAutoReminderStatus().then(function (res) {
      that.setData({ hasAutoReminder: res.enabled, remindAdvanceMinutes: res.remindAdvanceMinutes || 60 });
    }).catch(function () {});
  },

  // 顺路攒订阅额度：在用户已经点击的操作里（勾选完成）顺带请求 1 次授权
  // 规则：每轮小程序进入内最多弹一次（用 _hasSubscribedThisSession 控制）；
  //       微信连续调用同一模板时只会弹出第一个，后续静默成功，
  //       所以这里一次就够"补一次额度"，不影响日常体验。
  _trySubtleSubscribe: function () {
    if (!this.data.hasAutoReminder) return;
    if (this.data._hasSubscribedThisSession) return;
    var that = this;
    that._batchRequestSubscribe(1).then(function () {
      that.setData({ _hasSubscribedThisSession: true });
      // 顺手把额度记录刷新一次（+1 条，同时重置时间窗口让显示更准确）
      that._markQuotaRefreshed();
      console.log('【提醒】顺路续订 +1 次');
    });
  },

  toggleCompleteInDetail: function () {
    if (!this.data.detailTask) return;
    var task = this.data.detailTask;
    var newVal = !task.completed;
    var that = this;
    cloudAPI.toggleComplete(task.id, task.date, newVal).then(function () {
      task.completed = newVal;
      that.setData({ detailTask: task });
      that.refreshDisplay();
      util.vibrate();
      that._trySubtleSubscribe();
    });
  },

  toggleQuickComplete: function (e) {
    var id = e.currentTarget.dataset.id;
    var date = e.currentTarget.dataset.date || util.getToday();
    var tasks = this.data.elderTasks.concat(this.data.youngerTasks);
    var currentCompleted = false;
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].id === id && tasks[i].date === date) {
        currentCompleted = tasks[i].completed;
        break;
      }
    }
    var newVal = !currentCompleted;
    var that = this;
    cloudAPI.toggleComplete(id, date, newVal).then(function () {
      that.refreshDisplay();
      if (that.data.showDetail && that.data.detailTask && that.data.detailTask.id === id) {
        that.data.detailTask.completed = newVal;
        that.setData({ detailTask: that.data.detailTask });
      }
      util.vibrate();
      that._trySubtleSubscribe();
    });
  },

  /** ===== 地图导航 ===== */

  openLocation: function () {
    var data = this.data.detailTask && this.data.detailTask.locationData;
    if (data && data.latitude && data.longitude) {
      wx.openLocation({
        latitude: data.latitude,
        longitude: data.longitude,
        name: data.name || '',
        address: data.address || ''
      });
    } else if (this.data.detailTask && this.data.detailTask.location) {
      wx.showToast({ title: '该地点暂无详细坐标', icon: 'none' });
    }
  },

  /** ===== 日期导航 ===== */

  // 切换日期：查看前一天/后一天/今天/选择日期
  goPrevDay: function () {
    var d = new Date(this.data.currentViewDate + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    this.switchViewDate(util.formatDateNum(d.getFullYear(), d.getMonth() + 1, d.getDate()));
  },

  goNextDay: function () {
    var d = new Date(this.data.currentViewDate + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    this.switchViewDate(util.formatDateNum(d.getFullYear(), d.getMonth() + 1, d.getDate()));
  },

  goToday: function () {
    this.switchViewDate(util.getToday());
  },

  onDatePickerChange: function (e) {
    this.switchViewDate(e.detail.value);
  },

  // 核心：切换到指定日期并刷新显示
  switchViewDate: function (dateStr) {
    var today = util.getToday();
    var isToday = dateStr === today;
    this.setData({
      currentViewDate: dateStr,
      viewDateDisplay: util.formatDate(dateStr),
      isViewToday: isToday
    });

    var that = this;
    var tasks = wx.getStorageSync('cachedTasks') || [];
    var compMap = wx.getStorageSync('cachedCompletions') || {};
    that.setDisplayData(tasks, compMap);

    if (this._switchTimer) clearTimeout(this._switchTimer);
    this._switchTimer = setTimeout(function () {
      cloudAPI.loadAllData(true).then(function (res) {
        var t = res.tasks || [];
        var comps = res.completions || [];
        var cm = {};
        for (var i = 0; i < comps.length; i++) {
          cm[comps[i].taskId + '_' + comps[i].date] = comps[i].completed;
        }
        wx.setStorageSync('cachedTasks', t);
        wx.setStorageSync('cachedCompletions', cm);
        that.setDisplayData(t, cm);
      }).catch(function () {});
    }, 300);
  },

  /** ===== 添加/编辑任务 ===== */

  showAddModal: function () {
    this.openForm(null);
  },

  editTask: function () {
    var task = this.data.detailTask;
    if (!task) return;
    this.hideDetail();
    var tasks = wx.getStorageSync('cachedTasks') || [];
    var raw = null;
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i]._id === task.id) { raw = tasks[i]; break; }
    }
    this.openForm(raw || task);
  },

  openForm: function (raw) {
    var now = new Date();
    var h = String(now.getHours()).padStart(2, '0');
    var m = String(now.getMinutes()).padStart(2, '0');
    var threeMonthsLater = new Date();
    threeMonthsLater.setMonth(threeMonthsLater.getMonth() + 3);

    if (raw) {
      var isRepeat = !!(raw.repeatRule);
      var childIndex = raw.child === 'younger' ? 1 : 0;
      var daysArr = [0,0,0,0,0,0,0];
      if (isRepeat && raw.repeatRule.daysOfWeek) {
        for (var di = 0; di < raw.repeatRule.daysOfWeek.length; di++) {
          daysArr[raw.repeatRule.daysOfWeek[di]] = 1;
        }
      }
      this.setData({
        showAddModal: true,
        isEditing: true,
        editingTaskId: raw._id,
        formDate: isRepeat ? raw.repeatRule.startDate : raw.date,
        formAllDay: !raw.startTime,
        formStartTime: raw.startTime || h + ':' + m,
        formEndTime: raw.endTime || '',
        formName: raw.name,
        formLocation: raw.location || '',
        formLocationData: raw.locationData || null,
        formChildIndex: childIndex,
        formRepeatType: isRepeat ? 1 : 0,
        formRepeatDays: daysArr,
        formRepeatEndDate: isRepeat ? raw.repeatRule.endDate : util.formatDateNum(
          threeMonthsLater.getFullYear(), threeMonthsLater.getMonth() + 1, threeMonthsLater.getDate()
        )
      });
    } else {
      this.setData({
        showAddModal: true,
        isEditing: false,
        editingTaskId: null,
        formDate: this.data.currentViewDate || util.getToday(),
        formAllDay: false,
        formStartTime: h + ':' + m,
        formEndTime: '',
        formName: '',
        formLocation: '',
        formLocationData: null,
        formChildIndex: parseInt(wx.getStorageSync('lastChildIndex')) || 0,
        formRepeatType: 0,
        formRepeatDays: [0,0,0,0,0,0,0],
        formRepeatEndDate: util.formatDateNum(
          threeMonthsLater.getFullYear(), threeMonthsLater.getMonth() + 1, threeMonthsLater.getDate()
        )
      });
    }
  },

  hideAddModal: function () {
    this.setData({ showAddModal: false, isEditing: false, editingTaskId: null });
  },

  chooseLocation: function () {
    var that = this;
    wx.chooseLocation({
      success: function (res) {
        that.setData({
          formLocation: res.address || res.name,
          formLocationData: {
            name: res.name,
            address: res.address,
            latitude: res.latitude,
            longitude: res.longitude
          }
        });
      },
      fail: function () {
        wx.showToast({ title: '已切换为手动输入', icon: 'none' });
      }
    });
  },

  clearLocation: function () {
    this.setData({ formLocation: '', formLocationData: null });
  },

  // 表单
  onChildChange: function (e) { this.setData({ formChildIndex: parseInt(e.detail.value) }); },
  onDateChange: function (e) { this.setData({ formDate: e.detail.value }); },
  toggleFormAllDay: function () { this.setData({ formAllDay: !this.data.formAllDay }); },
  onStartTimeChange: function (e) { this.setData({ formStartTime: e.detail.value }); },
  onEndTimeChange: function (e) { this.setData({ formEndTime: e.detail.value }); },
  onNameInput: function (e) { this.setData({ formName: e.detail.value }); },
  onLocationInput: function (e) { this.setData({ formLocation: e.detail.value }); },
  onRepeatTypeChange: function (e) { this.setData({ formRepeatType: parseInt(e.detail.value) }); },
  onRepeatEndDateChange: function (e) { this.setData({ formRepeatEndDate: e.detail.value }); },
  noop: function () {},

  toggleRepeatDay: function (e) {
    var idx = parseInt(e.currentTarget.dataset.idx);
    var days = this.data.formRepeatDays.slice();
    days[idx] = days[idx] ? 0 : 1;
    this.setData({ formRepeatDays: days });
  },

  addTask: function () {
    var name = this.data.formName.trim();
    if (!name) {
      wx.showToast({ title: '请输入日程名称', icon: 'none' });
      return;
    }

    var childKey = this.data.formChildIndex === 0 ? 'elder' : 'younger';
    var isRepeat = this.data.formRepeatType === 1;
    var taskData = {
      child: childKey,
      name: name,
      startTime: this.data.formAllDay ? '' : this.data.formStartTime,
      endTime: this.data.formAllDay ? '' : this.data.formEndTime,
      location: this.data.formLocation,
      locationData: this.data.formLocationData
    };

    if (isRepeat) {
      var selectedDays = [];
      for (var i = 0; i < this.data.formRepeatDays.length; i++) {
        if (this.data.formRepeatDays[i]) selectedDays.push(i);
      }
      if (selectedDays.length === 0) {
        wx.showToast({ title: '请至少选择一天', icon: 'none' });
        return;
      }
      taskData.date = null;
      taskData.repeatRule = {
        type: 'weekly',
        daysOfWeek: selectedDays,
        startDate: this.data.formDate,
        endDate: this.data.formRepeatEndDate
      };
    } else {
      taskData.date = this.data.formDate;
      taskData.repeatRule = null;
    }

    var that = this;
    var isEdit = this.data.isEditing;
    wx.showLoading({ title: isEdit ? '保存中...' : '添加中...', mask: true });
    var promise = isEdit
      ? cloudAPI.updateTask(this.data.editingTaskId, taskData)
      : cloudAPI.addTask(taskData);
    promise.then(function () {
      wx.hideLoading();
      wx.setStorageSync('lastChildIndex', that.data.formChildIndex);
      that.setData({ showAddModal: false, isEditing: false, editingTaskId: null });
      that.syncFromCloud();
      util.vibrate();
    }).catch(function () {
      wx.hideLoading();
    });
  },

  /** ===== 批量录入 ===== */

  showBatchInput: function () {
    this.setData({
      showBatchInput: true,
      batchChildIndex: parseInt(wx.getStorageSync('lastChildIndex')) || 0,
      batchText: '',
      batchPreview: []
    });
  },

  hideBatchInput: function () {
    this.setData({ showBatchInput: false, batchText: '', batchPreview: [], batchUploading: false });
  },

  onBatchChildChange: function (e) {
    var idx = parseInt(e.detail.value);
    this.setData({ batchChildIndex: idx });
    if (this.data.batchText) {
      var parsed = this.parseBatchText(this.data.batchText, idx === 0 ? 'elder' : 'younger', new Date().getFullYear());
      this.setData({ batchPreview: parsed.tasks });
    }
  },

  onBatchTextInput: function (e) {
    var text = e.detail.value;
    this.setData({ batchText: text });
    // 实时解析
    var parsed = this.parseBatchText(text, this.data.batchChildIndex === 0 ? 'elder' : 'younger', new Date().getFullYear());
    this.setData({ batchPreview: parsed.tasks });
  },

  // 解析批量文本为任务数组
  parseBatchText: function (text, child, currentYear) {
    var lines = text.split('\n');
    var tasks = [];
    var currentDate = '';
    var pendingName = '';

    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function padTime(t) { if (!t) return ''; var p = t.split(':'); return pad2(parseInt(p[0])) + ':' + pad2(parseInt(p[1] || 0)); }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      var dateMatch = line.match(/^(\d{1,2})月(\d{1,2})日/);
      if (dateMatch) {
        currentDate = currentYear + '-' + pad2(dateMatch[1]) + '-' + pad2(dateMatch[2]);
        pendingName = '';
        continue;
      }

      if (line === '上午' || line === '下午') { continue; }

      var fullMatch = line.match(/^(.+?)\s*(\d{1,2}:\d{2})\s*[~\-\—]\s*(\d{1,2}:\d{2})$/);
      if (fullMatch) {
        pendingName = '';
        tasks.push({
          name: fullMatch[1].trim(),
          startTime: padTime(fullMatch[2]),
          endTime: padTime(fullMatch[3]),
          date: currentDate,
          child: child
        });
        continue;
      }

      var timeLineMatch = line.match(/^(\d{1,2}:\d{2})\s*[~\-\—]\s*(\d{1,2}:\d{2})$/);
      if (timeLineMatch) {
        if (pendingName) {
          tasks.push({
            name: pendingName,
            startTime: padTime(timeLineMatch[1]),
            endTime: padTime(timeLineMatch[2]),
            date: currentDate,
            child: child
          });
          pendingName = '';
        }
        continue;
      }

      pendingName = line;
    }

    return { tasks: tasks };
  },

  batchSubmit: function () {
    var preview = this.data.batchPreview;
    if (preview.length === 0) {
      wx.showToast({ title: '没有可添加的日程', icon: 'none' });
      return;
    }

    var that = this;
    this.setData({ batchUploading: true });

    var chain = Promise.resolve();
    var successCount = 0;
    var failCount = 0;

    for (var i = 0; i < preview.length; i++) {
      chain = chain.then((function(task) {
        return function() {
          return cloudAPI.addTaskSilent(task).then(function () {
            successCount++;
          }).catch(function () {
            failCount++;
          });
        };
      })(preview[i]));
    }

    chain.then(function () {
      that.setData({
        showBatchInput: false,
        batchText: '',
        batchPreview: [],
        batchUploading: false
      });
      wx.setStorageSync('lastChildIndex', that.data.batchChildIndex);
      that.syncFromCloud();
      if (failCount > 0) {
        wx.showToast({ title: '成功 ' + successCount + ' 项，失败 ' + failCount + ' 项', icon: 'none' });
      } else {
        wx.showToast({ title: '成功添加 ' + successCount + ' 项', icon: 'success' });
      }
    });
  },

  /** ===== 重置今日 ===== */

  resetToday: function () {
    var that = this;
    wx.showModal({
      title: '确认重置',
      content: '将清空今日所有任务的已完成状态，确定要重置吗？',
      success: function (res) {
        if (res.confirm) {
          var today = util.getToday();
          wx.showLoading({ title: '重置中...', mask: true });
          cloudAPI.resetToday(today).then(function () {
            wx.hideLoading();
            that.syncFromCloud();
            wx.showToast({ title: '已重置', icon: 'success' });
          }).catch(function () {
            wx.hideLoading();
          });
        }
      }
    });
  },

  /** ===== 删除任务 ===== */

  deleteTask: function () {
    var task = this.data.detailTask;
    if (!task) return;
    var that = this;

    if (task.isRecurring) {
      wx.showActionSheet({
        itemList: ['仅删除当天', '删除所有重复'],
        success: function (res) {
          if (res.tapIndex === 0) {
            wx.showLoading({ title: '处理中...', mask: true });
            cloudAPI.skipDate(task.id, task.date).then(function () {
              wx.hideLoading();
              that.hideDetail();
              that.refreshDisplay();
              wx.showToast({ title: '已跳过该天', icon: 'success' });
            }).catch(function () { wx.hideLoading(); });
          } else if (res.tapIndex === 1) {
            wx.showModal({
              title: '确认删除',
              content: '将删除该重复日程及其所有完成记录，确定吗？',
              success: function (modalRes) {
                if (modalRes.confirm) {
                  wx.showLoading({ title: '删除中...', mask: true });
                  cloudAPI.deleteTask(task.id).then(function () {
                    wx.hideLoading();
                    that.hideDetail();
                    that.refreshDisplay();
                    wx.showToast({ title: '已删除', icon: 'success' });
                  }).catch(function () { wx.hideLoading(); });
                }
              }
            });
          }
        }
      });
    } else {
      wx.showModal({
        title: '确认删除',
        content: '确定要删除此日程吗？',
        success: function (res) {
          if (res.confirm) {
            wx.showLoading({ title: '删除中...', mask: true });
            cloudAPI.deleteTask(task.id).then(function () {
              wx.hideLoading();
              that.hideDetail();
              that.refreshDisplay();
              wx.showToast({ title: '已删除', icon: 'success' });
            }).catch(function () { wx.hideLoading(); });
          }
        }
      });
    }
  },

  /** ===== 月历视图 ===== */

  toggleCalendar: function () {
    var showing = this.data.showCalendar;
    if (showing) {
      this.setData({ showCalendar: false });
    } else {
      var d = new Date(this.data.currentViewDate + 'T00:00:00');
      this.setData({
        showCalendar: true,
        calendarYear: d.getFullYear(),
        calendarMonth: d.getMonth() + 1
      });
      this.refreshCalendar();
    }
  },

  goPrevMonth: function () {
    var y = this.data.calendarYear;
    var m = this.data.calendarMonth - 1;
    if (m < 1) { m = 12; y--; }
    this.setData({ calendarYear: y, calendarMonth: m });
    this.refreshCalendar();
  },

  goNextMonth: function () {
    var y = this.data.calendarYear;
    var m = this.data.calendarMonth + 1;
    if (m > 12) { m = 1; y++; }
    this.setData({ calendarYear: y, calendarMonth: m });
    this.refreshCalendar();
  },

  onCalendarDayTap: function (e) {
    this.switchViewDate(e.currentTarget.dataset.date);
    this.setData({ showCalendar: false });
  },

  refreshCalendar: function () {
    var tasks = wx.getStorageSync('cachedTasks') || [];
    var completions = wx.getStorageSync('cachedCompletions') || {};
    var days = this.buildCalendarData(tasks, completions);
    this.setData({ calendarDays: days });
  },

  buildCalendarData: function (tasks, completions) {
    var that = this;
    var year = that.data.calendarYear;
    var month = that.data.calendarMonth;
    var today = util.getToday();

    var firstDay = new Date(year, month - 1, 1);
    var daysInMonth = new Date(year, month, 0).getDate();
    var startDow = firstDay.getDay();
    var offset = startDow;

    var days = [];

    var prevMonth = month === 1 ? 12 : month - 1;
    var prevYear = month === 1 ? year - 1 : year;
    var prevMonthDays = new Date(prevYear, prevMonth, 0).getDate();
    function addDay(dayNum, dateStr, isCurrent, count, hasConflict) {
      var holiday = HOLIDAYS_2026[dateStr] || null;
      if (!holiday) {
        var fetched = that.data.fetchedHolidays;
        if (fetched && fetched[dateStr]) holiday = fetched[dateStr];
      }
      days.push({ dayNum: dayNum, dateStr: dateStr, count: count || 0, hasConflict: !!hasConflict, holiday: holiday, isToday: dateStr === today, isCurrentMonth: isCurrent });
    }

    for (var i = offset - 1; i >= 0; i--) {
      var d = prevMonthDays - i;
      addDay(d, util.formatDateNum(prevYear, prevMonth, d), false);
    }

    for (var d = 1; d <= daysInMonth; d++) {
      var dateStr = util.formatDateNum(year, month, d);
      var info = this.countAndConflictForDate(tasks, completions, dateStr);
      addDay(d, dateStr, true, info.count, info.hasConflict);
    }

    var remaining = 42 - days.length;
    var nextMonth = month === 12 ? 1 : month + 1;
    var nextYear = month === 12 ? year + 1 : year;
    for (var d = 1; d <= remaining && days.length < 42; d++) {
      addDay(d, util.formatDateNum(nextYear, nextMonth, d), false);
    }

    return days;
  },

  // 对某天: 返回 { count, hasConflict }
  countAndConflictForDate: function (tasks, completions, dateStr) {
    var targetDow = util.getDayOfWeek(dateStr);
    var matches = [];
    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      var match = false;
      if (t.date && t.date === dateStr) match = true;
      if (!match && t.repeatRule && t.repeatRule.type === 'weekly') {
        var rule = t.repeatRule;
        if (dateStr >= rule.startDate && dateStr <= rule.endDate) {
          if (rule.daysOfWeek.indexOf(targetDow) !== -1) {
            var skipped = rule.skippedDates || [];
            if (skipped.indexOf(dateStr) === -1) match = true;
          }
        }
      }
      if (match) matches.push(t);
    }
    function toMins(s) { if (!s) return 0; var p = s.split(':'); return parseInt(p[0]) * 60 + parseInt(p[1] || 0); }
    matches.sort(function (a, b) {
      return toMins(a.isAllDay ? '' : a.startTime) - toMins(b.isAllDay ? '' : b.startTime);
    });
    var hasConflict = false;
    for (var ci = 0; ci < matches.length && !hasConflict; ci++) {
      if (!matches[ci].endTime) continue;
      var outerS = matches[ci].startTime || '00:00';
      var outerE = matches[ci].endTime;
      for (var cj = ci + 1; cj < matches.length && !hasConflict; cj++) {
        if (matches[ci].child !== matches[cj].child) continue;
        var innerS = matches[cj].startTime || '00:00';
        if (matches[cj].endTime) {
          if (innerS >= outerE) break;
        } else {
          if (innerS < outerS || innerS >= outerE) continue;
        }
        hasConflict = true;
      }
    }
    return { count: matches.length, hasConflict: hasConflict };
  }
});
