import { safeErr } from "./errors.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function createQueue({ concurrency = 2, log }) {
  let active = 0;
  const pending = [];
  let pumping = false;

  function state() {
    return { concurrency, active, pending: pending.length };
  }

  async function pump() {
    if (pumping) return;
    pumping = true;

    try {
      log.info("queue pump start", state());

      while (active < concurrency && pending.length > 0) {
        const item = pending.shift();
        active += 1;

        const startedAt = Date.now();
        log.info("queue job begin", { ...state(), jobId: item.jobId });

        (async () => {
          try {
            await item.fn();
            log.info("queue job success", { jobId: item.jobId, ms: Date.now() - startedAt });
          } catch (e) {
            log.error("queue job failed", { jobId: item.jobId, err: safeErr(e), ms: Date.now() - startedAt });
          } finally {
            active -= 1;
            log.info("queue job end", { ...state(), jobId: item.jobId });
            await sleep(0);
            pump();
          }
        })();
      }

      log.info("queue pump idle", state());
    } finally {
      pumping = false;
    }
  }

  function enqueue(fn) {
    const jobId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const item = { jobId, fn };

    pending.push(item);

    const pos = Math.max(0, pending.length - 1 - Math.max(0, concurrency - active - 1));
    log.info("queue enqueue", { jobId, position: pending.length, ...state() });

    pump();

    // Return user's queue position estimate: if active < concurrency and this job is at head, it's 0
    // We'll compute real position in caller by looking at current state; keep it simple.
    return pending.length > 0 && active >= concurrency ? pending.length : 0;
  }

  return { enqueue, state };
}
