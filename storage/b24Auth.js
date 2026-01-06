const fs = require("fs");
const path = require("path");

const B24_AUTH_FILE = path.join(__dirname, "bitrix_auth.json");

function saveB24Auth(data) {
  fs.writeFileSync(B24_AUTH_FILE, JSON.stringify(data, null, 2));
}

function loadB24Auth() {
  try {
    return JSON.parse(fs.readFileSync(B24_AUTH_FILE, "utf8"));
  } catch {
    return null;
  }
}

module.exports = { saveB24Auth, loadB24Auth };

