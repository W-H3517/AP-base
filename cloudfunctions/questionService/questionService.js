const crypto = require("crypto");
const cloud = require("wx-server-sdk");
const { db, _ } = require("./db");
const {
  QUESTION_TYPE_CHOICE,
  CONTENT_SOURCE_TEXT,
  CONTENT_SOURCE_IMAGE,
  ENTRY_MODE_SINGLE,
  ENTRY_MODE_GROUPED,
  OPTION_MODE_PER_OPTION,
  OPTION_MODE_GROUPED_ASSET,
  PRACTICE_PAPER_QUESTION_COUNT,
} = require("./constants");
const {
  ok,
  fail,
  normalizeString,
  normalizeUpperString,
  sortQuestions,
} = require("./utils");
const { ensureUserRecord, requireAdmin, normalizeRole, getCollections } = require("./userAccess");

const STORAGE_ROOT_DEVELOP = "develop";
const STORAGE_ROOT_TRIAL = "trial";
const STORAGE_ROOT_RELEASE = "trial";
const STORAGE_ROOTS = [
  STORAGE_ROOT_DEVELOP,
  STORAGE_ROOT_TRIAL,
];
const TEMP_RESOURCE_PREFIX = "temp/";
const SINGLE_RESOURCE_PREFIX = "Resources/single";
const GROUP_RESOURCE_PREFIX = "Resources/group";
const CLOUD_DELETE_BATCH_SIZE = 50;
const DB_IN_QUERY_BATCH_SIZE = 100;
const QUESTION_DRAFT_EXPIRE_MS = 24 * 60 * 60 * 1000;
const QUESTION_DRAFT_STATUS_PREPARED = "prepared";
const QUESTION_DRAFT_STATUS_SAVING = "saving";
const QUESTION_DRAFT_STATUS_FAILED = "failed";
const QUESTION_DRAFT_STATUS_COMMITTED = "committed";
const QUESTION_DRAFT_STATUS_ABANDONED = "abandoned";

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

const isMissingCloudFileError = (error) => {
  const errMsg = normalizeString(error?.message || String(error)).toLowerCase();
  return (
    errMsg.includes("file not exist") ||
    errMsg.includes("file not found") ||
    errMsg.includes("resource not found") ||
    errMsg.includes("not exist")
  );
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
  const text = normalizeString(content?.text);
  const imageFileIds = Array.isArray(content?.imageFileIds)
    ? content.imageFileIds.map((item) => normalizeString(item)).filter(Boolean)
    : [];

  if (allowEmpty && !text && !imageFileIds.length) {
    return {};
  }

  if (!text && !imageFileIds.length) {
    throw new Error(`${fieldName} 的文本和图片不能同时为空`);
  }

  const sourceType = imageFileIds.length
    ? CONTENT_SOURCE_IMAGE
    : validateSourceType(
        normalizeString(content?.sourceType) || CONTENT_SOURCE_TEXT,
        fieldName,
      );

  return {
    sourceType,
    text,
    imageFileIds,
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

const normalizeQuestionCore = (payload, { requireQuestionId = false } = {}) => {
  const questionId = normalizeString(payload?.questionId);
  const questionLabel = normalizeString(payload?.questionLabel);
  const questionType = normalizeString(payload?.questionType);
  const stem = normalizeRichStem(payload?.stem, "stem");
  const optionMode = validateOptionMode(payload?.optionMode);
  const optionKeys = normalizeOptionKeys(payload?.options?.keys);
  const correctOptionKeys = normalizeCorrectOptionKeys(payload?.correctOptionKeys);

  if (requireQuestionId && !questionId) {
    throw new Error("questionId 不能为空");
  }
  if (!questionLabel) {
    throw new Error("questionLabel 不能为空");
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
    questionLabel,
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
    questionId: normalizeString(child?.questionId),
    entryMode: ENTRY_MODE_GROUPED,
    sharedStem,
    groupOrder: index + 1,
  }));
};

const generateDraftToken = () =>
  `draft_${crypto.randomBytes(18).toString("hex")}`;

const getDraftExpireAt = () => Date.now() + QUESTION_DRAFT_EXPIRE_MS;

const generateQuestionId = async (questionsCollectionName) => {
  for (let i = 0; i < 8; i += 1) {
    const candidate = `q_${crypto.randomBytes(16).toString("hex")}`;
    const existed = await db
      .collection(questionsCollectionName)
      .where({ questionId: candidate })
      .limit(1)
      .get();
    if (!existed.data?.length) {
      return candidate;
    }
  }
  throw new Error("题目ID生成失败，请重试");
};

const generateGroupId = async (questionsCollectionName) => {
  for (let i = 0; i < 8; i += 1) {
    const candidate = `g_${crypto.randomBytes(12).toString("hex")}`;
    const existed = await db
      .collection(questionsCollectionName)
      .where({ groupId: candidate })
      .limit(1)
      .get();
    if (!existed.data?.length) {
      return candidate;
    }
  }
  throw new Error("题组ID生成失败，请重试");
};

const getQuestionById = async (questionId, questionsCollectionName) => {
  const resp = await db
    .collection(questionsCollectionName)
    .where({ questionId })
    .limit(1)
    .get();
  return resp.data?.[0] || null;
};

const getDraftByToken = async (draftToken, openid, questionDraftsCollectionName) => {
  const resp = await db
    .collection(questionDraftsCollectionName)
    .where({ draftToken, openid })
    .limit(1)
    .get();
  return resp.data?.[0] || null;
};

const updateDraftRecord = async (draftRecord, questionDraftsCollectionName, data) => {
  if (!draftRecord?._id) {
    throw new Error("草稿记录不存在");
  }
  await db.collection(questionDraftsCollectionName).doc(draftRecord._id).update({
    data: {
      ...data,
      updateTime: Date.now(),
    },
  });
};

const getQuestionsByIds = async (questionIds, questionsCollectionName) => {
  const normalizedIds = [...new Set(
    (questionIds || []).map((item) => normalizeString(item)).filter(Boolean)
  )];
  if (!normalizedIds.length) {
    return new Map();
  }

  const records = [];
  for (let i = 0; i < normalizedIds.length; i += DB_IN_QUERY_BATCH_SIZE) {
    const batchIds = normalizedIds.slice(i, i + DB_IN_QUERY_BATCH_SIZE);
    const resp = await db
      .collection(questionsCollectionName)
      .where({
        questionId: _.in(batchIds),
      })
      .get();
    records.push(...(resp.data || []));
  }

  return new Map(
    records.map((item) => [normalizeString(item?.questionId), item])
  );
};

const getQuestionsByGroupId = async (groupId, questionsCollectionName) => {
  const resp = await db
    .collection(questionsCollectionName)
    .where({ groupId })
    .get();
  return (resp.data || []).sort((left, right) => {
    const leftOrder = Number(left?.groupOrder || 0);
    const rightOrder = Number(right?.groupOrder || 0);
    return leftOrder - rightOrder;
  });
};

const getPracticeSubmissionById = async (submissionId, openid, practiceSubmissionsCollectionName) => {
  const resp = await db
    .collection(practiceSubmissionsCollectionName)
    .where({ submissionId, openid })
    .limit(1)
    .get();
  return resp.data?.[0] || null;
};

const getSingleQuestionVersion = (question) =>
  String(Number(question?.updateTime || 0));

const getGroupVersion = (questions) =>
  String(
    (questions || []).reduce(
      (maxVersion, question) => Math.max(maxVersion, Number(question?.updateTime || 0)),
      0,
    ),
  );

const buildStemPreview = (content) => {
  const imageFileIds = Array.isArray(content?.imageFileIds)
    ? content.imageFileIds.map((item) => normalizeString(item)).filter(Boolean)
    : [];

  return {
    stemText: normalizeString(content?.text),
    hasStemImage: imageFileIds.length > 0,
  };
};

const buildQuestionPreview = (question) => ({
  ...buildStemPreview(question?.stem),
  optionMode: question?.optionMode || OPTION_MODE_PER_OPTION,
  optionKeys: Array.isArray(question?.options?.keys)
    ? question.options.keys.map((item) => normalizeUpperString(item)).filter(Boolean)
    : [],
});

const decodeCursor = (cursor) => {
  const normalized = normalizeString(cursor);
  if (!normalized) {
    return 0;
  }

  try {
    const decoded = JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
    const offset = Number(decoded?.offset);
    return Number.isInteger(offset) && offset >= 0 ? offset : 0;
  } catch (error) {
    return 0;
  }
};

const encodeCursor = (offset) =>
  Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64");

const normalizeListLimit = (limit) => {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 10;
  }
  return Math.min(Math.floor(parsed), 100);
};

const sanitizePathSegment = (value, fallback = "resource") => {
  const normalized = normalizeString(value)
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
};

const normalizeStorageRoot = (value) => {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === "develop") {
    return STORAGE_ROOT_DEVELOP;
  }
  if (normalized === "trial" || normalized === "release") {
    return STORAGE_ROOT_TRIAL;
  }
  return "";
};

const normalizeRuntimeEnvVersion = (value) =>
  normalizeString(value).toLowerCase() === "develop" ? "develop" : "trial";

const resolveStorageRootFromRuntimeEnvVersion = (value) =>
  normalizeStorageRoot(normalizeRuntimeEnvVersion(value)) || STORAGE_ROOT_RELEASE;

const buildTempResourcePrefix = (storageRoot) =>
  `${normalizeStorageRoot(storageRoot) || STORAGE_ROOT_RELEASE}/${TEMP_RESOURCE_PREFIX}`;

const buildSingleResourcePrefix = (storageRoot) =>
  `${normalizeStorageRoot(storageRoot) || STORAGE_ROOT_RELEASE}/${SINGLE_RESOURCE_PREFIX}`;

const buildGroupResourcePrefix = (storageRoot) =>
  `${normalizeStorageRoot(storageRoot) || STORAGE_ROOT_RELEASE}/${GROUP_RESOURCE_PREFIX}`;

const buildSingleDraftResourceBasePath = (storageRoot, questionId) =>
  `${buildSingleResourcePrefix(storageRoot)}/${questionId}`;

const buildGroupDraftResourceBasePath = (storageRoot, groupId) =>
  `${buildGroupResourcePrefix(storageRoot)}/${groupId}`;

const buildDraftResponse = (draftRecord) => ({
  draftToken: normalizeString(draftRecord?.draftToken),
  entryMode: validateEntryMode(draftRecord?.entryMode || ENTRY_MODE_SINGLE),
  storageRoot: normalizeStorageRoot(draftRecord?.storageRoot),
  questionId: normalizeString(draftRecord?.questionId),
  groupId: normalizeString(draftRecord?.groupId),
  questionIds: Array.isArray(draftRecord?.questionIds)
    ? draftRecord.questionIds.map((item) => normalizeString(item)).filter(Boolean)
    : [],
  resourceBasePath:
    normalizeString(draftRecord?.entryMode) === ENTRY_MODE_GROUPED
      ? buildGroupDraftResourceBasePath(draftRecord?.storageRoot, draftRecord?.groupId)
      : buildSingleDraftResourceBasePath(draftRecord?.storageRoot, draftRecord?.questionId),
  status: normalizeString(draftRecord?.status || QUESTION_DRAFT_STATUS_PREPARED),
  expiresAt: Number(draftRecord?.expiresAt || 0),
});

const getFileExtensionFromFileId = (fileId) => {
  const normalized = normalizeString(fileId);
  const matched = normalized.match(/(\.[a-zA-Z0-9]+)(?:$|[?#])/);
  return matched ? matched[1].toLowerCase() : ".png";
};

const inferStorageRootFromFileId = (fileId) => {
  const normalized = normalizeString(fileId);
  for (const storageRoot of STORAGE_ROOTS) {
    if (
      normalized.includes(`/${storageRoot}/${TEMP_RESOURCE_PREFIX}`) ||
      normalized.includes(`${storageRoot}/${TEMP_RESOURCE_PREFIX}`) ||
      normalized.includes(`/${storageRoot}/Resources/`) ||
      normalized.includes(`${storageRoot}/Resources/`)
    ) {
      return storageRoot;
    }
  }
  return "";
};

const isTempFileId = (fileId) => {
  const normalized = normalizeString(fileId);
  return (
    normalized.includes(`/${TEMP_RESOURCE_PREFIX}`) ||
    normalized.includes(TEMP_RESOURCE_PREFIX) ||
    STORAGE_ROOTS.some((storageRoot) => {
      const scopedPrefix = buildTempResourcePrefix(storageRoot);
      return normalized.includes(`/${scopedPrefix}`) || normalized.includes(scopedPrefix);
    })
  );
};

const isManagedResourceFileId = (fileId) => {
  const normalized = normalizeString(fileId);
  return (
    normalized.includes("/Resources/") ||
    normalized.includes("Resources/") ||
    STORAGE_ROOTS.some((storageRoot) => {
      const singlePrefix = buildSingleResourcePrefix(storageRoot);
      const groupPrefix = buildGroupResourcePrefix(storageRoot);
      return (
        normalized.includes(`/${singlePrefix}`) ||
        normalized.includes(singlePrefix) ||
        normalized.includes(`/${groupPrefix}`) ||
        normalized.includes(groupPrefix)
      );
    })
  );
};

const buildResourceCloudPath = (basePath, kind, fileId, suffix = "") => {
  const ext = getFileExtensionFromFileId(fileId);
  const random = crypto.randomBytes(8).toString("hex");
  const normalizedKind = sanitizePathSegment(kind, "asset");
  const normalizedSuffix = sanitizePathSegment(suffix, "");
  return `${basePath}/${normalizedKind}${normalizedSuffix ? `-${normalizedSuffix}` : ""}-${random}${ext}`;
};

const copyCloudFileToResource = async (sourceFileId, cloudPath) => {
  const downloadResult = await cloud.downloadFile({
    fileID: sourceFileId,
  });
  const uploadResult = await cloud.uploadFile({
    cloudPath,
    fileContent: downloadResult.fileContent,
  });
  return normalizeString(uploadResult?.fileID);
};

const extractFileIdsFromRichContent = (content) => {
  return Array.isArray(content?.imageFileIds)
    ? content.imageFileIds.map((item) => normalizeString(item)).filter(Boolean)
    : [];
};

const extractFileIdsFromOptions = (options, optionMode) => {
  const fileIds = [];
  if (optionMode === OPTION_MODE_PER_OPTION) {
    (options?.items || []).forEach((item) => {
      if (normalizeString(item?.sourceType) === CONTENT_SOURCE_IMAGE) {
        const fileId = normalizeString(item?.imageFileId);
        if (fileId) {
          fileIds.push(fileId);
        }
      }
    });
  }

  if (optionMode === OPTION_MODE_GROUPED_ASSET) {
    const groupedAssetFileId = normalizeString(options?.groupedAsset?.imageFileId);
    if (groupedAssetFileId) {
      fileIds.push(groupedAssetFileId);
    }
  }

  return fileIds;
};

const collectStorageRoots = (fileIds) =>
  [...new Set((fileIds || []).map((fileId) => inferStorageRootFromFileId(fileId)).filter(Boolean))];

const extractStorageRootsFromQuestionPayload = (question, { includeSharedStem = true } = {}) => {
  if (!question) {
    return [];
  }
  const fileIds = [];
  if (includeSharedStem) {
    fileIds.push(...extractFileIdsFromRichContent(question.sharedStem));
  }
  fileIds.push(...extractFileIdsFromRichContent(question.stem));
  fileIds.push(...extractFileIdsFromOptions(question.options, question.optionMode));
  return collectStorageRoots(fileIds);
};

const extractStorageRootsFromGroupPayload = (sharedStem, children) => {
  const fileIds = [...extractFileIdsFromRichContent(sharedStem)];
  (children || []).forEach((child) => {
    fileIds.push(...extractFileIdsFromRichContent(child.stem));
    fileIds.push(...extractFileIdsFromOptions(child.options, child.optionMode));
  });
  return collectStorageRoots(fileIds);
};

const resolveStorageRoot = (event, payload, { grouped = false } = {}) => {
  const payloadRoots = grouped
    ? extractStorageRootsFromGroupPayload(payload.sharedStem, payload.children)
    : extractStorageRootsFromQuestionPayload(payload);

  if (payloadRoots.length > 1) {
    throw new Error("上传文件必须来自同一运行版本目录");
  }
  if (payloadRoots.length === 1) {
    return payloadRoots[0];
  }

  const eventStorageRoot = normalizeStorageRoot(event?.storageRoot || event?.data?.storageRoot);
  const runtimeEnvStorageRoot = resolveStorageRootFromRuntimeEnvVersion(
    event?.runtimeEnvVersion || event?.data?.runtimeEnvVersion,
  );

  if (eventStorageRoot && eventStorageRoot !== runtimeEnvStorageRoot) {
    throw new Error("storageRoot 与 runtimeEnvVersion 不一致");
  }

  return eventStorageRoot || runtimeEnvStorageRoot || STORAGE_ROOT_RELEASE;
};

const extractQuestionResourceFileIds = (question, { includeSharedStem = true } = {}) => {
  if (!question) {
    return [];
  }
  const fileIds = [];
  if (includeSharedStem) {
    fileIds.push(...extractFileIdsFromRichContent(question.sharedStem));
  }
  fileIds.push(...extractFileIdsFromRichContent(question.stem));
  fileIds.push(...extractFileIdsFromOptions(question.options, question.optionMode));
  return [...new Set(fileIds.filter((fileId) => isManagedResourceFileId(fileId)))];
};

const extractGroupResourceFileIds = (questions) => {
  const fileIdSet = new Set();
  (questions || []).forEach((question, index) => {
    extractQuestionResourceFileIds(question, {
      includeSharedStem: index === 0,
    }).forEach((fileId) => fileIdSet.add(fileId));
  });
  return [...fileIdSet];
};

const collectFileIdsFromValidatedSingle = (question) =>
  extractQuestionResourceFileIds(question);

const collectFileIdsFromValidatedGroup = (sharedStem, children) => {
  const fileIds = [...extractFileIdsFromRichContent(sharedStem)];
  (children || []).forEach((child) => {
    fileIds.push(...extractFileIdsFromRichContent(child.stem));
    fileIds.push(...extractFileIdsFromOptions(child.options, child.optionMode));
  });
  return [...new Set(fileIds.map((item) => normalizeString(item)).filter(Boolean))];
};

const isCloudFileId = (fileId) => normalizeString(fileId).startsWith("cloud://");

const assertNoTempResourceFileIds = (fileIds) => {
  const tempFileId = (fileIds || []).find((fileId) => isTempFileId(fileId));
  if (tempFileId) {
    throw new Error("提交数据仍包含临时文件，请重新上传后再保存");
  }
  const invalidFileId = (fileIds || []).find((fileId) => !isCloudFileId(fileId));
  if (invalidFileId) {
    throw new Error("图片资源必须为云文件 fileID");
  }
};

const isDraftExpired = (draftRecord) => Number(draftRecord?.expiresAt || 0) <= Date.now();

const ensureDraftActive = (draftRecord, expectedEntryMode) => {
  if (!draftRecord) {
    throw new Error("创建会话不存在，请重新创建");
  }
  if (normalizeString(draftRecord.status) === QUESTION_DRAFT_STATUS_ABANDONED) {
    throw new Error("创建会话已废弃，请重新创建");
  }
  if (normalizeString(draftRecord.status) === QUESTION_DRAFT_STATUS_COMMITTED) {
    throw new Error("创建会话已提交，请重新创建");
  }
  if (isDraftExpired(draftRecord)) {
    throw new Error("创建会话已过期，请重新创建");
  }
  if (expectedEntryMode && normalizeString(draftRecord.entryMode) !== expectedEntryMode) {
    throw new Error("创建会话类型不匹配");
  }
};

const isFileIdUnderDraftScope = (fileId, draftRecord) => {
  const normalizedFileId = normalizeString(fileId);
  if (!normalizedFileId) {
    return false;
  }
  if (normalizeString(draftRecord?.entryMode) === ENTRY_MODE_GROUPED) {
    return normalizedFileId.includes(`${buildGroupDraftResourceBasePath(draftRecord?.storageRoot, draftRecord?.groupId)}/`);
  }
  return normalizedFileId.includes(`${buildSingleDraftResourceBasePath(draftRecord?.storageRoot, draftRecord?.questionId)}/`);
};

const assertFileIdsWithinDraftScope = (fileIds, draftRecord) => {
  (fileIds || []).forEach((fileId) => {
    if (!isFileIdUnderDraftScope(fileId, draftRecord)) {
      throw new Error("图片资源不属于当前创建会话");
    }
  });
};

const deleteCloudFiles = async (fileIds) => {
  const normalizedFileIds = [...new Set((fileIds || []).map((item) => normalizeString(item)).filter(Boolean))];
  for (let i = 0; i < normalizedFileIds.length; i += CLOUD_DELETE_BATCH_SIZE) {
    const fileList = normalizedFileIds.slice(i, i + CLOUD_DELETE_BATCH_SIZE);
    if (!fileList.length) {
      continue;
    }
    try {
      const resp = await cloud.deleteFile({ fileList });
      const results = Array.isArray(resp?.fileList) ? resp.fileList : [];
      results.forEach((item) => {
        const status = Number(item?.status || 0);
        const errMsg = normalizeString(item?.errMsg).toLowerCase();
        if (status !== 0 && !errMsg.includes("not exist") && !errMsg.includes("not found")) {
          throw new Error(item?.errMsg || "云文件删除失败");
        }
      });
    } catch (error) {
      if (!isMissingCloudFileError(error)) {
        throw error;
      }
    }
  }
};

const safeDeleteCloudFiles = async (fileIds) => {
  try {
    await deleteCloudFiles(fileIds);
  } catch (error) {
    // Rollback cleanup is best effort.
  }
};

const materializeRichContentResources = async (content, basePath, kind, suffix = "") => {
  const nextContent = cloneJson(content || {});
  const imageFileIds = Array.isArray(nextContent.imageFileIds) ? nextContent.imageFileIds : [];
  const imageResults = await Promise.all(imageFileIds.map(async (item, index) => {
    const fileId = normalizeString(item);
    if (!fileId) {
      return null;
    }
    if (!isTempFileId(fileId)) {
      return {
        fileId,
        createdFileId: "",
      };
    }

    const targetFileId = await copyCloudFileToResource(
      fileId,
      buildResourceCloudPath(basePath, kind, fileId, `${suffix}${suffix ? "-" : ""}${index + 1}`),
    );
    return {
      fileId: targetFileId,
      createdFileId: targetFileId,
    };
  }));

  nextContent.imageFileIds = imageResults
    .map((item) => item?.fileId || "")
    .filter(Boolean);

  return {
    content: nextContent,
    createdFileIds: imageResults
      .map((item) => item?.createdFileId || "")
      .filter(Boolean),
  };
};

const materializeOptionsResources = async (options, optionMode, basePath, suffix = "") => {
  const nextOptions = cloneJson(options || {});

  if (optionMode === OPTION_MODE_PER_OPTION) {
    nextOptions.items = Array.isArray(nextOptions.items) ? nextOptions.items : [];
    const itemResults = await Promise.all(nextOptions.items.map(async (item, index) => {
      if (normalizeString(item?.sourceType) !== CONTENT_SOURCE_IMAGE) {
        return {
          item,
          createdFileId: "",
        };
      }
      const fileId = normalizeString(item?.imageFileId);
      if (!fileId || !isTempFileId(fileId)) {
        return {
          item,
          createdFileId: "",
        };
      }
      const optionKey = sanitizePathSegment(item.key || `option-${index + 1}`, `option-${index + 1}`);
      const targetFileId = await copyCloudFileToResource(
        fileId,
        buildResourceCloudPath(basePath, "option", fileId, `${suffix}${suffix ? "-" : ""}${optionKey}`),
      );
      return {
        item: {
          ...item,
          imageFileId: targetFileId,
        },
        createdFileId: targetFileId,
      };
    }));
    nextOptions.items = itemResults.map((item) => item.item);
    return {
      options: nextOptions,
      createdFileIds: itemResults
        .map((item) => item.createdFileId || "")
        .filter(Boolean),
    };
  }

  if (optionMode === OPTION_MODE_GROUPED_ASSET) {
    const fileId = normalizeString(nextOptions?.groupedAsset?.imageFileId);
    if (fileId && isTempFileId(fileId)) {
      const targetFileId = await copyCloudFileToResource(
        fileId,
        buildResourceCloudPath(basePath, "grouped-asset", fileId, suffix),
      );
      nextOptions.groupedAsset = {
        ...nextOptions.groupedAsset,
        imageFileId: targetFileId,
      };
      return {
        options: nextOptions,
        createdFileIds: [targetFileId],
      };
    }
  }

  return {
    options: nextOptions,
    createdFileIds: [],
  };
};

const materializeSingleQuestionResources = async (question, questionId, storageRoot) => {
  const nextQuestion = cloneJson(question);
  const basePath = `${buildSingleResourcePrefix(storageRoot)}/${questionId}`;
  const createdFileIds = [];

  const sharedStemResult = await materializeRichContentResources(
    nextQuestion.sharedStem,
    basePath,
    "shared-stem",
  );
  nextQuestion.sharedStem = sharedStemResult.content;
  createdFileIds.push(...sharedStemResult.createdFileIds);

  const stemResult = await materializeRichContentResources(
    nextQuestion.stem,
    basePath,
    "stem",
  );
  nextQuestion.stem = stemResult.content;
  createdFileIds.push(...stemResult.createdFileIds);

  const optionsResult = await materializeOptionsResources(
    nextQuestion.options,
    nextQuestion.optionMode,
    basePath,
  );
  nextQuestion.options = optionsResult.options;
  createdFileIds.push(...optionsResult.createdFileIds);

  return {
    question: nextQuestion,
    createdFileIds,
  };
};

const materializeGroupResources = async (sharedStem, children, groupId, storageRoot) => {
  const basePath = `${buildGroupResourcePrefix(storageRoot)}/${groupId}`;
  const createdFileIds = [];

  const sharedStemResult = await materializeRichContentResources(
    sharedStem,
    basePath,
    "shared-stem",
  );
  const finalSharedStem = sharedStemResult.content;
  createdFileIds.push(...sharedStemResult.createdFileIds);

  const childResults = await Promise.all(children.map(async (sourceChild, index) => {
    const child = cloneJson(sourceChild);
    child.sharedStem = finalSharedStem;

    const stemResult = await materializeRichContentResources(
      child.stem,
      basePath,
      "stem",
      String(index + 1),
    );
    child.stem = stemResult.content;

    const optionsResult = await materializeOptionsResources(
      child.options,
      child.optionMode,
      basePath,
      String(index + 1),
    );
    child.options = optionsResult.options;

    return {
      child,
      createdFileIds: [
        ...stemResult.createdFileIds,
        ...optionsResult.createdFileIds,
      ],
    };
  }));

  const finalChildren = [];
  childResults.forEach((result) => {
    createdFileIds.push(...result.createdFileIds);
    finalChildren.push(result.child);
  });

  return {
    sharedStem: finalSharedStem,
    children: finalChildren,
    createdFileIds,
  };
};

const stripQuestionByRole = (
  question,
  role,
  version = getSingleQuestionVersion(question),
) => {
  if (!question) {
    return null;
  }

  const base = {
    _id: question._id,
    questionId: question.questionId,
    questionLabel: normalizeString(question.questionLabel),
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
    groupOrder: Number(question.groupOrder || 1),
    version,
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

const buildSingleQuestionSummary = (question) => ({
  entityType: "single",
  questionId: question.questionId,
  questionLabel: normalizeString(question.questionLabel),
  groupId: "",
  questionType: question.questionType || QUESTION_TYPE_CHOICE,
  entryMode: ENTRY_MODE_SINGLE,
  preview: buildQuestionPreview(question),
  version: getSingleQuestionVersion(question),
  createTime: question.createTime,
  updateTime: question.updateTime,
});

const buildGroupChildPreview = (question, version) => ({
  questionId: question.questionId,
  questionLabel: normalizeString(question.questionLabel),
  groupId: normalizeString(question.groupId),
  groupOrder: Number(question.groupOrder || 1),
  questionType: question.questionType || QUESTION_TYPE_CHOICE,
  entryMode: ENTRY_MODE_GROUPED,
  preview: buildQuestionPreview(question),
  version,
  createTime: question.createTime,
  updateTime: question.updateTime,
});

const buildGroupSummary = (questions) => {
  const sortedQuestions = [...questions].sort((left, right) => {
    const leftOrder = Number(left?.groupOrder || 0);
    const rightOrder = Number(right?.groupOrder || 0);
    return leftOrder - rightOrder;
  });
  const firstQuestion = sortedQuestions[0] || {};
  const version = getGroupVersion(sortedQuestions);

  return {
    entityType: "group",
    groupId: normalizeString(firstQuestion.groupId),
    questionType: firstQuestion.questionType || QUESTION_TYPE_CHOICE,
    entryMode: ENTRY_MODE_GROUPED,
    sharedStemPreview: buildStemPreview(firstQuestion.sharedStem),
    childCount: sortedQuestions.length,
    childrenPreview: sortedQuestions.map((question) =>
      buildGroupChildPreview(question, version),
    ),
    version,
    createTime: sortedQuestions.reduce((minTime, question) => {
      const createTime = Number(question?.createTime || 0);
      if (!minTime) {
        return createTime;
      }
      return Math.min(minTime, createTime);
    }, 0),
    updateTime: sortedQuestions.reduce(
      (maxTime, question) => Math.max(maxTime, Number(question?.updateTime || 0)),
      0,
    ),
  };
};

const buildQuestionSummaryEntities = (questions) => {
  const groupedMap = new Map();
  const entities = [];

  sortQuestions(questions || []).forEach((question) => {
    const entryMode = question?.entryMode || ENTRY_MODE_SINGLE;
    if (entryMode === ENTRY_MODE_GROUPED && normalizeString(question?.groupId)) {
      const groupId = normalizeString(question.groupId);
      if (!groupedMap.has(groupId)) {
        groupedMap.set(groupId, []);
      }
      groupedMap.get(groupId).push(question);
      return;
    }

    entities.push({
      sortCreateTime: Number(question?.createTime || 0),
      sortGroupOrder: Number(question?.groupOrder || 0),
      data: buildSingleQuestionSummary(question),
    });
  });

  groupedMap.forEach((groupQuestions) => {
    const summary = buildGroupSummary(groupQuestions);
    entities.push({
      sortCreateTime: Number(summary.createTime || 0),
      sortGroupOrder: 0,
      data: summary,
    });
  });

  return entities
    .sort((left, right) => {
      if (left.sortCreateTime !== right.sortCreateTime) {
        return right.sortCreateTime - left.sortCreateTime;
      }
      return left.sortGroupOrder - right.sortGroupOrder;
    })
    .map((item) => item.data);
};

const buildQuestionSummaryPaginationUnits = (questions) => {
  const groupedMap = new Map();
  const units = [];

  sortQuestions(questions || []).forEach((question) => {
    const entryMode = question?.entryMode || ENTRY_MODE_SINGLE;
    if (entryMode === ENTRY_MODE_GROUPED && normalizeString(question?.groupId)) {
      const groupId = normalizeString(question.groupId);
      if (!groupedMap.has(groupId)) {
        groupedMap.set(groupId, []);
      }
      groupedMap.get(groupId).push(question);
      return;
    }

    units.push({
      sortCreateTime: Number(question?.createTime || 0),
      sortGroupOrder: Number(question?.groupOrder || 0),
      questionCount: 1,
      data: buildSingleQuestionSummary(question),
    });
  });

  groupedMap.forEach((groupQuestions) => {
    const summary = buildGroupSummary(groupQuestions);
    units.push({
      sortCreateTime: Number(summary.createTime || 0),
      sortGroupOrder: 0,
      questionCount: Number(summary.childCount || 0),
      data: summary,
    });
  });

  return units.sort((left, right) => {
    if (left.sortCreateTime !== right.sortCreateTime) {
      return right.sortCreateTime - left.sortCreateTime;
    }
    return left.sortGroupOrder - right.sortGroupOrder;
  });
};

const countQuestionSummaryUnits = (units) =>
  (units || []).reduce((total, unit) => total + Number(unit?.questionCount || 0), 0);

const paginateQuestionSummaryUnits = (units, offset, limit) => {
  const normalizedUnits = Array.isArray(units) ? units : [];
  const normalizedOffset = Math.max(0, Number(offset || 0));
  const normalizedLimit = normalizeListLimit(limit);
  const pageUnits = [];
  let pageQuestionCount = 0;
  let cursor = normalizedOffset;

  while (cursor < normalizedUnits.length) {
    const unit = normalizedUnits[cursor];
    const unitQuestionCount = Math.max(1, Number(unit?.questionCount || 0));
    if (
      pageUnits.length > 0 &&
      pageQuestionCount + unitQuestionCount > normalizedLimit
    ) {
      break;
    }

    pageUnits.push(unit);
    pageQuestionCount += unitQuestionCount;
    cursor += 1;

    if (pageQuestionCount >= normalizedLimit) {
      break;
    }
  }

  return {
    list: pageUnits.map((unit) => unit.data),
    nextOffset: cursor,
    hasMore: cursor < normalizedUnits.length,
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
  const payload = { ...(event || {}) };
  delete payload.type;
  return payload;
};

const createDraftRecord = async (user, collections, payload) => {
  const now = Date.now();
  const draftToken = generateDraftToken();
  const childCount = Math.max(2, Number(payload?.childCount || 2));
  const storageRoot =
    normalizeStorageRoot(payload?.storageRoot) ||
    resolveStorageRootFromRuntimeEnvVersion(payload?.runtimeEnvVersion);

  if (normalizeString(payload?.entryMode) === ENTRY_MODE_GROUPED) {
    const groupId = await generateGroupId(collections.questions);
    const questionIds = [];
    for (let i = 0; i < childCount; i += 1) {
      questionIds.push(await generateQuestionId(collections.questions));
    }
    const record = {
      draftToken,
      openid: user.openid,
      entryMode: ENTRY_MODE_GROUPED,
      storageRoot,
      questionId: "",
      groupId,
      questionIds,
      status: QUESTION_DRAFT_STATUS_PREPARED,
      uploadedFileIds: [],
      createTime: now,
      updateTime: now,
      expiresAt: getDraftExpireAt(),
    };
    await db.collection(collections.questionDrafts).add({ data: record });
    return record;
  }

  const questionId = await generateQuestionId(collections.questions);
  const record = {
    draftToken,
    openid: user.openid,
    entryMode: ENTRY_MODE_SINGLE,
    storageRoot,
    questionId,
    groupId: "",
    questionIds: [],
    status: QUESTION_DRAFT_STATUS_PREPARED,
    uploadedFileIds: [],
    createTime: now,
    updateTime: now,
    expiresAt: getDraftExpireAt(),
  };
  await db.collection(collections.questionDrafts).add({ data: record });
  return record;
};

const prepareCreateQuestionDraft = async (event) => {
  const user = await requireAdmin(event);
  const collections = getCollections(event);
  const draftRecord = await createDraftRecord(user, collections, {
    ...getEventPayload(event),
    entryMode: ENTRY_MODE_SINGLE,
  });
  return ok(buildDraftResponse(draftRecord));
};

const prepareCreateQuestionGroupDraft = async (event) => {
  const user = await requireAdmin(event);
  const collections = getCollections(event);
  const draftRecord = await createDraftRecord(user, collections, {
    ...getEventPayload(event),
    entryMode: ENTRY_MODE_GROUPED,
  });
  return ok(buildDraftResponse(draftRecord));
};

const appendDraftGroupQuestionIds = async (event) => {
  const user = await requireAdmin(event);
  const collections = getCollections(event);
  const payload = getEventPayload(event);
  const draftToken = normalizeString(payload?.draftToken);
  const appendCount = Math.max(1, Number(payload?.appendCount || 1));
  if (!draftToken) {
    return fail("draftToken 不能为空");
  }
  const draftRecord = await getDraftByToken(
    draftToken,
    user.openid,
    collections.questionDrafts,
  );
  ensureDraftActive(draftRecord, ENTRY_MODE_GROUPED);

  const nextQuestionIds = [];
  for (let i = 0; i < appendCount; i += 1) {
    nextQuestionIds.push(await generateQuestionId(collections.questions));
  }
  const questionIds = [
    ...(Array.isArray(draftRecord.questionIds) ? draftRecord.questionIds : []),
    ...nextQuestionIds,
  ];
  await updateDraftRecord(draftRecord, collections.questionDrafts, {
    questionIds,
    status: QUESTION_DRAFT_STATUS_PREPARED,
    expiresAt: getDraftExpireAt(),
  });
  return ok({
    draftToken,
    questionIds: nextQuestionIds,
    allQuestionIds: questionIds,
    expiresAt: getDraftExpireAt(),
  });
};

const cleanupDraftResources = async (event) => {
  const user = await requireAdmin(event);
  const collections = getCollections(event);
  const payload = getEventPayload(event);
  const draftToken = normalizeString(payload?.draftToken);
  if (!draftToken) {
    return fail("draftToken 不能为空");
  }
  const draftRecord = await getDraftByToken(
    draftToken,
    user.openid,
    collections.questionDrafts,
  );
  if (!draftRecord) {
    return ok({ draftToken, cleanedFileIds: [] });
  }

  const requestedFileIds = Array.isArray(payload?.uploadedFileIds)
    ? payload.uploadedFileIds.map((item) => normalizeString(item)).filter(Boolean)
    : [];
  const currentUploaded = Array.isArray(draftRecord.uploadedFileIds)
    ? draftRecord.uploadedFileIds.map((item) => normalizeString(item)).filter(Boolean)
    : [];
  const cleanupTargets = requestedFileIds.length
    ? currentUploaded.filter((fileId) => requestedFileIds.includes(fileId))
    : currentUploaded;

  await deleteCloudFiles(cleanupTargets);
  const cleanedSet = new Set(cleanupTargets);
  const remainingFileIds = currentUploaded.filter((fileId) => !cleanedSet.has(fileId));
  await updateDraftRecord(draftRecord, collections.questionDrafts, {
    uploadedFileIds: remainingFileIds,
    status:
      normalizeString(payload?.status) === QUESTION_DRAFT_STATUS_ABANDONED
        ? QUESTION_DRAFT_STATUS_ABANDONED
        : QUESTION_DRAFT_STATUS_FAILED,
    expiresAt: getDraftExpireAt(),
  });
  return ok({
    draftToken,
    cleanedFileIds: cleanupTargets,
    remainingFileIds,
  });
};

const abandonDraft = async (event) =>
  cleanupDraftResources({
    ...event,
    data: {
      ...getEventPayload(event),
      status: QUESTION_DRAFT_STATUS_ABANDONED,
    },
  });

const listQuestions = async (event) => {
  const user = await ensureUserRecord(event);
  const collections = getCollections(event);
  const resp = await db.collection(collections.questions).get();
  return ok(
    sortQuestions(resp.data || []).map((question) =>
      stripQuestionByRole(question, user.role),
    ),
  );
};

const listQuestionSummaries = async (event) => {
  await requireAdmin(event);
  const collections = getCollections(event);
  const payload = getEventPayload(event);
  const limit = normalizeListLimit(payload?.limit);
  const offset = decodeCursor(payload?.cursor);

  normalizeString(payload?.keyword);

  const resp = await db.collection(collections.questions).get();
  const units = buildQuestionSummaryPaginationUnits(resp.data || []);
  const totalQuestionCount = countQuestionSummaryUnits(units);
  const page = paginateQuestionSummaryUnits(units, offset, limit);

  return ok({
    list: page.list,
    nextCursor: page.hasMore ? encodeCursor(page.nextOffset) : "",
    hasMore: page.hasMore,
    totalQuestionCount,
  });
};

const getQuestionDetail = async (event) => {
  const user = await ensureUserRecord(event);
  const collections = getCollections(event);
  const questionId = normalizeString(event?.data?.questionId || event?.questionId);
  if (!questionId) {
    return fail("questionId 不能为空");
  }
  const question = await getQuestionById(questionId, collections.questions);
  if (!question) {
    return fail("题目不存在");
  }
  return ok(stripQuestionByRole(question, user.role, getSingleQuestionVersion(question)));
};

const getQuestionGroupDetail = async (event) => {
  const user = await ensureUserRecord(event);
  const collections = getCollections(event);
  const groupId = normalizeString(event?.data?.groupId || event?.groupId);
  if (!groupId) {
    return fail("groupId 不能为空");
  }
  const questions = await getQuestionsByGroupId(groupId, collections.questions);
  if (!questions.length) {
    return fail("题组不存在");
  }
  const version = getGroupVersion(questions);
  return ok({
    groupId,
    entryMode: ENTRY_MODE_GROUPED,
    version,
    sharedStem:
      questions[0].sharedStem && Object.keys(questions[0].sharedStem).length
        ? questions[0].sharedStem
        : {},
    children: questions.map((question) => stripQuestionByRole(question, user.role, version)),
  });
};

const generateSubmissionId = () =>
  `sub_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

const buildPracticeQuestionItem = (question) => {
  const sanitized = stripQuestionByRole(question, "user", getSingleQuestionVersion(question));
  return {
    questionId: sanitized.questionId,
    questionLabel: normalizeString(sanitized.questionLabel),
    groupId: sanitized.groupId,
    entryMode: sanitized.entryMode,
    groupOrder: Number(sanitized.groupOrder || 1),
    questionType: sanitized.questionType || QUESTION_TYPE_CHOICE,
    sharedStem:
      sanitized.sharedStem && Object.keys(sanitized.sharedStem).length
        ? sanitized.sharedStem
        : {},
    stem: sanitized.stem,
    optionMode: sanitized.optionMode,
    options: sanitized.options,
    version: sanitized.version,
    createTime: sanitized.createTime,
    updateTime: sanitized.updateTime,
  };
};

const buildPracticeSubmissionQuestionSnapshot = (question) => ({
  questionId: question.questionId,
  questionLabel: normalizeString(question.questionLabel),
  groupId: question.groupId,
  entryMode: question.entryMode,
  groupOrder: Number(question.groupOrder || 1),
  questionType: question.questionType || QUESTION_TYPE_CHOICE,
  sharedStem:
    question.sharedStem && Object.keys(question.sharedStem).length
      ? cloneJson(question.sharedStem)
      : {},
  stem: cloneJson(question.stem || {}),
  optionMode: question.optionMode,
  options: cloneJson(question.options || {}),
  version: question.version,
});

const buildPracticeQuestionRef = (question, index = 0) => ({
  questionId: question.questionId,
  questionLabel: normalizeString(question.questionLabel),
  groupId: question.groupId,
  entryMode: question.entryMode,
  groupOrder: Number(question.groupOrder || 1),
  version: normalizeString(question.version || "0"),
  index: Number(index || 0),
});

const buildPracticeQuestionRefs = (questions) =>
  (Array.isArray(questions) ? questions : []).map((question, index) =>
    buildPracticeQuestionRef(question, index),
  );

const shuffleArray = (items) => {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
};

const buildPracticePaperUnits = (questions) => {
  const groupedMap = new Map();
  const singleUnits = [];

  sortQuestions(questions || []).forEach((question) => {
    const entryMode = question?.entryMode || ENTRY_MODE_SINGLE;
    const groupId = normalizeString(question?.groupId);
    if (entryMode === ENTRY_MODE_GROUPED && groupId) {
      if (!groupedMap.has(groupId)) {
        groupedMap.set(groupId, []);
      }
      groupedMap.get(groupId).push(question);
      return;
    }
    singleUnits.push({
      questions: [question],
      questionCount: 1,
    });
  });

  const groupedUnits = [];
  groupedMap.forEach((items) => {
    const sortedItems = [...items].sort((left, right) => {
      const leftOrder = Number(left?.groupOrder || 0);
      const rightOrder = Number(right?.groupOrder || 0);
      return leftOrder - rightOrder;
    });
    groupedUnits.push({
      questions: sortedItems,
      questionCount: sortedItems.length,
    });
  });

  return singleUnits.concat(groupedUnits);
};

const normalizePracticePaperQuestionCount = (value) => {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return 20;
  }
  return Math.floor(normalized);
};

const buildPracticePaperQuestions = (
  questions,
  configuredCount = PRACTICE_PAPER_QUESTION_COUNT,
) => {
  const practiceUnits = buildPracticePaperUnits(questions);
  const shuffledUnits = shuffleArray(practiceUnits);
  const selectedQuestions = [];
  let selectedCount = 0;

  shuffledUnits.forEach((unit) => {
    if (selectedCount >= configuredCount) {
      return;
    }
    selectedQuestions.push(...unit.questions);
    selectedCount += unit.questionCount;
  });

  return selectedQuestions.map((question) =>
    buildPracticeQuestionItem(question),
  );
};

const getPracticePaper = async (event) => {
  await ensureUserRecord(event);
  const collections = getCollections(event);
  const resp = await db.collection(collections.questions).get();
  const configuredCount = normalizePracticePaperQuestionCount(PRACTICE_PAPER_QUESTION_COUNT);
  const questions = buildPracticePaperQuestions(resp.data || [], configuredCount);
  return ok({
    paperMeta: {
      configuredCount,
      totalCount: questions.length,
      generatedAt: Date.now(),
    },
    questionRefs: buildPracticeQuestionRefs(questions),
  });
};

const getPracticeQuestionDetail = async (event) => {
  await ensureUserRecord(event);
  const collections = getCollections(event);
  const questionId = normalizeString(event?.data?.questionId || event?.questionId);
  if (!questionId) {
    return fail("questionId 不能为空");
  }
  const question = await getQuestionById(questionId, collections.questions);
  if (!question) {
    return fail("题目不存在");
  }
  return ok(buildPracticeQuestionItem(question));
};

const normalizeSelectedOptionKeys = (keys, label) => {
  if (!Array.isArray(keys)) {
    throw new Error(`${label} 必须是数组`);
  }
  const cleaned = keys
    .map((item) => normalizeUpperString(item))
    .filter(Boolean);
  const keySet = new Set();
  cleaned.forEach((item) => {
    if (keySet.has(item)) {
      throw new Error(`${label} 中存在重复选项：${item}`);
    }
    keySet.add(item);
  });
  return cleaned;
};

const normalizePracticeAnswers = (answers) => {
  if (!Array.isArray(answers)) {
    throw new Error("answers 必须是数组");
  }
  const answerMap = new Map();

  answers.forEach((answer, index) => {
    const questionId = normalizeString(answer?.questionId);
    if (!questionId) {
      throw new Error(`answers[${index}].questionId 不能为空`);
    }
    answerMap.set(questionId, {
      questionId,
      selectedOptionKeys: normalizeSelectedOptionKeys(
        answer?.selectedOptionKeys || [],
        `answers[${index}].selectedOptionKeys`,
      ),
      answeredAt: Number(answer?.answeredAt || 0) || Date.now(),
    });
  });

  return answerMap;
};

const normalizePaperSnapshotQuestions = (questions) => {
  if (!Array.isArray(questions) || !questions.length) {
    throw new Error("paperSnapshot.questions 必须是非空数组");
  }
  return questions.map((question, index) => {
    const questionId = normalizeString(question?.questionId);
    const questionLabel = normalizeString(question?.questionLabel);
    if (!questionId) {
      throw new Error(`paperSnapshot.questions[${index}].questionId 不能为空`);
    }
    if (!questionLabel) {
      throw new Error(`paperSnapshot.questions[${index}].questionLabel 不能为空`);
    }
    return {
      questionId,
      questionLabel,
      groupId: normalizeString(question?.groupId),
      entryMode: validateEntryMode(question?.entryMode || ENTRY_MODE_SINGLE),
      groupOrder: Number(question?.groupOrder || 1),
      version: normalizeString(question?.version || "0"),
    };
  });
};

const isSameOptionKeySet = (left, right) => {
  if (left.length !== right.length) {
    return false;
  }
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  for (let i = 0; i < leftSorted.length; i += 1) {
    if (leftSorted[i] !== rightSorted[i]) {
      return false;
    }
  }
  return true;
};

const submitPracticePaper = async (event) => {
  const user = await ensureUserRecord(event);
  const collections = getCollections(event);
  const payload = getEventPayload(event);
  const snapshotQuestions = normalizePaperSnapshotQuestions(
    payload?.paperSnapshot?.questions,
  );
  const answerMap = normalizePracticeAnswers(payload?.answers || []);
  const now = Date.now();
  const judgeQuestionResults = [];
  const questionSnapshots = [];
  let answeredCount = 0;
  let correctCount = 0;
  const latestQuestionMap = await getQuestionsByIds(
    snapshotQuestions.map((item) => item.questionId),
    collections.questions,
  );

  for (const snapshotQuestion of snapshotQuestions) {
    const latestQuestion = latestQuestionMap.get(snapshotQuestion.questionId) || null;
    const answer = answerMap.get(snapshotQuestion.questionId) || {
      questionId: snapshotQuestion.questionId,
      selectedOptionKeys: [],
      answeredAt: 0,
    };

    const selectedOptionKeys = answer.selectedOptionKeys;
    const answered = selectedOptionKeys.length > 0;
    if (answered) {
      answeredCount += 1;
    }

    const currentVersion = latestQuestion
      ? getSingleQuestionVersion(latestQuestion)
      : normalizeString(snapshotQuestion.version || "0");
    const versionChanged = currentVersion !== normalizeString(snapshotQuestion.version || "0");
    const correctOptionKeys = Array.isArray(latestQuestion?.correctOptionKeys)
      ? latestQuestion.correctOptionKeys.map((item) => normalizeUpperString(item)).filter(Boolean)
      : [];
    const isCorrect =
      !!latestQuestion &&
      answered &&
      isSameOptionKeySet(selectedOptionKeys, correctOptionKeys);

    if (isCorrect) {
      correctCount += 1;
    }

    questionSnapshots.push(
      latestQuestion
        ? buildPracticeSubmissionQuestionSnapshot(buildPracticeQuestionItem(latestQuestion))
        : {
            questionId: snapshotQuestion.questionId,
            questionLabel: normalizeString(snapshotQuestion.questionLabel),
            groupId: snapshotQuestion.groupId,
            entryMode: snapshotQuestion.entryMode,
            groupOrder: Number(snapshotQuestion.groupOrder || 1),
            questionType: QUESTION_TYPE_CHOICE,
            sharedStem: {},
            stem: {},
            optionMode: OPTION_MODE_PER_OPTION,
            options: {
              keys: [],
              items: [],
              groupedAsset: {
                sourceType: CONTENT_SOURCE_IMAGE,
                imageFileId: "",
              },
            },
            version: normalizeString(snapshotQuestion.version || "0"),
          },
    );

    judgeQuestionResults.push({
      questionId: snapshotQuestion.questionId,
      isCorrect,
      versionChanged,
      questionMissing: !latestQuestion,
    });
  }

  const submissionId = generateSubmissionId();
  const totalCount = snapshotQuestions.length;
  const score = totalCount ? Number(((correctCount / totalCount) * 100).toFixed(2)) : 0;

  await db.collection(collections.practiceSubmissions).add({
    data: {
      submissionId,
      openid: user.openid,
      role: normalizeRole(user.role),
      paperSnapshot: {
        totalCount,
        questions: snapshotQuestions,
      },
      questionSnapshots,
      answers: snapshotQuestions.map((question) => {
        const answer = answerMap.get(question.questionId);
        return {
          questionId: question.questionId,
          selectedOptionKeys: answer ? answer.selectedOptionKeys : [],
          answeredAt: answer ? answer.answeredAt : 0,
        };
      }),
      judgeResult: {
        totalCount,
        answeredCount,
        correctCount,
        score,
        questionResults: judgeQuestionResults,
      },
      createTime: now,
      updateTime: now,
    },
  });

  return ok({
    submissionId,
    totalCount,
    answeredCount,
    correctCount,
    score,
    submittedAt: now,
    questionResults: judgeQuestionResults.map((item) => ({
      questionId: item.questionId,
      isCorrect: !!item.isCorrect,
      versionChanged: !!item.versionChanged,
    })),
  });
};

const listPracticeSubmissions = async (event) => {
  const user = await ensureUserRecord(event);
  const collections = getCollections(event);
  const resp = await db
    .collection(collections.practiceSubmissions)
    .where({ openid: user.openid })
    .get();

  const list = (resp.data || [])
    .map((item) => {
      const judgeResult = item?.judgeResult || {};
      return {
        submissionId: item.submissionId || "",
        totalCount: Number(judgeResult.totalCount || item?.paperSnapshot?.totalCount || 0),
        answeredCount: Number(judgeResult.answeredCount || 0),
        correctCount: Number(judgeResult.correctCount || 0),
        score: Number(judgeResult.score || 0),
        submittedAt: Number(item.createTime || 0),
      };
    })
    .sort((left, right) => right.submittedAt - left.submittedAt);

  return ok({
    list,
  });
};

const getPracticeSubmissionDetail = async (event) => {
  const user = await ensureUserRecord(event);
  const collections = getCollections(event);
  const submissionId = normalizeString(event?.data?.submissionId || event?.submissionId);
  if (!submissionId) {
    return fail("submissionId 不能为空");
  }

  const record = await getPracticeSubmissionById(
    submissionId,
    user.openid,
    collections.practiceSubmissions,
  );
  if (!record) {
    return fail("做题记录不存在");
  }

  const judgeResult = record?.judgeResult || {};
  return ok({
    submissionId: record.submissionId || "",
    summary: {
      totalCount: Number(judgeResult.totalCount || record?.paperSnapshot?.totalCount || 0),
      answeredCount: Number(judgeResult.answeredCount || 0),
      correctCount: Number(judgeResult.correctCount || 0),
      score: Number(judgeResult.score || 0),
      submittedAt: Number(record.createTime || 0),
    },
    paperSnapshot: cloneJson(record.paperSnapshot || { totalCount: 0, questions: [] }),
    answers: cloneJson(record.answers || []),
    judgeResult: {
      totalCount: Number(judgeResult.totalCount || 0),
      answeredCount: Number(judgeResult.answeredCount || 0),
      correctCount: Number(judgeResult.correctCount || 0),
      score: Number(judgeResult.score || 0),
      questionResults: (judgeResult.questionResults || []).map((item) => ({
        questionId: normalizeString(item?.questionId),
        isCorrect: !!item?.isCorrect,
        versionChanged: !!item?.versionChanged,
        questionMissing: !!item?.questionMissing,
      })),
    },
    questionRefs: buildPracticeQuestionRefs(record?.paperSnapshot?.questions || []),
  });
};

const getPracticeSubmissionQuestionDetail = async (event) => {
  const user = await ensureUserRecord(event);
  const collections = getCollections(event);
  const submissionId = normalizeString(event?.data?.submissionId || event?.submissionId);
  const questionId = normalizeString(event?.data?.questionId || event?.questionId);
  if (!submissionId) {
    return fail("submissionId 不能为空");
  }
  if (!questionId) {
    return fail("questionId 不能为空");
  }

  const record = await getPracticeSubmissionById(
    submissionId,
    user.openid,
    collections.practiceSubmissions,
  );
  if (!record) {
    return fail("做题记录不存在");
  }

  const question = Array.isArray(record?.questionSnapshots)
    ? record.questionSnapshots.find((item) => normalizeString(item?.questionId) === questionId)
    : null;
  if (!question) {
    return fail("题目快照不存在");
  }

  return ok(cloneJson(question));
};

const buildSingleQuestionDocument = async (payload, user, existingQuestion = null) => {
  const mergedPayload = existingQuestion
      ? {
        questionId: existingQuestion.questionId,
        questionLabel: payload.questionLabel ?? existingQuestion.questionLabel,
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
  const user = await requireAdmin(event);
  const collections = getCollections(event);
  const payload = getEventPayload(event);
  const draftToken = normalizeString(payload?.draftToken);
  if (!draftToken) {
    return fail("draftToken 不能为空");
  }
  const draftRecord = await getDraftByToken(
    draftToken,
    user.openid,
    collections.questionDrafts,
  );
  ensureDraftActive(draftRecord, ENTRY_MODE_SINGLE);

  const validated = normalizeSingleQuestionPayload({
    ...payload,
    questionId: draftRecord.questionId,
  }, { requireQuestionId: true });
  const storageRoot = resolveStorageRoot(event, validated);
  if (storageRoot !== normalizeStorageRoot(draftRecord.storageRoot)) {
    return fail("storageRoot 与创建会话不一致");
  }

  const allFileIds = collectFileIdsFromValidatedSingle(validated);
  assertNoTempResourceFileIds(allFileIds);
  assertFileIdsWithinDraftScope(allFileIds, draftRecord);
  const now = Date.now();
  let createdQuestionDocId = "";

  try {
    await updateDraftRecord(draftRecord, collections.questionDrafts, {
      uploadedFileIds: allFileIds,
      status: QUESTION_DRAFT_STATUS_SAVING,
      expiresAt: getDraftExpireAt(),
    });

    const addResult = await db.collection(collections.questions).add({
      data: {
        questionId: validated.questionId,
        questionLabel: validated.questionLabel,
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
    createdQuestionDocId = addResult?._id || "";

    const persisted = await getQuestionById(validated.questionId, collections.questions);
    const persistedFileIds = collectFileIdsFromValidatedSingle(persisted || {});
    if (!persisted || persisted.questionId !== validated.questionId) {
      throw new Error("题目保存校验失败");
    }
    if (JSON.stringify([...persistedFileIds].sort()) !== JSON.stringify([...allFileIds].sort())) {
      throw new Error("题目图片保存校验失败");
    }

    await updateDraftRecord(draftRecord, collections.questionDrafts, {
      uploadedFileIds: allFileIds,
      status: QUESTION_DRAFT_STATUS_COMMITTED,
      expiresAt: getDraftExpireAt(),
    });

    return ok({ questionId: validated.questionId, draftToken });
  } catch (error) {
    if (createdQuestionDocId) {
      try {
        await db.collection(collections.questions).doc(createdQuestionDocId).remove();
      } catch (removeError) {
        // Best effort rollback.
      }
    }
    await safeDeleteCloudFiles(allFileIds);
    await updateDraftRecord(draftRecord, collections.questionDrafts, {
      uploadedFileIds: [],
      status: QUESTION_DRAFT_STATUS_FAILED,
      expiresAt: getDraftExpireAt(),
    }).catch(() => {});
    return fail(error);
  }
};

const updateQuestion = async () =>
  fail("题目不支持直接编辑，请删除后重新创建");

const createQuestionGroup = async (event) => {
  const user = await requireAdmin(event);
  const collections = getCollections(event);
  const payload = getEventPayload(event);
  const draftToken = normalizeString(payload?.draftToken);
  if (!draftToken) {
    return fail("draftToken 不能为空");
  }
  const draftRecord = await getDraftByToken(
    draftToken,
    user.openid,
    collections.questionDrafts,
  );
  ensureDraftActive(draftRecord, ENTRY_MODE_GROUPED);
  const sharedStem = normalizeRichStem(payload?.sharedStem, "sharedStem");
  const children = normalizeGroupedChildren(payload?.children, sharedStem);
  const storageRoot = resolveStorageRoot(
    event,
    {
      sharedStem,
      children,
    },
    { grouped: true },
  );
  if (storageRoot !== normalizeStorageRoot(draftRecord.storageRoot)) {
    return fail("storageRoot 与创建会话不一致");
  }
  const draftQuestionIds = new Set(
    Array.isArray(draftRecord.questionIds)
      ? draftRecord.questionIds.map((item) => normalizeString(item)).filter(Boolean)
      : []
  );
  const childrenWithIds = children.map((child) => ({
    ...child,
    questionId: normalizeString(child.questionId),
  }));
  if (!childrenWithIds.length) {
    return fail("题组至少需要一个子题");
  }
  const usedQuestionIds = new Set();
  for (const child of childrenWithIds) {
    if (!child.questionId) {
      return fail("题组子题缺少预分配 questionId");
    }
    if (!draftQuestionIds.has(child.questionId)) {
      return fail("题组子题不属于当前创建会话");
    }
    if (usedQuestionIds.has(child.questionId)) {
      return fail("题组子题 questionId 重复");
    }
    usedQuestionIds.add(child.questionId);
  }
  const allFileIds = collectFileIdsFromValidatedGroup(sharedStem, childrenWithIds);
  assertNoTempResourceFileIds(allFileIds);
  assertFileIdsWithinDraftScope(allFileIds, draftRecord);
  const now = Date.now();
  const createdQuestionDocIds = [];

  try {
    await updateDraftRecord(draftRecord, collections.questionDrafts, {
      uploadedFileIds: allFileIds,
      status: QUESTION_DRAFT_STATUS_SAVING,
      expiresAt: getDraftExpireAt(),
    });

    for (const child of childrenWithIds) {
      const addResult = await db.collection(collections.questions).add({
        data: {
          questionId: child.questionId,
          questionLabel: child.questionLabel,
          groupId: draftRecord.groupId,
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
      createdQuestionDocIds.push(addResult?._id || "");
    }

    const persisted = await getQuestionsByGroupId(draftRecord.groupId, collections.questions);
    if (persisted.length !== childrenWithIds.length) {
      throw new Error("题组保存校验失败");
    }
    const persistedFileIds = collectFileIdsFromValidatedGroup(
      sharedStem,
      persisted,
    );
    if (JSON.stringify([...persistedFileIds].sort()) !== JSON.stringify([...allFileIds].sort())) {
      throw new Error("题组图片保存校验失败");
    }

    await updateDraftRecord(draftRecord, collections.questionDrafts, {
      uploadedFileIds: allFileIds,
      status: QUESTION_DRAFT_STATUS_COMMITTED,
      expiresAt: getDraftExpireAt(),
    });

    return ok({ groupId: draftRecord.groupId, draftToken });
  } catch (error) {
    for (const docId of createdQuestionDocIds) {
      if (!docId) {
        continue;
      }
      try {
        await db.collection(collections.questions).doc(docId).remove();
      } catch (removeError) {
        // Best effort rollback.
      }
    }
    await safeDeleteCloudFiles(allFileIds);
    await updateDraftRecord(draftRecord, collections.questionDrafts, {
      uploadedFileIds: [],
      status: QUESTION_DRAFT_STATUS_FAILED,
      expiresAt: getDraftExpireAt(),
    }).catch(() => {});
    return fail(error);
  }
};

const updateQuestionGroup = async () =>
  fail("题组不支持直接编辑，请删除整组后重新上传");

const deleteQuestion = async (event) => {
  await requireAdmin(event);
  const collections = getCollections(event);
  const questionId = normalizeString(event?.data?.questionId || event?.questionId);
  if (!questionId) {
    return fail("questionId 不能为空");
  }
  const existingQuestion = await getQuestionById(questionId, collections.questions);
  if (!existingQuestion) {
    return fail("题目不存在");
  }
  if ((existingQuestion.entryMode || ENTRY_MODE_SINGLE) !== ENTRY_MODE_SINGLE) {
    return fail("组内题目不支持单独删除，请删除整组");
  }

  const resourceFileIds = extractQuestionResourceFileIds(existingQuestion);
  try {
    await deleteCloudFiles(resourceFileIds);
    await db.collection(collections.questions).doc(existingQuestion._id).remove();
    return ok({ questionId });
  } catch (error) {
    return fail(error);
  }
};

const deleteQuestionGroup = async (event) => {
  await requireAdmin(event);
  const collections = getCollections(event);
  const groupId = normalizeString(event?.data?.groupId || event?.groupId);
  if (!groupId) {
    return fail("groupId 不能为空");
  }

  const existingQuestions = await getQuestionsByGroupId(groupId, collections.questions);
  if (!existingQuestions.length) {
    return fail("题组不存在");
  }

  const resourceFileIds = extractGroupResourceFileIds(existingQuestions);
  try {
    await deleteCloudFiles(resourceFileIds);
    for (const question of existingQuestions) {
      await db.collection(collections.questions).doc(question._id).remove();
    }
    return ok({ groupId });
  } catch (error) {
    return fail(error);
  }
};

const dispatch = async (event) => {
  switch (event.type) {
    case "listQuestions":
      return listQuestions(event);
    case "listQuestionSummaries":
      return listQuestionSummaries(event);
    case "getQuestionDetail":
      return getQuestionDetail(event);
    case "getQuestionGroupDetail":
      return getQuestionGroupDetail(event);
    case "getPracticePaper":
      return getPracticePaper(event);
    case "getPracticeQuestionDetail":
      return getPracticeQuestionDetail(event);
    case "submitPracticePaper":
      return submitPracticePaper(event);
    case "listPracticeSubmissions":
      return listPracticeSubmissions(event);
    case "getPracticeSubmissionDetail":
      return getPracticeSubmissionDetail(event);
    case "getPracticeSubmissionQuestionDetail":
      return getPracticeSubmissionQuestionDetail(event);
    case "prepareCreateQuestionDraft":
      return prepareCreateQuestionDraft(event);
    case "prepareCreateQuestionGroupDraft":
      return prepareCreateQuestionGroupDraft(event);
    case "appendDraftGroupQuestionIds":
      return appendDraftGroupQuestionIds(event);
    case "cleanupDraftResources":
      return cleanupDraftResources(event);
    case "abandonDraft":
      return abandonDraft(event);
    case "createQuestion":
      return createQuestion(event);
    case "updateQuestion":
      return updateQuestion(event);
    case "createQuestionGroup":
      return createQuestionGroup(event);
    case "updateQuestionGroup":
      return updateQuestionGroup(event);
    case "deleteQuestionGroup":
      return deleteQuestionGroup(event);
    case "deleteQuestion":
      return deleteQuestion(event);
    default:
      return fail(`不支持的操作类型：${event.type || "undefined"}`);
  }
};

module.exports = {
  dispatch,
};
