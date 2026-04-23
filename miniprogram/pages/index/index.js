const USER_CLOUD_FUNCTION_NAME = "userService";
const ASSET_CLOUD_FUNCTION_NAME = "assetService";
const SHARE_QUESTION_CLOUD_FUNCTION_NAME = "shareQuestionService";
const STEM_IMAGE_BASE_HEIGHT_RPX = 320;
const STEM_IMAGE_DEFAULT_SCALE = 1.4;
const STEM_IMAGE_MIN_SCALE = 0.1;
const STEM_IMAGE_MAX_SCALE = 2.2;
const STEM_IMAGE_SCALE_STEP = 0.1;
const TIMELINE_SHARE_MODE = "timeline-share";
const SHARE_PAGE_TITLE = "X-New AP物理选择题预览";
const SHARE_CARD_TITLE = "X-New AP物理选择题";
const {
  OPTION_MARKDOWN_CONTAINER_STYLE,
  OPTION_MARKDOWN_TAG_STYLE,
  STEM_MARKDOWN_CONTAINER_STYLE,
  STEM_MARKDOWN_TAG_STYLE,
  attachRenderedOptionItem,
  attachRenderedRichContent,
} = require("../../utils/markdown");
const { createPagedResourceManager } = require("../../utils/pagedAssets");

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

function getEnterScene() {
  try {
    if (typeof wx.getEnterOptionsSync === "function") {
      const options = wx.getEnterOptionsSync() || {};
      return Number(options.scene || 0);
    }
  } catch (error) {
    console.warn("获取进入场景失败，已回退到 launchOptions", error);
  }

  try {
    if (typeof wx.getLaunchOptionsSync === "function") {
      const options = wx.getLaunchOptionsSync() || {};
      return Number(options.scene || 0);
    }
  } catch (error) {
    console.warn("获取启动场景失败", error);
  }

  return 0;
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

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function isPlainObject(value) {
  return !!value && Object.prototype.toString.call(value) === "[object Object]";
}

function normalizeRichContent(content) {
  const source = isPlainObject(content) ? content : {};
  const imageFileIds = normalizeArray(source.imageFileIds)
    .map((item) => normalizeString(item))
    .filter(Boolean);
  const text = normalizeString(source.text);
  return attachRenderedRichContent({
    sourceType: imageFileIds.length ? "image" : "text",
    text,
    imageFileIds,
  });
}

function normalizeOptionItem(option) {
  const source = isPlainObject(option) ? option : {};
  const sourceType = source.sourceType === "image" ? "image" : "text";
  return attachRenderedOptionItem({
    key: normalizeString(source.key).toUpperCase(),
    sourceType,
    text: sourceType === "text" ? normalizeString(source.text) : "",
    imageFileId: sourceType === "image" ? normalizeString(source.imageFileId) : "",
  });
}

function normalizeOptions(options) {
  const source = isPlainObject(options) ? options : {};
  return {
    keys: normalizeArray(source.keys)
      .map((item) => normalizeString(item).toUpperCase())
      .filter(Boolean),
    items: normalizeArray(source.items).map((item) => normalizeOptionItem(item)),
    groupedAsset: {
      sourceType: "image",
      imageFileId: normalizeString(source.groupedAsset && source.groupedAsset.imageFileId),
    },
  };
}

function normalizeQuestion(question) {
  const source = isPlainObject(question) ? question : {};
  return {
    questionId: normalizeString(source.questionId),
    questionLabel: normalizeString(source.questionLabel),
    groupId: normalizeString(source.groupId),
    entryMode: source.entryMode === "grouped" ? "grouped" : "single",
    groupOrder: Number(source.groupOrder || 1),
    questionType: normalizeString(source.questionType) || "choice",
    sharedStem: normalizeRichContent(source.sharedStem),
    stem: normalizeRichContent(source.stem),
    optionMode: source.optionMode === "grouped_asset" ? "grouped_asset" : "per_option",
    options: normalizeOptions(source.options),
    version: normalizeString(source.version || "0"),
  };
}

function hasRichContent(content) {
  const normalized = normalizeRichContent(content);
  return !!normalized.text || normalized.imageFileIds.length > 0;
}

function buildRenderedShareQuestion(question, pagedResourceManager) {
  if (!question) {
    return null;
  }
  const resolvedQuestion =
    pagedResourceManager && typeof pagedResourceManager.resolveQuestionAssets === "function"
      ? pagedResourceManager.resolveQuestionAssets(question)
      : question;
  return {
    ...resolvedQuestion,
    sharedStemVisible:
      resolvedQuestion.entryMode === "grouped" && hasRichContent(resolvedQuestion.sharedStem),
    stemVisible: hasRichContent(resolvedQuestion.stem),
    optionKeysForDisplay: normalizeArray(resolvedQuestion.options.keys).map((key) => ({ key })),
  };
}

Page({
  data: {
    pageMode: "default",
    showTip: false,
    title: "",
    content: "",
    loadingUser: false,
    loadingAction: false,
    loadingShareQuestion: false,
    userLoaded: false,
    isAdmin: false,
    currentUser: {
      openid: "",
      role: "",
    },
    navMetrics: getNavigationMetrics(),
    assistantQrImage: "",
    assistantQrConfigured: false,
    sharePageTitle: SHARE_PAGE_TITLE,
    shareCardTitle: SHARE_CARD_TITLE,
    shareQuestion: null,
    shareQuestionGeneratedAt: 0,
    stemImageScale: STEM_IMAGE_DEFAULT_SCALE,
    stemImageScalePercent: Math.round(STEM_IMAGE_DEFAULT_SCALE * 100),
    stemImageHeightRpx: Math.round(STEM_IMAGE_BASE_HEIGHT_RPX * STEM_IMAGE_DEFAULT_SCALE),
    stemMarkdownContainerStyle: STEM_MARKDOWN_CONTAINER_STYLE,
    stemMarkdownTagStyle: STEM_MARKDOWN_TAG_STYLE,
    optionMarkdownContainerStyle: OPTION_MARKDOWN_CONTAINER_STYLE,
    optionMarkdownTagStyle: OPTION_MARKDOWN_TAG_STYLE,
  },

  onLoad(options) {
    const enterScene = getEnterScene();
    const isTimelineShareMode = options && options.mode === TIMELINE_SHARE_MODE;
    const pageMode =
      isTimelineShareMode && enterScene !== 1155 ? TIMELINE_SHARE_MODE : "default";
    this.setData({
      pageMode,
    });

    wx.showShareMenu({
      menus: ["shareAppMessage", "shareTimeline"],
    });

    if (pageMode === TIMELINE_SHARE_MODE) {
      this.pagedResourceManager = createPagedResourceManager({
        concurrency: 2,
        onAssetUpdate: () => {
          this.refreshShareQuestionAssets();
        },
      });
      this.loadShareQuestion();
      return;
    }

    this.getCurrentUser();
    this.loadAssistantQrConfig(false).catch(() => {});
  },

  onUnload() {
    if (this.pagedResourceManager) {
      this.pagedResourceManager.reset();
    }
  },

  onShareAppMessage() {
    if (this.data.pageMode === TIMELINE_SHARE_MODE) {
      return {
        title: SHARE_CARD_TITLE,
        path: `/pages/index/index?mode=${TIMELINE_SHARE_MODE}`,
      };
    }
    return {
      title: SHARE_CARD_TITLE,
      path: "/pages/index/index",
    };
  },

  onShareTimeline() {
    return {
      title: SHARE_CARD_TITLE,
      query: `mode=${TIMELINE_SHARE_MODE}`,
    };
  },

  onShow() {
    if (this.data.pageMode === TIMELINE_SHARE_MODE) {
      return;
    }
    if (this.data.userLoaded) {
      this.getCurrentUser(false);
    }
    if (getCloudEnv()) {
      this.loadAssistantQrConfig(false).catch(() => {});
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

  async callQuestionFunction(data) {
    const resp = await wx.cloud.callFunction({
      name: SHARE_QUESTION_CLOUD_FUNCTION_NAME,
      data: {
        ...(data || {}),
        ...getRuntimeContext(),
      },
    });
    return unwrapCloudResult(resp);
  },

  async loadShareQuestion() {
    const env = getCloudEnv();
    if (!env) {
      this.showCloudTip(
        "请先配置云开发环境",
        "请在 miniprogram/app.js 中填入 env 后，再使用分享示例题页面。"
      );
      return;
    }

    this.setData({
      loadingShareQuestion: true,
    });

    try {
      const result = await this.callQuestionFunction({
      });
      const data = result && isPlainObject(result.data) ? result.data : {};
      const question = normalizeQuestion(data.question);
      if (this.pagedResourceManager) {
        this.pagedResourceManager.reset();
        this.pagedResourceManager.primePageItems(question.questionId ? [question] : []);
        this.pagedResourceManager.prefetchImagesForItems(question, null);
      }
      this.setData({
        loadingShareQuestion: false,
        shareQuestionGeneratedAt: Number(data.generatedAt || Date.now()),
        shareQuestion: question.questionId
          ? buildRenderedShareQuestion(question, this.pagedResourceManager)
          : null,
      });
    } catch (err) {
      this.setData({
        loadingShareQuestion: false,
        shareQuestion: null,
      });
      this.showCloudTip("示例题加载失败", getErrorMessage(err) || "请稍后重试。");
    }
  },

  refreshShareQuestionAssets() {
    if (!this.data.shareQuestion || !this.pagedResourceManager) {
      return;
    }
    const normalizedQuestion = normalizeQuestion(this.data.shareQuestion);
    this.setData({
      shareQuestion: buildRenderedShareQuestion(normalizedQuestion, this.pagedResourceManager),
    });
  },

  async loadAssistantQrConfig(showError = true) {
    if (!getCloudEnv()) {
      return null;
    }
    try {
      const result = await this.callAssetFunction({
        type: "getAssistantQrConfig",
      });
      const data = result && result.data && typeof result.data === "object" ? result.data : {};
      const fileID = typeof data.fileID === "string" ? data.fileID.trim() : "";
      this.setData({
        assistantQrImage: fileID,
        assistantQrConfigured: !!fileID,
      });
      return data;
    } catch (err) {
      this.setData({
        assistantQrImage: "",
        assistantQrConfigured: false,
      });
      if (showError) {
        this.showCloudTip("加载二维码失败", getErrorMessage(err) || "请稍后重试。");
      }
      throw err;
    }
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
      const app = getApp();
      let user;
      if (app && typeof app.fetchCurrentUser === "function") {
        user = await app.fetchCurrentUser();
      } else {
        const resp = await wx.cloud.callFunction({
          name: USER_CLOUD_FUNCTION_NAME,
          data: {
            type: "getCurrentUser",
            ...getRuntimeContext(),
          },
        });
        const payload = unwrapCloudResult(resp) || {};
        user =
          payload && payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
            ? payload.data
            : payload;
      }
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

  openAssistantQrAdmin() {
    if (!this.data.isAdmin) {
      this.showCloudTip("权限不足", "当前用户不是管理员，不能进入二维码管理页。");
      return;
    }

    wx.navigateTo({
      url: "/pages/assistant-qr-admin/index",
    });
  },

  openPracticeHistory() {
    wx.navigateTo({
      url: "/pages/practice-history/index",
    });
  },

  previewImage(e) {
    const src = normalizeString(e.currentTarget.dataset.src);
    if (!src) {
      return;
    }
    const question = this.data.shareQuestion;
    const urls =
      question && this.pagedResourceManager
        ? this.pagedResourceManager.resolvePreviewUrls(question)
        : [src];
    wx.previewImage({
      current: src,
      urls: urls.length ? urls : [src],
    });
  },

  previewAssistantQr() {
    const src = this.data.assistantQrConfigured
      ? (typeof this.data.assistantQrImage === "string" ? this.data.assistantQrImage.trim() : "")
      : "";
    if (!src) {
      return;
    }
    wx.previewImage({
      current: src,
      urls: [src],
      showmenu: true,
    });
  },

  onRichTextError(e) {
    if (this.data.pageMode !== TIMELINE_SHARE_MODE || !this.data.shareQuestion) {
      return;
    }
    const scope = normalizeString(e.currentTarget.dataset.scope);
    const optionKey = normalizeString(e.currentTarget.dataset.optionKey).toUpperCase();

    if (scope === "sharedStem" && this.data.shareQuestion.sharedStem && !this.data.shareQuestion.sharedStem.renderAsPlainText) {
      this.setData({
        "shareQuestion.sharedStem.renderAsPlainText": true,
      });
      return;
    }

    if (scope === "stem" && this.data.shareQuestion.stem && !this.data.shareQuestion.stem.renderAsPlainText) {
      this.setData({
        "shareQuestion.stem.renderAsPlainText": true,
      });
      return;
    }

    if (scope === "option" && optionKey) {
      const optionIndex = normalizeArray(this.data.shareQuestion.options && this.data.shareQuestion.options.items).findIndex(
        (item) => item.key === optionKey
      );
      if (optionIndex !== -1 && !this.data.shareQuestion.options.items[optionIndex].renderAsPlainText) {
        this.setData({
          [`shareQuestion.options.items[${optionIndex}].renderAsPlainText`]: true,
        });
      }
    }
  },

  updateStemImageScale(nextScale) {
    const normalizedScale = Math.min(
      STEM_IMAGE_MAX_SCALE,
      Math.max(STEM_IMAGE_MIN_SCALE, Number(nextScale) || STEM_IMAGE_DEFAULT_SCALE)
    );
    this.setData({
      stemImageScale: normalizedScale,
      stemImageScalePercent: Math.round(normalizedScale * 100),
      stemImageHeightRpx: Math.round(STEM_IMAGE_BASE_HEIGHT_RPX * normalizedScale),
    });
  },

  zoomInStemImage() {
    this.updateStemImageScale(this.data.stemImageScale + STEM_IMAGE_SCALE_STEP);
  },

  zoomOutStemImage() {
    this.updateStemImageScale(this.data.stemImageScale - STEM_IMAGE_SCALE_STEP);
  },

  resetStemImageScale() {
    this.updateStemImageScale(STEM_IMAGE_DEFAULT_SCALE);
  },
});
