// A version for the browser code: a hash of everything the browser runs
// (public/js, the stylesheet and the page template). The page carries it in
// <meta name="app-build"> and every API response in an X-App-Build header, so
// a tab left open across a deploy can tell it's out of date and offer a reload
// (public/js/core.js). Server-only deploys keep the same version, so they don't
// ask anyone to reload.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function files(dir) {
  let out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(files(p));
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}

const sources = [...files(path.join(root, "public", "js")), path.join(root, "public", "css", "app.css"), path.join(root, "templates", "index.html")];
const hash = crypto.createHash("sha256");
let hashed = 0;
for (const f of sources) {
  try {
    hash.update(path.relative(root, f)).update(fs.readFileSync(f));
    hashed++;
  } catch {}
}
// If the deployment bundle doesn't include the browser files, fall back to the
// deployment itself (changes on every deploy, which only means an extra offer).
export const BUILD = hashed > 2 ? hash.digest("hex").slice(0, 12) : String(process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || "dev").slice(-12);
export const BUILD_FILES = hashed;
