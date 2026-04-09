const QUESTION_CLOUD_FUNCTION_NAME = "questionService";

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

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function isPlainObject(value) {
  return !!value && Object.prototype.toString.call(value) === "[object Object]";
}

function unwrapCloudResult(resp) {
  const result = (resp && resp.result) || {};
  if (result && result.success === false) {
    throw new Error(result.errMsg || "云函数执行失败");
  }
  return result;
}

function getErrorMessage(error) {
  return (error && (error.errMsg || error.message)) || "请求失败";
}

function formatTime(value) {
  const date = new Date(Number(value || 0));
  if (Number.isNaN(date.getTime()) || !Number(value)) {
    return "未知";
  }
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

Page({
  data: {
    showTip: false,
    title: "",
    content: "",
    loading: false,
    historyList: [],
  },

  onLoad() {
    this.loadHistoryList();
  },

  async onPullDownRefresh() {
    try {
      await this.loadHistoryList(true);
    } finally {
      wx.stopPullDownRefresh();
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

  async loadHistoryList(showToast = false) {
    this.setData({
      loading: true,
    });
    try {
      const resp = await wx.cloud.callFunction({
        name: QUESTION_CLOUD_FUNCTION_NAME,
        data: {
          type: "listPracticeSubmissions",
          ...getRuntimeContext(),
        },
      });
      const result = unwrapCloudResult(resp);
      const data = isPlainObject(result.data) ? result.data : {};
      const historyList = normalizeArray(data.list).map((item) => ({
        submissionId: item.submissionId || "",
        totalCount: Number(item.totalCount || 0),
        answeredCount: Number(item.answeredCount || 0),
        correctCount: Number(item.correctCount || 0),
        score: Number(item.score || 0),
        submittedAt: Number(item.submittedAt || 0),
        submittedAtText: formatTime(item.submittedAt),
      }));
      this.setData({
        loading: false,
        historyList,
      });
      if (showToast) {
        wx.showToast({
          title: "记录已刷新",
          icon: "success",
        });
      }
    } catch (error) {
      this.setData({
        loading: false,
      });
      this.showCloudTip("加载记录失败", getErrorMessage(error));
    }
  },

  openHistoryDetail(e) {
    const submissionId = e.currentTarget.dataset.submissionid;
    if (!submissionId) {
      return;
    }
    wx.navigateTo({
      url: `/pages/practice-history-detail/index?submissionId=${submissionId}`,
    });
  },
});
