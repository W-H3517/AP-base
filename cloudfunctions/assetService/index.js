const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const { fail } = require("./utils");
const {
  getAssistantQrConfig,
  deleteAssistantQr,
  saveAssistantQrConfig,
} = require("./assetService");

const dispatch = async (event) => {
  switch (event.type) {
    case "getAssistantQrConfig":
      return getAssistantQrConfig(event);
    case "deleteAssistantQr":
      return deleteAssistantQr(event);
    case "saveAssistantQrConfig":
      return saveAssistantQrConfig(event);
    default:
      return fail(`不支持的操作类型：${event.type || "undefined"}`);
  }
};

exports.main = async (event) => {
  try {
    return await dispatch(event || {});
  } catch (error) {
    return fail(error);
  }
};
