import "dotenv/config";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { cfg } from "./lib/env.js";
import { log } from "./lib/logger.js";
import { safeErr } from "./lib/errors.js";
import { ensureTmpRoot, cleanupStaleTmpDirs } from "./lib/fsTmp.js";
import { createBot } from "./bot.js";

process.on("unhandledRejection", (e) => {
  log.error("process unhandledRejection", { err: safeErr(e) });
  process.exit(1);
});
process.on("uncaughtException", (e) => {
  log.error("process uncaughtException", { err: safeErr(e) });
  process.exit(1);
});

function startHealthServer() {
  const port = cfg.PORT;
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          service: "telegram-downloader-bot",
          uptimeSec: Math.round(process.uptime()),
        })
      );
      return;
    }

    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
  });

  server.listen(port, () => {
    log.info("health server listening", { port });
  });
}

async function boot() {
  log.info("boot start", {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    host: os.hostname(),
    tmpRoot: path.resolve(cfg.TMP_ROOT),
    env: {
      TELEGRAM_BOT_TOKEN_set: !!cfg.TELEGRAM_BOT_TOKEN,
      MAX_UPLOAD_MB_set: !!process.env.MAX_UPLOAD_MB,
      COOLDOWN_SEC_set: !!process.env.COOLDOWN_SEC,
      CONCURRENCY_set: !!process.env.CONCURRENCY,
      PORT_set: !!process.env.PORT,
    },
  });

  if (!cfg.TELEGRAM_BOT_TOKEN) {
    console.error("TELEGRAM_BOT_TOKEN is required. Set it in your environment and redeploy.");
    process.exit(1);
  }

  await ensureTmpRoot(cfg.TMP_ROOT);
  await cleanupStaleTmpDirs(cfg.TMP_ROOT, { olderThanMs: 24 * 60 * 60 * 1000 });

  startHealthServer();

  const bot = createBot(cfg.TELEGRAM_BOT_TOKEN);

  try {
    await bot.api.deleteWebhook({ drop_pending_updates: true });
  } catch (e) {
    log.warn("deleteWebhook failed", { err: safeErr(e) });
  }

  try {
    await bot.api.setMyCommands([
      { command: "start", description: "Welcome & examples" },
      { command: "help", description: "Commands, limits, and rules" },
      { command: "dl", description: "Auto download (mp4 default, mp3 if message says audio)" },
      { command: "mp4", description: "Force MP4" },
      { command: "mp3", description: "Force MP3" }
    ]);
  } catch (e) {
    log.warn("setMyCommands failed", { err: safeErr(e) });
  }

  bot.catch((err) => {
    log.error("bot.catch", {
      err: safeErr(err?.error || err),
      updateId: err?.ctx?.update?.update_id,
    });
  });

  // Polling with backoff on 409 (deploy overlap)
  let delayMs = 2000;
  const maxDelayMs = 20000;
  while (true) {
    try {
      log.info("polling start", { runner: "built-in", note: "grammY long polling" });
      await bot.start();
      log.warn("bot.start exited (unexpected)");
    } catch (e) {
      const msg = safeErr(e);
      const is409 = String(msg || "").includes("409") || String(msg || "").toLowerCase().includes("conflict");
      log.error("polling error", { err: msg, retryInMs: delayMs, is409 });
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs = Math.min(maxDelayMs, Math.round(delayMs * 1.8));
      continue;
    }

    // If bot.start resolves, wait and retry.
    await new Promise((r) => setTimeout(r, delayMs));
    delayMs = Math.min(maxDelayMs, Math.round(delayMs * 1.8));
  }
}

boot().catch((e) => {
  log.error("boot failed", { err: safeErr(e) });
  process.exit(1);
});
