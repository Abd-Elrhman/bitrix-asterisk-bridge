const axios = require("axios");
const env = require("../config/env");

async function bitrixCall(method, params) {
  if (!env.BITRIX_WEBHOOK_BASE) throw new Error("BITRIX_WEBHOOK_BASE is not set");
  const url = `${env.BITRIX_WEBHOOK_BASE}/${method}.json`;
  const res = await axios.post(url, params, { timeout: 15000 });
  return res.data;
}

async function callRestWithAccessToken(method, accessToken, paramsObj = {}) {
  const url = `${env.BITRIX_PORTAL}/rest/${method}.json`;
  const res = await axios.post(url, { ...paramsObj, auth: accessToken }, { timeout: 15000 });
  return res.data;
}

async function oauthTokenExchange(code) {
  const url = `${env.BITRIX_PORTAL}/oauth/token/`;
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: env.BITRIX_CLIENT_ID,
    client_secret: env.BITRIX_CLIENT_SECRET,
    code
  });

  const res = await axios.post(url, params, { timeout: 15000 });
  return res.data;
}

module.exports = { bitrixCall, callRestWithAccessToken, oauthTokenExchange };
