const express = require("express");
const fs = require("fs");
const path = require("path");

const env = require("../config/env");
const { ami } = require("../services/ami");
const { bitrixCall, callRestWithAccessToken, oauthTokenExchange } = require("../services/bitrixWebhook");
const { normalizeEgyptNumber } = require("../services/phone");
const { saveB24Auth, loadB24Auth } = require("../storage/b24Auth");

const router = express.Router();

// load mapping once
const userMap = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "users.json"), "utf8"));

function agentChannelForExt(ext) {
  if (ext === "202") return "SIP/202";
  return `PJSIP/${ext}`;
}

// Bitrix REST helper using OAuth
async function b24(method, params = {}) {
  const auth = loadB24Auth();
  if (!auth || !auth.access_token || !auth.domain) {
    throw new Error("No Bitrix auth stored yet");
  }

  // Use the domain from auth, fall back to BITRIX_PORTAL if needed
  const domain = auth.domain.includes(".") ? auth.domain : `${auth.domain}`; 
  const url = `https://${domain}/rest/${method}.json`;
  const { default: axios } = require("axios");
  const res = await axios.post(url, { ...params, auth: auth.access_token }, { timeout: 15000 });
  return res.data;
}

// Finish tracking (optional)
const active = new Map();
ami.on("event", async (evt) => {
  if (evt.Event === "Hangup" && evt.Uniqueid && active.has(evt.Uniqueid)) {
    const info = active.get(evt.Uniqueid);
    active.delete(evt.Uniqueid);

    if (env.BITRIX_WEBHOOK_BASE && info.bitrixCallId) {
      try {
        await bitrixCall("telephony.externalcall.finish", {
          CALL_ID: info.bitrixCallId,
          STATUS_CODE: "200",
          DURATION: Number(evt.Duration || 0),
          COST: 0,
        });
        console.log("Bitrix finished call:", info.bitrixCallId);
      } catch (e) {
        console.error("Bitrix finish error:", e.message);
      }
    }
  }
});

// POST /bitrix/outbound
router.post("/outbound", async (req, res) => {
  const phone = req.body.phone;
  const userId = String(req.body.user_id || "");

  const extension = userMap[userId];
  if (!extension) return res.status(404).json({ ok: false, error: `No extension mapped for user ${userId}` });
  if (!phone) return res.status(400).json({ ok: false, error: "Missing phone" });

  const action = {
    Action: "Originate",
    Channel: `PJSIP/${extension}`,
    Application: "Dial",
    Data: `Dongle/dongle0/${phone}`,
    CallerID: `${extension} <${extension}>`,
    Timeout: 30000,
    Async: true,
  };

  try {
    const r = await ami.action(action);

    const safe = {
      Response: r?.Response,
      Message: r?.Message,
      ActionID: r?.ActionID,
    };

    console.log("AMI ORIGINATE OK:", safe);
    return res.json({ ok: true, ami: safe });
  } catch (e) {
    console.error("AMI ORIGINATE ERROR:", e?.message || e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// POST /bitrix/onExternalCallStart
router.post("/onExternalCallStart", async (req, res) => {
  try {
    const token = req.header("X-B24-Bridge-Token");
    if (token !== env.BRIDGE_TOKEN) return res.status(401).json({ ok: false, error: "unauthorized" });

    const bitrixUserId =
      req.body?.data?.USER_ID ||
      req.body?.USER_ID ||
      req.body?.user_id ||
      req.body?.data?.userId;

    const rawPhone =
      req.body?.data?.PHONE_NUMBER ||
      req.body?.PHONE_NUMBER ||
      req.body?.phone ||
      req.body?.data?.phone;

    if (!bitrixUserId || !rawPhone) {
      return res.status(400).json({ ok: false, error: "missing USER_ID or PHONE_NUMBER" });
    }

    const ext = userMap[String(bitrixUserId)];
    if (!ext) return res.status(400).json({ ok: false, error: `no extension mapped for Bitrix user ${bitrixUserId}` });

    const phone = normalizeEgyptNumber(rawPhone);

    // Register/show in Bitrix (optional)
    let bitrixCallId = null;
    if (env.BITRIX_WEBHOOK_BASE) {
      const reg = await bitrixCall("telephony.externalcall.register", {
        USER_ID: Number(bitrixUserId),
        PHONE_NUMBER: phone,
        TYPE: 2,
        CRM_CREATE: 1,
      });
      bitrixCallId = reg?.result?.CALL_ID || null;
      if (bitrixCallId) await bitrixCall("telephony.externalcall.show", { CALL_ID: bitrixCallId });
    }

    const channel = agentChannelForExt(ext);
    const localDial = `Local/${phone}@from-internal/n`;

    const action = {
      Action: "Originate",
      Channel: channel,
      Application: "Dial",
      Data: localDial,
      CallerID: phone,
      Timeout: 30000,
      Async: true,
    };

    const r = await ami.action(action);
    console.log("Originate OK:", channel, "->", localDial, r?.Response);

    return res.json({ ok: true, ext, phone, bitrixCallId });
  } catch (e) {
    console.error("Handler error:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Installation and Handler routes
router.post("/save-auth", (req, res) => {
  saveB24Auth(req.body);
  res.json({ ok: true });
});

router.get("/bind", async (req, res) => {
  try {
    const result = await b24("event.bind", {
      event: "OnExternalCallStart",
      handler: "https://zfcall.ngrok.app/bitrix/onExternalCallStart"
    });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.all("/ping", (req, res) => {
  res.json({ ok: true });
});

router.all("/install", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Issabel Click-to-Call Install</title>
</head>
<body>
  <h3>Installing…</h3>
  <pre id="log">Starting…</pre>
  <script src="//api.bitrix24.com/api/v1/"></script>
  <script>
    const log = (m) => document.getElementById('log').textContent += "\\n" + m;
    BX24.init(async function () {
      try {
        log("BX24 initialized");
        const auth = BX24.getAuth();
        log("Got auth for domain: " + auth.domain);
        const resp = await fetch("/bitrix/save-auth", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify(auth)
        });
        if (!resp.ok) throw new Error("save-auth failed: " + resp.status);
        log("Auth saved on server");
        BX24.installFinish();
        log("Install finished ✅");
      } catch (e) {
        log("ERROR: " + e.message);
      }
    });
  </script>
</body>
</html>
  `);
});

router.all("/handler", async (req, res) => {
  try {
    if (req.body && req.body.AUTH_ID && req.query && req.query.DOMAIN) {
      saveB24Auth({
        access_token: req.body.AUTH_ID,
        refresh_token: req.body.REFRESH_ID,
        domain: req.query.DOMAIN,
        server_endpoint: req.body.SERVER_ENDPOINT,
        member_id: req.body.member_id,
        expires_at: Date.now() + (Number(req.body.AUTH_EXPIRES || 3600) * 1000)
      });
    }

    const code = (req.query && req.query.code) || (req.body && req.body.code);
    if (code) {
      const tokens = await oauthTokenExchange(code);
      saveB24Auth(tokens);
      const bind = await callRestWithAccessToken("event.bind", tokens.access_token, {
        event: "OnExternalCallStart",
        handler: "https://zfcall.ngrok.app/bitrix/onExternalCallStart"
      });
      return res.status(200).send("Installed + event bound ✅");
    }
    return res.status(200).send("Handler OK (no code received)");
  } catch (e) {
    return res.status(500).send("Handler error");
  }
});

router.all("/widget/call", (req, res) => {
  let placementOptions = req.body?.PLACEMENT_OPTIONS || "{}";
  if (typeof placementOptions === "string") {
    try { placementOptions = JSON.parse(placementOptions); } catch { placementOptions = {}; }
  }
  const contactId = placementOptions.ID || "";

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Call via PBX</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 12px; }
    .muted { color:#666; font-size:12px; margin-top:6px; }
    select, button { width:100%; padding:10px; margin-top:10px; font-size:14px; }
    button { cursor:pointer; }
    .ok { color: #0a7; }
    .err { color: #c00; }
  </style>
</head>
<body>
  <b>Call via PBX</b>
  <div id="status" class="muted">Loading…</div>
  <select id="phones" style="display:none;"></select>
  <button id="callBtn" disabled>Call</button>
  <script src="https://api.bitrix24.com/api/v1/"></script>
  <script>
    const CONTACT_ID = ${JSON.stringify(contactId)};
    const statusEl = document.getElementById("status");
    const phonesEl = document.getElementById("phones");
    const callBtn = document.getElementById("callBtn");
    function setStatus(msg, cls="muted") { statusEl.className = cls; statusEl.textContent = msg; }
    BX24.init(() => {
      if (!CONTACT_ID) { setStatus("Missing Contact ID", "err"); return; }
      setStatus("Loading contact phone…");
      BX24.callMethod("crm.contact.get", { id: CONTACT_ID }, (r) => {
        if (r.error()) { setStatus("Bitrix error: " + r.error().ex, "err"); return; }
        const contact = r.data();
        const phones = (Array.isArray(contact.PHONE) ? contact.PHONE : []).map(p => p.VALUE).filter(Boolean);
        if (!phones.length) { setStatus("No phone number found.", "err"); return; }
        phonesEl.innerHTML = phones.map(p => \`<option value="\${p}">\${p}</option>\`).join("");
        phonesEl.style.display = phones.length > 1 ? "block" : "none";
        callBtn.disabled = false;
        setStatus("Ready. Click Call.", "ok");
        BX24.callMethod("user.current", {}, (u) => {
          const user = u.data();
          callBtn.onclick = async () => {
            callBtn.disabled = true;
            const phone = phonesEl.value;
            setStatus("Sending call request…");
            try {
              const resp = await fetch("/bitrix/outbound", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phone, user_id: String(user.ID) })
              });
              const data = await resp.json().catch(()=>({}));
              if (!data.ok) { setStatus("Failed: " + (data.error || "Unknown"), "err"); callBtn.disabled = false; return; }
              setStatus("Call started ✅", "ok");
              setTimeout(() => { callBtn.disabled = false; }, 4000);
            } catch (e) { setStatus("Network error: " + e.message, "err"); callBtn.disabled = false; }
          };
        });
      });
    });
  </script>
</body>
</html>`);
});

module.exports = router;
