const QUESTION_CLOUD_FUNCTION_NAME = "questionService";
const USER_CLOUD_FUNCTION_NAME = "userService";
const STEM_IMAGE_BASE_HEIGHT_RPX = 320;
const STEM_IMAGE_DEFAULT_SCALE = 1.4;
const STEM_IMAGE_MIN_SCALE = 0.1;
const STEM_IMAGE_MAX_SCALE = 2.2;
const STEM_IMAGE_SCALE_STEP = 0.1;
const {
  OPTION_MARKDOWN_CONTAINER_STYLE,
  OPTION_MARKDOWN_TAG_STYLE,
  STEM_MARKDOWN_CONTAINER_STYLE,
  STEM_MARKDOWN_TAG_STYLE,
  attachRenderedOptionItem,
  attachRenderedRichContent,
} = require("../../utils/markdown");
const { createPagedResourceManager, hasQuestionImages } = require("../../utils/pagedAssets");

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

async function fetchCurrentUserWithCache() {
  const app = getApp();
  if (app && typeof app.fetchCurrentUser === "function") {
    return app.fetchCurrentUser();
  }
  return null;
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

function normalizeSelectedOptionKeys(keys) {
  const keySet = new Set();
  normalizeArray(keys).forEach((item) => {
    const normalized = normalizeString(item).toUpperCase();
    if (normalized) {
      keySet.add(normalized);
    }
  });
  return Array.from(keySet);
}

function hasRichContent(content) {
  const normalized = normalizeRichContent(content);
  return !!normalized.text || normalized.imageFileIds.length > 0;
}

function buildQuestionResultMap(questionResults) {
  const result = {};
  normalizeArray(questionResults).forEach((item) => {
    const questionId = normalizeString(item && item.questionId);
    if (!questionId) {
      return;
    }
    result[questionId] = {
      isCorrect: !!(item && item.isCorrect),
      versionChanged: !!(item && item.versionChanged),
    };
  });
  return result;
}

Page({
  data: {
    showTip: false,
    title: "",
    content: "",
    loading: false,
    loadingQuestion: false,
    isAdmin: false,
    navMetrics: getNavigationMetrics(),
    submissionId: "",
    summary: null,
    questionRefs: [],
    answerMap: {},
    reviewQuestionResultsMap: {},
    currentQuestionIndex: 0,
    currentQuestion: null,
    hasPrevious: false,
    hasNext: false,
    stemImageScale: STEM_IMAGE_DEFAULT_SCALE,
    stemImageScalePercent: Math.round(STEM_IMAGE_DEFAULT_SCALE * 100),
    stemImageHeightRpx: Math.round(STEM_IMAGE_BASE_HEIGHT_RPX * STEM_IMAGE_DEFAULT_SCALE),
    stemMarkdownContainerStyle: STEM_MARKDOWN_CONTAINER_STYLE,
    stemMarkdownTagStyle: STEM_MARKDOWN_TAG_STYLE,
    optionMarkdownContainerStyle: OPTION_MARKDOWN_CONTAINER_STYLE,
    optionMarkdownTagStyle: OPTION_MARKDOWN_TAG_STYLE,
  },

  onLoad(options) {
    this.submissionId = normalizeString(options && options.submissionId);
    this.questionCacheMap = new Map();
    this.questionRequestMap = new Map();
    this.pagedResourceManager = createPagedResourceManager({
      concurrency: 2,
      onAssetUpdate: () => {
        this.refreshCurrentQuestionAssets();
      },
    });
    this.loadCurrentUser();
    this.loadSubmissionDetail();
  },

  onUnload() {
    if (this.pagedResourceManager) {
      this.pagedResourceManager.reset();
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

  async loadCurrentUser() {
    try {
      const user = await fetchCurrentUserWithCache().then((cachedUser) => {
        if (cachedUser) {
          return cachedUser;
        }
        return wx.cloud.callFunction({
          name: USER_CLOUD_FUNCTION_NAME,
          data: {
            type: "getCurrentUser",
            ...getRuntimeContext(),
          },
        }).then((resp) => {
          const result = unwrapCloudResult(resp);
          return isPlainObject(result.data) ? result.data : {};
        });
      });
      this.setData({
        isAdmin: (user.role || "user") === "admin",
      });
    } catch (error) {
      this.setData({
        isAdmin: false,
      });
    }
  },

  async loadSubmissionDetail() {
    if (!this.submissionId) {
      this.showCloudTip("缺少记录编号", "请从做题记录列表进入详情页面。");
      return;
    }

    this.setData({
      loading: true,
    });

    try {
      const resp = await wx.cloud.callFunction({
        name: QUESTION_CLOUD_FUNCTION_NAME,
        data: {
          type: "getPracticeSubmissionDetail",
          submissionId: this.submissionId,
          ...getRuntimeContext(),
        },
      });
      const result = unwrapCloudResult(resp);
      const data = isPlainObject(result.data) ? result.data : {};
      const questionRefs = normalizeArray(data.questionRefs).map((item) => ({
        questionId: normalizeString(item.questionId),
        questionLabel: normalizeString(item.questionLabel),
        groupId: normalizeString(item.groupId),
        entryMode: item.entryMode === "grouped" ? "grouped" : "single",
        groupOrder: Number(item.groupOrder || 1),
        version: normalizeString(item.version || "0"),
        index: Number(item.index || 0),
      }));
      const answers = {};
      normalizeArray(data.answers).forEach((item) => {
        const questionId = normalizeString(item && item.questionId);
        if (!questionId) {
          return;
        }
        answers[questionId] = normalizeSelectedOptionKeys(item && item.selectedOptionKeys);
      });
      const reviewQuestionResultsMap = buildQuestionResultMap(
        data.judgeResult && data.judgeResult.questionResults
      );
      const summarySource = isPlainObject(data.summary) ? data.summary : {};
      const questionSnapshots = normalizeArray(data.questionSnapshots).map((item) =>
        normalizeQuestion(item)
      );
      this.questionCacheMap = new Map();
      this.questionRequestMap = new Map();
      if (this.pagedResourceManager) {
        this.pagedResourceManager.reset();
        this.pagedResourceManager.primePageItems(questionSnapshots);
      }
      questionSnapshots.forEach((question) => {
        if (question.questionId) {
          this.questionCacheMap.set(question.questionId, question);
        }
      });
      this.setData({
        loading: false,
        loadingQuestion: false,
        submissionId: data.submissionId || this.submissionId,
        summary: {
          totalCount: Number(summarySource.totalCount || questionRefs.length),
          answeredCount: Number(summarySource.answeredCount || 0),
          correctCount: Number(summarySource.correctCount || 0),
          score: Number(summarySource.score || 0),
          submittedAt: Number(summarySource.submittedAt || 0),
          submittedAtText: formatTime(summarySource.submittedAt),
        },
        questionRefs,
        answerMap: answers,
        reviewQuestionResultsMap,
        currentQuestionIndex: 0,
        currentQuestion: null,
        hasPrevious: false,
        hasNext: questionRefs.length > 1,
      });
      if (questionRefs.length) {
        await this.switchToQuestion(0);
      }
    } catch (error) {
      this.setData({
        loading: false,
        loadingQuestion: false,
      });
      this.showCloudTip("加载记录详情失败", getErrorMessage(error));
    }
  },

  buildRenderedQuestion(question) {
    const questionWithAssets =
      this.pagedResourceManager && typeof this.pagedResourceManager.resolveQuestionAssets === "function"
        ? this.pagedResourceManager.resolveQuestionAssets(question)
        : question;
    const selectedOptionKeys = normalizeSelectedOptionKeys(
      this.data.answerMap[questionWithAssets.questionId] || []
    );
    const reviewResult = this.data.reviewQuestionResultsMap[questionWithAssets.questionId] || null;
    return {
      ...questionWithAssets,
      sharedStemVisible:
        questionWithAssets.entryMode === "grouped" && hasRichContent(questionWithAssets.sharedStem),
      selectedOptionKeysText: selectedOptionKeys.length ? selectedOptionKeys.join(" / ") : "未作答",
      reviewResult,
      options: {
        ...questionWithAssets.options,
        items: normalizeArray(questionWithAssets.options.items).map((item) => ({
          ...item,
          selected: selectedOptionKeys.includes(item.key),
          selectionLabel: selectedOptionKeys.includes(item.key) ? "我的答案" : "未选择",
        })),
      },
      optionKeysForDisplay: normalizeArray(questionWithAssets.options.keys).map((key) => ({
        key,
        selected: selectedOptionKeys.includes(key),
      })),
    };
  },

  async ensureQuestionLoaded(index) {
    const ref = this.data.questionRefs[index];
    if (!ref) {
      return null;
    }

    if (this.questionCacheMap.has(ref.questionId)) {
      return this.questionCacheMap.get(ref.questionId);
    }

    if (this.questionRequestMap.has(ref.questionId)) {
      return this.questionRequestMap.get(ref.questionId);
    }

    const request = wx.cloud.callFunction({
      name: QUESTION_CLOUD_FUNCTION_NAME,
      data: {
        type: "getPracticeSubmissionQuestionDetail",
        submissionId: this.data.submissionId || this.submissionId,
        questionId: ref.questionId,
        ...getRuntimeContext(),
      },
    })
      .then((resp) => {
        const result = unwrapCloudResult(resp);
        const question = normalizeQuestion(result && result.data);
        if (!question.questionId) {
          throw new Error("题目快照数据不完整");
        }
        this.questionCacheMap.set(ref.questionId, question);
        if (this.pagedResourceManager) {
          this.pagedResourceManager.primePageItems([question]);
        }
        return question;
      })
      .finally(() => {
        this.questionRequestMap.delete(ref.questionId);
      });

    this.questionRequestMap.set(ref.questionId, request);
    return request;
  },

  async loadQuestionForDisplay(index) {
    const ref = this.data.questionRefs[index];
    if (ref && this.questionCacheMap.has(ref.questionId)) {
      return this.questionCacheMap.get(ref.questionId);
    }
    this.setData({
      loadingQuestion: true,
    });
    try {
      return await this.ensureQuestionLoaded(index);
    } finally {
      this.setData({
        loadingQuestion: false,
      });
    }
  },

  prefetchNextQuestionData(index) {
    const targetIndex = index + 1;
    if (targetIndex < 0 || targetIndex >= this.data.questionRefs.length) {
      return;
    }
    this.ensureQuestionLoaded(targetIndex).catch(() => {});
  },

  async switchToQuestion(index) {
    try {
      this.setData({
        hasPrevious: index > 0,
        hasNext: index < this.data.questionRefs.length - 1,
      });
      const question = await this.loadQuestionForDisplay(index);
      if (!question) {
        return;
      }
      this.setData({
        currentQuestionIndex: index,
        currentQuestion: this.buildRenderedQuestion(question),
        hasPrevious: index > 0,
        hasNext: index < this.data.questionRefs.length - 1,
      });
      this.prefetchNextQuestionData(index);
      this.prefetchQuestionImages(index);
    } catch (error) {
      this.showCloudTip("题目快照加载失败", getErrorMessage(error));
    }
  },

  refreshCurrentQuestionAssets() {
    const ref = this.data.questionRefs[this.data.currentQuestionIndex];
    if (!ref) {
      return;
    }
    const source = this.questionCacheMap.get(ref.questionId);
    if (!source) {
      return;
    }
    this.setData({
      currentQuestion: this.buildRenderedQuestion(source),
    });
  },

  prefetchQuestionImages(index) {
    if (!this.pagedResourceManager) {
      return;
    }
    const currentRef = this.data.questionRefs[index];
    const currentQuestion = currentRef ? this.questionCacheMap.get(currentRef.questionId) : null;
    let nextQuestion = null;

    for (let i = index + 1; i < this.data.questionRefs.length; i += 1) {
      const candidateRef = this.data.questionRefs[i];
      const candidateQuestion = candidateRef
        ? this.questionCacheMap.get(candidateRef.questionId)
        : null;
      if (candidateQuestion && hasQuestionImages(candidateQuestion)) {
        nextQuestion = candidateQuestion;
        break;
      }
    }

    this.pagedResourceManager.prefetchImagesForItems(currentQuestion, nextQuestion);
  },

  goToPreviousQuestion() {
    if (!this.data.hasPrevious) {
      return;
    }
    this.switchToQuestion(this.data.currentQuestionIndex - 1);
  },

  goToNextQuestion() {
    if (!this.data.hasNext) {
      return;
    }
    this.switchToQuestion(this.data.currentQuestionIndex + 1);
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

  previewImage(e) {
    const src = normalizeString(e.currentTarget.dataset.src);
    if (!src) {
      return;
    }
    const question = this.data.currentQuestion;
    const urls =
      question && this.pagedResourceManager
        ? this.pagedResourceManager.resolvePreviewUrls(question)
        : [src];
    wx.previewImage({
      current: src,
      urls: urls.length ? urls : [src],
    });
  },

  onRichTextError(e) {
    const scope = normalizeString(e.currentTarget.dataset.scope);
    const optionKey = normalizeString(e.currentTarget.dataset.optionKey).toUpperCase();
    const currentQuestion = this.data.currentQuestion;
    if (!currentQuestion) {
      return;
    }

    if (scope === "sharedStem" && currentQuestion.sharedStem && !currentQuestion.sharedStem.renderAsPlainText) {
      this.setData({
        "currentQuestion.sharedStem.renderAsPlainText": true,
      });
      return;
    }

    if (scope === "stem" && currentQuestion.stem && !currentQuestion.stem.renderAsPlainText) {
      this.setData({
        "currentQuestion.stem.renderAsPlainText": true,
      });
      return;
    }

    if (scope === "option" && optionKey) {
      const optionIndex = normalizeArray(currentQuestion.options && currentQuestion.options.items).findIndex(
        (item) => item.key === optionKey
      );
      if (optionIndex !== -1 && !currentQuestion.options.items[optionIndex].renderAsPlainText) {
        this.setData({
          [`currentQuestion.options.items[${optionIndex}].renderAsPlainText`]: true,
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
