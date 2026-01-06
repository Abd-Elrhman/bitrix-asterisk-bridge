const env = require("./config/env");
const app = require("./app");
const { connectAmi } = require("./services/ami");

(async () => {
  await connectAmi();

  app.listen(env.PORT, "0.0.0.0", () => {
    console.log(`Bridge listening on :${env.PORT}`);
  });
})();
