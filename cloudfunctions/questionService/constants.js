const USERS_COLLECTION = "users";
const QUESTIONS_COLLECTION = "questions";
const PRACTICE_SUBMISSIONS_COLLECTION = "practice_submissions";
const QUESTION_DRAFTS_COLLECTION = "question_drafts";
const QUESTION_TYPE_CHOICE = "choice";
const CONTENT_SOURCE_TEXT = "text";
const CONTENT_SOURCE_IMAGE = "image";
const ENTRY_MODE_SINGLE = "single";
const ENTRY_MODE_GROUPED = "grouped";
const OPTION_MODE_PER_OPTION = "per_option";
const OPTION_MODE_GROUPED_ASSET = "grouped_asset";
//在这里修改试卷配额
const PRACTICE_PAPER_QUESTION_COUNT = 5;

const normalizeRuntimeDataVersion = (value) =>
  String(value || "").trim().toLowerCase() === "develop" ? "develop" : "trial";

const resolveCollectionNames = (runtimeDataVersion) => {
  const suffix = normalizeRuntimeDataVersion(runtimeDataVersion) === "develop" ? "_dev" : "_trial";
  return {
    users: `${USERS_COLLECTION}${suffix}`,
    questions: `${QUESTIONS_COLLECTION}${suffix}`,
    practiceSubmissions: `${PRACTICE_SUBMISSIONS_COLLECTION}${suffix}`,
    questionDrafts: `${QUESTION_DRAFTS_COLLECTION}${suffix}`,
  };
};

module.exports = {
  USERS_COLLECTION,
  QUESTIONS_COLLECTION,
  PRACTICE_SUBMISSIONS_COLLECTION,
  QUESTION_DRAFTS_COLLECTION,
  QUESTION_TYPE_CHOICE,
  CONTENT_SOURCE_TEXT,
  CONTENT_SOURCE_IMAGE,
  ENTRY_MODE_SINGLE,
  ENTRY_MODE_GROUPED,
  OPTION_MODE_PER_OPTION,
  OPTION_MODE_GROUPED_ASSET,
  PRACTICE_PAPER_QUESTION_COUNT,
  normalizeRuntimeDataVersion,
  resolveCollectionNames,
};
