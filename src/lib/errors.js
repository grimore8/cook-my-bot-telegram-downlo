export function safeErr(err) {
  return (
    err?.response?.data?.error?.message ||
    err?.response?.data?.message ||
    err?.message ||
    String(err)
  );
}

export class UserError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "UserError";
    this.code = code;
  }
}

export function toUserMessage(err, { fallback = "Failed to download from this URL.", jobId = "" } = {}) {
  const code = err?.code || err?.name || "";
  const msg = safeErr(err);

  if (code === "INVALID_URL") return msg;
  if (code === "BLOCKED_URL") return msg;
  if (code === "DNS_FAIL") return msg;

  if (code === "DOWNLOAD_TIMEOUT") return "Download timed out.";

  const m = String(msg || "").toLowerCase();
  if (m.includes("private") || m.includes("sign in") || m.includes("login") || m.includes("members-only")) {
    return "This content appears private or restricted.";
  }
  if (m.includes("403") || m.includes("forbidden") || m.includes("geo") || m.includes("not available") || m.includes("region")) {
    return "This content appears private or restricted.";
  }

  if (m.includes("unsupported url") || m.includes("no suitable extractor") || m.includes("unsupported")) {
    return "Failed to download from this URL.";
  }

  if (jobId) return `${fallback} (ref: ${jobId})`;
  return fallback;
}
