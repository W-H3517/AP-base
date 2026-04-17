const ASSET_CLOUD_FUNCTION_NAME = "assetService";

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

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
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
    return "";
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
    navMetrics: getNavigationMetrics(),
    loadingConfig: false,
    savingQr: false,
    deletingQr: false,
    qrConfig: {
      fileID: "",
      cloudPath: "",
      hasConfigured: false,
      updatedAt: 0,
      updatedAtText: "",
    },
  },

  onLoad() {
    this.loadQrConfig();
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

  async callAssetFunction(data) {
    const resp = await wx.cloud.callFunction({
      name: ASSET_CLOUD_FUNCTION_NAME,
      data: {
        ...(data || {}),
        ...getRuntimeContext(),
      },
    });
    return unwrapCloudResult(resp);
  },

  async loadQrConfig() {
    const env = getCloudEnv();
    if (!env) {
      this.showCloudTip("请先配置云开发环境", "请在 miniprogram/app.js 中填入 env 后，再管理二维码。");
      return;
    }

    this.setData({
      loadingConfig: true,
    });

    try {
      const result = await this.callAssetFunction({
        type: "getAssistantQrConfig",
      });
      const data = isPlainObject(result.data) ? result.data : {};
      this.setData({
        loadingConfig: false,
        qrConfig: {
          fileID: normalizeString(data.fileID),
          cloudPath: normalizeString(data.cloudPath),
          hasConfigured: !!normalizeString(data.fileID),
          updatedAt: Number(data.updatedAt || 0),
          updatedAtText: formatTime(Number(data.updatedAt || 0)),
        },
      });
    } catch (error) {
      this.setData({
        loadingConfig: false,
      });
      this.showCloudTip("加载二维码配置失败", getErrorMessage(error));
    }
  },

  previewCurrentQr() {
    const src = normalizeString(this.data.qrConfig.fileID);
    if (!src) {
      return;
    }
    wx.previewImage({
      current: src,
      urls: [src],
      showmenu: true,
    });
  },

  async deleteCurrentQr() {
    if (!this.data.qrConfig.hasConfigured) {
      return;
    }

    const modalResult = await wx.showModal({
      title: "删除当前二维码",
      content: "删除后结果页会进入未配置状态，确认继续吗？",
      confirmText: "确认删除",
      confirmColor: "#b91c1c",
    });
    if (!modalResult.confirm) {
      return;
    }

    this.setData({
      deletingQr: true,
    });

    try {
      await this.callAssetFunction({
        type: "deleteAssistantQr",
      });
      wx.showToast({
        title: "已删除",
        icon: "success",
      });
      await this.loadQrConfig();
    } catch (error) {
      this.showCloudTip("删除二维码失败", getErrorMessage(error));
    } finally {
      this.setData({
        deletingQr: false,
      });
    }
  },

  async uploadNewQr() {
    if (this.data.qrConfig.hasConfigured) {
      this.showCloudTip("请先删除旧二维码", "当前系统要求先删除旧图，再上传新的二维码图片。");
      return;
    }

    if (!getCloudEnv()) {
      this.showCloudTip("请先配置云开发环境", "请在 miniprogram/app.js 中填入 env 后，再上传二维码。");
      return;
    }
    if (!normalizeString(this.data.qrConfig.cloudPath)) {
      this.showCloudTip("云路径未准备好", "请先刷新二维码配置，再执行上传。");
      return;
    }

    let uploadedFileId = "";
    this.setData({
      savingQr: true,
    });

    try {
      const chooseResult = await new Promise((resolve, reject) => {
        wx.chooseMedia({
          count: 1,
          mediaType: ["image"],
          sourceType: ["album", "camera"],
          success: resolve,
          fail: reject,
        });
      });
      const tempFilePath = normalizeString(
        chooseResult && chooseResult.tempFiles && chooseResult.tempFiles[0]
          ? chooseResult.tempFiles[0].tempFilePath
          : ""
      );
      if (!tempFilePath) {
        throw new Error("未获取到待上传图片");
      }

      const uploadResult = await wx.cloud.uploadFile({
        cloudPath: this.data.qrConfig.cloudPath,
        filePath: tempFilePath,
      });
      uploadedFileId = normalizeString(uploadResult && uploadResult.fileID);
      if (!uploadedFileId) {
        throw new Error("二维码上传失败");
      }

      await this.callAssetFunction({
        type: "saveAssistantQrConfig",
        fileID: uploadedFileId,
      });

      wx.showToast({
        title: "上传成功",
        icon: "success",
      });
      await this.loadQrConfig();
    } catch (error) {
      if (uploadedFileId) {
        try {
          await wx.cloud.deleteFile({
            fileList: [uploadedFileId],
          });
        } catch (cleanupError) {}
      }
      this.showCloudTip("上传二维码失败", getErrorMessage(error));
    } finally {
      this.setData({
        savingQr: false,
      });
    }
  },

  goBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
      return;
    }
    wx.reLaunch({
      url: "/pages/index/index",
    });
  },

  goHome() {
    wx.reLaunch({
      url: "/pages/index/index",
    });
  },
});
