const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const { fail } = require("./utils");
const { getOpenId, getCurrentUser } = require("./userService");
const { initCollections, getMiniProgramCode } = require("./utilityService");

const dispatch = async (event) => {
  switch (event.type) {
    case "getOpenId":
      return getOpenId();
    case "getCurrentUser":
      return getCurrentUser(event);
    case "initCollections":
      return initCollections(event);
    case "getMiniProgramCode":
      return getMiniProgramCode(event);
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
