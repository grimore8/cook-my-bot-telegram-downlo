What this bot does
It downloads media from a verified public URL using yt-dlp, optionally converts/extracts audio using ffmpeg, and sends the result back to Telegram as MP4 or MP3 if it fits within the configured size limit.

Public commands
1) /start
Shows a short intro and examples.

2) /help
Shows all commands, limits (MAX_UPLOAD_MB), cooldown (COOLDOWN_SEC), and URL safety rules.

3) /dl <url>
Auto mode. Defaults to MP4. If your message contains the word audio (case-insensitive) anywhere, it prefers MP3.
Example: /dl https://example.com/video
Example: /dl https://example.com/video audio

4) /mp4 <url>
Forces MP4 output.
Example: /mp4 https://example.com/video

5) /mp3 <url>
Forces MP3 output.
Example: /mp3 https://example.com/video

Environment variables
1) TELEGRAM_BOT_TOKEN (required)
Telegram bot token.

2) MAX_UPLOAD_MB (optional, default 50)
Maximum file size that the bot will upload to Telegram.

3) COOLDOWN_SEC (optional, default 20)
Per-user cooldown applied when a job is accepted into the queue.

4) CONCURRENCY (optional, default 2)
Maximum number of simultaneous download jobs.

5) PORT (optional, default 3000)
Port for the small health server.

6) JOB_TIMEOUT_MS (optional, default 720000)
Maximum time per download job before it is aborted.

Operational notes
1) This bot depends on yt-dlp and ffmpeg installed on the host.
2) Each job runs in ./tmp/<jobId>/ and is cleaned up in a finally block.
3) URL verification includes DNS resolution and blocks private IPv4 ranges to reduce SSRF risk.
