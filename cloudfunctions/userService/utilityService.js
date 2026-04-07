const cloud = require("wx-server-sdk");
const { ok, fail } = require("./utils");
const { ensureCollections } = require("./userService");

const initCollections = async () => {
  await ensureCollections();
  return ok({
    usersCreated: false,
    questionsCreated: false,
    notes: [
      "Ensure a unique index on users.openid in the cloud database console.",
      "Ensure a unique index on questions.questionId in the cloud database console.",
    ],
  });
};

const getMiniProgramCode = async () => {
  try {
    const resp = await cloud.openapi.wxacode.get({
      path: "pages/index/index",
    });
    const upload = await cloud.uploadFile({
      cloudPath: "code.png",
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
