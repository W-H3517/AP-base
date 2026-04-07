const CLOUD_FUNCTION_NAME = "quickstartFunctions";
const OPTION_KEY_POOL = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function getCloudEnv() {
  const app = getApp();
  return app && app.globalData ? app.globalData.env : "";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createDefaultOptions() {
  return [
    { key: "A", imageFileId: "" },
    { key: "B", imageFileId: "" },
  ];
}

function createEmptyEditorForm() {
  return {
    questionId: "",
    stemImageFileId: "",
    options: createDefaultOptions(),
    correctOptionKeys: [],
  };
}

function getNextOptionKey(options) {
  const usedKeys = new Set(
    (options || [])
      .map((item) => String(item && item.key ? item.key : "").trim().toUpperCase())
      .filter(Boolean)
  );

  for (let i = 0; i < OPTION_KEY_POOL.length; i += 1) {
    if (!usedKeys.has(OPTION_KEY_POOL[i])) {
      return OPTION_KEY_POOL[i];
    }
  }

  return `OPT${Date.now()}`;
}

function getErrorMessage(error) {
  return (error && (error.errMsg || error.message)) || "请求失败";
}

function isTimeoutError(errMsg) {
  return String(errMsg || "").toLowerCase().includes("timeout");
}

function unwrapCloudResult(resp) {
  const result = (resp && resp.result) || {};
  if (result && result.success === false) {
    throw new Error(result.errMsg || "云函数执行失败");
  }
  return result;
}

function normalizeUser(result) {
  const data = result && result.data ? result.data : result;
  return {
    openid: data && data.openid ? data.openid : "",
    role: data && data.role ? data.role : "user",
    createTime: (data && data.createTime) || "",
    updateTime: (data && data.updateTime) || "",
  };
}

function normalizeQuestion(question, isAdmin) {
  const normalized = {
    _id: question && question._id ? question._id : "",
    questionId: question && question.questionId ? question.questionId : "",
    stemImageFileId:
      question && question.stemImageFileId ? question.stemImageFileId : "",
    options: Array.isArray(question && question.options) ? question.options : [],
    correctOptionKeys: Array.isArray(question && question.correctOptionKeys)
      ? question.correctOptionKeys
      : [],
  };

  normalized.correctOptionText = normalized.correctOptionKeys.length
    ? normalized.correctOptionKeys.join(", ")
    : "暂无";

  if (!isAdmin) {
    delete normalized.correctOptionKeys;
    delete normalized.correctOptionText;
  }

  return normalized;
}

function normalizeEditorForm(question) {
  return {
    questionId: question && question.questionId ? question.questionId : "",
    stemImageFileId:
      question && question.stemImageFileId ? question.stemImageFileId : "",
    options:
      Array.isArray(question && question.options) && question.options.length
        ? question.options.map((item) => ({
            key: String(item.key || "").trim().toUpperCase(),
            imageFileId: item.imageFileId || "",
          }))
        : createDefaultOptions(),
    correctOptionKeys:
      Array.isArray(question && question.correctOptionKeys)
        ? question.correctOptionKeys
            .map((item) => String(item || "").trim().toUpperCase())
            .filter(Boolean)
        : [],
  };
}

function getQuestionImageUrls(question) {
  const urls = [];
  const stemImageFileId =
    question && question.stemImageFileId ? question.stemImageFileId : "";
  const options = Array.isArray(question && question.options) ? question.options : [];

  if (stemImageFileId) {
    urls.push(stemImageFileId);
  }

  options.forEach((option) => {
    if (option && option.imageFileId) {
      urls.push(option.imageFileId);
    }
  });

  return urls;
}

Page({
  data: {
    type: "questions",
    mode: "browse",
    showTip: false,
    title: "",
    content: "",
    loadingUser: false,
    loadingQuestions: false,
    savingQuestion: false,
    deletingQuestionId: "",
    userLoaded: false,
    isAdmin: false,
    currentUser: {
      openid: "",
      role: "",
    },
    questions: [],
    selectedQuestion: null,
    showDetailModal: false,
    showEditorModal: false,
    editorMode: "create",
    editorForm: createEmptyEditorForm(),
  },

  onLoad(options) {
    this.setData({
      type: options.type || "questions",
      mode: options.mode || "browse",
    });
    this.refreshCurrentUser();
  },

  onShow() {
    if (this.data.userLoaded) {
      this.refreshCurrentUser(false);
    }
  },

  showCloudTip(title, content) {
    this.setData({
      showTip: true,
      title,
      content,
    });
  },

  ensureCloudEnv() {
    if (getCloudEnv()) {
      return true;
    }

    this.showCloudTip(
      "请先配置云开发环境",
      "请先在 miniprogram/app.js 中填写 env，再使用题库功能。"
    );
    return false;
  },

  async callQuestionFunction(type, data) {
    const resp = await wx.cloud.callFunction({
      name: CLOUD_FUNCTION_NAME,
      data: {
        type,
        ...(data || {}),
      },
    });
    return unwrapCloudResult(resp);
  },

  async refreshCurrentUser(showLoading = true) {
    if (!this.ensureCloudEnv()) {
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
      const result = await this.callQuestionFunction("getCurrentUser");
      const currentUser = normalizeUser(result);
      const isAdmin = currentUser.role === "admin";
      this.setData({
        currentUser,
        userLoaded: true,
        isAdmin,
      });
      await this.refreshQuestions(false, isAdmin);
    } catch (error) {
      const errMsg = getErrorMessage(error);
      if (isTimeoutError(errMsg)) {
        this.showCloudTip(
          "获取当前用户超时",
          "云函数请求超时，请确认云函数已上传、环境配置正确，并稍后重试。"
        );
      } else {
        this.showCloudTip("获取当前用户失败", errMsg);
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

  async refreshQuestions(showLoading = true, isAdmin = this.data.isAdmin) {
    if (!this.ensureCloudEnv()) {
      return;
    }

    if (showLoading) {
      wx.showLoading({
        title: "加载题目...",
      });
    }

    this.setData({
      loadingQuestions: true,
    });

    try {
      const result = await this.callQuestionFunction("listQuestions");
      const list = Array.isArray(result.data) ? result.data : [];
      this.setData({
        questions: list.map((item) => normalizeQuestion(item, isAdmin)),
      });
    } catch (error) {
      const errMsg = getErrorMessage(error);
      if (isTimeoutError(errMsg)) {
        this.showCloudTip(
          "加载题目超时",
          "题目查询超时，请确认云函数与云数据库状态正常后再重试。"
        );
      } else {
        this.showCloudTip("加载题目失败", errMsg);
      }
    } finally {
      this.setData({
        loadingQuestions: false,
      });
      if (showLoading) {
        wx.hideLoading();
      }
    }
  },

  async viewQuestionDetail(e) {
    const questionId = e.currentTarget.dataset.questionid;
    if (!questionId || !this.ensureCloudEnv()) {
      return;
    }

    wx.showLoading({
      title: "加载详情...",
    });

    try {
      const result = await this.callQuestionFunction("getQuestionDetail", {
        questionId,
      });
      this.setData({
        selectedQuestion: normalizeQuestion(result.data || {}, this.data.isAdmin),
        showDetailModal: true,
      });
    } catch (error) {
      const errMsg = getErrorMessage(error);
      if (isTimeoutError(errMsg)) {
        this.showCloudTip(
          "加载题目详情超时",
          "题目详情查询超时，请稍后重试。"
        );
      } else {
        this.showCloudTip("加载题目详情失败", errMsg);
      }
    } finally {
      wx.hideLoading();
    }
  },

  closeDetailModal() {
    this.setData({
      showDetailModal: false,
      selectedQuestion: null,
    });
  },

  previewSingleImage(e) {
    const current = e.currentTarget.dataset.src;
    if (!current) {
      return;
    }

    wx.previewImage({
      current,
      urls: [current],
    });
  },

  previewQuestionImages(e) {
    const current = e.currentTarget.dataset.src;
    const questionId = e.currentTarget.dataset.questionid;
    if (!current) {
      return;
    }

    let question = null;
    if (
      this.data.selectedQuestion &&
      this.data.selectedQuestion.questionId === questionId
    ) {
      question = this.data.selectedQuestion;
    }

    if (!question) {
      question = (this.data.questions || []).find(
        (item) => item.questionId === questionId
      );
    }

    const urls = getQuestionImageUrls(question);
    wx.previewImage({
      current,
      urls: urls.length ? urls : [current],
    });
  },

  openCreateQuestion() {
    if (!this.data.isAdmin) {
      this.showCloudTip("权限不足", "只有管理员才能新增题目。");
      return;
    }

    this.setData({
      editorMode: "create",
      editorForm: createEmptyEditorForm(),
      showEditorModal: true,
    });
  },

  async openEditQuestion(e) {
    const questionId = e.currentTarget.dataset.questionid;
    if (!questionId || !this.ensureCloudEnv()) {
      return;
    }

    wx.showLoading({
      title: "加载题目...",
    });

    try {
      const result = await this.callQuestionFunction("getQuestionDetail", {
        questionId,
      });
      this.setData({
        editorMode: "edit",
        editorForm: normalizeEditorForm(result.data || {}),
        showEditorModal: true,
      });
    } catch (error) {
      const errMsg = getErrorMessage(error);
      if (isTimeoutError(errMsg)) {
        this.showCloudTip(
          "加载题目超时",
          "题目查询超时，请稍后重试。"
        );
      } else {
        this.showCloudTip("加载题目失败", errMsg);
      }
    } finally {
      wx.hideLoading();
    }
  },

  closeEditor() {
    this.setData({
      showEditorModal: false,
      editorMode: "create",
      editorForm: createEmptyEditorForm(),
    });
  },

  async deleteQuestion(e) {
    const questionId = e.currentTarget.dataset.questionid;
    if (!questionId) {
      return;
    }

    if (!this.data.isAdmin) {
      this.showCloudTip("权限不足", "只有管理员才能删除题目。");
      return;
    }

    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: "确认删除",
        content: `确定删除题目 ${questionId} 吗？`,
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false),
      });
    });

    if (!confirmed || !this.ensureCloudEnv()) {
      return;
    }

    wx.showLoading({
      title: "删除中...",
    });
    this.setData({
      deletingQuestionId: questionId,
    });

    try {
      await this.callQuestionFunction("deleteQuestion", {
        questionId,
      });
      wx.hideLoading();
      wx.showToast({
        title: "删除成功",
        icon: "success",
      });
      await this.refreshQuestions(false);
    } catch (error) {
      const errMsg = getErrorMessage(error);
      if (isTimeoutError(errMsg)) {
        this.showCloudTip(
          "删除题目超时",
          "删除请求超时，请确认云函数状态正常后重试。"
        );
      } else {
        this.showCloudTip("删除题目失败", errMsg);
      }
    } finally {
      this.setData({
        deletingQuestionId: "",
      });
    }
  },

  addOption() {
    const editorForm = clone(this.data.editorForm);
    editorForm.options.push({
      key: getNextOptionKey(editorForm.options),
      imageFileId: "",
    });
    this.setData({
      editorForm,
    });
  },

  removeOption(e) {
    const index = Number(e.currentTarget.dataset.index);
    const editorForm = clone(this.data.editorForm);
    if (editorForm.options.length <= 2) {
      this.showCloudTip("选项数量不足", "题目至少保留两个选项。");
      return;
    }

    const removed = editorForm.options[index];
    editorForm.options.splice(index, 1);
    editorForm.correctOptionKeys = editorForm.correctOptionKeys.filter(
      (item) => item !== removed.key
    );
    this.setData({
      editorForm,
    });
  },

  onEditorOptionKeyInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const value = String(e.detail.value || "").trim().toUpperCase();
    const editorForm = clone(this.data.editorForm);
    const oldKey = editorForm.options[index].key;
    editorForm.options[index].key = value;
    editorForm.correctOptionKeys = editorForm.correctOptionKeys.map((item) =>
      item === oldKey ? value : item
    );
    this.setData({
      editorForm,
    });
  },

  onCorrectOptionChange(e) {
    const editorForm = clone(this.data.editorForm);
    editorForm.correctOptionKeys = (e.detail.value || [])
      .map((item) => String(item).trim().toUpperCase())
      .filter(Boolean);
    this.setData({
      editorForm,
    });
  },

  async uploadImageToCloud(prefix) {
    return new Promise((resolve, reject) => {
      wx.chooseMedia({
        count: 1,
        mediaType: ["image"],
        sourceType: ["album", "camera"],
        success: async (chooseResult) => {
          try {
            const filePath = chooseResult.tempFiles[0].tempFilePath;
            const cloudPath = `${prefix}-${Date.now()}.png`;
            const uploadResult = await wx.cloud.uploadFile({
              cloudPath,
              filePath,
            });
            resolve(uploadResult.fileID);
          } catch (error) {
            reject(error);
          }
        },
        fail: reject,
      });
    });
  },

  async uploadStemImage() {
    if (!this.ensureCloudEnv()) {
      return;
    }

    wx.showLoading({
      title: "上传中...",
    });

    try {
      const fileID = await this.uploadImageToCloud("question-stem");
      const editorForm = clone(this.data.editorForm);
      editorForm.stemImageFileId = fileID;
      this.setData({
        editorForm,
      });
    } catch (error) {
      this.showCloudTip("上传题干图片失败", getErrorMessage(error));
    } finally {
      wx.hideLoading();
    }
  },

  async uploadOptionImage(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (!this.ensureCloudEnv()) {
      return;
    }

    wx.showLoading({
      title: "上传中...",
    });

    try {
      const fileID = await this.uploadImageToCloud("question-option");
      const editorForm = clone(this.data.editorForm);
      editorForm.options[index].imageFileId = fileID;
      this.setData({
        editorForm,
      });
    } catch (error) {
      this.showCloudTip("上传选项图片失败", getErrorMessage(error));
    } finally {
      wx.hideLoading();
    }
  },

  validateEditorForm() {
    const editorForm = this.data.editorForm;
    const stemImageFileId = String(editorForm.stemImageFileId || "").trim();
    const options = Array.isArray(editorForm.options) ? editorForm.options : [];
    const correctOptionKeys = Array.isArray(editorForm.correctOptionKeys)
      ? editorForm.correctOptionKeys
          .map((item) => String(item).trim().toUpperCase())
          .filter(Boolean)
      : [];

    if (!stemImageFileId) {
      return { valid: false, message: "请先上传题干图片。" };
    }

    if (options.length < 2) {
      return { valid: false, message: "题目至少需要两个选项。" };
    }

    const normalizedOptions = [];
    const seenKeys = new Set();

    for (let i = 0; i < options.length; i += 1) {
      const option = options[i] || {};
      const key = String(option.key || "").trim().toUpperCase();
      const imageFileId = String(option.imageFileId || "").trim();

      if (!key) {
        return { valid: false, message: "请补全所有选项标识。" };
      }

      if (seenKeys.has(key)) {
        return { valid: false, message: "选项标识不能重复。" };
      }
      seenKeys.add(key);

      if (!imageFileId) {
        return { valid: false, message: `请上传选项 ${key} 的图片。` };
      }

      normalizedOptions.push({
        key,
        imageFileId,
      });
    }

    if (!correctOptionKeys.length) {
      return { valid: false, message: "请至少选择一个正确答案。" };
    }

    for (let i = 0; i < correctOptionKeys.length; i += 1) {
      if (!seenKeys.has(correctOptionKeys[i])) {
        return { valid: false, message: "正确答案必须来自当前选项。" };
      }
    }

    return {
      valid: true,
      data: {
        stemImageFileId,
        options: normalizedOptions,
        correctOptionKeys: Array.from(new Set(correctOptionKeys)),
      },
    };
  },

  async saveQuestion() {
    if (!this.data.isAdmin) {
      this.showCloudTip("权限不足", "只有管理员才能保存题目。");
      return;
    }

    const validation = this.validateEditorForm();
    if (!validation.valid) {
      this.showCloudTip("请先完善题目", validation.message);
      return;
    }

    if (!this.ensureCloudEnv()) {
      return;
    }

    const data = clone(validation.data);
    if (this.data.editorMode === "edit") {
      data.questionId = this.data.editorForm.questionId;
    }

    wx.showLoading({
      title: "保存中...",
    });
    this.setData({
      savingQuestion: true,
    });

    try {
      await this.callQuestionFunction(
        this.data.editorMode === "edit" ? "updateQuestion" : "createQuestion",
        data
      );
      wx.hideLoading();
      wx.showToast({
        title: "保存成功",
        icon: "success",
      });
      this.closeEditor();
      await this.refreshQuestions(false);
    } catch (error) {
      const errMsg = getErrorMessage(error);
      if (isTimeoutError(errMsg)) {
        this.showCloudTip(
          "保存题目超时",
          "保存请求超时，请确认云函数与云数据库状态正常后重试。"
        );
      } else {
        this.showCloudTip("保存题目失败", errMsg);
      }
    } finally {
      this.setData({
        savingQuestion: false,
      });
    }
  },
});
