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

// Browsers allow several downloads from one click when they're spaced out a little.
export async function downloadAll(hrefs) {
  if (!hrefs.length || !(await canDownload(hrefs[0]))) return;
  for (const [i, href] of hrefs.entries()) {
    if (i) await new Promise((r) => setTimeout(r, 350));
    const a = document.createElement("a");
    a.href = href;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
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
