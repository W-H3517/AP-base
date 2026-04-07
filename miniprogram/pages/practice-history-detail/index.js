const QUESTION_CLOUD_FUNCTION_NAME = "questionService";

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
    submissionId: "",
    summary: null,
    questions: [],
    answerMap: {},
    reviewQuestionResultsMap: {},
    currentQuestionIndex: 0,
    currentQuestion: null,
    hasPrevious: false,
    hasNext: false,
  },

  onLoad(options) {
    this.submissionId = normalizeString(options && options.submissionId);
    this.loadSubmissionDetail();
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
        },
      });
      const result = unwrapCloudResult(resp);
      const data = isPlainObject(result.data) ? result.data : {};
      const questions = normalizeArray(data.questions).map((item) => normalizeQuestion(item));
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
      this.questions = questions;
      this.setData({
        loading: false,
        submissionId: data.submissionId || this.submissionId,
        summary: {
          totalCount: Number(summarySource.totalCount || questions.length),
          answeredCount: Number(summarySource.answeredCount || 0),
          correctCount: Number(summarySource.correctCount || 0),
          score: Number(summarySource.score || 0),
          submittedAt: Number(summarySource.submittedAt || 0),
          submittedAtText: formatTime(summarySource.submittedAt),
        },
        questions,
        answerMap: answers,
        reviewQuestionResultsMap,
        currentQuestionIndex: 0,
        currentQuestion: null,
        hasPrevious: false,
        hasNext: questions.length > 1,
      });
      if (questions.length) {
        this.switchToQuestion(0);
      }
    } catch (error) {
      this.setData({
        loading: false,
      });
      this.showCloudTip("加载记录详情失败", getErrorMessage(error));
    }
  },

  buildRenderedQuestion(question) {
    const selectedOptionKeys = normalizeSelectedOptionKeys(
      this.data.answerMap[question.questionId] || []
    );
    const reviewResult = this.data.reviewQuestionResultsMap[question.questionId] || null;
    return {
      ...question,
      sharedStemVisible: question.entryMode === "grouped" && hasRichContent(question.sharedStem),
      selectedOptionKeysText: selectedOptionKeys.length ? selectedOptionKeys.join(" / ") : "未作答",
      reviewResult,
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
    };
  },

  switchToQuestion(index) {
    const question = this.questions[index];
    if (!question) {
      return;
    }
    this.setData({
      currentQuestionIndex: index,
      currentQuestion: this.buildRenderedQuestion(question),
      hasPrevious: index > 0,
      hasNext: index < this.questions.length - 1,
    });
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
});
