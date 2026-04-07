const cloud = require("wx-server-sdk");
const { db } = require("./db");
const {
  USERS_COLLECTION,
  QUESTIONS_COLLECTION,
  PRACTICE_SUBMISSIONS_COLLECTION,
} = require("./constants");
const { ok, normalizeString } = require("./utils");

const ADMIN_OPENIDS = (process.env.ADMIN_OPENIDS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const normalizeRole = (role) => (role === "admin" ? "admin" : "user");

const getWxContext = () => cloud.getWXContext();

const ensureCollection = async (collectionName) => {
  try {
    await db.createCollection(collectionName);
  } catch (error) {
    const errMsg = normalizeString(error?.message || String(error)).toLowerCase();
    if (!errMsg.includes("collection")) {
      throw error;
    }
  }
};

const ensureCollections = async () => {
  await Promise.all([
    ensureCollection(USERS_COLLECTION),
    ensureCollection(QUESTIONS_COLLECTION),
    ensureCollection(PRACTICE_SUBMISSIONS_COLLECTION),
  ]);
};

const getUserByOpenId = async (openid) => {
  if (!openid) {
    return null;
  }

  try {
    const resp = await db
      .collection(USERS_COLLECTION)
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

const ensureUserRecord = async () => {
  const wxContext = getWxContext();
  const openid = wxContext.OPENID;
  if (!openid) {
    throw new Error("无法获取当前用户身份");
  }

  await ensureCollections();

  const existing = await getUserByOpenId(openid);
  if (existing) {
    const role = normalizeRole(existing.role);
    if (role !== existing.role) {
      await db.collection(USERS_COLLECTION).doc(existing._id).update({
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
    await db.collection(USERS_COLLECTION).add({
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

  const created = await getUserByOpenId(openid);
  if (!created) {
    throw new Error("用户记录创建失败");
  }

  return created;
};

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

module.exports = {
  ensureCollections,
  ensureUserRecord,
  getOpenId,
  getCurrentUser,
};
