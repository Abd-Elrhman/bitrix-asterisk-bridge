require("dotenv").config();

module.exports = {
  PORT: Number(process.env.PORT || 8080),

  AMI_HOST: process.env.AMI_HOST,
  AMI_PORT: Number(process.env.AMI_PORT || 5038),
  AMI_USER: process.env.AMI_USER,
  AMI_PASS: process.env.AMI_PASS,

  BITRIX_WEBHOOK_BASE: process.env.BITRIX_WEBHOOK_BASE,
  BRIDGE_TOKEN: process.env.BRIDGE_TOKEN,

  BITRIX_PORTAL: process.env.BITRIX_PORTAL,
  BITRIX_CLIENT_ID: process.env.BITRIX_CLIENT_ID,
  BITRIX_CLIENT_SECRET: process.env.BITRIX_CLIENT_SECRET,

  // Call recording options (optional)
  RECORDINGS_DIR: process.env.RECORDINGS_DIR || "/var/spool/asterisk/monitor",
  RECORDING_PUBLIC_BASE: process.env.RECORDING_PUBLIC_BASE || "",
};

