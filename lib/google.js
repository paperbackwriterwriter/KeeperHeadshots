// "Continue with Google": OAuth 2.0 authorization code flow with PKCE, done
// entirely on the server. The browser goes to Google and comes back to
// /api/auth/google/callback; the code is swapped for an ID token directly with
// Google (over TLS, with our client secret), so the token's claims can be
// trusted without checking its signature, as Google's docs allow.
//
// Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET; without them the button
// doesn't show and the routes answer 404. GOOGLE_AUTH_URL / GOOGLE_TOKEN_URL
// exist only so the tests can stand in for Google.

import crypto from "node:crypto";

export const googleEnabled = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

const AUTH_URL = () => process.env.GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = () => process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export const STATE_COOKIE = "kh_google";
export const STATE_MAX_AGE_MS = 10 * 60 * 1000;

const rand = (n = 24) => crypto.randomBytes(n).toString("base64url");

// Where Google sends the person, plus what the callback needs to check the
// reply: state (ties the reply to this browser), the PKCE verifier and the
// nonce (ties the ID token to this request).
export function begin({ redirectUri, next, signup }) {
  const flow = { state: rand(), verifier: rand(48), nonce: rand(), next: next || null, signup: !!signup, at: Date.now() };
  const challenge = crypto.createHash("sha256").update(flow.verifier).digest("base64url");
  const url = new URL(AUTH_URL());
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return { url: url.toString(), cookie: Buffer.from(JSON.stringify(flow)).toString("base64url") };
}

export function readFlow(raw) {
  try {
    const flow = JSON.parse(Buffer.from(String(raw || ""), "base64url").toString());
    if (typeof flow?.state !== "string" || typeof flow.verifier !== "string" || typeof flow.nonce !== "string") return null;
    if (!(Date.now() - flow.at < STATE_MAX_AGE_MS)) return null;
    return flow;
  } catch {
    return null;
  }
}

const sameString = (a, b) => typeof a === "string" && typeof b === "string" && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const stateMatches = (flow, state) => sameString(flow?.state, state);

export class GoogleError extends Error {}

// Swaps the code for the person's verified Google profile:
// { sub, email, name, givenName }. Throws GoogleError when anything is off.
export async function finish({ code, flow, redirectUri }) {
  if (typeof code !== "string" || !code || code.length > 2000) throw new GoogleError("missing code");
  const res = await fetch(TOKEN_URL(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: flow.verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body.id_token !== "string") throw new GoogleError(`token exchange failed (${res.status} ${body.error || ""})`.trim());
  let claims;
  try {
    claims = JSON.parse(Buffer.from(body.id_token.split(".")[1] || "", "base64url").toString());
  } catch {
    throw new GoogleError("unreadable ID token");
  }
  if (!ISSUERS.includes(claims.iss)) throw new GoogleError("wrong issuer");
  if (claims.aud !== process.env.GOOGLE_CLIENT_ID) throw new GoogleError("wrong audience");
  if (!(Number(claims.exp) * 1000 > Date.now())) throw new GoogleError("expired ID token");
  if (!sameString(claims.nonce, flow.nonce)) throw new GoogleError("nonce mismatch");
  if (typeof claims.sub !== "string" || !claims.sub) throw new GoogleError("no subject");
  // Only an address Google has confirmed counts; it stands in for our own
  // confirmation email.
  if (claims.email_verified !== true && claims.email_verified !== "true") throw new GoogleError("email not verified");
  const email = String(claims.email || "").toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new GoogleError("no email");
  return { sub: claims.sub, email, name: typeof claims.name === "string" ? claims.name : "", givenName: typeof claims.given_name === "string" ? claims.given_name : "" };
}
