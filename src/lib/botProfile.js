import { cfg } from "./env.js";

export const BOT_PROFILE = [
  "Purpose: Download media from a verified public URL using yt-dlp and return MP4/MP3 in Telegram.",
  "Commands: /start, /help, /dl <url>, /mp4 <url>, /mp3 <url>.",
  `Rules: cooldown per user is ${cfg.COOLDOWN_SEC}s; max upload is ${cfg.MAX_UPLOAD_MB} MB; global concurrency is ${cfg.CONCURRENCY}.`,
  "URL safety: only http(s), no spaces/control chars, no username/password, no localhost, DNS must resolve and private IPv4 ranges are blocked.",
].join("\n");
