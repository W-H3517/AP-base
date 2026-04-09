const QUESTION_CLOUD_FUNCTION_NAME = "questionService";
const USER_CLOUD_FUNCTION_NAME = "userService";
const QUESTION_TYPE = "choice";
const OPTION_KEY_POOL = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const QUESTION_SUMMARY_PAGE_SIZE = 20;
const SINGLE_DETAIL_CACHE_PREFIX = "question_detail:";
const GROUP_DETAIL_CACHE_PREFIX = "question_group_detail:";

function getCloudEnv() {
  const app = getApp();
  return app && app.globalData ? app.globalData.env : "";
}

function normalizeStorageRoot(value) {
  const normalized = normalizeString(value);
  if (normalized === "develop" || normalized === "trial") {
    return normalized;
  }
  return "trial";
}

function normalizeRuntimeDataVersion(value) {
  return normalizeStorageRoot(value);
}

function getRuntimeStorageInfo() {
  const app = getApp();
  const runtimeEnvVersion =
    app && typeof app.getRuntimeEnvVersion === "function"
      ? app.getRuntimeEnvVersion()
      : normalizeString(app && app.globalData ? app.globalData.runtimeEnvVersion : "");
  const runtimeDataVersion =
    app && typeof app.getRuntimeDataVersion === "function"
      ? app.getRuntimeDataVersion()
      : normalizeRuntimeDataVersion(app && app.globalData ? app.globalData.runtimeDataVersion : "");
  const storageRoot =
    app && typeof app.getStorageRoot === "function"
      ? app.getStorageRoot()
      : normalizeStorageRoot(app && app.globalData ? app.globalData.storageRoot : "");
  return {
    runtimeEnvVersion: normalizeString(runtimeEnvVersion) || "trial",
    runtimeDataVersion: normalizeRuntimeDataVersion(runtimeDataVersion),
    storageRoot: normalizeStorageRoot(storageRoot),
  };
}

function appendRuntimeStorageData(data) {
  return assignObject({}, data || {}, getRuntimeStorageInfo());
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

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeSourceType(value, fallback = "text") {
  return value === "image" ? "image" : value === "text" ? "text" : fallback;
}

function normalizeOptionMode(value) {
  return value === "grouped_asset" ? "grouped_asset" : "per_option";
}

function normalizeEntryMode(value) {
  return value === "grouped" ? "grouped" : "single";
}

function normalizeEntityType(value) {
  return value === "group" ? "group" : "single";
}

function createRichContent(defaultSourceType = "text") {
  return {
    sourceType: defaultSourceType,
    text: "",
    imageFileIds: [],
  };
}

function createEmptyStem() {
  return createRichContent("text");
}

function createEmptySharedStem() {
  return createRichContent("text");
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
    groupedAsset: {
      sourceType: "image",
      imageFileId: "",
    },
  };
}

function createSingleQuestionForm() {
  return {
    questionId: "",
    questionLabel: "",
    questionType: QUESTION_TYPE,
    stem: createEmptyStem(),
    optionMode: "per_option",
    options: createDefaultOptions(),
    correctOptionKeys: [],
  };
}

function createGroupedQuestionForm() {
  return {
    groupId: "",
    sharedStem: createEmptySharedStem(),
    children: [createSingleQuestionForm(), createSingleQuestionForm()],
  };
}

function createEmptyEditorForm() {
  return {
    single: createSingleQuestionForm(),
    grouped: createGroupedQuestionForm(),
  };
}

function buildAnswerChoiceList(question) {
  const source = isPlainObject(question) ? question : {};
  const keys = normalizeArray(source.options && source.options.keys)
    .map((item) => normalizeString(item).toUpperCase())
    .filter(Boolean);
  const checkedKeySet = new Set(normalizeCheckboxKeys(source.correctOptionKeys));
  return keys.map((key) => ({
    key,
    checked: checkedKeySet.has(key),
  }));
}

function hydrateQuestionEditorState(question) {
  const target = isPlainObject(question) ? question : createSingleQuestionForm();
  target.optionMode = normalizeOptionMode(target.optionMode);
  target.stem = normalizeRichContent(target.stem, target.stemImageFileId);
  target.correctOptionKeys = normalizeCheckboxKeys(target.correctOptionKeys);
  target.options = isPlainObject(target.options) ? target.options : createDefaultOptions();
  target.options.groupedAsset = normalizeGroupedAsset(target.options.groupedAsset);
  target.options.items = normalizeArray(target.options.items).map((item) => normalizeOptionItem(item));
  target.options.keys = normalizeArray(target.options.keys)
    .map((item) => normalizeString(item).toUpperCase())
    .filter(Boolean);

  if (!target.options.keys.length && target.options.items.length) {
    target.options.keys = target.options.items.map((item) => item.key).filter(Boolean);
  }

  if (!target.options.keys.length) {
    target.options.keys = ["A", "B"];
  }

  if (!target.options.items.length) {
    target.options.items = target.options.keys.map((key) => createOptionItem(key));
  }

  const validKeySet = new Set(target.options.keys);
  target.correctOptionKeys = target.correctOptionKeys.filter((item) => validKeySet.has(item));
  target.answerChoices = buildAnswerChoiceList(target);
  return target;
}

function hydrateEditorForm(form) {
  const target = isPlainObject(form) ? form : createEmptyEditorForm();
  target.single = hydrateQuestionEditorState(target.single);
  target.grouped = isPlainObject(target.grouped) ? target.grouped : createGroupedQuestionForm();
  target.grouped.sharedStem = normalizeRichContent(target.grouped.sharedStem);
  target.grouped.children = normalizeArray(target.grouped.children).length
    ? target.grouped.children.map((child) => hydrateQuestionEditorState(child))
    : [hydrateQuestionEditorState(createSingleQuestionForm()), hydrateQuestionEditorState(createSingleQuestionForm())];
  return target;
}

function getNextOptionKey(itemsOrKeys) {
  const usedKeys = new Set(
    (Array.isArray(itemsOrKeys) ? itemsOrKeys : [])
      .map((item) => (isPlainObject(item) ? item.key : item))
      .map((item) => normalizeString(item).toUpperCase())
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

function getCloudFunctionNameByType(type) {
  const userTypes = new Set([
    "getOpenId",
    "getCurrentUser",
    "initCollections",
    "getMiniProgramCode",
  ]);
  return userTypes.has(type)
    ? USER_CLOUD_FUNCTION_NAME
    : QUESTION_CLOUD_FUNCTION_NAME;
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

function normalizeImageFileIds(value, fallback = "") {
  if (Array.isArray(value)) {
    const cleaned = value.map((item) => normalizeString(item)).filter(Boolean);
    if (cleaned.length) {
      return cleaned;
    }
  }
  const single = normalizeString(value);
  if (single) {
    return [single];
  }
  const legacy = normalizeString(fallback);
  return legacy ? [legacy] : [];
}

function normalizeRichContent(rawContent, legacyImageValue = "") {
  const content = isPlainObject(rawContent) ? rawContent : {};
  const imageFileIds = normalizeImageFileIds(
    content.imageFileIds || content.imageFileId,
    legacyImageValue
  );
  const sourceType = normalizeSourceType(
    content.sourceType,
    imageFileIds.length ? "image" : "text"
  );
  const text = normalizeString(content.text);
  if (sourceType === "text") {
    return {
      sourceType: "text",
      text,
      imageFileIds: [],
    };
  }
  return {
    sourceType: "image",
    text: "",
    imageFileIds,
  };
}

function normalizeOptionItem(item) {
  const option = isPlainObject(item) ? item : {};
  const key = normalizeString(option.key).toUpperCase();
  const sourceType = normalizeSourceType(
    option.sourceType,
    option.imageFileId ? "image" : "text"
  );
  const text = normalizeString(option.text);
  const imageFileId = normalizeString(option.imageFileId);
  return {
    key,
    sourceType,
    text: sourceType === "text" ? text : "",
    imageFileId: sourceType === "image" ? imageFileId : "",
  };
}

function normalizeGroupedAsset(groupedAsset) {
  const asset = isPlainObject(groupedAsset) ? groupedAsset : {};
  return {
    sourceType: "image",
    imageFileId: normalizeString(asset.imageFileId || asset.imageFileIds?.[0]),
  };
}

function normalizeOptions(options) {
  const source = isPlainObject(options) ? options : {};
  if (Array.isArray(source)) {
    const items = source.map((item) => normalizeOptionItem(item)).filter((item) => item.key);
    return {
      keys: items.map((item) => item.key),
      items,
      groupedAsset: {
        sourceType: "image",
        imageFileId: "",
      },
    };
  }
  return {
    keys: normalizeArray(source.keys)
      .map((item) => normalizeString(item).toUpperCase())
      .filter(Boolean),
    items: normalizeArray(source.items).map((item) => normalizeOptionItem(item)),
    groupedAsset: normalizeGroupedAsset(source.groupedAsset),
  };
}

function normalizeCheckboxKeys(keys) {
  return normalizeArray(keys)
    .map((item) => normalizeString(item).toUpperCase())
    .filter(Boolean);
}

function normalizeVersion(value) {
  const stringValue = normalizeString(value);
  if (stringValue) {
    return stringValue;
  }
  return String(Number(value || 0));
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

function getOptionModeLabel(optionMode) {
  return normalizeOptionMode(optionMode) === "grouped_asset" ? "大图模式" : "独立选项";
}

function getSummaryStemText(text, fallback) {
  const normalized = normalizeString(text);
  return normalized || fallback;
}

function normalizeQuestionPreview(preview) {
  const source = isPlainObject(preview) ? preview : {};
  const optionKeys = normalizeArray(source.optionKeys)
    .map((item) => normalizeString(item).toUpperCase())
    .filter(Boolean);
  const optionMode = normalizeOptionMode(source.optionMode);
  return {
    stemText: getSummaryStemText(source.stemText, "暂无题干摘要"),
    hasStemImage: !!source.hasStemImage,
    optionMode,
    optionModeLabel: getOptionModeLabel(optionMode),
    optionKeys,
    optionKeysText: optionKeys.length ? optionKeys.join(" / ") : "暂无选项",
  };
}

function normalizeGroupChildPreview(child) {
  const source = isPlainObject(child) ? child : {};
  return {
    questionId: normalizeString(source.questionId),
    questionLabel: normalizeString(source.questionLabel),
    groupId: normalizeString(source.groupId),
    groupOrder: Number(source.groupOrder || 1),
    questionType: normalizeString(source.questionType) || QUESTION_TYPE,
    entryMode: "grouped",
    preview: normalizeQuestionPreview(source.preview),
    version: normalizeVersion(source.version),
    createTime: source.createTime || 0,
    updateTime: source.updateTime || 0,
    updateTimeText: formatTime(source.updateTime),
  };
}

function normalizeSingleSummary(entity) {
  const source = isPlainObject(entity) ? entity : {};
  const questionId = normalizeString(source.questionId);
  return {
    summaryId: questionId,
    entityType: "single",
    questionId,
    questionLabel: normalizeString(source.questionLabel),
    groupId: "",
    questionType: normalizeString(source.questionType) || QUESTION_TYPE,
    entryMode: "single",
    preview: normalizeQuestionPreview(source.preview),
    version: normalizeVersion(source.version),
    createTime: source.createTime || 0,
    updateTime: source.updateTime || 0,
    updateTimeText: formatTime(source.updateTime),
  };
}

function normalizeGroupSummary(entity) {
  const source = isPlainObject(entity) ? entity : {};
  const groupId = normalizeString(source.groupId);
  const childrenPreview = normalizeArray(source.childrenPreview).map((item) =>
    normalizeGroupChildPreview(item)
  );
  return {
    summaryId: groupId,
    entityType: "group",
    groupId,
    questionType: normalizeString(source.questionType) || QUESTION_TYPE,
    entryMode: "grouped",
    sharedStemPreview: {
      stemText: getSummaryStemText(source.sharedStemPreview && source.sharedStemPreview.stemText, "暂无公共题干摘要"),
      hasStemImage: !!(source.sharedStemPreview && source.sharedStemPreview.hasStemImage),
    },
    childCount: Number(source.childCount || childrenPreview.length || 0),
    childrenPreview,
    version: normalizeVersion(source.version),
    createTime: source.createTime || 0,
    updateTime: source.updateTime || 0,
    updateTimeText: formatTime(source.updateTime),
  };
}

function normalizeQuestionSummaryEntity(entity) {
  return normalizeEntityType(entity && entity.entityType) === "group"
    ? normalizeGroupSummary(entity)
    : normalizeSingleSummary(entity);
}

function assignObject(target) {
  const result = target || {};
  for (let i = 1; i < arguments.length; i += 1) {
    const source = arguments[i];
    if (!source) {
      continue;
    }
    const keys = Object.keys(source);
    for (let j = 0; j < keys.length; j += 1) {
      result[keys[j]] = source[keys[j]];
    }
  }
  return result;
}

function appendArrays(left, right) {
  return normalizeArray(left).concat(normalizeArray(right));
}

function uniqueArray(values) {
  return Array.from(new Set(normalizeArray(values)));
}

function decorateQuestionSummaryEntity(entity, expandedGroupIds = []) {
  const source = isPlainObject(entity) ? entity : {};
  if (source.entityType === "group") {
    return assignObject({}, source, {
      isExpanded: expandedGroupIds.includes(source.groupId),
    });
  }
  return source;
}

function decorateQuestionSummaries(list, expandedGroupIds = []) {
  return normalizeArray(list).map((item) => decorateQuestionSummaryEntity(item, expandedGroupIds));
}

function buildDetailChildTabs(children, activeQuestionId) {
  const normalizedActiveId = normalizeString(activeQuestionId);
  return normalizeArray(children).map((child) => ({
    questionId: child.questionId,
    label: normalizeString(child.questionLabel) || `第 ${child.groupOrder} 题`,
    isActive: child.questionId === normalizedActiveId,
  }));
}

function getAnswerText(question) {
  const keys = normalizeCheckboxKeys(question && question.correctOptionKeys);
  return keys.length ? keys.join(", ") : "暂无";
}

function getQuestionImageUrls(question) {
  const urls = [];
  const source = isPlainObject(question) ? question : {};
  normalizeRichContent(source.sharedStem).imageFileIds.forEach((url) => urls.push(url));
  normalizeRichContent(source.stem, source.stemImageFileId).imageFileIds.forEach((url) => urls.push(url));

  const options = normalizeOptions(source.options);
  options.items.forEach((option) => {
    if (option.imageFileId) {
      urls.push(option.imageFileId);
    }
  });
  if (options.groupedAsset && options.groupedAsset.imageFileId) {
    urls.push(options.groupedAsset.imageFileId);
  }

  normalizeArray(source.children).forEach((child) => {
    getQuestionImageUrls(child).forEach((url) => urls.push(url));
  });

  return uniqueArray(urls.filter(Boolean));
}

function normalizeQuestionItem(question, isAdmin) {
  const source = isPlainObject(question) ? question : {};
  const entryMode = normalizeEntryMode(source.entryMode || (source.groupId ? "grouped" : "single"));
  const normalized = {
    _id: source._id || "",
    questionId: normalizeString(source.questionId),
    questionLabel: normalizeString(source.questionLabel),
    groupId: normalizeString(source.groupId),
    groupOrder: Number(source.groupOrder || 1),
    entryMode,
    questionType: normalizeString(source.questionType) || QUESTION_TYPE,
    sharedStem: normalizeRichContent(source.sharedStem),
    stem: normalizeRichContent(source.stem, source.stemImageFileId),
    optionMode: normalizeOptionMode(source.optionMode),
    options: normalizeOptions(source.options),
    version: normalizeVersion(source.version),
    createTime: source.createTime,
    updateTime: source.updateTime,
    createdBy: source.createdBy || "",
    updatedBy: source.updatedBy || "",
  };

  if (isAdmin) {
    normalized.correctOptionKeys = normalizeCheckboxKeys(source.correctOptionKeys);
    normalized.correctOptionText = getAnswerText(normalized);
  }

  return normalized;
}

function normalizeQuestionGroupDetail(group, isAdmin) {
  const source = isPlainObject(group) ? group : {};
  const sharedStem = normalizeRichContent(source.sharedStem);
  const childrenSource = normalizeArray(source.children).length
    ? normalizeArray(source.children)
    : normalizeArray(source.questions);
  const children = childrenSource.map((child, index) =>
    normalizeQuestionItem(
      assignObject({}, child, {
        entryMode: "grouped",
        groupId: normalizeString(source.groupId || child.groupId),
        groupOrder: Number(child.groupOrder || index + 1),
        sharedStem: child.sharedStem || sharedStem,
      }),
      isAdmin
    )
  );

  return {
    groupId: normalizeString(source.groupId),
    entryMode: "grouped",
    version: normalizeVersion(source.version),
    sharedStem,
    children,
    createTime: source.createTime,
    updateTime: source.updateTime,
    createdBy: source.createdBy || "",
    updatedBy: source.updatedBy || "",
  };
}

function normalizeEditorSingleForm(question) {
  const normalized = normalizeQuestionItem(question, true);
  return {
    questionId: normalized.questionId || "",
    questionLabel: normalized.questionLabel || "",
    questionType: QUESTION_TYPE,
    entryMode: "single",
    groupId: "",
    groupOrder: 1,
    sharedStem: createEmptySharedStem(),
    stem: normalized.stem || createEmptyStem(),
    optionMode: normalized.optionMode || "per_option",
    options: normalized.options && normalized.options.keys ? normalized.options : createDefaultOptions(),
    correctOptionKeys: normalizeArray(normalized.correctOptionKeys).slice(),
  };
}

function normalizeEditorGroupedForm(group) {
  const normalized = normalizeQuestionGroupDetail(group, true);
  return {
    groupId: normalized.groupId || "",
    sharedStem: normalized.sharedStem || createEmptySharedStem(),
    children: normalizeArray(normalized.children).length
      ? normalized.children.map((child) => normalizeEditorSingleForm(child))
      : [createSingleQuestionForm(), createSingleQuestionForm()],
  };
}

function getTargetStem(form, scope, childIndex) {
  if (scope === "group-shared") {
    return form.grouped.sharedStem;
  }
  if (scope === "group-child") {
    return form.grouped.children[childIndex] && form.grouped.children[childIndex].stem;
  }
  return form.single.stem;
}

function getTargetQuestion(form, scope, childIndex) {
  if (scope === "group-child") {
    return form.grouped.children[childIndex];
  }
  return form.single;
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
    initialLoading: false,
    loadingMore: false,
    savingQuestion: false,
    deletingQuestionId: "",
    userLoaded: false,
    isAdmin: false,
    currentUser: {
      openid: "",
      role: "",
    },
    questionSummaries: [],
    listCursor: "",
    listHasMore: false,
    listLoaded: false,
    expandedGroupIds: [],
    selectedDetail: null,
    selectedDetailType: "single",
    selectedDetailSource: "network",
    selectedDetailQuestionId: "",
    selectedDetailGroupId: "",
    selectedDetailActiveChildQuestionId: "",
    selectedDetailActiveChild: null,
    detailChildTabs: [],
    showDetailModal: false,
    showEditorModal: false,
    editorMode: "create",
    editorEntryMode: "single",
    editorForm: createEmptyEditorForm(),
  },

  onLoad(options) {
    this.detailCacheMap = new Map();
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

  onPullDownRefresh() {
    this.refreshCurrentUser(false).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  onReachBottom() {
    if (!this.data.isAdmin || this.data.showEditorModal || this.data.showDetailModal) {
      return;
    }
    this.loadMoreQuestionSummaries();
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
      name: getCloudFunctionNameByType(type),
      data: assignObject({ type: type }, appendRuntimeStorageData(data)),
    });
    return unwrapCloudResult(resp);
  },

  setEditorForm(mutator) {
    const editorForm = clone(this.data.editorForm);
    mutator(editorForm);
    hydrateEditorForm(editorForm);
    this.setData({
      editorForm,
    });
  },

  getEditorScopeFromEvent(e) {
    const scope = normalizeString(e.currentTarget.dataset.scope);
    if (scope === "group-shared") {
      return "group-shared";
    }
    if (scope === "group-child") {
      return "group-child";
    }
    return "single";
  },

  getChildIndexFromEvent(e) {
    const value = e.currentTarget.dataset.childIndex;
    return value === undefined || value === null || value === "" ? null : Number(value);
  },

  async refreshCurrentUser(showLoading = true) {
    if (!this.ensureCloudEnv()) {
      return;
    }

    if (showLoading) {
      wx.showLoading({ title: "同步中..." });
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
      if (isAdmin) {
        await this.refreshQuestionSummaries(false, isAdmin);
      } else {
        this.setData({
          questionSummaries: [],
          listCursor: "",
          listHasMore: false,
          listLoaded: true,
          expandedGroupIds: [],
          initialLoading: false,
          loadingQuestions: false,
          loadingMore: false,
        });
      }
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

  async refreshQuestionSummaries(showLoading = true, isAdmin = this.data.isAdmin) {
    if (!this.ensureCloudEnv()) {
      return;
    }

    if (!isAdmin) {
      this.setData({
        questionSummaries: [],
        listCursor: "",
        listHasMore: false,
        listLoaded: true,
        expandedGroupIds: [],
        initialLoading: false,
        loadingQuestions: false,
        loadingMore: false,
      });
      return;
    }

    if (showLoading) {
      wx.showLoading({ title: "加载题目..." });
    }

    this.setData({
      loadingQuestions: true,
      initialLoading: true,
      loadingMore: false,
    });

    try {
      const result = await this.callQuestionFunction("listQuestionSummaries", {
        limit: QUESTION_SUMMARY_PAGE_SIZE,
        cursor: "",
      });
      const data = isPlainObject(result.data) ? result.data : {};
      const normalizedList = normalizeArray(data.list).map((item) => normalizeQuestionSummaryEntity(item));
      this.setData({
        questionSummaries: decorateQuestionSummaries(normalizedList, []),
        listCursor: normalizeString(data.nextCursor),
        listHasMore: !!data.hasMore,
        listLoaded: true,
        expandedGroupIds: [],
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
        initialLoading: false,
      });
      if (showLoading) {
        wx.hideLoading();
      }
    }
  },

  async loadMoreQuestionSummaries() {
    if (!this.ensureCloudEnv() || !this.data.isAdmin) {
      return;
    }
    if (this.data.loadingQuestions || this.data.loadingMore || !this.data.listHasMore) {
      return;
    }

    this.setData({
      loadingMore: true,
    });

    try {
      const result = await this.callQuestionFunction("listQuestionSummaries", {
        limit: QUESTION_SUMMARY_PAGE_SIZE,
        cursor: this.data.listCursor,
      });
      const data = isPlainObject(result.data) ? result.data : {};
      const nextList = normalizeArray(data.list).map((item) => normalizeQuestionSummaryEntity(item));
      const mergedList = appendArrays(this.data.questionSummaries, nextList);
      this.setData({
        questionSummaries: decorateQuestionSummaries(mergedList, this.getExpandedGroupIds()),
        listCursor: normalizeString(data.nextCursor),
        listHasMore: !!data.hasMore,
        listLoaded: true,
      });
    } catch (error) {
      this.showCloudTip("加载更多失败", getErrorMessage(error));
    } finally {
      this.setData({
        loadingMore: false,
      });
    }
  },

  getExpandedGroupIds() {
    return normalizeArray(this.data.expandedGroupIds).map((item) => normalizeString(item)).filter(Boolean);
  },

  toggleGroupExpanded(e) {
    const groupId = normalizeString(e.currentTarget.dataset.groupid);
    if (!groupId) {
      return;
    }
    const expandedGroupIds = this.getExpandedGroupIds();
    const exists = expandedGroupIds.includes(groupId);
    const nextExpandedGroupIds = exists
      ? expandedGroupIds.filter((item) => item !== groupId)
      : expandedGroupIds.concat(groupId);
    this.setData({
      expandedGroupIds: nextExpandedGroupIds,
      questionSummaries: decorateQuestionSummaries(this.data.questionSummaries, nextExpandedGroupIds),
    });
  },

  getDetailCacheKey(type, id) {
    const normalizedId = normalizeString(id);
    if (!normalizedId) {
      return "";
    }
    return type === "group"
      ? GROUP_DETAIL_CACHE_PREFIX + normalizedId
      : SINGLE_DETAIL_CACHE_PREFIX + normalizedId;
  },

  getSummaryMeta(questionId, groupId) {
    const normalizedQuestionId = normalizeString(questionId);
    const normalizedGroupId = normalizeString(groupId);
    const summaries = normalizeArray(this.data.questionSummaries);
    for (let i = 0; i < summaries.length; i += 1) {
      const item = summaries[i];
      if (item.entityType === "single" && normalizedQuestionId && item.questionId === normalizedQuestionId) {
        return {
          entityType: "single",
          version: normalizeVersion(item.version),
          summary: item,
        };
      }
      if (item.entityType === "group" && normalizedGroupId && item.groupId === normalizedGroupId) {
        if (!normalizedQuestionId) {
          return {
            entityType: "group",
            version: normalizeVersion(item.version),
            summary: item,
          };
        }
        const child = normalizeArray(item.childrenPreview).find(
          (preview) => preview.questionId === normalizedQuestionId
        );
        if (child) {
          return {
            entityType: "group",
            version: normalizeVersion(item.version),
            summary: item,
            child,
          };
        }
      }
    }
    return {
      entityType: normalizedGroupId ? "group" : "single",
      version: "0",
      summary: null,
    };
  },

  getCachedDetail(type, id, expectedVersion) {
    const cacheKey = this.getDetailCacheKey(type, id);
    if (!cacheKey) {
      return null;
    }
    const normalizedVersion = normalizeVersion(expectedVersion);
    const memoryValue = this.detailCacheMap && this.detailCacheMap.get(cacheKey);
    const cached = memoryValue || wx.getStorageSync(cacheKey);
    if (!cached || normalizeVersion(cached.version) !== normalizedVersion) {
      return null;
    }
    if (this.detailCacheMap && !memoryValue) {
      this.detailCacheMap.set(cacheKey, cached);
    }
    return cached;
  },

  setCachedDetail(type, id, payload) {
    const cacheKey = this.getDetailCacheKey(type, id);
    if (!cacheKey) {
      return;
    }
    const nextPayload = assignObject({}, payload, {
      version: normalizeVersion(payload && payload.version),
      cachedAt: Date.now(),
    });
    if (this.detailCacheMap) {
      this.detailCacheMap.set(cacheKey, nextPayload);
    }
    wx.setStorageSync(cacheKey, nextPayload);
  },

  clearCachedDetail(type, id) {
    const cacheKey = this.getDetailCacheKey(type, id);
    if (!cacheKey) {
      return;
    }
    if (this.detailCacheMap) {
      this.detailCacheMap.delete(cacheKey);
    }
    wx.removeStorageSync(cacheKey);
  },

  showSingleDetail(detail, options = {}) {
    const normalized = normalizeQuestionItem(detail, this.data.isAdmin);
    this.setData({
      selectedDetail: normalized,
      selectedDetailType: "single",
      selectedDetailSource: options.source || "network",
      selectedDetailQuestionId: normalized.questionId,
      selectedDetailGroupId: "",
      selectedDetailActiveChildQuestionId: "",
      selectedDetailActiveChild: null,
      detailChildTabs: [],
      showDetailModal: true,
    });
  },

  showGroupedChildDetail(groupDetail, activeChildQuestionId, options = {}) {
    const normalized = normalizeQuestionGroupDetail(groupDetail, this.data.isAdmin);
    const activeChild =
      normalizeArray(normalized.children).find(
        (child) => child.questionId === normalizeString(activeChildQuestionId)
      ) || normalizeArray(normalized.children)[0] || null;
    this.setData({
      selectedDetail: normalized,
      selectedDetailType: "grouped",
      selectedDetailSource: options.source || "network",
      selectedDetailQuestionId: activeChild ? activeChild.questionId : "",
      selectedDetailGroupId: normalized.groupId,
      selectedDetailActiveChildQuestionId: activeChild ? activeChild.questionId : "",
      selectedDetailActiveChild: activeChild,
      detailChildTabs: buildDetailChildTabs(normalized.children, activeChild ? activeChild.questionId : ""),
      showDetailModal: true,
    });
  },

  async viewQuestionDetail(e) {
    const questionId = normalizeString(e.currentTarget.dataset.questionid);
    const groupId = normalizeString(e.currentTarget.dataset.groupid);
    const version = normalizeVersion(e.currentTarget.dataset.version);
    if (!this.ensureCloudEnv()) {
      return;
    }

    wx.showLoading({
      title: "加载详情...",
    });

    try {
      if (groupId) {
        const cached = this.getCachedDetail("group", groupId, version);
        if (cached && cached.data) {
          this.showGroupedChildDetail(cached.data, questionId, { source: "cache" });
          return;
        }
        const result = await this.callQuestionFunction("getQuestionGroupDetail", { groupId });
        const normalized = normalizeQuestionGroupDetail(result.data || {}, this.data.isAdmin);
        this.setCachedDetail("group", groupId, {
          type: "group",
          version: normalized.version,
          data: normalized,
        });
        this.showGroupedChildDetail(normalized, questionId, { source: "network" });
      } else {
        const cached = this.getCachedDetail("single", questionId, version);
        if (cached && cached.data) {
          this.showSingleDetail(cached.data, { source: "cache" });
          return;
        }
        const result = await this.callQuestionFunction("getQuestionDetail", { questionId });
        const normalized = normalizeQuestionItem(result.data || {}, this.data.isAdmin);
        this.setCachedDetail("single", questionId, {
          type: "single",
          version: normalized.version,
          data: normalized,
        });
        this.showSingleDetail(normalized, { source: "network" });
      }
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
      selectedDetail: null,
      selectedDetailType: "single",
      selectedDetailSource: "network",
      selectedDetailQuestionId: "",
      selectedDetailGroupId: "",
      selectedDetailActiveChildQuestionId: "",
      selectedDetailActiveChild: null,
      detailChildTabs: [],
    });
  },

  switchDetailChild(e) {
    const questionId = normalizeString(e.currentTarget.dataset.questionid);
    if (!questionId || this.data.selectedDetailType !== "grouped") {
      return;
    }
    const activeChild = normalizeArray(this.data.selectedDetail && this.data.selectedDetail.children).find(
      (child) => child.questionId === questionId
    );
    if (!activeChild) {
      return;
    }
    this.setData({
      selectedDetailQuestionId: activeChild.questionId,
      selectedDetailActiveChildQuestionId: activeChild.questionId,
      selectedDetailActiveChild: activeChild,
      detailChildTabs: buildDetailChildTabs(
        this.data.selectedDetail && this.data.selectedDetail.children,
        activeChild.questionId
      ),
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
    const groupId = e.currentTarget.dataset.groupid;
    if (!current) {
      return;
    }

    let source = null;
    if (
      this.data.showDetailModal &&
      this.data.selectedDetail &&
      ((groupId &&
        this.data.selectedDetailType === "grouped" &&
        this.data.selectedDetail.groupId === groupId) ||
        (!groupId &&
          this.data.selectedDetailType === "single" &&
          this.data.selectedDetail.questionId === questionId))
    ) {
      source = this.data.selectedDetail;
    }

    if (!source && groupId) {
      const cached = this.getCachedDetail("group", groupId, this.data.selectedDetail && this.data.selectedDetail.version);
      source = cached && cached.data ? cached.data : null;
    }

    if (!source && questionId) {
      const meta = this.getSummaryMeta(questionId, groupId);
      if (meta.summary && meta.summary.entityType === "group") {
        const cached = this.getCachedDetail("group", groupId, meta.version);
        source = cached && cached.data ? cached.data : null;
      } else {
        const cached = this.getCachedDetail("single", questionId, meta.version);
        source = cached && cached.data ? cached.data : null;
      }
    }

    const urls = getQuestionImageUrls(source);
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
      editorEntryMode: "single",
      editorForm: hydrateEditorForm(createEmptyEditorForm()),
      showEditorModal: true,
    });
  },

  async openEditQuestion(e) {
    this.showCloudTip("题目不可编辑", "题目当前不支持直接编辑，请删除后重新创建。");
  },

  closeEditor() {
    this.setData({
      showEditorModal: false,
      editorMode: "create",
      editorEntryMode: "single",
      editorForm: hydrateEditorForm(createEmptyEditorForm()),
    });
  },

  async deleteQuestion(e) {
    const questionId = normalizeString(e.currentTarget.dataset.questionid);
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
      this.clearCachedDetail("single", questionId);
      wx.showToast({
        title: "删除成功",
        icon: "success",
      });
      await this.refreshQuestionSummaries(false);
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
      wx.hideLoading();
      this.setData({
        deletingQuestionId: "",
      });
    }
  },

  async deleteQuestionGroup(e) {
    const groupId = normalizeString(e.currentTarget.dataset.groupid);
    if (!groupId) {
      return;
    }

    if (!this.data.isAdmin) {
      this.showCloudTip("权限不足", "只有管理员才能删除题组。");
      return;
    }

    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: "确认删除",
        content: `确定删除题组 ${groupId} 及其全部子题吗？`,
        success: function (res) {
          resolve(!!res.confirm);
        },
        fail: function () {
          resolve(false);
        },
      });
    });

    if (!confirmed || !this.ensureCloudEnv()) {
      return;
    }

    wx.showLoading({
      title: "删除中...",
    });
    this.setData({
      deletingQuestionId: groupId,
    });

    try {
      await this.callQuestionFunction("deleteQuestionGroup", {
        groupId: groupId,
      });
      this.clearCachedDetail("group", groupId);
      wx.showToast({
        title: "删除成功",
        icon: "success",
      });
      await this.refreshQuestionSummaries(false);
    } catch (error) {
      const errMsg = getErrorMessage(error);
      if (isTimeoutError(errMsg)) {
        this.showCloudTip(
          "删除题组超时",
          "删除请求超时，请确认云函数状态正常后重试。"
        );
      } else {
        this.showCloudTip("删除题组失败", errMsg);
      }
    } finally {
      wx.hideLoading();
      this.setData({
        deletingQuestionId: "",
      });
    }
  },

  switchEditorEntryMode(e) {
    this.setData({
      editorEntryMode: normalizeEntryMode(e.currentTarget.dataset.mode),
    });
  },

  switchStemSourceType(e) {
    const scope = this.getEditorScopeFromEvent(e);
    const childIndex = this.getChildIndexFromEvent(e);
    const sourceType = normalizeSourceType(e.currentTarget.dataset.type);

    this.setEditorForm((form) => {
      const target = getTargetStem(form, scope, childIndex);
      if (!target) {
        return;
      }

      target.sourceType = sourceType;
      if (sourceType === "text") {
        target.imageFileIds = [];
      } else {
        target.text = "";
      }
    });
  },

  onStemTextInput(e) {
    const scope = this.getEditorScopeFromEvent(e);
    const childIndex = this.getChildIndexFromEvent(e);
    const value = e.detail.value || "";

    this.setEditorForm((form) => {
      const target = getTargetStem(form, scope, childIndex);
      if (!target) {
        return;
      }
      target.text = value;
    });
  },

  onQuestionLabelInput(e) {
    const scope = this.getEditorScopeFromEvent(e);
    const childIndex = this.getChildIndexFromEvent(e);
    const value = e.detail.value || "";

    this.setEditorForm((form) => {
      const target = getTargetQuestion(form, scope, childIndex);
      if (!target) {
        return;
      }
      target.questionLabel = value;
    });
  },

  async uploadStemImages(e) {
    const scope = this.getEditorScopeFromEvent(e);
    const childIndex = this.getChildIndexFromEvent(e);
    if (!this.ensureCloudEnv()) {
      return;
    }

    wx.showLoading({
      title: "上传中...",
    });

    try {
      const fileIDs = await this.uploadImagesToCloud("question-stem");
      this.setEditorForm((form) => {
        const target = getTargetStem(form, scope, childIndex);
        if (!target) {
          return;
        }
        target.sourceType = "image";
        target.text = "";
        target.imageFileIds = uniqueArray(appendArrays(target.imageFileIds || [], fileIDs));
      });
    } catch (error) {
      this.showCloudTip("上传图片失败", getErrorMessage(error));
    } finally {
      wx.hideLoading();
    }
  },

  removeStemImage(e) {
    const scope = this.getEditorScopeFromEvent(e);
    const childIndex = this.getChildIndexFromEvent(e);
    const imageIndex = Number(e.currentTarget.dataset.index);

    this.setEditorForm((form) => {
      const target = getTargetStem(form, scope, childIndex);
      if (!target || Number.isNaN(imageIndex)) {
        return;
      }
      target.imageFileIds = normalizeArray(target.imageFileIds).filter(
        (_, index) => index !== imageIndex
      );
      if (!target.imageFileIds.length && target.sourceType === "image") {
        target.sourceType = "text";
      }
    });
  },

  switchOptionMode(e) {
    const scope = this.getEditorScopeFromEvent(e);
    const childIndex = this.getChildIndexFromEvent(e);
    const optionMode = normalizeOptionMode(e.currentTarget.dataset.mode);

    this.setEditorForm((form) => {
      const target = getTargetQuestion(form, scope, childIndex);
      if (!target) {
        return;
      }

      target.optionMode = optionMode;
      if (!Array.isArray(target.options.keys) || !target.options.keys.length) {
        target.options.keys = normalizeArray(target.options.items).length
          ? target.options.items.map((item) => item.key).filter(Boolean)
          : ["A", "B"];
      }
      if (!Array.isArray(target.options.items) || !target.options.items.length) {
        target.options.items = target.options.keys.map((key) => createOptionItem(key));
      }
      if (!target.options.groupedAsset) {
        target.options.groupedAsset = {
          sourceType: "image",
          imageFileId: "",
        };
      }
    });
  },

  addOption(e) {
    const scope = this.getEditorScopeFromEvent(e);
    const childIndex = this.getChildIndexFromEvent(e);

    this.setEditorForm((form) => {
      const target = getTargetQuestion(form, scope, childIndex);
      if (!target) {
        return;
      }

      if (target.optionMode === "grouped_asset") {
        const nextKey = getNextOptionKey(target.options.keys);
        target.options.keys = appendArrays(normalizeArray(target.options.keys), [nextKey]);
        if (!normalizeArray(target.options.items).length) {
          target.options.items = target.options.keys.map((key) => createOptionItem(key));
        } else {
          target.options.items = appendArrays(target.options.items, [createOptionItem(nextKey)]);
        }
        return;
      }

      const nextKey = getNextOptionKey(target.options.items);
      target.options.items = appendArrays(normalizeArray(target.options.items), [createOptionItem(nextKey)]);
      target.options.keys = target.options.items.map((item) => item.key);
    });
  },

  removeOption(e) {
    const scope = this.getEditorScopeFromEvent(e);
    const childIndex = this.getChildIndexFromEvent(e);
    const index = Number(e.currentTarget.dataset.index);

    this.setEditorForm((form) => {
      const target = getTargetQuestion(form, scope, childIndex);
      if (!target || Number.isNaN(index)) {
        return;
      }

      if (target.optionMode === "grouped_asset") {
        const keys = normalizeArray(target.options.keys);
        if (keys.length <= 2) {
          this.showCloudTip("选项数量不足", "题目至少保留两个选项。");
          return;
        }
        const removedKey = keys[index];
        if (!removedKey) {
          return;
        }
        target.options.keys = keys.filter((_, i) => i !== index);
        target.options.items = normalizeArray(target.options.items).filter(
          (item) => item.key !== removedKey
        );
        target.correctOptionKeys = normalizeArray(target.correctOptionKeys).filter(
          (item) => item !== removedKey
        );
        return;
      }

      const items = normalizeArray(target.options.items);
      if (items.length <= 2) {
        this.showCloudTip("选项数量不足", "题目至少保留两个选项。");
        return;
      }
      const removed = items[index];
      if (!removed) {
        return;
      }
      target.options.items = items.filter((_, i) => i !== index);
      target.options.keys = target.options.items.map((item) => item.key);
      target.correctOptionKeys = normalizeArray(target.correctOptionKeys).filter(
        (item) => item !== removed.key
      );
    });
  },

  onOptionKeyInput(e) {
    const scope = this.getEditorScopeFromEvent(e);
    const childIndex = this.getChildIndexFromEvent(e);
    const index = Number(e.currentTarget.dataset.index);
    const value = normalizeString(e.detail.value || "").toUpperCase();

    this.setEditorForm((form) => {
      const target = getTargetQuestion(form, scope, childIndex);
      if (!target || Number.isNaN(index)) {
        return;
      }

      if (target.optionMode === "grouped_asset") {
        const keys = normalizeArray(target.options.keys).slice();
        const oldKey = keys[index];
        if (!oldKey) {
          return;
        }
        keys[index] = value;
        target.options.keys = keys;
        target.correctOptionKeys = normalizeArray(target.correctOptionKeys).map((item) =>
          item === oldKey ? value : item
        );
        target.options.items = normalizeArray(target.options.items).map((item) =>
          item.key === oldKey ? assignObject({}, item, { key: value }) : item
        );
        return;
      }

      const items = normalizeArray(target.options.items);
      if (!items[index]) {
        return;
      }
      const oldKey = items[index].key;
      items[index].key = value;
      target.options.items = items;
      target.options.keys = items.map((item) => item.key);
      target.correctOptionKeys = normalizeArray(target.correctOptionKeys).map((item) =>
        item === oldKey ? value : item
      );
    });
  },

  switchOptionSourceType(e) {
    const scope = this.getEditorScopeFromEvent(e);
    const childIndex = this.getChildIndexFromEvent(e);
    const index = Number(e.currentTarget.dataset.index);
    const sourceType = normalizeSourceType(e.currentTarget.dataset.type);

    this.setEditorForm((form) => {
      const target = getTargetQuestion(form, scope, childIndex);
      if (!target || Number.isNaN(index)) {
        return;
      }

      const item = normalizeArray(target.options.items)[index];
      if (!item) {
        return;
      }

      item.sourceType = sourceType;
      if (sourceType === "text") {
        item.imageFileId = "";
      } else {
        item.text = "";
      }
    });
  },

  onOptionTextInput(e) {
    const scope = this.getEditorScopeFromEvent(e);
    const childIndex = this.getChildIndexFromEvent(e);
    const index = Number(e.currentTarget.dataset.index);
    const value = e.detail.value || "";

    this.setEditorForm((form) => {
      const target = getTargetQuestion(form, scope, childIndex);
      if (!target || Number.isNaN(index)) {
        return;
      }

      const item = normalizeArray(target.options.items)[index];
      if (!item) {
        return;
      }
      item.text = value;
    });
  },

  async uploadOptionImage(e) {
    const scope = this.getEditorScopeFromEvent(e);
    const childIndex = this.getChildIndexFromEvent(e);
    const index = Number(e.currentTarget.dataset.index);
    if (!this.ensureCloudEnv() || Number.isNaN(index)) {
      return;
    }

    wx.showLoading({
      title: "上传中...",
    });

    try {
      const fileIDs = await this.uploadImagesToCloud("question-option");
      const fileID = fileIDs[0];
      this.setEditorForm((form) => {
        const target = getTargetQuestion(form, scope, childIndex);
        if (!target) {
          return;
        }
        const item = normalizeArray(target.options.items)[index];
        if (!item) {
          return;
        }
        item.sourceType = "image";
        item.imageFileId = fileID || "";
        item.text = "";
      });
    } catch (error) {
      this.showCloudTip("上传选项图片失败", getErrorMessage(error));
    } finally {
      wx.hideLoading();
    }
  },

  removeOptionImage(e) {
    const scope = this.getEditorScopeFromEvent(e);
    const childIndex = this.getChildIndexFromEvent(e);
    const index = Number(e.currentTarget.dataset.index);
    this.setEditorForm((form) => {
      const target = getTargetQuestion(form, scope, childIndex);
      if (!target || Number.isNaN(index)) {
        return;
      }
      const item = normalizeArray(target.options.items)[index];
      if (!item) {
        return;
      }
      item.imageFileId = "";
      if (item.sourceType === "image") {
        item.sourceType = "text";
      }
    });
  },

  async uploadGroupedAssetImage(e) {
    const scope = this.getEditorScopeFromEvent(e);
    const childIndex = this.getChildIndexFromEvent(e);
    if (!this.ensureCloudEnv()) {
      return;
    }

    wx.showLoading({
      title: "上传中...",
    });

    try {
      const fileIDs = await this.uploadImagesToCloud("question-grouped-asset");
      const fileID = fileIDs[0];
      this.setEditorForm((form) => {
        const target = getTargetQuestion(form, scope, childIndex);
        if (!target) {
          return;
        }
        target.options.groupedAsset = {
          sourceType: "image",
          imageFileId: fileID || "",
        };
      });
    } catch (error) {
      this.showCloudTip("上传大图失败", getErrorMessage(error));
    } finally {
      wx.hideLoading();
    }
  },

  removeGroupedAssetImage(e) {
    const scope = this.getEditorScopeFromEvent(e);
    const childIndex = this.getChildIndexFromEvent(e);
    this.setEditorForm((form) => {
      const target = getTargetQuestion(form, scope, childIndex);
      if (!target) {
        return;
      }
      target.options.groupedAsset = {
        sourceType: "image",
        imageFileId: "",
      };
    });
  },

  onCorrectOptionChange(e) {
    const scope = this.getEditorScopeFromEvent(e);
    const childIndex = this.getChildIndexFromEvent(e);
    const checked = normalizeCheckboxKeys(e.detail.value);

    this.setEditorForm((form) => {
      const target = getTargetQuestion(form, scope, childIndex);
      if (!target) {
        return;
      }
      const keys = normalizeArray(target.options.keys);
      const keySet = new Set(keys);
      target.correctOptionKeys = checked.filter((item) => keySet.has(item));
    });
  },

  addChildQuestion() {
    this.setEditorForm((form) => {
      form.grouped.children.push(createSingleQuestionForm());
    });
  },

  removeChildQuestion(e) {
    const index = Number(e.currentTarget.dataset.childIndex);
    this.setEditorForm((form) => {
      if (Number.isNaN(index) || form.grouped.children.length <= 2) {
        this.showCloudTip("子题数量不足", "关联题至少保留两个子题。");
        return;
      }
      form.grouped.children.splice(index, 1);
    });
  },

  moveChildQuestionUp(e) {
    const index = Number(e.currentTarget.dataset.childIndex);
    this.setEditorForm((form) => {
      if (Number.isNaN(index) || index <= 0) {
        return;
      }
      const items = form.grouped.children;
      const temp = items[index - 1];
      items[index - 1] = items[index];
      items[index] = temp;
    });
  },

  moveChildQuestionDown(e) {
    const index = Number(e.currentTarget.dataset.childIndex);
    this.setEditorForm((form) => {
      if (Number.isNaN(index) || index >= form.grouped.children.length - 1) {
        return;
      }
      const items = form.grouped.children;
      const temp = items[index + 1];
      items[index + 1] = items[index];
      items[index] = temp;
    });
  },

  async uploadImagesToCloud(prefix) {
    const runtimeStorageInfo = getRuntimeStorageInfo();
    return new Promise((resolve, reject) => {
      wx.chooseMedia({
        count: 9,
        mediaType: ["image"],
        sourceType: ["album", "camera"],
        success: async (chooseResult) => {
          try {
            const files = normalizeArray(chooseResult.tempFiles);
            const uploads = await Promise.all(
              files.map((file, index) =>
                wx.cloud.uploadFile({
                  cloudPath: `${runtimeStorageInfo.storageRoot}/temp/${prefix}/${Date.now()}-${index}.png`,
                  filePath: file.tempFilePath,
                })
              )
            );
            resolve(uploads.map((item) => item.fileID));
          } catch (error) {
            reject(error);
          }
        },
        fail: reject,
      });
    });
  },

  validateRichContent(content, label, allowEmpty = false) {
    const normalized = normalizeRichContent(content);
    if (normalized.sourceType === "text") {
      if (!normalized.text && !allowEmpty) {
        return { valid: false, message: `${label}文本不能为空。` };
      }
      return { valid: true, data: normalized };
    }
    if (!normalized.imageFileIds.length && !allowEmpty) {
      return { valid: false, message: `${label}至少上传一张图片。` };
    }
    return { valid: true, data: normalized };
  },

  validateSingleQuestionForm(questionForm, label = "题目") {
    const source = isPlainObject(questionForm) ? questionForm : createSingleQuestionForm();
    const questionLabel = normalizeString(source.questionLabel);
    if (!questionLabel) {
      return { valid: false, message: `${label}题号昵称不能为空。` };
    }
    if (normalizeString(source.questionType) !== QUESTION_TYPE) {
      return { valid: false, message: `${label}类型必须是 choice。` };
    }

    const stemResult = this.validateRichContent(source.stem, `${label}题干`);
    if (!stemResult.valid) {
      return stemResult;
    }

    const optionMode = normalizeOptionMode(source.optionMode);
    const options = isPlainObject(source.options) ? source.options : createDefaultOptions();
    const correctOptionKeys = normalizeCheckboxKeys(source.correctOptionKeys);

    if (optionMode === "per_option") {
      const items = normalizeArray(options.items);
      if (items.length < 2) {
        return { valid: false, message: `${label}至少需要两个选项。` };
      }

      const normalizedItems = [];
      const keys = [];
      const seen = new Set();
      for (let i = 0; i < items.length; i += 1) {
        const item = normalizeOptionItem(items[i]);
        if (!item.key) {
          return { valid: false, message: `${label}请补全所有选项标识。` };
        }
        if (seen.has(item.key)) {
          return { valid: false, message: `${label}选项标识不能重复。` };
        }
        seen.add(item.key);

        if (item.sourceType === "text" && !item.text) {
          return { valid: false, message: `${label}请填写选项 ${item.key} 的文本。` };
        }
        if (item.sourceType === "image" && !item.imageFileId) {
          return { valid: false, message: `${label}请上传选项 ${item.key} 的图片。` };
        }

        normalizedItems.push(item);
        keys.push(item.key);
      }

      if (!correctOptionKeys.length) {
        return { valid: false, message: `${label}请至少选择一个正确答案。` };
      }
      for (let i = 0; i < correctOptionKeys.length; i += 1) {
        if (!seen.has(correctOptionKeys[i])) {
          return { valid: false, message: `${label}正确答案必须来自当前选项。` };
        }
      }

      return {
        valid: true,
        data: {
          questionType: QUESTION_TYPE,
          questionLabel,
          entryMode: "single",
          groupId: "",
          groupOrder: 1,
          sharedStem: createEmptySharedStem(),
          stem: stemResult.data,
          optionMode,
          options: {
            keys,
            items: normalizedItems,
            groupedAsset: {
              sourceType: "image",
              imageFileId: "",
            },
          },
          correctOptionKeys: Array.from(new Set(correctOptionKeys)),
        },
      };
    }

    const keys = normalizeCheckboxKeys(options.keys);
    if (keys.length < 2) {
      return { valid: false, message: `${label}至少需要两个选项。` };
    }

    const seen = new Set();
    for (let i = 0; i < keys.length; i += 1) {
      if (seen.has(keys[i])) {
        return { valid: false, message: `${label}选项标识不能重复。` };
      }
      seen.add(keys[i]);
    }

    const groupedAsset = normalizeGroupedAsset(options.groupedAsset);
    if (!groupedAsset.imageFileId) {
      return { valid: false, message: `${label}请上传覆盖选项的大图。` };
    }

    if (!correctOptionKeys.length) {
      return { valid: false, message: `${label}请至少选择一个正确答案。` };
    }
    for (let i = 0; i < correctOptionKeys.length; i += 1) {
      if (!seen.has(correctOptionKeys[i])) {
        return { valid: false, message: `${label}正确答案必须来自当前选项。` };
      }
    }

    return {
      valid: true,
      data: {
        questionType: QUESTION_TYPE,
        questionLabel,
        entryMode: "single",
        groupId: "",
        groupOrder: 1,
        sharedStem: createEmptySharedStem(),
        stem: stemResult.data,
        optionMode,
        options: {
          keys,
          items: [],
          groupedAsset,
        },
        correctOptionKeys: Array.from(new Set(correctOptionKeys)),
      },
    };
  },

  validateGroupedQuestionForm(groupForm) {
    const source = isPlainObject(groupForm) ? groupForm : createGroupedQuestionForm();
    const sharedStemResult = this.validateRichContent(source.sharedStem, "公共题干");
    if (!sharedStemResult.valid) {
      return sharedStemResult;
    }

    const children = normalizeArray(source.children);
    if (children.length < 2) {
      return { valid: false, message: "关联题至少需要两个子题。" };
    }

    const normalizedChildren = [];
    for (let i = 0; i < children.length; i += 1) {
      const childResult = this.validateSingleQuestionForm(children[i], `第 ${i + 1} 个子题`);
      if (!childResult.valid) {
        return childResult;
      }
      normalizedChildren.push(assignObject({}, childResult.data, {
        questionId: normalizeString(children[i] && children[i].questionId),
      }));
    }

    return {
      valid: true,
      data: {
        entryMode: "grouped",
        groupId: normalizeString(source.groupId),
        sharedStem: sharedStemResult.data,
        children: normalizedChildren,
      },
    };
  },

  async saveQuestion() {
    if (!this.data.isAdmin) {
      this.showCloudTip("权限不足", "只有管理员才能保存题目。");
      return;
    }

    if (!this.ensureCloudEnv()) {
      return;
    }

    const isGrouped = this.data.editorEntryMode === "grouped";
    const form = isGrouped ? this.data.editorForm.grouped : this.data.editorForm.single;
    const validation = isGrouped
      ? this.validateGroupedQuestionForm(form)
      : this.validateSingleQuestionForm(form);

    if (!validation.valid) {
      this.showCloudTip("请先完善题目", validation.message);
      return;
    }

    if (this.data.editorMode === "edit") {
      this.showCloudTip("题目不可编辑", "题目当前不支持直接编辑，请删除后重新创建。");
      return;
    }
    const payload = clone(validation.data);

    let loadingVisible = true;
    wx.showLoading({
      title: "保存中...",
    });
    this.setData({
      savingQuestion: true,
    });

    try {
      const actionType = isGrouped ? "createQuestionGroup" : "createQuestion";
      const result = await this.callQuestionFunction(actionType, payload);

      if (isGrouped) {
        const targetGroupId =
          normalizeString(payload.groupId) ||
          normalizeString(result && result.data && result.data.groupId) ||
          normalizeString(this.data.editorForm.grouped.groupId);
        if (targetGroupId) {
          this.clearCachedDetail("group", targetGroupId);
        }
      } else {
        const targetQuestionId =
          normalizeString(payload.questionId) ||
          normalizeString(result && result.data && result.data.questionId) ||
          normalizeString(this.data.editorForm.single.questionId);
        if (targetQuestionId) {
          this.clearCachedDetail("single", targetQuestionId);
        }
      }

      if (loadingVisible) {
        wx.hideLoading();
        loadingVisible = false;
      }

      wx.showToast({
        title: "保存成功",
        icon: "success",
      });
      this.closeEditor();
      await this.refreshQuestionSummaries(false);
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
      if (loadingVisible) {
        wx.hideLoading();
        loadingVisible = false;
      }
      this.setData({
        savingQuestion: false,
      });
    }
  },
});
