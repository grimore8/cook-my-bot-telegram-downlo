Telegram Downloader Bot (yt-dlp + ffmpeg)

What it does
This is a Telegram bot that downloads media from a verified public URL using yt-dlp and returns either MP4 or MP3 in chat.

Commands
/start
Shows a brief intro and examples.

/help
Shows commands, limits, cooldown, and URL safety rules.

/dl <url>
Auto mode. Defaults to MP4. If your message contains the word "audio" (case-insensitive) anywhere, it prefers MP3.

/mp4 <url>
Force MP4.

/mp3 <url>
Force MP3.

Limits and controls
1) MAX_UPLOAD_MB (default 50)
2) COOLDOWN_SEC (default 20) per user, applied only when a job is accepted into the queue
3) CONCURRENCY (default 2) global FIFO queue
4) Job timeout is controlled by JOB_TIMEOUT_MS (default 12 minutes)

URL safety rules (SSRF protection)
1) Only http:// and https:// URLs are accepted
2) URLs with spaces or control characters are rejected
3) URLs with username/password are rejected
4) Hostnames localhost and *.localhost are rejected
5) DNS must resolve, and any private/local IPv4 result is blocked (127/8, 10/8, 172.16/12, 192.168/16)

Setup
1) Install Node.js
On Ubuntu, you can use NodeSource or your preferred method. Node 18+ is required.

2) Install system dependencies
This bot requires yt-dlp and ffmpeg installed on the host.

Ubuntu:
sudo apt-get update
sudo apt-get install -y ffmpeg

yt-dlp options:
1) apt (may be older): sudo apt-get install -y yt-dlp
2) recommended binary:
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp

Verify:
yt-dlp --version
ffmpeg -version

3) Configure env
Copy .env.sample to .env and set TELEGRAM_BOT_TOKEN.

4) Install and run
npm run build
npm start

Dev mode
npm run dev

Running with pm2
1) Install pm2
sudo npm i -g pm2

2) Start
pm2 start src/index.js --name telegram-downloader

3) View logs
pm2 logs telegram-downloader

4) Startup on boot
pm2 startup
pm2 save

Notes
1) Large files are rejected before upload if they exceed MAX_UPLOAD_MB.
2) Temporary job folders are created under ./tmp/<jobId>/ and deleted after every job (success or failure).
3) The bot uses long polling, but still starts a small HTTP server on PORT for health checks.
