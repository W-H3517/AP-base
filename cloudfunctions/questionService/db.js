const cloud = require("wx-server-sdk");

const db = cloud.database();
const _ = db.command;

module.exports = {
  db,
  _,
};
