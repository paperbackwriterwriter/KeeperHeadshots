import { html, api, state, toast, media, squareMedia } from "../core.js";
import { PHOTO_FORMATS, photoFormat } from "../shared/catalog.js";

// Download format: portrait 3:4, square 1:1, or both. Saved on the account so
// it follows the person to every shoot and device.

export const currentFormat = () => photoFormat(state.user?.photoFormat);
export const formatName = (id) => PHOTO_FORMATS.find((f) => f.id === photoFormat(id)).name;

export const formatPicker = (current, label = "Download format") =>
  html`<div class="filters fmt-picker" role="group" aria-label="${label}">
    ${PHOTO_FORMATS.map((f) => html`<button type="button" class="filter" data-format="${f.id}" aria-pressed="${f.id === current}" title="${f.blurb}">${f.name}</button>`)}
  </div>`;

export async function saveFormat(id) {
  const prev = currentFormat();
  if (!state.user || id === prev) return;
  state.user = { ...state.user, photoFormat: id };
  if (state.user.demo) return; // the shared demo account only changes for this visit
  try {
    const data = await api("/api/account/preferences", { method: "POST", body: { photoFormat: id } });
    state.user = data.user;
  } catch (err) {
    state.user = { ...state.user, photoFormat: prev };
    toast(err.message, "error");
    throw err;
  }
}

export const formatHrefs = (file, id = currentFormat()) =>
  id === "portrait" ? [media(file, true)] : id === "square" ? [squareMedia(file)] : [media(file, true), squareMedia(file)];

// Whether a download may go ahead: a link clicked after the session ended
// would otherwise save the sign-in page as a file. Asks the server first and,
// if signed out, hands over to the usual sign-in flow.
export async function canDownload(href) {
  try {
    const res = await fetch(href, { method: "HEAD", credentials: "same-origin", redirect: "manual" });
    if (res.status === 401 || res.type === "opaqueredirect") {
      document.dispatchEvent(new CustomEvent("ahg:signed-out"));
      return false;
    }
  } catch {}
  return true;
}

// iPhone and iPad Safari keep only one download per tap, so several files
// (both shapes, or a whole set) go through the share sheet instead, whose
// "Save Images" puts them all in Photos at once.
const appleTouch = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const fileName = (res, href, i) => /filename="?([^";]+)"?/.exec(res.headers.get("content-disposition") || "")?.[1] || `headshot-${i + 1}.${/square=1/.test(href) ? "square." : ""}jpg`;

// Returns "saved", "cancelled" (the sheet was closed), or false when sharing
// isn't possible here (the caller downloads instead).
async function shareFiles(hrefs) {
  // One at a time: a whole team's set at full size at once is a lot of memory on a phone.
  const files = [];
  for (const [i, href] of hrefs.entries()) {
    const res = await fetch(href, { credentials: "same-origin" });
    if (!res.ok) throw new Error("download failed");
    const blob = await res.blob();
    files.push(new File([blob], fileName(res, href, i), { type: blob.type || "image/jpeg" }));
  }
  if (!navigator.canShare?.({ files })) return false;
  const share = () => navigator.share({ files }).then(() => "saved", (err) => (err.name === "AbortError" ? "cancelled" : Promise.reject(err)));
  try {
    return await share();
  } catch (err) {
    if (err.name !== "NotAllowedError") throw err;
  }
  // Fetching took long enough that Safari no longer counts this as the
  // person's tap: one more tap opens the sheet.
  return new Promise((resolve) => {
    const sheet = document.createElement("div");
    sheet.className = "save-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-label", "Save your headshots");
    sheet.innerHTML = html`<p>Your ${files.length} photos are ready.</p>
      <button type="button" class="btn btn-flash" data-save>Save ${files.length} photos</button>
      <button type="button" class="btn btn-ghost" data-close>Not now</button>`.v;
    const before = document.activeElement;
    const done = (v) => {
      sheet.remove();
      removeEventListener("popstate", leave);
      document.removeEventListener("ahg:navigate", leave);
      document.removeEventListener("keydown", onKey);
      if (before?.isConnected) before.focus();
      resolve(v);
    };
    const leave = () => done("cancelled");
    const onKey = (e) => e.key === "Escape" && done("cancelled");
    sheet.querySelector("[data-save]").addEventListener("click", () => share().then(done, () => done(false)));
    sheet.querySelector("[data-close]").addEventListener("click", () => done("cancelled"));
    // Leaving the page (in-app navigation) or Escape closes it.
    addEventListener("popstate", leave);
    document.addEventListener("ahg:navigate", leave);
    document.addEventListener("keydown", onKey);
    document.body.appendChild(sheet);
    sheet.querySelector("[data-save]").focus();
  });
}

// Browsers allow several downloads from one click when they're spaced out a little.
// Returns false when nothing was saved (signed out, or the share sheet closed).
export async function downloadAll(hrefs) {
  if (!hrefs.length || !(await canDownload(hrefs[0]))) return false;
  if (hrefs.length > 1 && appleTouch() && navigator.share) {
    try {
      const shared = await shareFiles(hrefs);
      if (shared === "saved") return true;
      if (shared === "cancelled") return false;
    } catch {
      // fall back to separate downloads below
    }
  }
  for (const [i, href] of hrefs.entries()) {
    if (i) await new Promise((r) => setTimeout(r, 350));
    const a = document.createElement("a");
    a.href = href;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  return true;
}

// Download links (<a download>) check the session first, then download as usual.
export function guardDownloadLinks(root) {
  root.addEventListener("click", (e) => {
    const a = e.target.closest("a[download]");
    if (!a || a.dataset.checked) return;
    e.preventDefault();
    canDownload(a.href).then((okay) => {
      if (!okay) return;
      a.dataset.checked = "1";
      a.click();
      delete a.dataset.checked;
    });
  });
}
