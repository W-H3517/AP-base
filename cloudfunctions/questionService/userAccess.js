const cloud = require("wx-server-sdk");
const { db } = require("./db");
const {
  normalizeRuntimeDataVersion,
  resolveCollectionNames,
} = require("./constants");
const { normalizeString } = require("./utils");

const ADMIN_OPENIDS = (process.env.ADMIN_OPENIDS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const ensuredCollectionPromises = new Map();

const normalizeRole = (role) => (role === "admin" ? "admin" : "user");

const getWxContext = () => cloud.getWXContext();

const getRuntimeDataVersion = (event) =>
  normalizeRuntimeDataVersion(event?.runtimeDataVersion || event?.data?.runtimeDataVersion);

const getCollections = (event) => resolveCollectionNames(getRuntimeDataVersion(event));

const ensureCollection = async (collectionName) => {
  try {
    await db.createCollection(collectionName);
  } catch (error) {
    const errMsg = normalizeString(error?.message || String(error));
    if (!errMsg.toLowerCase().includes("collection")) {
      throw error;
    }
  }
};

const ensureCollections = async (event) => {
  const collections = getCollections(event);
  const collectionNames = [
    collections.users,
    collections.questions,
    collections.practiceSubmissions,
    collections.questionDrafts,
  ];

  await Promise.all(collectionNames.map((collectionName) => {
    if (!ensuredCollectionPromises.has(collectionName)) {
      const promise = ensureCollection(collectionName).catch((error) => {
        ensuredCollectionPromises.delete(collectionName);
        throw error;
      });
      ensuredCollectionPromises.set(collectionName, promise);
    }
    return ensuredCollectionPromises.get(collectionName);
  }));
};

const getUserByOpenId = async (openid, event) => {
  if (!openid) {
    return null;
  }
  const collections = getCollections(event);

  try {
    const resp = await db
      .collection(collections.users)
      .where({ openid })
      .limit(1)
      .get();
    return resp.data?.[0] || null;
  } catch (error) {
    const errMsg = normalizeString(error?.message || String(error));
    if (errMsg.includes("collection")) {
      return null;
    }
    throw error;
  }
};

const ensureUserRecord = async (event) => {
  const wxContext = getWxContext();
  const openid = wxContext.OPENID;
  if (!openid) {
    throw new Error("无法获取当前用户身份");
  }
  const collections = getCollections(event);

  await ensureCollections(event);

  const existing = await getUserByOpenId(openid, event);
  if (existing) {
    const role = normalizeRole(existing.role);
    if (role !== existing.role) {
      await db.collection(collections.users).doc(existing._id).update({
        data: {
          role,
          updateTime: Date.now(),
        },
      });
      return {
        ...existing,
        role,
      };
    }
    return existing;
  }

  const now = Date.now();
  const role = ADMIN_OPENIDS.includes(openid) ? "admin" : "user";
  try {
    await db.collection(collections.users).add({
      data: {
        openid,
        role,
        createTime: now,
        updateTime: now,
      },
    });
  } catch (error) {
    const errMsg = normalizeString(error?.message || String(error)).toLowerCase();
    if (!errMsg.includes("duplicate")) {
      throw error;
    }
  }

  const created = await getUserByOpenId(openid, event);
  if (!created) {
    throw new Error("用户记录创建失败");
  }

  return created;
};

const requireAdmin = async (event) => {
  const user = await ensureUserRecord(event);
  if (normalizeRole(user.role) !== "admin") {
    throw new Error("仅管理员可执行此操作");
  }
  return user;
};

module.exports = {
  normalizeRole,
  getRuntimeDataVersion,
  getCollections,
  ensureUserRecord,
  requireAdmin,
};
