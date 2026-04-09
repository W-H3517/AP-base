const cloud = require("wx-server-sdk");
const { ok, fail } = require("./utils");
const { ensureCollections, getCollections, getRuntimeDataVersion } = require("./userService");

const resolveStorageRoot = (event) => (getRuntimeDataVersion(event) === "develop" ? "develop" : "trial");

const initCollections = async (event) => {
  const collections = getCollections(event);
  await ensureCollections(event);
  return ok({
    usersCreated: false,
    questionsCreated: false,
    practiceSubmissionsCreated: false,
    notes: [
      `Ensure a unique index on ${collections.users}.openid in the cloud database console.`,
      `Ensure a unique index on ${collections.questions}.questionId in the cloud database console.`,
      `Ensure a unique index on ${collections.practiceSubmissions}.submissionId in the cloud database console.`,
      `Ensure an index on ${collections.practiceSubmissions}.openid in the cloud database console.`,
    ],
  });
};

const getMiniProgramCode = async (event) => {
  try {
    const storageRoot = resolveStorageRoot(event);
    const resp = await cloud.openapi.wxacode.get({
      path: "pages/index/index",
    });
    const upload = await cloud.uploadFile({
      cloudPath: `${storageRoot}/code.png`,
      fileContent: resp.buffer,
    });
    return ok(upload.fileID);
  } catch (error) {
    return fail(error);
  }
};

module.exports = {
  initCollections,
  getMiniProgramCode,
};
