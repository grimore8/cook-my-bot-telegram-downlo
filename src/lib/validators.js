import dns from "node:dns/promises";
import net from "node:net";

import { UserError } from "./errors.js";

function hasSpacesOrControl(s) {
  // reject spaces and ASCII control chars
  return /[\s\x00-\x1F\x7F]/.test(String(s || ""));
}

function isLocalhostHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  return h === "localhost" || h.endsWith(".localhost");
}

function ipIsPrivateV4(ip) {
  const parts = String(ip || "").split(".").map((x) => Number(x));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;

  const [a, b] = parts;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isIpHostname(hostname) {
  return net.isIP(String(hostname || "")) !== 0;
}

export async function verifyAndNormalizeUrl(raw) {
  const input = String(raw || "").trim();

  if (!input) {
    throw new UserError(
      "INVALID_URL",
      "Invalid URL. Usage: /dl <url>\nExample: /dl https://example.com/video"
    );
  }

  if (hasSpacesOrControl(input)) {
    throw new UserError("INVALID_URL", "Invalid URL: spaces or control characters are not allowed.");
  }

  let u;
  try {
    u = new URL(input);
  } catch {
    throw new UserError(
      "INVALID_URL",
      "Invalid URL. Usage: /dl <url>\nExample: /dl https://example.com/video"
    );
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new UserError("INVALID_URL", "Invalid URL: only http:// or https:// URLs are allowed.");
  }

  if (u.username || u.password) {
    throw new UserError("INVALID_URL", "Invalid URL: username/password in URLs is not allowed.");
  }

  if (!u.hostname) {
    throw new UserError("INVALID_URL", "Invalid URL: missing hostname.");
  }

  if (isLocalhostHost(u.hostname)) {
    throw new UserError("BLOCKED_URL", "Blocked URL: localhost addresses are not allowed.");
  }

  // Reject direct IP hostnames if private
  if (isIpHostname(u.hostname)) {
    const ip = u.hostname;
    if (net.isIP(ip) === 4 && ipIsPrivateV4(ip)) {
      throw new UserError("BLOCKED_URL", "Blocked URL: private/local network addresses are not allowed.");
    }
  }

  // Resolve DNS A records and block if any private
  let addrs;
  try {
    addrs = await dns.resolve4(u.hostname);
  } catch (e) {
    throw new UserError("DNS_FAIL", "DNS lookup failed for this hostname. Please use a public URL.");
  }

  if (!Array.isArray(addrs) || addrs.length === 0) {
    throw new UserError("DNS_FAIL", "DNS lookup failed for this hostname. Please use a public URL.");
  }

  for (const ip of addrs) {
    if (ipIsPrivateV4(ip)) {
      throw new UserError("BLOCKED_URL", "Blocked URL: private/local network addresses are not allowed.");
    }
  }

  // Normalize (WHATWG URL serialization)
  const normalized = u.toString();
  return { url: u, normalized };
}
