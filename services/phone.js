function normalizeEgyptNumber(raw) {
  if (!raw) return "";
  let n = String(raw).trim().replace(/[^\d+]/g, "");

  if (n.startsWith("00")) n = "+" + n.slice(2);
  if (/^20\d+/.test(n)) n = "+" + n;
  if (/^0\d+/.test(n)) n = "+20" + n.slice(1);

  return n;
}

module.exports = { normalizeEgyptNumber };

