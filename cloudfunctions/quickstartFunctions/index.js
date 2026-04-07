const crypto = require("crypto");
const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const USERS_COLLECTION = "users";
const QUESTIONS_COLLECTION = "questions";
const QUESTION_TYPE_CHOICE = "choice";
const CONTENT_SOURCE_TEXT = "text";
const CONTENT_SOURCE_IMAGE = "image";
const ENTRY_MODE_SINGLE = "single";
const ENTRY_MODE_GROUPED = "grouped";
const OPTION_MODE_PER_OPTION = "per_option";
const OPTION_MODE_GROUPED_ASSET = "grouped_asset";
const ADMIN_OPENIDS = (process.env.ADMIN_OPENIDS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const ok = (data = null) => ({
  success: true,
  data,
  errMsg: "",
});

const fail = (errMsg) => ({
  success: false,
  data: null,
  errMsg: errMsg instanceof Error ? errMsg.message : String(errMsg),
});

const getWxContext = () => cloud.getWXContext();

const normalizeRole = (role) => (role === "admin" ? "admin" : "user");

const normalizeString = (value) =>
  typeof value === "string" ? value.trim() : "";

const normalizeUpperString = (value) => normalizeString(value).toUpperCase();

const ensureCollection = async (collectionName) => {
  try {
    await db.createCollection(collectionName);
    return { created: true };
  } catch (error) {
    return { created: false, errMsg: error?.message || String(error) };
  }
};

const ensureCollections = async () => {
  const [usersResult, questionsResult] = await Promise.all([
    ensureCollection(USERS_COLLECTION),
    ensureCollection(QUESTIONS_COLLECTION),
  ]);

  return {
    success: true,
    data: {
      usersCreated: usersResult.created,
      questionsCreated: questionsResult.created,
      notes: [
        "Ensure a unique index on users.openid in the cloud database console.",
        "Ensure a unique index on questions.questionId in the cloud database console.",
      ],
    },
    errMsg: "",
  };
};

const getUserByOpenId = async (openid) => {
  if (!openid) {
    return null;
  }

  try {
    const resp = await db
      .collection(USERS_COLLECTION)
      .where({
        openid,
      })
      .limit(1)
      .get();
    return resp.data?.[0] || null;
  } catch (error) {
    if ((error?.message || "").includes("collection")) {
      return null;
    }
    throw error;
  }
};

const ensureUserRecord = async () => {
  const wxContext = getWxContext();
  const openid = wxContext.OPENID;
  if (!openid) {
    throw new Error("无法获取当前用户身份");
  }

  await ensureCollections();

  const existing = await getUserByOpenId(openid);
  if (existing) {
    const normalizedRole = normalizeRole(existing.role);
    if (normalizedRole !== existing.role) {
      await db.collection(USERS_COLLECTION).doc(existing._id).update({
        data: {
          role: normalizedRole,
          updateTime: Date.now(),
        },
      });
      return {
        ...existing,
        role: normalizedRole,
      };
    }
    return existing;
  }

  const now = Date.now();
  const role = ADMIN_OPENIDS.includes(openid) ? "admin" : "user";

  try {
    await db.collection(USERS_COLLECTION).add({
      data: {
        openid,
        role,
        createTime: now,
        updateTime: now,
      },
    });
  } catch (error) {
    const duplicateLike =
      (error?.message || "").includes("Duplicate") ||
      (error?.message || "").includes("duplicate");
    if (!duplicateLike) {
      throw error;
    }
  }

  const created = await getUserByOpenId(openid);
  if (!created) {
    throw new Error("用户记录创建失败");
  }

  return created;
};

const requireAdmin = async () => {
  const user = await ensureUserRecord();
  if (normalizeRole(user.role) !== "admin") {
    throw new Error("仅管理员可执行此操作");
  }
  return user;
};

const generateQuestionId = async () => {
  for (let i = 0; i < 8; i += 1) {
    const candidate = `q_${crypto.randomBytes(16).toString("hex")}`;
    const existed = await db
      .collection(QUESTIONS_COLLECTION)
      .where({
        questionId: candidate,
      })
      .limit(1)
      .get();
    if (!existed.data?.length) {
      return candidate;
    }
  }

  throw new Error("题目ID生成失败，请重试");
};

const generateGroupId = async () => {
  for (let i = 0; i < 8; i += 1) {
    const candidate = `g_${crypto.randomBytes(12).toString("hex")}`;
    const existed = await db
      .collection(QUESTIONS_COLLECTION)
      .where({
        groupId: candidate,
      })
      .limit(1)
      .get();
    if (!existed.data?.length) {
      return candidate;
    }
  }

  throw new Error("题组ID生成失败，请重试");
};

const validateSourceType = (sourceType, fieldName) => {
  if (
    sourceType !== CONTENT_SOURCE_TEXT &&
    sourceType !== CONTENT_SOURCE_IMAGE
  ) {
    throw new Error(`${fieldName}.sourceType 仅支持 text 或 image`);
  }
  return sourceType;
};

const normalizeImageFileIds = (imageFileIds, fieldName) => {
  if (!Array.isArray(imageFileIds)) {
    throw new Error(`${fieldName}.imageFileIds 必须是数组`);
  }

  const cleaned = imageFileIds
    .map((item) => normalizeString(item))
    .filter(Boolean);

  if (!cleaned.length) {
    throw new Error(`${fieldName}.imageFileIds 不能为空`);
  }

  return cleaned;
};

const normalizeRichStem = (content, fieldName, { allowEmpty = false } = {}) => {
  if (allowEmpty) {
    const text = normalizeString(content?.text);
    const rawImageFileIds = Array.isArray(content?.imageFileIds)
      ? content.imageFileIds
      : [];
    const imageFileIds = rawImageFileIds
      .map((item) => normalizeString(item))
      .filter(Boolean);

    if (!text && !imageFileIds.length) {
      return {};
    }
  }

  const sourceType = validateSourceType(
    normalizeString(content?.sourceType),
    fieldName,
  );
  const text = normalizeString(content?.text);
  const imageFileIds = Array.isArray(content?.imageFileIds)
    ? content.imageFileIds
    : [];

  if (sourceType === CONTENT_SOURCE_TEXT) {
    if (!text) {
      throw new Error(`${fieldName}.text 不能为空`);
    }
    if (imageFileIds.some((item) => normalizeString(item))) {
      throw new Error(`${fieldName} 为文本时不能同时传 imageFileIds`);
    }
    return {
      sourceType,
      text,
      imageFileIds: [],
    };
  }

  return {
    sourceType,
    text: "",
    imageFileIds: normalizeImageFileIds(imageFileIds, fieldName),
  };
};

const normalizeOptionContent = (content, fieldName) => {
  const sourceType = validateSourceType(
    normalizeString(content?.sourceType),
    fieldName,
  );
  const text = normalizeString(content?.text);
  const imageFileId = normalizeString(content?.imageFileId);

  if (sourceType === CONTENT_SOURCE_TEXT) {
    if (!text) {
      throw new Error(`${fieldName}.text 不能为空`);
    }
    if (imageFileId) {
      throw new Error(`${fieldName} 为文本时不能同时传 imageFileId`);
    }
  }

  if (sourceType === CONTENT_SOURCE_IMAGE) {
    if (!imageFileId) {
      throw new Error(`${fieldName}.imageFileId 不能为空`);
    }
    if (text) {
      throw new Error(`${fieldName} 为图片时不能同时传 text`);
    }
  }

  return {
    sourceType,
    text: sourceType === CONTENT_SOURCE_TEXT ? text : "",
    imageFileId: sourceType === CONTENT_SOURCE_IMAGE ? imageFileId : "",
  };
};

const normalizeOptionKeys = (keys) => {
  if (!Array.isArray(keys) || !keys.length) {
    throw new Error("options.keys 必须是非空数组");
  }

  const cleaned = keys.map((key) => normalizeUpperString(key));
  const keySet = new Set();

  cleaned.forEach((key, index) => {
    if (!key) {
      throw new Error(`options.keys 第 ${index + 1} 项不能为空`);
    }
    if (keySet.has(key)) {
      throw new Error(`options.keys 重复：${key}`);
    }
    keySet.add(key);
  });

  return cleaned;
};

const normalizePerOptionItems = (items) => {
  if (!Array.isArray(items) || !items.length) {
    throw new Error("options.items 必须是非空数组");
  }

  const keySet = new Set();
  return items.map((item, index) => {
    const key = normalizeUpperString(item?.key);
    if (!key) {
      throw new Error(`第 ${index + 1} 个选项缺少 key`);
    }
    if (keySet.has(key)) {
      throw new Error(`选项 key 重复：${key}`);
    }
    keySet.add(key);
    return {
      key,
      ...normalizeOptionContent(item, `options.items[${index}]`),
    };
  });
};

const normalizeCorrectOptionKeys = (correctOptionKeys) => {
  if (!Array.isArray(correctOptionKeys) || !correctOptionKeys.length) {
    throw new Error("correctOptionKeys 必须是非空数组");
  }

  const cleaned = correctOptionKeys.map((key) => normalizeUpperString(key));
  const keySet = new Set();
  for (const key of cleaned) {
    if (!key) {
      throw new Error("correctOptionKeys 中存在空值");
    }
    if (keySet.has(key)) {
      throw new Error(`correctOptionKeys 重复：${key}`);
    }
    keySet.add(key);
  }

  return cleaned;
};

const validateOptionMode = (optionMode) => {
  const normalized = normalizeString(optionMode);
  if (
    normalized !== OPTION_MODE_PER_OPTION &&
    normalized !== OPTION_MODE_GROUPED_ASSET
  ) {
    throw new Error("optionMode 仅支持 per_option 或 grouped_asset");
  }
  return normalized;
};

const validateEntryMode = (entryMode) => {
  const normalized = normalizeString(entryMode);
  if (
    normalized !== ENTRY_MODE_SINGLE &&
    normalized !== ENTRY_MODE_GROUPED
  ) {
    throw new Error("entryMode 仅支持 single 或 grouped");
  }
  return normalized;
};

const normalizeGroupOrder = (groupOrder, { required = false } = {}) => {
  if (groupOrder === undefined || groupOrder === null || groupOrder === "") {
    if (required) {
      throw new Error("groupOrder 不能为空");
    }
    return 1;
  }

  const normalized = Number(groupOrder);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error("groupOrder 必须是大于 0 的整数");
  }
  return normalized;
};

const normalizeQuestionCore = (payload, { requireQuestionId = false } = {}) => {
  const questionId = normalizeString(payload?.questionId);
  const questionType = normalizeString(payload?.questionType);
  const stem = normalizeRichStem(payload?.stem, "stem");
  const optionMode = validateOptionMode(payload?.optionMode);
  const optionKeys = normalizeOptionKeys(payload?.options?.keys);
  const correctOptionKeys = normalizeCorrectOptionKeys(payload?.correctOptionKeys);

  if (requireQuestionId && !questionId) {
    throw new Error("questionId 不能为空");
  }

  if (questionType !== QUESTION_TYPE_CHOICE) {
    throw new Error("questionType 仅支持 choice");
  }

  const options = {
    keys: optionKeys,
    items: [],
    groupedAsset: {
      sourceType: CONTENT_SOURCE_IMAGE,
      imageFileId: "",
    },
  };

  if (optionMode === OPTION_MODE_PER_OPTION) {
    const items = normalizePerOptionItems(payload?.options?.items);
    const itemKeys = items.map((item) => item.key);
    if (itemKeys.length !== optionKeys.length) {
      throw new Error("options.keys 与 options.items 数量不一致");
    }

    for (let i = 0; i < optionKeys.length; i += 1) {
      if (optionKeys[i] !== itemKeys[i]) {
        throw new Error("options.keys 必须与 options.items.key 完全一致且顺序一致");
      }
    }

    const groupedAssetImageFileId = normalizeString(
      payload?.options?.groupedAsset?.imageFileId,
    );
    if (groupedAssetImageFileId) {
      throw new Error("per_option 模式下不能传 groupedAsset.imageFileId");
    }

    options.items = items;
  }

  if (optionMode === OPTION_MODE_GROUPED_ASSET) {
    const rawItems = payload?.options?.items;
    if (Array.isArray(rawItems) && rawItems.length) {
      throw new Error("grouped_asset 模式下 options.items 必须为空数组");
    }

    options.groupedAsset = normalizeOptionContent(
      {
        sourceType: CONTENT_SOURCE_IMAGE,
        text: "",
        imageFileId: payload?.options?.groupedAsset?.imageFileId,
      },
      "options.groupedAsset",
    );
  }

  const optionKeySet = new Set(optionKeys);
  for (const key of correctOptionKeys) {
    if (!optionKeySet.has(key)) {
      throw new Error(`correctOptionKeys 包含不存在的选项：${key}`);
    }
  }

  return {
    questionId,
    questionType,
    stem,
    optionMode,
    options,
    correctOptionKeys,
  };
};

const normalizeSingleQuestionPayload = (payload, { requireQuestionId = false } = {}) => {
  const entryMode = validateEntryMode(payload?.entryMode || ENTRY_MODE_SINGLE);
  if (entryMode !== ENTRY_MODE_SINGLE) {
    throw new Error("createQuestion / updateQuestion 仅支持 single 模式");
  }

  return {
    ...normalizeQuestionCore(payload, { requireQuestionId }),
    entryMode,
    groupId: "",
    sharedStem: normalizeRichStem(payload?.sharedStem, "sharedStem", {
      allowEmpty: true,
    }),
    groupOrder: 1,
  };
};

const normalizeGroupedChildren = (children, sharedStem) => {
  if (!Array.isArray(children) || !children.length) {
    throw new Error("children 必须是非空数组");
  }

  return children.map((child, index) => ({
    ...normalizeQuestionCore(child, { requireQuestionId: false }),
    entryMode: ENTRY_MODE_GROUPED,
    sharedStem,
    groupOrder: index + 1,
  }));
};

const getEventPayload = (event) => {
  if (
    event &&
    event.data &&
    typeof event.data === "object" &&
    !Array.isArray(event.data)
  ) {
    return event.data;
  }

  const payload = {
    ...(event || {}),
  };
  delete payload.type;
  return payload;
};

const getQuestionById = async (questionId) => {
  const resp = await db
    .collection(QUESTIONS_COLLECTION)
    .where({
      questionId,
    })
    .limit(1)
    .get();

  return resp.data?.[0] || null;
};

const getQuestionsByGroupId = async (groupId) => {
  const resp = await db
    .collection(QUESTIONS_COLLECTION)
    .where({
      groupId,
    })
    .get();

  return (resp.data || []).sort((left, right) => {
    const leftOrder = Number(left?.groupOrder || 0);
    const rightOrder = Number(right?.groupOrder || 0);
    return leftOrder - rightOrder;
  });
};

const stripQuestionByRole = (question, role) => {
  if (!question) {
    return null;
  }

  const base = {
    _id: question._id,
    questionId: question.questionId,
    groupId: normalizeString(question.groupId),
    questionType: question.questionType || QUESTION_TYPE_CHOICE,
    entryMode: question.entryMode || ENTRY_MODE_SINGLE,
    sharedStem:
      question.sharedStem && Object.keys(question.sharedStem).length
        ? question.sharedStem
        : {},
    stem:
      question.stem || {
        sourceType: CONTENT_SOURCE_TEXT,
        text: "",
        imageFileIds: [],
      },
    optionMode: question.optionMode || OPTION_MODE_PER_OPTION,
    options:
      question.options || {
        keys: [],
        items: [],
        groupedAsset: {
          sourceType: CONTENT_SOURCE_IMAGE,
          imageFileId: "",
        },
      },
    groupOrder: normalizeGroupOrder(question.groupOrder),
    createTime: question.createTime,
    updateTime: question.updateTime,
  };

  if (normalizeRole(role) === "admin") {
    return {
      ...base,
      correctOptionKeys: question.correctOptionKeys || [],
      createdBy: question.createdBy || "",
      updatedBy: question.updatedBy || "",
    };
  }

  return base;
};

const sortQuestions = (questions) =>
  [...questions].sort((left, right) => {
    const leftTime = Number(left?.createTime || 0);
    const rightTime = Number(right?.createTime || 0);
    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    const leftOrder = Number(left?.groupOrder || 0);
    const rightOrder = Number(right?.groupOrder || 0);
    return leftOrder - rightOrder;
  });

const getOpenId = async () => {
  const wxContext = getWxContext();
  return ok({
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID,
  });
};

const getCurrentUser = async () => {
  const user = await ensureUserRecord();
  return ok({
    openid: user.openid,
    role: normalizeRole(user.role),
    createTime: user.createTime,
    updateTime: user.updateTime,
  });
};

const initCollections = async () => ensureCollections();

const listQuestions = async () => {
  const user = await ensureUserRecord();
  const resp = await db.collection(QUESTIONS_COLLECTION).get();
  const questions = sortQuestions(resp.data || []).map((question) =>
    stripQuestionByRole(question, user.role),
  );
  return ok(questions);
};

const getQuestionDetail = async (event) => {
  const user = await ensureUserRecord();
  const questionId = normalizeString(event?.data?.questionId || event?.questionId);
  if (!questionId) {
    return fail("questionId 不能为空");
  }

  const question = await getQuestionById(questionId);
  if (!question) {
    return fail("题目不存在");
  }

  return ok(stripQuestionByRole(question, user.role));
};

const getQuestionGroupDetail = async (event) => {
  const user = await ensureUserRecord();
  const groupId = normalizeString(event?.data?.groupId || event?.groupId);
  if (!groupId) {
    return fail("groupId 不能为空");
  }

  const questions = await getQuestionsByGroupId(groupId);
  if (!questions.length) {
    return fail("题组不存在");
  }

  return ok({
    groupId,
    entryMode: ENTRY_MODE_GROUPED,
    sharedStem:
      questions[0].sharedStem && Object.keys(questions[0].sharedStem).length
        ? questions[0].sharedStem
        : {},
    children: questions.map((question) => stripQuestionByRole(question, user.role)),
  });
};

const buildSingleQuestionDocument = async (payload, user, existingQuestion = null) => {
  const mergedPayload = existingQuestion
    ? {
        questionId: existingQuestion.questionId,
        questionType: payload.questionType ?? existingQuestion.questionType,
        entryMode: payload.entryMode ?? existingQuestion.entryMode,
        sharedStem: payload.sharedStem ?? existingQuestion.sharedStem,
        stem: payload.stem ?? existingQuestion.stem,
        optionMode: payload.optionMode ?? existingQuestion.optionMode,
        options: payload.options ?? existingQuestion.options,
        correctOptionKeys:
          payload.correctOptionKeys ?? existingQuestion.correctOptionKeys,
      }
    : payload;

  const validated = normalizeSingleQuestionPayload(mergedPayload, {
    requireQuestionId: false,
  });

  return {
    ...validated,
    createTime: existingQuestion?.createTime || Date.now(),
    updateTime: Date.now(),
    createdBy: existingQuestion?.createdBy || user.openid,
    updatedBy: user.openid,
  };
};

const createQuestion = async (event) => {
  const user = await requireAdmin();
  const payload = getEventPayload(event);
  const validated = normalizeSingleQuestionPayload(payload);
  const now = Date.now();
  const questionId = await generateQuestionId();

  await db.collection(QUESTIONS_COLLECTION).add({
    data: {
      questionId,
      groupId: "",
      questionType: validated.questionType,
      entryMode: ENTRY_MODE_SINGLE,
      sharedStem: validated.sharedStem,
      stem: validated.stem,
      optionMode: validated.optionMode,
      options: validated.options,
      correctOptionKeys: validated.correctOptionKeys,
      groupOrder: 1,
      createTime: now,
      updateTime: now,
      createdBy: user.openid,
      updatedBy: user.openid,
    },
  });

  return ok({
    questionId,
  });
};

const updateQuestion = async (event) => {
  const user = await requireAdmin();
  const payload = getEventPayload(event);
  const questionId = normalizeString(payload.questionId);
  if (!questionId) {
    return fail("questionId 不能为空");
  }

  const existingQuestion = await getQuestionById(questionId);
  if (!existingQuestion) {
    return fail("题目不存在");
  }

  if ((existingQuestion.entryMode || ENTRY_MODE_SINGLE) !== ENTRY_MODE_SINGLE) {
    return fail("关联题请使用题组更新接口");
  }

  const validated = await buildSingleQuestionDocument(payload, user, existingQuestion);
  await db.collection(QUESTIONS_COLLECTION).doc(existingQuestion._id).update({
    data: {
      questionType: validated.questionType,
      entryMode: ENTRY_MODE_SINGLE,
      sharedStem: validated.sharedStem,
      stem: validated.stem,
      optionMode: validated.optionMode,
      options: validated.options,
      correctOptionKeys: validated.correctOptionKeys,
      groupId: "",
      groupOrder: 1,
      updateTime: validated.updateTime,
      updatedBy: validated.updatedBy,
    },
  });

  return ok({
    questionId,
  });
};

const createQuestionGroup = async (event) => {
  const user = await requireAdmin();
  const payload = getEventPayload(event);
  const sharedStem = normalizeRichStem(payload?.sharedStem, "sharedStem");
  const children = normalizeGroupedChildren(payload?.children, sharedStem);
  const groupId = await generateGroupId();
  const now = Date.now();

  await Promise.all(
    children.map(async (child) => {
      const questionId = await generateQuestionId();
      await db.collection(QUESTIONS_COLLECTION).add({
        data: {
          questionId,
          groupId,
          questionType: child.questionType,
          entryMode: ENTRY_MODE_GROUPED,
          sharedStem,
          stem: child.stem,
          optionMode: child.optionMode,
          options: child.options,
          correctOptionKeys: child.correctOptionKeys,
          groupOrder: child.groupOrder,
          createTime: now,
          updateTime: now,
          createdBy: user.openid,
          updatedBy: user.openid,
        },
      });
    }),
  );

  return ok({
    groupId,
  });
};

const updateQuestionGroup = async (event) => {
  const user = await requireAdmin();
  const payload = getEventPayload(event);
  const groupId = normalizeString(payload?.groupId);
  if (!groupId) {
    return fail("groupId 不能为空");
  }

  const existingQuestions = await getQuestionsByGroupId(groupId);
  if (!existingQuestions.length) {
    return fail("题组不存在");
  }

  const sharedStem = normalizeRichStem(payload?.sharedStem, "sharedStem");
  const children = normalizeGroupedChildren(payload?.children, sharedStem);
  const now = Date.now();

  await Promise.all(
    existingQuestions.map((question) =>
      db.collection(QUESTIONS_COLLECTION).doc(question._id).remove(),
    ),
  );

  await Promise.all(
    children.map(async (child) => {
      const questionId = normalizeString(child.questionId) || (await generateQuestionId());
      await db.collection(QUESTIONS_COLLECTION).add({
        data: {
          questionId,
          groupId,
          questionType: child.questionType,
          entryMode: ENTRY_MODE_GROUPED,
          sharedStem,
          stem: child.stem,
          optionMode: child.optionMode,
          options: child.options,
          correctOptionKeys: child.correctOptionKeys,
          groupOrder: child.groupOrder,
          createTime: now,
          updateTime: now,
          createdBy: user.openid,
          updatedBy: user.openid,
        },
      });
    }),
  );

  return ok({
    groupId,
  });
};

const deleteQuestion = async (event) => {
  await requireAdmin();
  const questionId = normalizeString(event?.data?.questionId || event?.questionId);
  if (!questionId) {
    return fail("questionId 不能为空");
  }

  const existingQuestion = await getQuestionById(questionId);
  if (!existingQuestion) {
    return fail("题目不存在");
  }

  await db.collection(QUESTIONS_COLLECTION).doc(existingQuestion._id).remove();
  return ok({
    questionId,
  });
};

const dispatch = async (event) => {
  switch (event.type) {
    case "getOpenId":
      return getOpenId();
    case "getCurrentUser":
      return getCurrentUser();
    case "initCollections":
      return initCollections();
    case "listQuestions":
      return listQuestions();
    case "getQuestionDetail":
      return getQuestionDetail(event);
    case "getQuestionGroupDetail":
      return getQuestionGroupDetail(event);
    case "createQuestion":
      return createQuestion(event);
    case "updateQuestion":
      return updateQuestion(event);
    case "createQuestionGroup":
      return createQuestionGroup(event);
    case "updateQuestionGroup":
      return updateQuestionGroup(event);
    case "deleteQuestion":
      return deleteQuestion(event);
    case "getMiniProgramCode":
      return getMiniProgramCode();
    default:
      return fail(`不支持的操作类型：${event.type || "undefined"}`);
  }
};

const getMiniProgramCode = async () => {
  const resp = await cloud.openapi.wxacode.get({
    path: "pages/index/index",
  });
  const { buffer } = resp;
  const upload = await cloud.uploadFile({
    cloudPath: "code.png",
    fileContent: buffer,
  });
  return ok(upload.fileID);
};

exports.main = async (event) => {
  try {
    return await dispatch(event || {});
  } catch (error) {
    return fail(error);
  }
};
