import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { log } from "./logger.js";
import { safeErr, UserError } from "./errors.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function spawnCapture(bin, args, { cwd, timeoutMs, killSignal = "SIGKILL" } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    log.info("spawn start", { bin, argsCount: args.length, cwd });

    const child = spawn(bin, args, {
      cwd,
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (d) => {
      stdout += d.toString("utf8");
      if (stdout.length > 20000) stdout = stdout.slice(-20000);
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString("utf8");
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });

    let timedOut = false;
    const t = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          try {
            child.kill(killSignal);
          } catch {}
        }, timeoutMs)
      : null;

    child.on("error", (e) => {
      if (t) clearTimeout(t);
      reject(e);
    });

    child.on("close", (code, signal) => {
      if (t) clearTimeout(t);

      const ms = Date.now() - startedAt;
      if (timedOut) {
        const err = new UserError("DOWNLOAD_TIMEOUT", "download timed out");
        err.details = { bin, code, signal, ms, stderr: stderr.slice(-2000) };
        return reject(err);
      }

      if (code === 0) {
        log.info("spawn exit", { bin, code, ms });
        return resolve({ code, signal, stdout, stderr, ms });
      }

      const err = new Error(`process failed: ${bin} exit ${code}`);
      err.details = { bin, code, signal, ms, stderr: stderr.slice(-2000) };
      log.warn("spawn failed", { bin, code, signal, ms, stderrTail: stderr.slice(-400) });
      reject(err);
    });
  });
}

async function findFirstByExt(dir, ext) {
  const files = await fs.readdir(dir);
  const f = files.find((x) => x.toLowerCase().endsWith(ext));
  return f ? path.join(dir, f) : "";
}

async function statBytes(p) {
  const st = await fs.stat(p);
  return st.size;
}

function ytDlpCommonArgs(outTemplate) {
  return [
    "--no-playlist",
    "--no-part",
    "--restrict-filenames",
    "--no-warnings",
    "--newline",
    "--output",
    outTemplate,
  ];
}

export async function downloadMedia({
  jobId,
  url,
  hostname,
  mode,
  jobDir,
  maxUploadBytes,
  timeoutMs,
}) {
  const t0 = Date.now();

  // Deterministic base name
  const base = path.join(jobDir, "output");

  try {
    if (mode === "mp3") {
      const outTemplate = base + ".%(ext)s";

      const args = [
        ...ytDlpCommonArgs(outTemplate),
        "-f",
        "bestaudio/best",
        "--extract-audio",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "0",
        url,
      ];

      await spawnCapture("yt-dlp", args, { cwd: jobDir, timeoutMs });

      // yt-dlp typically outputs output.mp3 due to template + postprocessor
      let filePath = await findFirstByExt(jobDir, ".mp3");
      if (!filePath) {
        // fallback: maybe output.<something>.mp3
        filePath = path.join(jobDir, "output.mp3");
        try {
          await fs.access(filePath);
        } catch {
          throw new Error("mp3 output not found");
        }
      }

      const sizeBytes = await statBytes(filePath);
      if (sizeBytes > maxUploadBytes) return { tooBig: true };

      return {
        tooBig: false,
        filePath,
        fileName: "download.mp3",
        sizeBytes,
        ms: Date.now() - t0,
        meta: { jobId, hostname },
      };
    }

    // mp4
    const outTemplate = base + ".%(ext)s";

    // Prefer MP4 container. This is conservative: pick best MP4 video + best audio and merge.
    // If no mp4 video, yt-dlp may still download another container; we then remux with ffmpeg.
    const args = [
      ...ytDlpCommonArgs(outTemplate),
      "-f",
      "bv*[ext=mp4]+ba/b[ext=mp4]/b",
      "--merge-output-format",
      "mp4",
      url,
    ];

    await spawnCapture("yt-dlp", args, { cwd: jobDir, timeoutMs });

    let filePath = await findFirstByExt(jobDir, ".mp4");

    // If yt-dlp produced something else, try a remux step.
    if (!filePath) {
      const files = await fs.readdir(jobDir);
      const candidate = files
        .filter((f) => f.startsWith("output."))
        .map((f) => path.join(jobDir, f))[0];

      if (!candidate) throw new Error("downloaded file not found");

      const remuxOut = path.join(jobDir, "output.mp4");
      await spawnCapture(
        "ffmpeg",
        ["-y", "-i", candidate, "-c", "copy", remuxOut],
        { cwd: jobDir, timeoutMs: Math.min(timeoutMs, 3 * 60_000) }
      );
      filePath = remuxOut;
    }

    const sizeBytes = await statBytes(filePath);
    if (sizeBytes > maxUploadBytes) return { tooBig: true };

    return {
      tooBig: false,
      filePath,
      fileName: "download.mp4",
      sizeBytes,
      ms: Date.now() - t0,
      meta: { jobId, hostname },
    };
  } catch (e) {
    // Map common yt-dlp failures to nicer errors
    const msg = safeErr(e);
    const lower = String(msg || "").toLowerCase();

    if (e?.code === "DOWNLOAD_TIMEOUT") throw e;

    if (lower.includes("private") || lower.includes("members-only") || lower.includes("sign in") || lower.includes("login")) {
      throw new UserError("RESTRICTED", "This content appears private or restricted.");
    }

    if (lower.includes("403") || lower.includes("forbidden") || lower.includes("geo") || lower.includes("not available") || lower.includes("region")) {
      throw new UserError("RESTRICTED", "This content appears private or restricted.");
    }

    log.error("download failed", {
      jobId,
      hostname,
      mode,
      err: msg,
      details: e?.details ? { ...e.details, stderr: String(e.details.stderr || "").slice(-800) } : undefined,
    });

    throw new UserError("DOWNLOAD_FAILED", "Failed to download from this URL.");
  }
}
