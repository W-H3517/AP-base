const USERS_COLLECTION = "users";
const QUESTIONS_COLLECTION = "questions";
const PRACTICE_SUBMISSIONS_COLLECTION = "practice_submissions";

const normalizeRuntimeDataVersion = (value) =>
  String(value || "").trim().toLowerCase() === "develop" ? "develop" : "trial";

const resolveCollectionNames = (runtimeDataVersion) => {
  const suffix = normalizeRuntimeDataVersion(runtimeDataVersion) === "develop" ? "_dev" : "_trial";
  return {
    users: `${USERS_COLLECTION}${suffix}`,
    questions: `${QUESTIONS_COLLECTION}${suffix}`,
    practiceSubmissions: `${PRACTICE_SUBMISSIONS_COLLECTION}${suffix}`,
  };
};

module.exports = {
  USERS_COLLECTION,
  QUESTIONS_COLLECTION,
  PRACTICE_SUBMISSIONS_COLLECTION,
  normalizeRuntimeDataVersion,
  resolveCollectionNames,
};
