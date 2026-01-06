require("dotenv").config();
const fs = require("fs");
const express = require("express");
const axios = require("axios");
const AmiClient = require("asterisk-ami-client");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));


// ===== Bitrix OAuth storage =====
const B24_AUTH_FILE = __dirname + "/bitrix_auth.json";

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

// ===== Bitrix REST helper using OAuth =====
async function b24(method, params = {}) {
  const auth = loadB24Auth();
  if (!auth || !auth.access_token || !auth.domain) {
    throw new Error("No Bitrix auth stored yet");
  }

  const url = `https://${auth.domain}/rest/${method}.json`;
  const res = await axios.post(url, { ...params, auth: auth.access_token }, { timeout: 15000 });
  return res.data;
}



// Load user mapping
const userMap = JSON.parse(fs.readFileSync(__dirname + "/users.json", "utf8"));

// --- helpers ---
function normalizeEgyptNumber(raw) {
  if (!raw) return "";
  let n = String(raw).trim().replace(/[^\d+]/g, "");

  // Convert 00... to +...
  if (n.startsWith("00")) n = "+" + n.slice(2);

  // If starts with 20 (no plus) -> +20...
  if (/^20\d+/.test(n)) n = "+" + n;

  // If starts with 0 -> +20...
  if (/^0\d+/.test(n)) n = "+20" + n.slice(1);

  // If already + -> keep
  return n;
}


function parsePlacementOptions(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}




const TOKENS_FILE = __dirname + "/bitrix_oauth_tokens.json";

function saveOAuth(tokens) {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}
function loadOAuth() {
  try { return JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8")); }
  catch { return null; }
}

async function oauthTokenExchange(code) {
  const url = `${process.env.BITRIX_PORTAL}/oauth/token/`;
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: process.env.BITRIX_CLIENT_ID,
    client_secret: process.env.BITRIX_CLIENT_SECRET,
    code
  });

  const res = await axios.post(url, params, { timeout: 15000 });
  return res.data; // {access_token, refresh_token, expires_in, ...}
}

async function callestWithAccessToken(method, accessToken, paramsObj = {}) {
  const url = `${process.env.BITRIX_PORTAL}/rest/${method}.json`;
  const res = await axios.post(url, { ...paramsObj, auth: accessToken }, { timeout: 15000 });
  return res.data;
}




function agentChannelForExt(ext) {
  // Your current reality: 200/201 are PJSIP, 202 is chan_sip
  if (ext === "202") return "SIP/202";
  return `PJSIP/${ext}`;
}

async function bitrixCall(method, params) {
  const base = process.env.BITRIX_WEBHOOK_BASE;
  if (!base) throw new Error("BITRIX_WEBHOOK_BASE is not set");
  const url = `${base}/${method}.json`;
  const res = await axios.post(url, params, { timeout: 15000 });
  return res.data;
}

// --- AMI connection ---
const ami = new AmiClient({ reconnect: true, keepAlive: true });
async function connectAmi() {
  await ami.connect(
    process.env.AMI_USER,
    process.env.AMI_PASS,
    { host: process.env.AMI_HOST, port: Number(process.env.AMI_PORT || 5038) }
  );
  console.log("AMI connected");
}

// Track active calls for finishing in Bitrix (simple in-memory map)
const active = new Map(); // key: asteriskUniqueid -> { bitrixCallId, ext, phone }

ami.on("event", async (evt) => {
  // When call ends, finalize it in Bitrix (optional)
  if (evt.Event === "Hangup" && evt.Uniqueid && active.has(evt.Uniqueid)) {
    const info = active.get(evt.Uniqueid);
    active.delete(evt.Uniqueid);

    if (process.env.BITRIX_WEBHOOK_BASE && info.bitrixCallId) {
      try {
        await bitrixCall("telephony.externalcall.finish", {
          CALL_ID: info.bitrixCallId,
          STATUS_CODE: "200",      // you can improve later
          DURATION: Number(evt.Duration || 0),
          COST: 0
        });
        console.log("Bitrix finished call:", info.bitrixCallId);
      } catch (e) {
        console.error("Bitrix finish error:", e.message);
      }
    }
  }
});



// --- endpoints ---

app.post("/bitrix/save-auth", (req, res) => {
  console.log("SAVE-AUTH HIT body:", JSON.stringify(req.body, null, 2));
  saveB24Auth(req.body);
  res.json({ ok: true });
});


// ===== Bind click-to-call event (run once) =====
app.get("/bitrix/bind", async (req, res) => {
  try {
    const result = await b24("event.bind", {
      event: "OnExternalCallStart",
      handler: "https://zfcall.ngrok.app/bitrix/onExternalCallStart"
    });

    console.log("event.bind result:", JSON.stringify(result, null, 2));
    res.json({ ok: true, result });
  } catch (err) {
    console.log("event.bind error message:", err.message);
    console.log("event.bind error response:", JSON.stringify(err.response?.data, null, 2));
    res.status(500).json({ ok: false, error: err.message });
  }
});


app.all("/bitrix/ping", (req, res) => {
  console.log("PING HIT", req.method, req.url, JSON.stringify(req.headers, null, 2));
  res.json({ ok: true });
});


app.get("/health", (req, res) => res.json({ ok: true }));


/**
install link from local app in bitrix
**/
app.all("/bitrix/install", (req, res) => {
  console.log("BITRIX INSTALL HIT method:", req.method);
  console.log("INSTALL QUERY:", JSON.stringify(req.query, null, 2));
  console.log("INSTALL BODY:", JSON.stringify(req.body, null, 2));

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

        // Get auth info from Bitrix context
        const auth = BX24.getAuth();
        log("Got auth for domain: " + auth.domain);

        // Send auth to your server
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




app.all("/bitrix/handler", async (req, res) => {
  try {
    console.log("BITRIX HANDLER HIT method:", req.method);
    console.log("QUERY:", JSON.stringify(req.query, null, 2));
    console.log("BODY:", JSON.stringify(req.body, null, 2));
    console.log("HEADERS:", JSON.stringify(req.headers, null, 2));

// If Bitrix sent AUTH_ID (it did), store it as our access token
if (req.body && req.body.AUTH_ID && req.query && req.query.DOMAIN) {
  saveB24Auth({
    access_token: req.body.AUTH_ID,
    refresh_token: req.body.REFRESH_ID,
    domain: req.query.DOMAIN,
    server_endpoint: req.body.SERVER_ENDPOINT,
    member_id: req.body.member_id,
    expires_at: Date.now() + (Number(req.body.AUTH_EXPIRES || 3600) * 1000)
  });
  console.log("AUTH STORED FROM HANDLER BODY ✅");
}
		


    // Some installs send auth in query, some in body
    const code = (req.query && req.query.code) || (req.body && req.body.code);

    if (code) {
      const tokens = await oauthTokenExchange(code);
      saveB24Auth(tokens);
      console.log("OAUTH TOKENS STORED");

      // Bind click-to-call event
      const bind = await callRestWithAccessToken("event.bind", tokens.access_token, {
        event: "OnExternalCallStart",
        handler: "https://zfcall.ngrok.app/bitrix/onExternalCallStart"
      });

      console.log("event.bind result:", JSON.stringify(bind, null, 2));
      return res.status(200).send("Installed + event bound ✅");
    }

    return res.status(200).send("Handler OK (no code received)");
  } catch (e) {
    console.error("HANDLER ERROR:", e.response?.data || e.message);
    return res.status(500).send("Handler error");
  }
});





app.post("/bitrix/outbound", async (req, res) => {
  console.log("=== OUTBOUND REQUEST ===", JSON.stringify(req.body, null, 2));

  const phone = req.body.phone;
  const userId = String(req.body.user_id || "");

  // Map user 1340 to extension 201 for now
  const userMap = { "1340":"201", "5050":"201", "1674":"201" };
  const extension = userMap[userId];

  if (!extension) {
    return res.status(404).json({ ok: false, error: `No extension mapped for user ${userId}` });
  }
  if (!phone) {
    return res.status(400).json({ ok: false, error: "Missing phone" });
  }

  const action = {
    Action: "Originate",
    Channel: `PJSIP/${extension}`,
    Application: "Dial",
    Data: `Dongle/dongle0/${phone}`,
    CallerID: `${extension} <${extension}>`,
    Timeout: 30000,
    Async: true
  };

  console.log("AMI ORIGINATE ACTION:", JSON.stringify(action, null, 2));

  try {
  const r = await ami.action(action);

  const lastResponse = r?._connection?._amiDataStream?._lastAmiResponse || null;

  console.log("AMI LAST RESPONSE:", lastResponse);
  return res.json({ ok: true, ami: lastResponse });
} catch (e) {
  console.error("AMI ORIGINATE ERROR:", e?.message || e);
  return res.status(500).json({ ok: false, error: e?.message || String(e) });
}


});




app.all("/bitrix/widget/call", (req, res) => {
  const opts = parsePlacementOptions(req.body?.PLACEMENT_OPTIONS);
  const contactId = opts.ID;

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
    const CONTACT_ID = ${JSON.stringify(contactId || "")};
    const statusEl = document.getElementById("status");
    const phonesEl = document.getElementById("phones");
    const callBtn = document.getElementById("callBtn");

    function setStatus(msg, cls="muted") {
      statusEl.className = cls;
      statusEl.textContent = msg;
    }

    function extractPhones(contact) {
      const arr = Array.isArray(contact.PHONE) ? contact.PHONE : [];
      return arr.map(p => p && p.VALUE).filter(Boolean);
    }

    BX24.init(() => {
      if (!CONTACT_ID) {
        setStatus("Missing Contact ID from placement options.", "err");
        return;
      }

      setStatus("Loading contact phone…");

      BX24.callMethod("crm.contact.get", { id: CONTACT_ID }, (r) => {
        if (r.error()) {
          setStatus("Bitrix error: " + r.error().ex, "err");
          return;
        }

        const contact = r.data();
        const phones = extractPhones(contact);

        if (!phones.length) {
          setStatus("This contact has no phone number.", "err");
          return;
        }

        // Fill dropdown
        phonesEl.innerHTML = "";
        phones.forEach(p => {
          const opt = document.createElement("option");
          opt.value = p;
          opt.textContent = p;
          phonesEl.appendChild(opt);
        });

        phonesEl.style.display = phones.length > 1 ? "block" : "none";
        callBtn.disabled = false;
        setStatus("Ready. Click Call.", "ok");

        BX24.callMethod("user.current", {}, (u) => {
          const user = u.data();

          callBtn.onclick = async () => {
            callBtn.disabled = true;
            const phone = phonesEl.value || phones[0];
            setStatus("Sending call request…");

            try {
              const resp = await fetch("/bitrix/outbound", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  phone,
                  user_id: String(user.ID),
                  entity: "CONTACT",
                  entity_id: String(CONTACT_ID)
                })
              });

              const data = await resp.json().catch(()=>({}));
              if (!resp.ok || !data.ok) {
                setStatus("Failed: " + (data.error || resp.status), "err");
                callBtn.disabled = false;
                return;
              }

              setStatus("Call started ✅ Check your extension.", "ok");
              setTimeout(() => { callBtn.disabled = false; }, 4000);

            } catch (e) {
              setStatus("Network error: " + e.message, "err");
              callBtn.disabled = false;
            }
          };
        });
      });
    });
  </script>
</body>
</html>`);
});








/**
 * Bitrix click-to-call handler.
 * Bitrix event payload can vary by setup; we handle common fields and allow a fallback.
 */
app.post("/bitrix/onExternalCallStart", async (req, res) => {
  try {

   	console.log("ONEXTERNALCALLSTART HIT");
	console.log("QUERY:", JSON.stringify(req.query, null, 2));
	console.log("BODY:", JSON.stringify(req.body, null, 2));
	console.log("HEADERS:", JSON.stringify(req.headers, null, 2));
	console.log("BITRIX PAYLOAD:", JSON.stringify(req.body, null, 2));

    // Security: require your own shared secret header
    const token = req.header("X-B24-Bridge-Token");
    if (token !== process.env.BRIDGE_TOKEN) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    // Extract fields (you may adjust based on your actual Bitrix payload)
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
    if (!ext) {
      return res.status(400).json({ ok: false, error: `no extension mapped for Bitrix user ${bitrixUserId}` });
    }

    const phone = normalizeEgyptNumber(rawPhone);

    // 1) (Optional) Register in Bitrix
    let bitrixCallId = null;
    if (process.env.BITRIX_WEBHOOK_BASE) {
      const reg = await bitrixCall("telephony.externalcall.register", {
        USER_ID: Number(bitrixUserId),
        PHONE_NUMBER: phone,
        TYPE: 2, // 1=incoming, 2=outgoing
        CRM_CREATE: 1
      });
      bitrixCallId = reg?.result?.CALL_ID || null;

      // Show call card (optional but nice)
      if (bitrixCallId) {
        await bitrixCall("telephony.externalcall.show", { CALL_ID: bitrixCallId });
      }
    }

    // 2) Originate: ring agent first, then dial customer via from-internal
    const channel = agentChannelForExt(ext);
    const localDial = `Local/${phone}@from-internal/n`;

    const action = {
      Action: "Originate",
      Channel: channel,
      Application: "Dial",
      Data: localDial,
      Async: "true",
      CallerID: phone
    };

    const resp = await ami.action(action);

    // Store mapping for Hangup -> finish (best effort)
    // We don’t always get Uniqueid in originate response; later you can improve using AMI events.
    // For MVP this is OK.
    console.log("Originate sent:", channel, "->", localDial, resp?.Response);

    return res.json({ ok: true, ext, phone, bitrixCallId });
  } catch (e) {
    console.error("Handler error:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// start
(async () => {
  await connectAmi();
  app.listen(Number(process.env.PORT || 8080), "0.0.0.0", () => {
    console.log(`Bridge listening on :${process.env.PORT || 8080}`);
  });
})();

