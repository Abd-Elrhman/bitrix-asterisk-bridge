const AmiClient = require("asterisk-ami-client");
const env = require("../config/env");

const ami = new AmiClient({ reconnect: true, keepAlive: true });

async function connectAmi() {
  await ami.connect(env.AMI_USER, env.AMI_PASS, {
    host: env.AMI_HOST,
    port: env.AMI_PORT,
  });
  console.log("AMI connected");
}

async function originate({ channel, app, data, callerId, timeoutMs = 30000 }) {
  const action = {
    Action: "Originate",
    Channel: channel,
    Application: app,
    Data: data,
    CallerID: callerId,
    Timeout: timeoutMs,
    Async: true,
  };

  const r = await ami.action(action);

  // Return only safe fields
  return {
    Response: r?.Response,
    Message: r?.Message,
    ActionID: r?.ActionID,
  };
}

module.exports = { ami, connectAmi, originate };

