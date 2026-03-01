import path from "node:path";

function num(name, def) {
  const raw = process.env[name];
  const v = raw === undefined || raw === "" ? NaN : Number(raw);
  if (!Number.isFinite(v)) return def;
  return v;
}

export const cfg = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",

  MAX_UPLOAD_MB: Math.max(1, Math.min(200, Math.floor(num("MAX_UPLOAD_MB", 50)))),
  COOLDOWN_SEC: Math.max(0, Math.min(3600, Math.floor(num("COOLDOWN_SEC", 20)))),
  CONCURRENCY: Math.max(1, Math.min(8, Math.floor(num("CONCURRENCY", 2)))),

  PORT: Math.max(1, Math.min(65535, Math.floor(num("PORT", 3000)))),

  TMP_ROOT: process.env.TMP_ROOT || "./tmp",

  JOB_TIMEOUT_MS: Math.max(30_000, Math.min(30 * 60_000, Math.floor(num("JOB_TIMEOUT_MS", 12 * 60_000)))),

  // convenience
  TMP_ROOT_ABS: path.resolve(process.env.TMP_ROOT || "./tmp"),
};
