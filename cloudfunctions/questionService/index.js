const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const { fail } = require("./utils");
const { dispatch } = require("./questionService");

exports.main = async (event) => {
  try {
    return await dispatch(event || {});
  } catch (error) {
    return fail(error);
  }
};
