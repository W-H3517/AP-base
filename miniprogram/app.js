// app.js
const STORAGE_ROOTS = {
  develop: "develop",
  trial: "trial",
  release: "trial",
};
const CURRENT_USER_CACHE_TTL_MS = 5 * 60 * 1000;

function normalizeCurrentUser(user) {
  const source = user && typeof user === "object" ? user : {};
  return {
    openid: source.openid || "",
    role: source.role || "user",
    createTime: source.createTime || "",
    updateTime: source.updateTime || "",
  };
}

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
      currentUserCache: null,
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

  getRuntimeContext() {
    return {
      runtimeEnvVersion: this.getRuntimeEnvVersion(),
      runtimeDataVersion: this.getRuntimeDataVersion(),
      storageRoot: this.getStorageRoot(),
    };
  },

  getCachedCurrentUser(maxAgeMs = CURRENT_USER_CACHE_TTL_MS) {
    const cache = this.globalData && this.globalData.currentUserCache;
    if (!cache || !cache.user || !cache.cachedAt) {
      return null;
    }
    if (Date.now() - Number(cache.cachedAt) > maxAgeMs) {
      return null;
    }
    return normalizeCurrentUser(cache.user);
  },

  setCachedCurrentUser(user) {
    const normalizedUser = normalizeCurrentUser(user);
    if (this.globalData) {
      this.globalData.currentUserCache = {
        user: normalizedUser,
        cachedAt: Date.now(),
      };
    }
    return normalizedUser;
  },

  async fetchCurrentUser(options = {}) {
    const forceRefresh = !!(options && options.forceRefresh);
    const maxAgeMs = Number(options && options.maxAgeMs) || CURRENT_USER_CACHE_TTL_MS;
    if (!forceRefresh) {
      const cachedUser = this.getCachedCurrentUser(maxAgeMs);
      if (cachedUser) {
        return cachedUser;
      }
    }

    if (!forceRefresh && this.currentUserPromise) {
      return this.currentUserPromise;
    }

    const request = wx.cloud.callFunction({
      name: "userService",
      data: {
        type: "getCurrentUser",
        ...this.getRuntimeContext(),
      },
    }).then((resp) => {
      const result = resp && resp.result ? resp.result : {};
      if (result && result.success === false) {
        throw new Error(result.errMsg || "云函数调用失败");
      }
      const data =
        result && result.data && typeof result.data === "object" && !Array.isArray(result.data)
          ? result.data
          : result;
      return this.setCachedCurrentUser(data);
    }).finally(() => {
      if (this.currentUserPromise === request) {
        this.currentUserPromise = null;
      }
    });

    this.currentUserPromise = request;
    return request;
  },
});
