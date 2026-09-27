// Cloudflare Turnstile: a bot check on sign-up. The browser widget produces a
// one-time token; we confirm it with Cloudflare before creating the account.
// Inactive unless both TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are set.

const VERIFY_URL = process.env.TURNSTILE_VERIFY_URL || "https://challenges.cloudflare.com/turnstile/v0/siteverify"; // override only for local QA

const SITE_HOSTS = ["keeperheadshots.com", "www.keeperheadshots.com"];

export const turnstileSiteKey = () => (process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY ? process.env.TURNSTILE_SITE_KEY : null);

// Returns { ok: true } or { ok: false, reason }. If Cloudflare itself can't be
// reached we let the sign-up through (email confirmation still guards the
// free shoot) rather than lock real people out during an outage.
export async function checkHuman(token, { ip, action } = {}) {
  if (!turnstileSiteKey()) return { ok: true, skipped: true };
  if (!token || typeof token !== "string" || token.length > 2048) return { ok: false, reason: "missing" };
  let data;
  try {
    const r = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: process.env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(8000),
    });
    data = await r.json();
  } catch (err) {
    console.error("[turnstile] verify unreachable, allowing:", err.message);
    return { ok: true, unverified: true };
  }
  if (!data.success) {
    console.warn("[turnstile] rejected", data["error-codes"]);
    return { ok: false, reason: (data["error-codes"] || []).join(",") || "failed" };
  }
  if (action && data.action && data.action !== action) return { ok: false, reason: "action-mismatch" };
  // In production the token must come from our own site, not a copy of the
  // widget embedded elsewhere with our (public) site key.
  if (process.env.VERCEL_ENV === "production" && data.hostname && !SITE_HOSTS.includes(data.hostname)) return { ok: false, reason: "hostname-mismatch" };
  return { ok: true };
}
