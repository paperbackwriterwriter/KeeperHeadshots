import { $, $$, html, raw, icon, state, api, toast, busy, initials } from "../core.js";
import { CONTACT_EMAIL } from "./contact.js";
import { PHOTO_FORMATS } from "../shared/catalog.js";
import { currentFormat, formatName, saveFormat } from "./format.js";

const plural = (n) => `${n} ${n === 1 ? "shoot" : "shoots"}`;
function shootsLeft(plan, credits) {
  if (plan?.tier === "owner") return "Unlimited";
  if (plan?.freeShootAvailable) return credits ? `${plural(credits)} + 1 free` : "1 free shoot";
  return plural(credits);
}
const date = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

export function renderAccount({ root, navigate }) {
  const u = state.user;
  const credits = u.plan?.credits || 0;

  root.innerHTML = html`
  <main id="main" class="container app-main view-enter account-page">
    <div class="page-head"><div><p class="eyebrow">Account</p><h1 class="display h-1" style="margin-top:8px">Your account</h1></div></div>

    <section class="panel account-card">
      <span class="avatar avatar-lg" aria-hidden="true">${initials(u.name)}</span>
      <dl class="account-facts">
        <div><dt>Name</dt><dd>${u.name}</dd></div>
        <div><dt>Email</dt><dd>${u.email}</dd></div>
        <div><dt>Member since</dt><dd>${u.createdAt ? date(u.createdAt) : "—"}</dd></div>
        <div><dt>Shoots left</dt><dd>${shootsLeft(u.plan, credits)}</dd></div>
      </dl>
    </section>
    <p class="small muted" style="margin-top:12px">Need to change your name or email? <a class="link" href="/contact?topic=general" data-link>Contact us</a>. Your data and rights are explained in our <a class="link" href="/privacy" data-link>Privacy Policy</a>.</p>

    <section class="panel prefs" aria-labelledby="prefs-title">
      <h2 class="h-3" id="prefs-title">Download format</h2>
      <p class="muted">Choose the shape your download buttons give you. Every headshot is always available in both, and you can switch at any time.</p>
      <div class="fmt-options" role="radiogroup" aria-labelledby="prefs-title">
        ${PHOTO_FORMATS.map(
          (f) => html`<label class="fmt-option">
            <input type="radio" name="photoFormat" value="${f.id}" ${f.id === currentFormat() ? raw("checked") : ""} />
            <span class="fmt-shape fmt-${f.id}" aria-hidden="true"><i></i><i></i></span>
            <span><b>${f.name}</b><small>${f.blurb}</small></span>
          </label>`,
        )}
      </div>
    </section>

    <section class="danger-zone" aria-labelledby="dz-title">
      <h2 class="h-3" id="dz-title">Delete your account</h2>
      ${u.demo
        ? html`<p>The demo account can't be deleted. Create your own account to try Keeper Headshots with your photos.</p>`
        : html`
      <p>This permanently deletes your account, every shoot, and all of your selfies and headshots. It can't be undone, so download any headshots you want to keep first.</p>
      ${credits > 0
        ? html`<div class="banner banner-danger" style="margin:16px 0">${icon("circle-alert")}<div><b>You have ${credits} unused ${credits === 1 ? "shoot" : "shoots"}.</b>They'll be lost when you delete your account. If you bought them in the last 30 days, <a class="link" href="/refunds" data-link>check whether you qualify for a refund</a> first.</div></div>`
        : ""}
      <button class="btn btn-danger" id="startDelete" type="button">${icon("trash-2")} Delete my account</button>
      <form id="deleteForm" class="delete-form" hidden novalidate>
        <div class="field">
          <label for="delPassword">Enter your password to confirm</label>
          <input class="input" id="delPassword" name="password" type="password" autocomplete="current-password" required />
          <span class="field-error" id="err-delPassword" hidden></span>
        </div>
        <label class="check"><input type="checkbox" id="delConfirm" /> <span>I understand my shoots and headshots will be deleted for good.</span></label>
        <div class="delete-actions">
          <button class="btn btn-danger" id="confirmDelete" type="submit" disabled>${icon("trash-2")} Permanently delete</button>
          <button class="btn btn-ghost" id="cancelDelete" type="button">Cancel</button>
        </div>
      </form>
      <p class="small muted" style="margin-top:16px">Prefer to ask us? Email <a class="link" href="mailto:${CONTACT_EMAIL}?subject=Delete%20my%20account">${CONTACT_EMAIL}</a> from this address and we'll delete it within 30 days.</p>`}
    </section>
  </main>`.v;

  $$('input[name="photoFormat"]', root).forEach((r) =>
    r.addEventListener("change", async () => {
      try {
        await saveFormat(r.value);
        toast(`Downloads set to ${formatName(r.value).toLowerCase()}.`, "success", 2500);
      } catch {
        $(`input[name="photoFormat"][value="${currentFormat()}"]`, root).checked = true;
      }
    }),
  );

  if (u.demo) return;
  const form = $("#deleteForm", root);
  const start = $("#startDelete", root);
  const pw = $("#delPassword", root);
  const agree = $("#delConfirm", root);
  const go = $("#confirmDelete", root);
  const err = $("#err-delPassword", root);
  const showError = (msg) => {
    err.textContent = msg;
    err.hidden = !msg;
    pw.setAttribute("aria-invalid", msg ? "true" : "false");
  };
  const sync = () => (go.disabled = !(agree.checked && pw.value));

  start.addEventListener("click", () => {
    start.hidden = true;
    form.hidden = false;
    pw.focus();
  });
  $("#cancelDelete", root).addEventListener("click", () => {
    form.hidden = true;
    start.hidden = false;
    form.reset();
    showError("");
    sync();
    start.focus();
  });
  pw.addEventListener("input", () => (showError(""), sync()));
  agree.addEventListener("change", sync);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (go.disabled) return;
    const done = busy(go, "Deleting…");
    try {
      await api("/api/account/delete", { method: "POST", body: { password: pw.value } });
      state.user = null;
      toast("Your account and all your photos have been deleted.", "success", 7000);
      navigate("/");
    } catch (ex) {
      done();
      if (ex.status === 401) {
        showError(ex.data?.fields?.password || ex.message);
        pw.select();
      } else toast(ex.message, "error", 7000);
    }
  });
}
