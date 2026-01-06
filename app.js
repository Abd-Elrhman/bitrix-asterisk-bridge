const express = require("express");
const bitrixRoutes = require("./routes/bitrix");
const healthRoutes = require("./routes/health");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

app.use("/bitrix", bitrixRoutes);
app.use("/", healthRoutes);

module.exports = app;

