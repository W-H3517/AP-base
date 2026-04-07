const CLOUD_FUNCTION_NAME = "quickstartFunctions";
const QUESTION_TYPE = "choice";
const OPTION_KEY_POOL = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function getCloudEnv() {
  const app = getApp();
  return app && app.globalData ? app.globalData.env : "";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return !!value && Object.prototype.toString.call(value) === "[object Object]";
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSourceType(value, fallback = "text") {
  return value === "image" ? "image" : value === "text" ? "text" : fallback;
}

function normalizeOptionMode(value) {
  return value === "grouped_asset" ? "grouped_asset" : "per_option";
}

function createEmptyStem() {
  return {
    sourceType: "text",
    text: "",
    imageFileId: "",
  };
}

function createEmptyGroupedAsset() {
  return {
    sourceType: "image",
    imageFileId: "",
  };
}

function createOptionItem(key) {
  return {
    key,
    sourceType: "text",
    text: "",
    imageFileId: "",
  };
}

function createDefaultOptions() {
  const keys = ["A", "B"];
  return {
    keys,
    items: keys.map((key) => createOptionItem(key)),
    groupedAsset: createEmptyGroupedAsset(),
  };
}

function createEmptyEditorForm() {
  return {
    questionId: "",
    questionType: QUESTION_TYPE,
    stem: createEmptyStem(),
    optionMode: "per_option",
    options: createDefaultOptions(),
    correctOptionKeys: [],
  };
}

function getNextOptionKey(keys) {
  const usedKeys = new Set(
    (Array.isArray(keys) ? keys : [])
      .map((item) =>
        normalizeString(
          isPlainObject(item) ? item.key : item
        ).toUpperCase()
      )
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

function normalizeStem(rawStem, legacyStemImageFileId = "") {
  const stem = isPlainObject(rawStem) ? rawStem : {};
  const sourceType = normalizeSourceType(
    stem.sourceType || (legacyStemImageFileId ? "image" : "text")
  );
  const normalized = {
    sourceType,
    text: normalizeString(stem.text),
    imageFileId: normalizeString(stem.imageFileId || legacyStemImageFileId),
  };

  if (sourceType === "text") {
    normalized.imageFileId = "";
  } else {
    normalized.text = "";
  }

  return normalized;
}

function normalizeOptionItem(item) {
  const option = isPlainObject(item) ? item : {};
  const key = normalizeString(option.key).toUpperCase();
  const sourceType = normalizeSourceType(
    option.sourceType,
    option.imageFileId ? "image" : "text"
  );
  const normalized = {
    key,
    sourceType,
    text: normalizeString(option.text),
    imageFileId: normalizeString(option.imageFileId),
  };

  if (sourceType === "text") {
    normalized.imageFileId = "";
  } else {
    normalized.text = "";
  }

  return normalized;
}

function normalizeGroupedAsset(groupedAsset) {
  const asset = isPlainObject(groupedAsset) ? groupedAsset : {};
  return {
    sourceType: "image",
    imageFileId: normalizeString(asset.imageFileId),
  };
}

function getQuestionKeysFromItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeString(item && item.key).toUpperCase())
    .filter(Boolean);
}

function getQuestionImageUrls(question) {
  const urls = [];
  const source = isPlainObject(question) ? question : {};

  const stem = normalizeStem(source.stem, source.stemImageFileId);
  if (stem.imageFileId) {
    urls.push(stem.imageFileId);
  }

  const options = isPlainObject(source.options) ? source.options : {};
  if (source.optionMode === "grouped_asset" && options.groupedAsset) {
    const groupedAsset = normalizeGroupedAsset(options.groupedAsset);
    if (groupedAsset.imageFileId) {
      urls.push(groupedAsset.imageFileId);
    }
  }

  const items = Array.isArray(options.items)
    ? options.items
    : Array.isArray(source.options)
      ? source.options
      : [];

  items.forEach((item) => {
    const normalized = normalizeOptionItem(item);
    if (normalized.imageFileId) {
      urls.push(normalized.imageFileId);
    }
  });

  return urls;
}

function getQuestionAnswerText(question) {
  const keys = Array.isArray(question && question.correctOptionKeys)
    ? question.correctOptionKeys
        .map((item) => normalizeString(item).toUpperCase())
        .filter(Boolean)
    : [];

  return keys.length ? keys.join(", ") : "暂无";
}

function normalizeQuestion(question, isAdmin) {
  const source = isPlainObject(question) ? question : {};
  const legacyOptions = Array.isArray(source.options) ? source.options : [];
  const rawOptions = isPlainObject(source.options) ? source.options : {};
  const stem = normalizeStem(source.stem, source.stemImageFileId);
  let optionMode = normalizeOptionMode(source.optionMode);
  let keys = [];
  let items = [];
  let groupedAsset = createEmptyGroupedAsset();

  if (legacyOptions.length) {
    optionMode = "per_option";
    items = legacyOptions.map((item) => normalizeOptionItem(item));
    keys = getQuestionKeysFromItems(items);
  } else {
    keys = Array.isArray(rawOptions.keys)
      ? rawOptions.keys.map((item) => normalizeString(item).toUpperCase()).filter(Boolean)
      : [];
    items = Array.isArray(rawOptions.items)
      ? rawOptions.items.map((item) => normalizeOptionItem(item))
      : [];
    groupedAsset = normalizeGroupedAsset(rawOptions.groupedAsset);

    if (!keys.length && items.length) {
      keys = getQuestionKeysFromItems(items);
    }

    if (!keys.length && Array.isArray(source.correctOptionKeys)) {
      keys = source.correctOptionKeys
        .map((item) => normalizeString(item).toUpperCase())
        .filter(Boolean);
    }

    if (!items.length && keys.length) {
      items = keys.map((key) => createOptionItem(key));
    }
  }

  const normalized = {
    _id: source._id || "",
    questionId: normalizeString(source.questionId),
    questionType: source.questionType || QUESTION_TYPE,
    stem,
    optionMode,
    options: {
      keys,
      items,
      groupedAsset,
    },
    createTime: source.createTime,
    updateTime: source.updateTime,
    createdBy: source.createdBy || "",
    updatedBy: source.updatedBy || "",
  };

  if (isAdmin) {
    normalized.correctOptionKeys = Array.isArray(source.correctOptionKeys)
      ? source.correctOptionKeys
          .map((item) => normalizeString(item).toUpperCase())
          .filter(Boolean)
      : [];
    normalized.correctOptionText = getQuestionAnswerText(normalized);
  }

  return normalized;
}

function normalizeEditorForm(question) {
  const normalized = normalizeQuestion(question, true);
  if (!normalized.questionId && !normalized.stem && !normalized.options) {
    return createEmptyEditorForm();
  }

  const keys = Array.isArray(normalized.options.keys) && normalized.options.keys.length
    ? normalized.options.keys.slice()
    : ["A", "B"];
  const items = Array.isArray(normalized.options.items) && normalized.options.items.length
    ? normalized.options.items.map((item) => ({
        key: normalizeString(item.key).toUpperCase(),
        sourceType: normalizeSourceType(
          item.sourceType,
          item.imageFileId ? "image" : "text"
        ),
        text: normalizeString(item.text),
        imageFileId: normalizeString(item.imageFileId),
      }))
    : keys.map((key) => createOptionItem(key));

  return {
    questionId: normalized.questionId || "",
    questionType: QUESTION_TYPE,
    stem: normalized.stem && normalized.stem.sourceType ? clone(normalized.stem) : createEmptyStem(),
    optionMode: normalized.optionMode || "per_option",
    options: {
      keys,
      items,
      groupedAsset: normalized.options.groupedAsset
        ? clone(normalized.options.groupedAsset)
        : createEmptyGroupedAsset(),
    },
    correctOptionKeys: Array.isArray(normalized.correctOptionKeys)
      ? normalized.correctOptionKeys.slice()
      : [],
  };
}

function getCurrentOptionKeys(form) {
  if (!form || !form.options) {
    return [];
  }

  if (form.optionMode === "grouped_asset") {
    return Array.isArray(form.options.keys)
      ? form.options.keys.map((item) => normalizeString(item).toUpperCase()).filter(Boolean)
      : [];
  }

  return Array.isArray(form.options.items)
    ? form.options.items.map((item) => normalizeString(item && item.key).toUpperCase()).filter(Boolean)
    : [];
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

  setEditorForm(mutator) {
    const editorForm = clone(this.data.editorForm);
    mutator(editorForm);
    this.setData({
      editorForm,
    });
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
        this.showCloudTip("加载题目详情超时", "题目详情查询超时，请稍后重试。");
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
        this.showCloudTip("加载题目超时", "题目查询超时，请稍后重试。");
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

  switchStemSourceType(e) {
    const sourceType = normalizeSourceType(e.currentTarget.dataset.type);
    this.setEditorForm((form) => {
      form.stem.sourceType = sourceType;
      if (sourceType === "text") {
        form.stem.imageFileId = "";
      } else {
        form.stem.text = "";
      }
    });
  },

  onStemTextInput(e) {
    const value = e.detail.value || "";
    this.setEditorForm((form) => {
      form.stem.text = value;
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
      this.setEditorForm((form) => {
        form.stem.sourceType = "image";
        form.stem.imageFileId = fileID;
        form.stem.text = "";
      });
    } catch (error) {
      this.showCloudTip("上传题干图片失败", getErrorMessage(error));
    } finally {
      wx.hideLoading();
    }
  },

  switchOptionMode(e) {
    const optionMode = normalizeOptionMode(e.currentTarget.dataset.mode);
    this.setEditorForm((form) => {
      const currentKeys = getCurrentOptionKeys(form);
      const existingItems = Array.isArray(form.options.items) ? form.options.items.slice() : [];
      form.optionMode = optionMode;
      if (!Array.isArray(form.options.keys) || !form.options.keys.length) {
        form.options.keys = currentKeys.length ? currentKeys : ["A", "B"];
      }
      if (optionMode === "per_option") {
        const itemMap = new Map(
          existingItems.map((item) => [normalizeString(item.key).toUpperCase(), item])
        );
        form.options.items = form.options.keys.map((key) => {
          const normalizedKey = normalizeString(key).toUpperCase();
          const existing = itemMap.get(normalizedKey);
          return existing
            ? {
                key: normalizedKey,
                sourceType: normalizeSourceType(
                  existing.sourceType,
                  existing.imageFileId ? "image" : "text"
                ),
                text: normalizeString(existing.text),
                imageFileId: normalizeString(existing.imageFileId),
              }
            : createOptionItem(normalizedKey);
        });
      } else if (!Array.isArray(form.options.items) || !form.options.items.length) {
        form.options.items = form.options.keys.map((key) => createOptionItem(key));
      }
      if (!form.options.groupedAsset) {
        form.options.groupedAsset = createEmptyGroupedAsset();
      }
    });
  },

  addOption() {
    this.setEditorForm((form) => {
      if (form.optionMode === "grouped_asset") {
        const nextKey = getNextOptionKey(form.options.keys);
        form.options.keys = (Array.isArray(form.options.keys) ? form.options.keys : []).concat(
          nextKey
        );
        if (!Array.isArray(form.options.items) || !form.options.items.length) {
          form.options.items = form.options.keys.map((key) => createOptionItem(key));
        } else {
          form.options.items = form.options.items.concat(createOptionItem(nextKey));
        }
        return;
      }

      const nextKey = getNextOptionKey(form.options.items);
      if (!Array.isArray(form.options.items)) {
        form.options.items = [];
      }
      form.options.items.push(createOptionItem(nextKey));
      form.options.keys = form.options.items.map((item) => item.key);
    });
  },

  removeOption(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (Number.isNaN(index)) {
      return;
    }

    this.setEditorForm((form) => {
      if (form.optionMode === "grouped_asset") {
        const keys = Array.isArray(form.options.keys) ? form.options.keys.slice() : [];
        if (keys.length <= 2) {
          this.showCloudTip("选项数量不足", "题目至少保留两个选项。");
          return;
        }

        const removedKey = keys[index];
        if (!removedKey) {
          return;
        }

        keys.splice(index, 1);
        form.options.keys = keys;
        if (Array.isArray(form.options.items) && form.options.items.length) {
          form.options.items = form.options.items.filter((item) => item.key !== removedKey);
        }
        form.correctOptionKeys = form.correctOptionKeys.filter((item) => item !== removedKey);
        return;
      }

      const items = Array.isArray(form.options.items) ? form.options.items.slice() : [];
      if (items.length <= 2) {
        this.showCloudTip("选项数量不足", "题目至少保留两个选项。");
        return;
      }

      const removed = items[index];
      if (!removed) {
        return;
      }

      items.splice(index, 1);
      form.options.items = items;
      form.options.keys = items.map((item) => item.key);
      form.correctOptionKeys = form.correctOptionKeys.filter((item) => item !== removed.key);
    });
  },

  onEditorOptionKeyInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const value = normalizeString(e.detail.value || "").toUpperCase();
    if (Number.isNaN(index)) {
      return;
    }

    this.setEditorForm((form) => {
      if (form.optionMode === "grouped_asset") {
        const keys = Array.isArray(form.options.keys) ? form.options.keys.slice() : [];
        const oldKey = keys[index];
        if (!oldKey) {
          return;
        }

        keys[index] = value;
        form.options.keys = keys;
        form.correctOptionKeys = form.correctOptionKeys.map((item) =>
          item === oldKey ? value : item
        );

        if (Array.isArray(form.options.items) && form.options.items.length) {
          form.options.items = form.options.items.map((item) =>
            item.key === oldKey ? { ...item, key: value } : item
          );
        }
        return;
      }

      if (!Array.isArray(form.options.items) || !form.options.items[index]) {
        return;
      }

      const oldKey = form.options.items[index].key;
      form.options.items[index].key = value;
      form.options.keys = form.options.items.map((item) => item.key);
      form.correctOptionKeys = form.correctOptionKeys.map((item) =>
        item === oldKey ? value : item
      );
    });
  },

  switchOptionSourceType(e) {
    const index = Number(e.currentTarget.dataset.index);
    const sourceType = normalizeSourceType(e.currentTarget.dataset.type);
    if (Number.isNaN(index)) {
      return;
    }

    this.setEditorForm((form) => {
      if (!Array.isArray(form.options.items) || !form.options.items[index]) {
        return;
      }

      form.options.items[index].sourceType = sourceType;
      if (sourceType === "text") {
        form.options.items[index].imageFileId = "";
      } else {
        form.options.items[index].text = "";
      }
    });
  },

  onOptionTextInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const value = e.detail.value || "";
    if (Number.isNaN(index)) {
      return;
    }

    this.setEditorForm((form) => {
      if (!Array.isArray(form.options.items) || !form.options.items[index]) {
        return;
      }

      form.options.items[index].text = value;
    });
  },

  async uploadOptionImage(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (Number.isNaN(index) || !this.ensureCloudEnv()) {
      return;
    }

    wx.showLoading({
      title: "上传中...",
    });

    try {
      const fileID = await this.uploadImageToCloud("question-option");
      this.setEditorForm((form) => {
        if (!Array.isArray(form.options.items) || !form.options.items[index]) {
          return;
        }

        form.options.items[index].sourceType = "image";
        form.options.items[index].imageFileId = fileID;
        form.options.items[index].text = "";
      });
    } catch (error) {
      this.showCloudTip("上传选项图片失败", getErrorMessage(error));
    } finally {
      wx.hideLoading();
    }
  },

  uploadGroupedAssetImage() {
    if (!this.ensureCloudEnv()) {
      return;
    }

    wx.showLoading({
      title: "上传中...",
    });

    this.uploadImageToCloud("question-grouped-asset")
      .then((fileID) => {
        this.setEditorForm((form) => {
          form.options.groupedAsset = {
            sourceType: "image",
            imageFileId: fileID,
          };
        });
      })
      .catch((error) => {
        this.showCloudTip("上传大图失败", getErrorMessage(error));
      })
      .finally(() => {
        wx.hideLoading();
      });
  },

  onGroupedAssetKeyInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const value = normalizeString(e.detail.value || "").toUpperCase();
    if (Number.isNaN(index)) {
      return;
    }

    this.setEditorForm((form) => {
      const keys = Array.isArray(form.options.keys) ? form.options.keys.slice() : [];
      const oldKey = keys[index];
      if (!oldKey) {
        return;
      }

      keys[index] = value;
      form.options.keys = keys;
      form.correctOptionKeys = form.correctOptionKeys.map((item) =>
        item === oldKey ? value : item
      );

      if (Array.isArray(form.options.items) && form.options.items.length) {
        form.options.items = form.options.items.map((item) =>
          item.key === oldKey ? { ...item, key: value } : item
        );
      }
    });
  },

  onCorrectOptionChange(e) {
    const editorForm = clone(this.data.editorForm);
    const keys = getCurrentOptionKeys(editorForm);
    const keySet = new Set(keys);
    editorForm.correctOptionKeys = (e.detail.value || [])
      .map((item) => normalizeString(item).toUpperCase())
      .filter((item) => item && keySet.has(item));
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

  validateEditorForm() {
    const editorForm = this.data.editorForm || createEmptyEditorForm();
    const questionType = normalizeString(editorForm.questionType) || QUESTION_TYPE;
    const stem = isPlainObject(editorForm.stem) ? editorForm.stem : createEmptyStem();
    const optionMode = normalizeOptionMode(editorForm.optionMode);
    const options = isPlainObject(editorForm.options)
      ? editorForm.options
      : createDefaultOptions();

    if (questionType !== QUESTION_TYPE) {
      return { valid: false, message: "题目类型必须是 choice。" };
    }

    if (!["text", "image"].includes(stem.sourceType)) {
      return { valid: false, message: "题干来源类型只能是文本或图片。" };
    }

    const normalizedStem = {
      sourceType: stem.sourceType,
      text: normalizeString(stem.text),
      imageFileId: normalizeString(stem.imageFileId),
    };

    if (normalizedStem.sourceType === "text") {
      if (!normalizedStem.text) {
        return { valid: false, message: "请填写题干文本。" };
      }
      normalizedStem.imageFileId = "";
    } else if (!normalizedStem.imageFileId) {
      return { valid: false, message: "请上传题干图片。" };
    } else {
      normalizedStem.text = "";
    }

    const correctOptionKeys = Array.isArray(editorForm.correctOptionKeys)
      ? editorForm.correctOptionKeys
          .map((item) => normalizeString(item).toUpperCase())
          .filter(Boolean)
      : [];

    if (optionMode === "per_option") {
      const items = Array.isArray(options.items) ? options.items : [];
      if (items.length < 2) {
        return { valid: false, message: "题目至少需要两个选项。" };
      }

      const normalizedItems = [];
      const keys = [];
      const seenKeys = new Set();

      for (let i = 0; i < items.length; i += 1) {
        const option = isPlainObject(items[i]) ? items[i] : {};
        const key = normalizeString(option.key).toUpperCase();
        if (!key) {
          return { valid: false, message: "请补全所有选项标识。" };
        }
        if (seenKeys.has(key)) {
          return { valid: false, message: "选项标识不能重复。" };
        }
        seenKeys.add(key);

        const sourceType = normalizeSourceType(
          option.sourceType,
          option.imageFileId ? "image" : "text"
        );
        const text = normalizeString(option.text);
        const imageFileId = normalizeString(option.imageFileId);

        if (sourceType === "text") {
          if (!text) {
            return { valid: false, message: `请填写选项 ${key} 的文本。` };
          }
        } else if (!imageFileId) {
          return { valid: false, message: `请上传选项 ${key} 的图片。` };
        }

        normalizedItems.push({
          key,
          sourceType,
          text: sourceType === "text" ? text : "",
          imageFileId: sourceType === "image" ? imageFileId : "",
        });
        keys.push(key);
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
          questionType: QUESTION_TYPE,
          stem: normalizedStem,
          optionMode,
          options: {
            keys,
            items: normalizedItems,
            groupedAsset: createEmptyGroupedAsset(),
          },
          correctOptionKeys: Array.from(new Set(correctOptionKeys)),
        },
      };
    }

    const keys = Array.isArray(options.keys)
      ? options.keys.map((item) => normalizeString(item).toUpperCase()).filter(Boolean)
      : [];

    if (keys.length < 2) {
      return { valid: false, message: "题目至少需要两个选项。" };
    }

    const seenKeys = new Set();
    for (let i = 0; i < keys.length; i += 1) {
      if (seenKeys.has(keys[i])) {
        return { valid: false, message: "选项标识不能重复。" };
      }
      seenKeys.add(keys[i]);
    }

    const groupedAsset = isPlainObject(options.groupedAsset)
      ? options.groupedAsset
      : createEmptyGroupedAsset();
    const groupedImageFileId = normalizeString(groupedAsset.imageFileId);

    if (!groupedImageFileId) {
      return { valid: false, message: "请上传覆盖选项的大图。" };
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
        questionType: QUESTION_TYPE,
        stem: normalizedStem,
        optionMode,
        options: {
          keys,
          items: [],
          groupedAsset: {
            sourceType: "image",
            imageFileId: groupedImageFileId,
          },
        },
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
