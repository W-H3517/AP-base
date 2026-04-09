// app.js
const STORAGE_ROOTS = {
  develop: "develop",
  trial: "trial",
  release: "trial",
};

function normalizeRuntimeEnvVersion(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized === "develop") {
    return "develop";
  }
  if (normalized === "trial") {
    return "trial";
  }
  if (normalized === "release") {
    return "release";
  }
  return "trial";
}

function normalizeRuntimeDataVersion(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized === "develop" ? "develop" : "trial";
}

function resolveRuntimeEnvVersion() {
  try {
    if (typeof wx.getAccountInfoSync === "function") {
      const info = wx.getAccountInfoSync();
      const envVersion = info && info.miniProgram ? info.miniProgram.envVersion : "";
      return normalizeRuntimeEnvVersion(envVersion);
    }
  } catch (error) {
    console.warn("获取小程序运行版本失败，已回退到 trial", error);
  }
  return "trial";
}

App({
  onLaunch: function () {
    const runtimeEnvVersion = resolveRuntimeEnvVersion();
    const runtimeDataVersion = normalizeRuntimeDataVersion(runtimeEnvVersion);
    this.globalData = {
      // env 参数说明：
      // env 参数决定接下来小程序发起的云开发调用（wx.cloud.xxx）会请求到哪个云环境的资源
      // 此处请填入环境 ID, 环境 ID 可在微信开发者工具右上顶部工具栏点击云开发按钮打开获取
      env: "cloud1-7gndd00c8ed050e6",
      runtimeEnvVersion,
      runtimeDataVersion,
      storageRoot: STORAGE_ROOTS[runtimeEnvVersion] || "trial",
    };
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true,
      });
    }
  },

  getRuntimeEnvVersion() {
    return normalizeRuntimeEnvVersion(this.globalData && this.globalData.runtimeEnvVersion);
  },

  getRuntimeDataVersion() {
    return normalizeRuntimeDataVersion(this.globalData && this.globalData.runtimeDataVersion);
  },

  getStorageRoot() {
    return normalizeRuntimeDataVersion(this.globalData && this.globalData.storageRoot);
  },
});
