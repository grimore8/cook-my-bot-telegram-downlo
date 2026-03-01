import { Bot, InputFile } from "grammy";

import { cfg } from "./lib/env.js";
import { log } from "./lib/logger.js";
import { safeErr, toUserMessage } from "./lib/errors.js";
import { verifyAndNormalizeUrl } from "./lib/validators.js";
import { createQueue } from "./lib/queue.js";
import { createJobDir, cleanupJobDir } from "./lib/fsTmp.js";
import { downloadMedia } from "./lib/downloader.js";
import { BOT_PROFILE } from "./lib/botProfile.js";

const queue = createQueue({
  concurrency: cfg.CONCURRENCY,
  log,
});

const cooldown = new Map(); // userId -> lastAcceptedAtMs

function nowMs() {
  return Date.now();
}

function getCooldownRemainingSec(userId) {
  const last = cooldown.get(String(userId));
  if (!last) return 0;
  const elapsedSec = (nowMs() - last) / 1000;
  const remaining = cfg.COOLDOWN_SEC - elapsedSec;
  return remaining > 0 ? Math.ceil(remaining) : 0;
}

function markCooldownAccepted(userId) {
  cooldown.set(String(userId), nowMs());
}

function parseArgUrl(ctx) {
  const txt = String(ctx.message?.text || "");
  const parts = txt.trim().split(/\s+/);
  // parts[0] is /cmd
  return parts[1] ? String(parts[1]).trim() : "";
}

async function sendResult(ctx, { filePath, fileName, mode, sizeBytes }) {
  const chatId = ctx.chat?.id;
  const caption = `${mode.toUpperCase()} (${(sizeBytes / (1024 * 1024)).toFixed(1)} MB)`;

  log.info("telegram sendDocument attempt", {
    chatId,
    userId: ctx.from?.id,
    mode,
    sizeBytes,
    fileName,
  });

  try {
    await ctx.api.sendDocument(chatId, new InputFile(filePath, fileName), {
      caption,
    });
    log.info("telegram sendDocument success", { chatId, userId: ctx.from?.id, mode });
  } catch (e) {
    log.error("telegram sendDocument failed", {
      chatId,
      userId: ctx.from?.id,
      mode,
      err: safeErr(e),
    });

    await ctx.reply(`Couldn't upload the file to Telegram. ${safeErr(e)}`.slice(0, 3500));
  }
}

function usageFor(cmd) {
  if (cmd === "mp3") return "Usage: /mp3 <url>\nExample: /mp3 https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  if (cmd === "mp4") return "Usage: /mp4 <url>\nExample: /mp4 https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  return "Usage: /dl <url>\nExample: /dl https://www.youtube.com/watch?v=dQw4w9WgXcQ";
}

function shouldAutoPreferAudio(ctx) {
  const txt = String(ctx.message?.text || "");
  return /\baudio\b/i.test(txt);
}

async function handleDownloadCommand(ctx, mode) {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (!userId || !chatId) {
    return ctx.reply("Couldn't read your user/chat info from Telegram.");
  }

  const rawUrl = parseArgUrl(ctx);
  if (!rawUrl) {
    return ctx.reply("Invalid URL. " + usageFor(mode));
  }

  let verified;
  try {
    verified = await verifyAndNormalizeUrl(rawUrl);
  } catch (e) {
    const msg = toUserMessage(e, { fallback: "Invalid URL. " + usageFor(mode) });
    return ctx.reply(msg);
  }

  // Cooldown applies only to accepted jobs
  const remaining = getCooldownRemainingSec(userId);
  if (remaining > 0) {
    return ctx.reply(`Cooldown: try again in ${remaining}s`);
  }

  // Auto mode: if message contains word audio, prefer mp3
  let effectiveMode = mode;
  if (mode === "dl" && shouldAutoPreferAudio(ctx)) effectiveMode = "mp3";
  if (mode === "dl" && effectiveMode === "dl") effectiveMode = "mp4";

  const jobId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const hostname = verified.url.hostname;

  markCooldownAccepted(userId);

  const pos = queue.enqueue(async () => {
    const t0 = Date.now();
    const jobDir = await createJobDir(cfg.TMP_ROOT, jobId);

    log.info("job start", {
      jobId,
      userId,
      chatId,
      command: mode,
      effectiveMode,
      hostname,
      queue: queue.state(),
    });

    try {
      const res = await downloadMedia({
        jobId,
        url: verified.normalized,
        hostname,
        mode: effectiveMode,
        jobDir,
        maxUploadBytes: cfg.MAX_UPLOAD_MB * 1024 * 1024,
        timeoutMs: cfg.JOB_TIMEOUT_MS,
      });

      if (res.tooBig) {
        await ctx.reply(
          `File too big (>${cfg.MAX_UPLOAD_MB} MB). Try /mp3 or a lower quality link.`
        );
        return;
      }

      await sendResult(ctx, {
        filePath: res.filePath,
        fileName: res.fileName,
        mode: effectiveMode,
        sizeBytes: res.sizeBytes,
      });

      const ms = Date.now() - t0;
      log.info("job success", { jobId, userId, chatId, effectiveMode, ms, sizeBytes: res.sizeBytes });
    } catch (e) {
      const err = safeErr(e);
      log.error("job failed", { jobId, userId, chatId, effectiveMode, err });
      await ctx.reply(toUserMessage(e, { jobId }));
    } finally {
      const ms = Date.now() - t0;
      log.info("job cleanup", { jobId, userId, chatId, ms });
      await cleanupJobDir(jobDir);
    }
  });

  // immediate response
  const state = queue.state();
  if (pos > 0) {
    await ctx.reply(`Queued: position #${pos}`);
  } else {
    await ctx.reply("Starting download…");
  }

  log.info("job accepted", { jobId, userId, chatId, command: mode, effectiveMode, hostname, queue: state });
}

export function createBot(token) {
  const bot = new Bot(token);

  bot.command("start", async (ctx) => {
    const mini = "";
    const msg =
      "Send me a URL and I’ll download it as MP4/MP3.\n\n" +
      "Examples:\n" +
      "/dl https://example.com/video\n" +
      "/dl https://example.com/video audio\n" +
      "/mp4 https://example.com/video\n" +
      "/mp3 https://example.com/video\n\n" +
      "Type /help for limits and URL safety rules.";

    await ctx.reply(msg + mini);
  });

  bot.command("help", async (ctx) => {
    const msg =
      "Commands:\n" +
      "/start\n" +
      "/help\n" +
      "/dl <url>  (auto: MP4 default, but if your message contains the word audio it prefers MP3)\n" +
      "/mp4 <url> (force MP4)\n" +
      "/mp3 <url> (force MP3)\n\n" +
      `Limits:\nMAX_UPLOAD_MB=${cfg.MAX_UPLOAD_MB}\nCOOLDOWN_SEC=${cfg.COOLDOWN_SEC}\nCONCURRENCY=${cfg.CONCURRENCY}\n\n` +
      "URL safety rules:\n" +
      "1) Only http:// or https:// URLs are accepted\n" +
      "2) No spaces or control characters\n" +
      "3) No username/password in URLs\n" +
      "4) Hostname cannot be localhost / *.localhost\n" +
      "5) DNS must resolve, and any private/local IPv4 result is blocked (127/8, 10/8, 172.16/12, 192.168/16)";

    await ctx.reply(msg);
  });

  bot.command("dl", (ctx) => handleDownloadCommand(ctx, "dl"));
  bot.command("mp4", (ctx) => handleDownloadCommand(ctx, "mp4"));
  bot.command("mp3", (ctx) => handleDownloadCommand(ctx, "mp3"));

  // keep for future AI integrations
  bot.use(async (ctx, next) => {
    ctx.state = ctx.state || {};
    ctx.state.botProfile = BOT_PROFILE;
    return next();
  });

  return bot;
}
