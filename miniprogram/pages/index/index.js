const USER_CLOUD_FUNCTION_NAME = "userService";

function getCloudEnv() {
  const app = getApp();
  return app && app.globalData ? app.globalData.env : "";
}

function normalizeRuntimeDataVersion(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized === "develop" ? "develop" : "trial";
}

function normalizeStorageRoot(value) {
  return normalizeRuntimeDataVersion(value);
}

function getRuntimeContext() {
  const app = getApp();
  return {
    runtimeEnvVersion:
      app && typeof app.getRuntimeEnvVersion === "function"
        ? app.getRuntimeEnvVersion()
        : "trial",
    runtimeDataVersion:
      app && typeof app.getRuntimeDataVersion === "function"
        ? app.getRuntimeDataVersion()
        : normalizeRuntimeDataVersion(app && app.globalData ? app.globalData.runtimeDataVersion : ""),
    storageRoot:
      app && typeof app.getStorageRoot === "function"
        ? app.getStorageRoot()
        : normalizeStorageRoot(app && app.globalData ? app.globalData.storageRoot : ""),
  };
}

function getNavigationMetrics() {
  const systemInfo =
    typeof wx.getWindowInfo === "function" ? wx.getWindowInfo() : wx.getSystemInfoSync();
  const menuButtonRect =
    typeof wx.getMenuButtonBoundingClientRect === "function"
      ? wx.getMenuButtonBoundingClientRect()
      : null;
  const statusBarHeight = systemInfo.statusBarHeight || 20;
  const capsuleWidth = menuButtonRect ? systemInfo.windowWidth - menuButtonRect.left + 12 : 196;
  const navBarHeight = menuButtonRect
    ? menuButtonRect.height + (menuButtonRect.top - statusBarHeight) * 2
    : 44;

  return {
    statusBarHeight,
    navBarHeight,
    totalHeight: statusBarHeight + navBarHeight,
    capsuleWidth,
  };
}

function getErrorMessage(err) {
  return (err && (err.errMsg || err.message)) || "";
}

function unwrapCloudResult(resp) {
  const payload = resp && Object.prototype.hasOwnProperty.call(resp, "result") ? resp.result : resp;
  if (payload && payload.success === false) {
    const error = new Error(payload.errMsg || "云函数调用失败");
    error.raw = payload;
    throw error;
  }
  return payload;
}

function isTimeoutError(errMsg) {
  return String(errMsg || "").toLowerCase().includes("timeout");
}

Page({
  data: {
    showTip: false,
    title: "",
    content: "",
    loadingUser: false,
    loadingAction: false,
    userLoaded: false,
    isAdmin: false,
    currentUser: {
      openid: "",
      role: "",
    },
    navMetrics: getNavigationMetrics(),
  },

  onLoad() {
    this.getCurrentUser();
  },

  onShow() {
    if (this.data.userLoaded) {
      this.getCurrentUser(false);
    }
  },

  showCloudTip(title, content) {
    this.setData({
      showTip: true,
      title,
      content,
    });
  },

  hideCloudTip() {
    this.setData({
      showTip: false,
    });
  },

  async getCurrentUser(showLoading = true) {
    const env = getCloudEnv();
    if (!env) {
      this.showCloudTip(
        "请先配置云开发环境",
        "请在 miniprogram/app.js 中填入 env 后，再使用题库相关功能。"
      );
      return;
    }

    if (showLoading) {
      wx.showLoading({
        title: "同步中...",
      });
    }

    this.setData({
      loadingUser: true,
    });

    try {
      const resp = await wx.cloud.callFunction({
        name: USER_CLOUD_FUNCTION_NAME,
        data: {
          type: "getCurrentUser",
          ...getRuntimeContext(),
        },
      });

      const payload = unwrapCloudResult(resp) || {};
      const user =
        payload && payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
          ? payload.data
          : payload;
      const currentUser = {
        openid: user.openid || "",
        role: user.role || "user",
        createTime: user.createTime || "",
        updateTime: user.updateTime || "",
      };

      this.setData({
        currentUser,
        userLoaded: true,
        isAdmin: currentUser.role === "admin",
      });
    } catch (err) {
      const errMsg = getErrorMessage(err);
      if (isTimeoutError(errMsg)) {
        this.showCloudTip(
          "获取当前用户超时",
          "云函数请求超时，请确认云函数已上传、环境配置正确，并稍后重试。"
        );
      } else if (errMsg.includes("Environment not found")) {
        this.showCloudTip(
          "云开发环境未找到",
          "如果已经开通云开发，请检查 miniprogram/app.js 里的 env 是否正确。"
        );
      } else if (errMsg.includes("FunctionName parameter could not be found")) {
        this.showCloudTip(
          "请先上传云函数",
          "请先上传并部署 cloudfunctions/userService，再返回重试。"
        );
      } else {
        this.showCloudTip("获取当前用户失败", errMsg || "请稍后重试。");
      }
    } finally {
      this.setData({
        loadingUser: false,
      });
      if (showLoading) {
        wx.hideLoading();
      }
    }
  },

  async initCollections() {
    const env = getCloudEnv();
    if (!env) {
      this.showCloudTip(
        "请先配置云开发环境",
        "请在 miniprogram/app.js 中填入 env 后，再初始化集合。"
      );
      return;
    }

    wx.showLoading({
      title: "初始化中...",
    });

    this.setData({
      loadingAction: true,
    });

    try {
      const resp = await wx.cloud.callFunction({
        name: USER_CLOUD_FUNCTION_NAME,
        data: {
          type: "initCollections",
          ...getRuntimeContext(),
        },
      });
      const result = unwrapCloudResult(resp) || {};
      wx.hideLoading();
      if (result.success) {
        wx.showToast({
          title: "初始化完成",
          icon: "success",
        });
      } else {
        this.showCloudTip("初始化未完成", result.errMsg || "请检查云函数返回结果。");
      }
    } catch (err) {
      const errMsg = getErrorMessage(err);
      if (isTimeoutError(errMsg)) {
        this.showCloudTip(
          "初始化集合超时",
          "云函数请求超时，请确认云函数已上传部署，且当前云环境可正常访问。"
        );
      } else if (errMsg.includes("Environment not found")) {
        this.showCloudTip(
          "云开发环境未找到",
          "如果已经开通云开发，请检查 miniprogram/app.js 里的 env 是否正确。"
        );
      } else if (errMsg.includes("FunctionName parameter could not be found")) {
        this.showCloudTip(
          "请先上传云函数",
          "请先上传并部署 cloudfunctions/userService，再返回重试。"
        );
      } else {
        this.showCloudTip("初始化集合失败", errMsg || "请稍后重试。");
      }
    } finally {
      this.setData({
        loadingAction: false,
      });
    }
  },

  openQuestionBrowser() {
    wx.navigateTo({
      url: "/pages/question-practice/index",
    });
  },

  openQuestionAdmin() {
    if (!this.data.isAdmin) {
      this.showCloudTip("权限不足", "当前用户是普通用户，只能浏览题目，不能进入管理员管理页。");
      return;
    }

    wx.navigateTo({
      url: "/pages/question-bank/index?type=questions&mode=admin",
    });
  },

  openPracticeHistory() {
    wx.navigateTo({
      url: "/pages/practice-history/index",
    });
  },
});
