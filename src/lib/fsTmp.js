import fs from "node:fs/promises";
import path from "node:path";

import { log } from "./logger.js";
import { safeErr } from "./errors.js";

export async function ensureTmpRoot(tmpRoot) {
  await fs.mkdir(tmpRoot, { recursive: true });
}

export async function createJobDir(tmpRoot, jobId) {
  const dir = path.join(tmpRoot, String(jobId));
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function cleanupJobDir(jobDir) {
  if (!jobDir) return;
  try {
    await fs.rm(jobDir, { recursive: true, force: true });
  } catch (e) {
    log.warn("tmp cleanup failed", { jobDir, err: safeErr(e) });
  }
}

export async function cleanupStaleTmpDirs(tmpRoot, { olderThanMs = 24 * 60 * 60 * 1000 } = {}) {
  try {
    const items = await fs.readdir(tmpRoot, { withFileTypes: true });
    const now = Date.now();

    for (const it of items) {
      if (!it.isDirectory()) continue;
      const p = path.join(tmpRoot, it.name);
      try {
        const st = await fs.stat(p);
        const age = now - st.mtimeMs;
        if (age > olderThanMs) {
          await fs.rm(p, { recursive: true, force: true });
          log.info("tmp stale dir removed", { dir: p, ageMs: Math.round(age) });
        }
      } catch {}
    }
  } catch {}
}
