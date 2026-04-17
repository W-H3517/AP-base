const USERS_COLLECTION = "users";
const ASSET_CONFIGS_COLLECTION = "asset_configs";

const ASSET_KEY_ASSISTANT_QR = "assistant_qr";

const normalizeRuntimeDataVersion = (value) =>
  String(value || "").trim().toLowerCase() === "develop" ? "develop" : "trial";

const resolveCollectionNames = (runtimeDataVersion) => {
  const suffix = normalizeRuntimeDataVersion(runtimeDataVersion) === "develop" ? "_dev" : "_trial";
  return {
    users: `${USERS_COLLECTION}${suffix}`,
    assetConfigs: `${ASSET_CONFIGS_COLLECTION}${suffix}`,
  };
};

module.exports = {
  ASSET_KEY_ASSISTANT_QR,
  normalizeRuntimeDataVersion,
  resolveCollectionNames,
};
