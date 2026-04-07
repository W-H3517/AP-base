const crypto = require("crypto");
const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const USERS_COLLECTION = "users";
const QUESTIONS_COLLECTION = "questions";
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

const normalizeOptions = (options) => {
  if (!Array.isArray(options)) {
    throw new Error("options 必须是数组");
  }

  const cleaned = options.map((option, index) => {
    const key = normalizeString(option?.key);
    const imageFileId = normalizeString(option?.imageFileId);
    if (!key) {
      throw new Error(`第 ${index + 1} 个选项缺少 key`);
    }
    if (!imageFileId) {
      throw new Error(`第 ${index + 1} 个选项缺少 imageFileId`);
    }
    return {
      key,
      imageFileId,
    };
  });

  const keySet = new Set();
  for (const option of cleaned) {
    if (keySet.has(option.key)) {
      throw new Error(`选项 key 重复：${option.key}`);
    }
    keySet.add(option.key);
  }

  return cleaned;
};

const normalizeCorrectOptionKeys = (correctOptionKeys) => {
  if (!Array.isArray(correctOptionKeys) || !correctOptionKeys.length) {
    throw new Error("correctOptionKeys 必须是非空数组");
  }

  const cleaned = correctOptionKeys.map((key) => normalizeString(key));
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

const validateQuestionPayload = (payload, { requireQuestionId = false } = {}) => {
  const questionId = normalizeString(payload?.questionId);
  const stemImageFileId = normalizeString(payload?.stemImageFileId);
  const options = normalizeOptions(payload?.options);
  const correctOptionKeys = normalizeCorrectOptionKeys(payload?.correctOptionKeys);

  if (requireQuestionId && !questionId) {
    throw new Error("questionId 不能为空");
  }
  if (!stemImageFileId) {
    throw new Error("stemImageFileId 不能为空");
  }

  const optionKeySet = new Set(options.map((item) => item.key));
  for (const key of correctOptionKeys) {
    if (!optionKeySet.has(key)) {
      throw new Error(`correctOptionKeys 包含不存在的选项：${key}`);
    }
  }

  return {
    questionId,
    stemImageFileId,
    options,
    correctOptionKeys,
  };
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

const stripQuestionByRole = (question, role) => {
  if (!question) {
    return null;
  }

  const base = {
    _id: question._id,
    questionId: question.questionId,
    stemImageFileId: question.stemImageFileId,
    options: question.options || [],
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
    const leftTime = Number(right?.createTime || 0);
    const rightTime = Number(left?.createTime || 0);
    return leftTime - rightTime;
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

  const resp = await db
    .collection(QUESTIONS_COLLECTION)
    .where({
      questionId,
    })
    .limit(1)
    .get();

  const question = resp.data?.[0];
  if (!question) {
    return fail("题目不存在");
  }

  return ok(stripQuestionByRole(question, user.role));
};

const buildQuestionDocument = async (payload, user, existingQuestion = null) => {
  const mergedPayload = existingQuestion
    ? {
        questionId: existingQuestion.questionId,
        stemImageFileId:
          payload.stemImageFileId ?? existingQuestion.stemImageFileId,
        options: payload.options ?? existingQuestion.options,
        correctOptionKeys:
          payload.correctOptionKeys ?? existingQuestion.correctOptionKeys,
      }
    : {
        stemImageFileId: payload.stemImageFileId,
        options: payload.options,
        correctOptionKeys: payload.correctOptionKeys,
      };

  const validated = validateQuestionPayload(mergedPayload, {
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
  const validated = validateQuestionPayload(payload);
  const now = Date.now();
  const questionId = await generateQuestionId();

  await db.collection(QUESTIONS_COLLECTION).add({
    data: {
      questionId,
      stemImageFileId: validated.stemImageFileId,
      options: validated.options,
      correctOptionKeys: validated.correctOptionKeys,
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

  const resp = await db
    .collection(QUESTIONS_COLLECTION)
    .where({
      questionId,
    })
    .limit(1)
    .get();

  const existingQuestion = resp.data?.[0];
  if (!existingQuestion) {
    return fail("题目不存在");
  }

  const validated = await buildQuestionDocument(payload, user, existingQuestion);
  await db.collection(QUESTIONS_COLLECTION).doc(existingQuestion._id).update({
    data: {
      stemImageFileId: validated.stemImageFileId,
      options: validated.options,
      correctOptionKeys: validated.correctOptionKeys,
      updateTime: validated.updateTime,
      updatedBy: validated.updatedBy,
    },
  });

  return ok({
    questionId,
  });
};

const deleteQuestion = async (event) => {
  await requireAdmin();
  const questionId = normalizeString(event?.data?.questionId || event?.questionId);
  if (!questionId) {
    return fail("questionId 不能为空");
  }

  const resp = await db
    .collection(QUESTIONS_COLLECTION)
    .where({
      questionId,
    })
    .limit(1)
    .get();

  const existingQuestion = resp.data?.[0];
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
    case "createQuestion":
      return createQuestion(event);
    case "updateQuestion":
      return updateQuestion(event);
    case "deleteQuestion":
      return deleteQuestion(event);
    case "getMiniProgramCode":
      return getMiniProgramCode();
    default:
      return fail(`不支持的操作类型：${event.type || "undefined"}`);
  }
};

// 获取小程序二维码
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

exports.main = async (event, context) => {
  try {
    return await dispatch(event || {});
  } catch (error) {
    return fail(error);
  }
};
