const env = require("./config/env");
const app = require("./app");
const { connectAmi } = require("./services/ami");

(async () => {
  await connectAmi();

  app.listen(env.PORT, "0.0.0.0", () => {
    console.log(`Bridge listening on :${env.PORT}`);
    if (env.PUBLIC_BASE_URL) {
      console.log(`Public URL (webhooks): ${env.PUBLIC_BASE_URL}`);
    } else {
      console.warn("PUBLIC_BASE_URL not set — /bitrix/bind and Bitrix event handler will fail until you set it in .env");
    }
  });
})();
