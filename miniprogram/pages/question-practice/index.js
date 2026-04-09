const QUESTION_CLOUD_FUNCTION_NAME = "questionService";
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
  const sourceType = source.sourceType === "image" ? "image" : "text";
  const imageFileIds = normalizeArray(source.imageFileIds)
    .map((item) => normalizeString(item))
    .filter(Boolean);
  return {
    sourceType: sourceType === "image" && imageFileIds.length ? "image" : "text",
    text: sourceType === "text" ? normalizeString(source.text) : "",
    imageFileIds,
  };
}

function normalizeOptionItem(option) {
  const source = isPlainObject(option) ? option : {};
  const sourceType = source.sourceType === "image" ? "image" : "text";
  return {
    key: normalizeString(source.key).toUpperCase(),
    sourceType,
    text: sourceType === "text" ? normalizeString(source.text) : "",
    imageFileId: sourceType === "image" ? normalizeString(source.imageFileId) : "",
  };
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

function buildPaperRefs(questions) {
  return normalizeArray(questions).map((question, index) => ({
    questionId: question.questionId,
    questionLabel: question.questionLabel,
    groupId: question.groupId,
    entryMode: question.entryMode,
    groupOrder: question.groupOrder,
    version: question.version,
    index,
  }));
}

function hasRichContent(content) {
  const normalized = normalizeRichContent(content);
  return !!normalized.text || normalized.imageFileIds.length > 0;
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
    loadingUser: false,
    loadingPaper: false,
    submitting: false,
    mode: "answering",
    currentUser: {
      openid: "",
      role: "",
    },
    userLoaded: false,
    paperQuestionRefs: [],
    paperMeta: {
      totalCount: 0,
      generatedAt: 0,
    },
    currentQuestionIndex: 0,
    currentQuestion: null,
    currentSelectedOptionKeys: [],
    answerMap: {},
    loadedQuestionIds: [],
    hasPrevious: false,
    hasNext: false,
    reviewQuestionResultsMap: {},
    activeSubmissionId: "",
    submissionSummary: null,
  },

  onLoad() {
    this.questionCacheMap = new Map();
    this.loadingQuestionIds = new Set();
    this.paperQuestions = [];
    this.loadInitialData();
  },

  async onPullDownRefresh() {
    try {
      await this.loadPracticePaper(true);
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

  async callFunction(cloudName, data) {
    const resp = await wx.cloud.callFunction({
      name: cloudName,
      data: {
        ...(data || {}),
        ...getRuntimeContext(),
      },
    });
    return unwrapCloudResult(resp);
  },

  async loadInitialData() {
    const env = getCloudEnv();
    if (!env) {
      this.showCloudTip(
        "请先配置云开发环境",
        "请在 miniprogram/app.js 中填入 env 后，再使用在线答题功能。"
      );
      return;
    }

    this.setData({
      loadingUser: true,
    });

    try {
      const [userResult] = await Promise.all([
        this.callFunction(USER_CLOUD_FUNCTION_NAME, { type: "getCurrentUser" }),
        this.loadPracticePaper(),
      ]);
      const user = userResult && userResult.data ? userResult.data : {};
      this.setData({
        loadingUser: false,
        userLoaded: true,
        currentUser: {
          openid: user.openid || "",
          role: user.role || "user",
        },
      });
    } catch (error) {
      this.setData({
        loadingUser: false,
      });
      this.showCloudTip("加载失败", getErrorMessage(error));
    }
  },

  async refreshCurrentUser() {
    this.setData({
      loadingUser: true,
    });
    try {
      const result = await this.callFunction(USER_CLOUD_FUNCTION_NAME, { type: "getCurrentUser" });
      const user = result && result.data ? result.data : {};
      this.setData({
        loadingUser: false,
        userLoaded: true,
        currentUser: {
          openid: user.openid || "",
          role: user.role || "user",
        },
      });
    } catch (error) {
      this.setData({
        loadingUser: false,
      });
      this.showCloudTip("用户同步失败", getErrorMessage(error));
    }
  },

  async loadPracticePaper(showToast = false) {
    this.setData({
      loadingPaper: true,
    });

    try {
      const result = await this.callFunction(
        QUESTION_CLOUD_FUNCTION_NAME,
        { type: "getPracticePaper" }
      );
      const data = isPlainObject(result.data) ? result.data : {};
      const questions = normalizeArray(data.questions).map((item) => normalizeQuestion(item));
      this.paperQuestions = questions;
      this.questionCacheMap = new Map();
      this.loadingQuestionIds = new Set();

      this.setData({
        loadingPaper: false,
        mode: "answering",
        paperQuestionRefs: buildPaperRefs(questions),
        paperMeta: {
          totalCount: Number(data.paperMeta && data.paperMeta.totalCount) || questions.length,
          generatedAt: Number(data.paperMeta && data.paperMeta.generatedAt) || Date.now(),
        },
        currentQuestionIndex: 0,
        currentQuestion: null,
        currentSelectedOptionKeys: [],
        answerMap: {},
        loadedQuestionIds: [],
        hasPrevious: false,
        hasNext: questions.length > 1,
        reviewQuestionResultsMap: {},
        activeSubmissionId: "",
        submissionSummary: null,
      });

      if (questions.length) {
        await this.switchToQuestion(0);
      }

      if (showToast) {
        wx.showToast({
          title: "试卷已刷新",
          icon: "success",
        });
      }
      return result;
    } catch (error) {
      this.setData({
        loadingPaper: false,
      });
      this.showCloudTip("试卷加载失败", getErrorMessage(error));
      throw error;
    }
  },

  async ensureQuestionLoaded(index) {
    const ref = this.data.paperQuestionRefs[index];
    if (!ref) {
      return null;
    }

    if (this.questionCacheMap.has(ref.questionId)) {
      return this.questionCacheMap.get(ref.questionId);
    }

    if (this.loadingQuestionIds.has(ref.questionId)) {
      return null;
    }

    this.loadingQuestionIds.add(ref.questionId);
    try {
      const source = this.paperQuestions[index];
      if (!source) {
        return null;
      }
      this.questionCacheMap.set(ref.questionId, source);
      const loadedQuestionIds = this.data.loadedQuestionIds.includes(ref.questionId)
        ? this.data.loadedQuestionIds
        : this.data.loadedQuestionIds.concat(ref.questionId);
      this.setData({
        loadedQuestionIds,
      });
      return source;
    } finally {
      this.loadingQuestionIds.delete(ref.questionId);
    }
  },

  prefetchNeighborQuestions(index) {
    [index - 1, index, index + 1].forEach((targetIndex) => {
      if (targetIndex < 0 || targetIndex >= this.data.paperQuestionRefs.length) {
        return;
      }
      this.ensureQuestionLoaded(targetIndex);
    });
  },

  buildRenderedQuestion(question, selectedKeysOverride, reviewMapOverride, modeOverride) {
    if (!question) {
      return null;
    }
    const selectedOptionKeys = normalizeSelectedOptionKeys(
      typeof selectedKeysOverride === "undefined"
        ? this.data.answerMap[question.questionId] || []
        : selectedKeysOverride
    );
    const mode = modeOverride || this.data.mode;
    const reviewMap = reviewMapOverride || this.data.reviewQuestionResultsMap || {};
    const reviewResult = reviewMap[question.questionId] || null;

    return {
      ...question,
      sharedStemVisible: question.entryMode === "grouped" && hasRichContent(question.sharedStem),
      stemVisible: hasRichContent(question.stem),
      reviewResult,
      isReviewMode: mode === "review",
      reviewStatusText: reviewResult
        ? reviewResult.isCorrect
          ? "答对"
          : "答错"
        : "",
      options: {
        ...question.options,
        items: normalizeArray(question.options.items).map((item) => ({
          ...item,
          selected: selectedOptionKeys.includes(item.key),
          selectionLabel: selectedOptionKeys.includes(item.key) ? "我的答案" : "未选择",
        })),
      },
      optionKeysForDisplay: normalizeArray(question.options.keys).map((key) => ({
        key,
        selected: selectedOptionKeys.includes(key),
      })),
      selectedOptionKeys,
      selectedOptionKeysText: selectedOptionKeys.length ? selectedOptionKeys.join(" / ") : "未作答",
      modeTitle: mode === "review" ? "作答回顾" : "作答区",
      modeTip:
        mode === "review"
          ? "当前为交卷回顾模式，仅展示你当时的作答与对错标记。"
          : "支持多选；当前题切换时会保留你的作答。",
    };
  },

  async switchToQuestion(index) {
    const target = await this.ensureQuestionLoaded(index);
    if (!target) {
      return;
    }
    const renderedQuestion = this.buildRenderedQuestion(target);
    this.setData({
      currentQuestionIndex: index,
      currentQuestion: renderedQuestion,
      currentSelectedOptionKeys: renderedQuestion.selectedOptionKeys,
      hasPrevious: index > 0,
      hasNext: index < this.data.paperQuestionRefs.length - 1,
    });
    this.prefetchNeighborQuestions(index);
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

  toggleOptionSelection(e) {
    if (this.data.mode !== "answering") {
      return;
    }

    const key = normalizeString(e.currentTarget.dataset.key).toUpperCase();
    const currentQuestion = this.data.currentQuestion;
    if (!currentQuestion || !key) {
      return;
    }

    const currentKeys = normalizeSelectedOptionKeys(
      this.data.answerMap[currentQuestion.questionId] || []
    );
    const nextKeys = currentKeys.includes(key)
      ? currentKeys.filter((item) => item !== key)
      : currentKeys.concat(key);
    const answerMap = {
      ...this.data.answerMap,
      [currentQuestion.questionId]: nextKeys,
    };
    this.setData({
      answerMap,
      currentSelectedOptionKeys: nextKeys,
      currentQuestion: this.buildRenderedQuestion(currentQuestion, nextKeys),
    });
  },

  previewImage(e) {
    const src = normalizeString(e.currentTarget.dataset.src);
    if (!src) {
      return;
    }
    const urls = [];
    const question = this.data.currentQuestion;
    if (question) {
      normalizeRichContent(question.sharedStem).imageFileIds.forEach((item) => urls.push(item));
      normalizeRichContent(question.stem).imageFileIds.forEach((item) => urls.push(item));
      normalizeArray(question.options.items).forEach((option) => {
        if (option.imageFileId) {
          urls.push(option.imageFileId);
        }
      });
      if (question.options.groupedAsset && question.options.groupedAsset.imageFileId) {
        urls.push(question.options.groupedAsset.imageFileId);
      }
    }
    wx.previewImage({
      current: src,
      urls: urls.length ? urls : [src],
    });
  },

  async refreshPaper() {
    await this.loadPracticePaper(true);
  },

  openPracticeHistory() {
    wx.navigateTo({
      url: "/pages/practice-history/index",
    });
  },

  buildSubmitPayload() {
    const questions = this.data.paperQuestionRefs.map((question) => ({
      questionId: question.questionId,
      questionLabel: question.questionLabel,
      groupId: question.groupId,
      entryMode: question.entryMode,
      groupOrder: question.groupOrder,
      version: question.version,
    }));
    const answers = questions.map((question) => ({
      questionId: question.questionId,
      selectedOptionKeys: normalizeSelectedOptionKeys(this.data.answerMap[question.questionId] || []),
      answeredAt: Date.now(),
    }));
    return {
      paperSnapshot: {
        totalCount: questions.length,
        questions,
      },
      answers,
    };
  },

  async submitPaper() {
    if (!this.data.paperQuestionRefs.length) {
      return;
    }

    const unansweredCount = this.data.paperQuestionRefs.filter(
      (question) => !normalizeSelectedOptionKeys(this.data.answerMap[question.questionId] || []).length
    ).length;

    if (unansweredCount) {
      const modalResult = await wx.showModal({
        title: "还有未作答题目",
        content: `当前还有 ${unansweredCount} 道题未作答，确认现在交卷吗？`,
        confirmText: "确认交卷",
      });
      if (!modalResult.confirm) {
        return;
      }
    }

    this.setData({
      submitting: true,
    });

    try {
      const result = await this.callFunction(QUESTION_CLOUD_FUNCTION_NAME, {
        type: "submitPracticePaper",
        ...this.buildSubmitPayload(),
      });
      const summary = isPlainObject(result.data) ? result.data : {};
      const reviewQuestionResultsMap = buildQuestionResultMap(summary.questionResults || []);
      const currentQuestionSource = this.questionCacheMap.get(
        this.data.paperQuestionRefs[this.data.currentQuestionIndex]?.questionId || ""
      );

      this.setData({
        submitting: false,
        mode: "review",
        reviewQuestionResultsMap,
        activeSubmissionId: summary.submissionId || "",
        submissionSummary: {
          submissionId: summary.submissionId || "",
          totalCount: Number(summary.totalCount || 0),
          answeredCount: Number(summary.answeredCount || 0),
          correctCount: Number(summary.correctCount || 0),
          score: Number(summary.score || 0),
          submittedAt: Number(summary.submittedAt || Date.now()),
          submittedAtText: formatTime(Number(summary.submittedAt || Date.now())),
        },
        currentQuestion: currentQuestionSource
          ? this.buildRenderedQuestion(
              currentQuestionSource,
              this.data.answerMap[currentQuestionSource.questionId] || [],
              reviewQuestionResultsMap,
              "review"
            )
          : this.data.currentQuestion,
      });
      wx.showToast({
        title: "交卷成功",
        icon: "success",
      });
    } catch (error) {
      this.setData({
        submitting: false,
      });
      this.showCloudTip("交卷失败", getErrorMessage(error));
    }
  },
});
