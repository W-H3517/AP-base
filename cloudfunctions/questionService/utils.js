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

const normalizeString = (value) =>
  typeof value === "string" ? value.trim() : "";

const normalizeUpperString = (value) => normalizeString(value).toUpperCase();

const sortQuestions = (questions) =>
  [...questions].sort((left, right) => {
    const leftTime = Number(left?.createTime || 0);
    const rightTime = Number(right?.createTime || 0);
    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    const leftOrder = Number(left?.groupOrder || 0);
    const rightOrder = Number(right?.groupOrder || 0);
    return leftOrder - rightOrder;
  });

module.exports = {
  ok,
  fail,
  normalizeString,
  normalizeUpperString,
  sortQuestions,
};
