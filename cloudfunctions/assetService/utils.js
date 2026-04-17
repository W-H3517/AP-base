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

module.exports = {
  ok,
  fail,
  normalizeString,
};
