App({
  onLaunch: function () {
    wx.cloud.init({
      env: wx.cloud.DYNAMIC_CURRENT_ENV,
      traceUser: false
    });
  }
});
