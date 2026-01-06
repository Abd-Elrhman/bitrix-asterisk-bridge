const path = require("path");
const root = path.join(__dirname, "..");

module.exports = {
  root,
  users: path.join(root, "users.json"),
  storage: path.join(root, "storage"),
  bitrixAuth: path.join(root, "storage", "bitrix_auth.json"),
};

