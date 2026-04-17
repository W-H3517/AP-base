const cloud = require("wx-server-sdk");
const { db } = require("./db");
const { ok, fail, normalizeString } = require("./utils");
const { ASSET_KEY_ASSISTANT_QR } = require("./constants");
const { ensureUserRecord, requireAdmin, getCollections, getRuntimeDataVersion } = require("./userAccess");

const buildAssistantQrCloudPath = (runtimeDataVersion) =>
  `${getRuntimeDataVersion({ runtimeDataVersion })}/marketing/assistant-qrcode`;

const buildAssistantQrResponse = (record, runtimeDataVersion) => {
  const source = record || {};
  const fileID = normalizeString(source.fileID);
  const cloudPath = normalizeString(source.cloudPath) || buildAssistantQrCloudPath(runtimeDataVersion);
  return {
    assetKey: ASSET_KEY_ASSISTANT_QR,
    fileID,
    cloudPath,
    hasConfigured: !!fileID,
    updatedAt: Number(source.updateTime || 0),
    updatedBy: normalizeString(source.updatedBy),
  };
};

const getAssistantQrRecord = async (event) => {
  const collections = getCollections(event);
  const resp = await db
    .collection(collections.assetConfigs)
    .where({ assetKey: ASSET_KEY_ASSISTANT_QR })
    .limit(1)
    .get();
  return resp.data?.[0] || null;
};

const saveAssistantQrRecord = async (event, data, existingRecord) => {
  const collections = getCollections(event);
  if (existingRecord && existingRecord._id) {
    await db.collection(collections.assetConfigs).doc(existingRecord._id).update({
      data: {
        ...data,
      },
    });
    return {
      ...existingRecord,
      ...data,
    };
  }
  const addResult = await db.collection(collections.assetConfigs).add({
    data: {
      assetKey: ASSET_KEY_ASSISTANT_QR,
      ...data,
    },
  });
  return {
    _id: addResult?._id || "",
    assetKey: ASSET_KEY_ASSISTANT_QR,
    ...data,
  };
};

const getAssistantQrConfig = async (event) => {
  await ensureUserRecord(event);
  const record = await getAssistantQrRecord(event);
  return ok(buildAssistantQrResponse(record, getRuntimeDataVersion(event)));
};

const deleteAssistantQr = async (event) => {
  const user = await requireAdmin(event);
  const record = await getAssistantQrRecord(event);
  const fileID = normalizeString(record?.fileID);

  if (fileID) {
    try {
      await cloud.deleteFile({
        fileList: [fileID],
      });
    } catch (error) {
      const errMsg = normalizeString(error?.message || String(error)).toLowerCase();
      if (!errMsg.includes("file not exist") && !errMsg.includes("not exist")) {
        throw error;
      }
    }
  }

  const nextRecord = await saveAssistantQrRecord(
    event,
    {
      fileID: "",
      cloudPath: buildAssistantQrCloudPath(getRuntimeDataVersion(event)),
      updateTime: Date.now(),
      updatedBy: user.openid,
    },
    record
  );

  return ok(buildAssistantQrResponse(nextRecord, getRuntimeDataVersion(event)));
};

const saveAssistantQrConfig = async (event) => {
  const user = await requireAdmin(event);
  const fileID = normalizeString(event?.data?.fileID || event?.fileID);
  if (!fileID || !fileID.startsWith("cloud://")) {
    return fail("fileID 不能为空且必须是云文件");
  }

  const record = await getAssistantQrRecord(event);
  const currentFileID = normalizeString(record?.fileID);
  if (currentFileID && currentFileID !== fileID) {
    return fail("请先删除旧二维码，再保存新二维码");
  }

  const nextRecord = await saveAssistantQrRecord(
    event,
    {
      fileID,
      cloudPath: buildAssistantQrCloudPath(getRuntimeDataVersion(event)),
      updateTime: Date.now(),
      updatedBy: user.openid,
    },
    record
  );

  return ok(buildAssistantQrResponse(nextRecord, getRuntimeDataVersion(event)));
};

module.exports = {
  getAssistantQrConfig,
  deleteAssistantQr,
  saveAssistantQrConfig,
};
