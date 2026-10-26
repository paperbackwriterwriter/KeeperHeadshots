import { $, $$, html, raw, esc, icon, state, api, toast, busy, initials, refreshUserChip } from "../core.js";
import { CONTACT_EMAIL } from "./contact.js";
import { PHOTO_FORMATS } from "../shared/catalog.js";
import { currentFormat, formatName, saveFormat } from "./format.js";
import { shareStatus, wireShareRemove } from "./share.js";

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
        <div><dt>Name</dt><dd><span id="nameText">${u.name}</span>${u.demo ? "" : html` <button class="link-btn" type="button" id="editName">Edit</button>`}
          <form class="name-edit" id="nameForm" novalidate hidden>
            <label class="sr-only" for="nameInput">Your name</label>
            <input class="input" id="nameInput" name="name" autocomplete="name" maxlength="80" value="${u.name}" aria-describedby="nameErr" />
            <button class="btn btn-flash btn-sm" type="submit">Save</button>
            <button class="btn btn-ghost btn-sm" type="button" id="cancelName">Cancel</button>
            <span class="field-error" id="nameErr" role="alert" hidden></span>
          </form></dd></div>
        <div><dt>Email</dt><dd>${raw(esc(u.email).replace("@", "@<wbr>"))}</dd></div>
        <div><dt>Member since</dt><dd>${u.createdAt ? date(u.createdAt) : "—"}</dd></div>
        <div><dt>Shoots left</dt><dd>${shootsLeft(u.plan, credits)}</dd></div>
      </dl>
    </section>
    ${u.plan?.tier === "owner" ? html`<p class="small" style="margin-top:12px"><a class="link" href="/app/funnel" data-link>Sales funnel</a>: sign-ups, photo checks, shoots and purchases by day. <a class="link" href="/app/showcase" data-link>Customer results</a>: headshots offered for the home page (owner only).</p>` : ""}
    ${u.demo || u.emailVerified
      ? ""
      : html`<section class="panel prefs" data-verify-panel aria-labelledby="verify-title">
      <h2 class="h-3" id="verify-title">Confirm your email</h2>
      <p class="muted">Confirm ${u.email} with the 6-digit code or link in the email we sent when you signed up. Check your spam folder too. Confirming shows the address is yours, so this account and its headshots stay with you.</p>
      <form class="verify-code" data-verify-code novalidate>
        <label class="sr-only" for="verifyCode">6-digit code</label>
        <input class="input" id="verifyCode" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]*" maxlength="7" placeholder="123 456" aria-describedby="verifyCodeErr" />
        <button class="btn btn-flash" type="submit">Confirm</button>
        <span class="field-error" id="verifyCodeErr" role="alert" hidden></span>
      </form>
      <p class="verify-resend">Didn't get it? <button class="link-btn" type="button" data-resend-verify>Send another</button></p>
    </section>`}
    <p class="small muted" style="margin-top:12px">Need to change your email? <a class="link" href="/contact?topic=general" data-link>Contact us</a>. Your data and rights are explained in our <a class="link" href="/privacy" data-link>Privacy Policy</a>.</p>

    ${u.demo
      ? ""
      : html`<section class="panel prefs" aria-labelledby="team-title">
      <h2 class="h-3" id="team-title">Team headshots</h2>
      <p class="muted">${u.hasTeam ? "Invite colleagues, follow their progress and download everyone's headshots." : "Buying for a team? Pick the team's looks and invite colleagues by email. Each person adds their own selfies, and everyone's headshots match."}</p>
      <div class="security-actions"><a class="btn btn-ghost" href="/app/team" data-link>${icon("users")} ${u.hasTeam ? "Open my team" : "Set up a team"}</a></div>
    </section>`}

    <div id="shareSlot"></div>

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

    ${u.demo
      ? ""
      : html`<section class="panel prefs" aria-labelledby="reminders-title">
      <h2 class="h-3" id="reminders-title">Reminder emails</h2>
      <p class="muted">At most two reminders, ever: one if your photos pass the check but you haven't developed them, and one after an unfinished checkout (or, if you have one, after a free preview shoot). If you haven't bought, we may occasionally email an offer, such as a discount code; this switch stops those too. Emails about your account and orders always arrive.</p>
      <label class="check"><input type="checkbox" id="remindersOn" ${u.emailReminders !== false ? raw("checked") : ""} /> <span>Send me reminder emails</span></label>
    </section>`}

    ${u.demo
      ? ""
      : html`<section class="panel prefs" aria-labelledby="security-title">
      <h2 class="h-3" id="security-title">Password and sign-in</h2>
      <p class="muted">${u.hasPassword === false
        ? "You sign in with Google. To also sign in with a password, we'll email you a link to choose one."
        : u.google
          ? "You can sign in with Google or your password. To change your password, we'll email you a link to choose a new one."
          : "To change your password, we'll email you a link to choose a new one."} If you signed in on a shared or lost device, sign out of it from here.</p>
      <div class="security-actions">
        <a class="btn btn-ghost" href="/forgot-password?email=${encodeURIComponent(u.email)}" data-link>${icon("mail")} ${u.hasPassword === false ? "Email me a link to set a password" : "Email me a password link"}</a>
        <button class="btn btn-ghost" id="signoutAll" type="button">${icon("log-out")} Sign out of other devices</button>
      </div>
    </section>`}

    <section class="danger-zone" aria-labelledby="dz-title">
      <h2 class="h-3" id="dz-title">Delete your account</h2>
      ${u.demo
        ? html`<p>The demo account can't be deleted. Create your own account to try Keeper Headshots with your photos.</p>`
        : html`
      <p>This cancels any shoots still developing and permanently deletes your account, every shoot, and all of your selfies and headshots. It can't be undone, so download any headshots you want to keep first.${u.hasTeam ? " Your team closes, but colleagues keep the shoots you've already given them." : ""}</p>
      ${credits > 0
        ? html`<div class="banner banner-danger" style="margin:16px 0">${icon("circle-alert")}<div><b>You have ${credits} unused ${credits === 1 ? "shoot" : "shoots"}.</b>They'll be lost when you delete your account. If you bought them in the last 30 days, <a class="link" href="/refunds" data-link>check whether you qualify for a refund</a> first.</div></div>`
        : ""}
      <button class="btn btn-danger" id="startDelete" type="button">${icon("trash-2")} Delete my account</button>
      <form id="deleteForm" class="delete-form" hidden novalidate>
        <div class="field">
          ${u.hasPassword === false
            ? html`<label for="delPassword">Type your email address (${u.email}) to confirm</label>
          <input class="input" id="delPassword" name="email" type="email" autocomplete="off" aria-describedby="err-delPassword" required />`
            : html`<label for="delPassword">Enter your password to confirm</label>
          <input class="input" id="delPassword" name="password" type="password" autocomplete="current-password" aria-describedby="err-delPassword" required />`}
          <span class="field-error" id="err-delPassword" role="alert" hidden></span>
        </div>
        <label class="check"><input type="checkbox" id="delConfirm" /> <span>I understand any developing shoots will be cancelled and all my photos deleted for good.</span></label>
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
  // A headshot shared for the home page, if any (views/share.js).
  const slot = $("#shareSlot", root);
  api("/api/showcase/mine")
    .then(({ entry }) => {
      if (!entry || !slot.isConnected) return;
      slot.innerHTML = html`<section class="panel prefs" aria-labelledby="share-title">
        <h2 class="h-3" id="share-title">Your shared headshot</h2>
        ${shareStatus(entry)}
      </section>`.v;
      wireShareRemove(slot, () => (slot.innerHTML = ""));
    })
    .catch(() => {});
  // Name: edited in place.
  const nameForm = $("#nameForm", root);
  const nameErr = $("#nameErr", root);
  const editName = $("#editName", root);
  const showNameForm = (open) => {
    nameForm.hidden = !open;
    $("#nameText", root).hidden = open;
    editName.hidden = open;
    nameErr.hidden = true;
    // Changed in another tab meanwhile: show it as it is now.
    $("#nameText", root).textContent = state.user.name;
    $(".avatar", root).textContent = initials(state.user.name);
    if (open) {
      $("#nameInput", root).value = state.user.name;
      $("#nameInput", root).focus();
    } else editName.focus();
  };
  editName?.addEventListener("click", () => showNameForm(true));
  $("#cancelName", root)?.addEventListener("click", () => showNameForm(false));
  nameForm?.addEventListener("keydown", (e) => e.key === "Escape" && showNameForm(false));
  nameForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#nameInput", root).value.trim();
    const save = $('button[type="submit"]', nameForm);
    const restore = busy(save, "Saving…");
    try {
      const r = await api("/api/account/preferences", { method: "POST", body: { name } });
      state.user = r.user;
      $("#nameText", root).textContent = r.user.name;
      $(".avatar", root).textContent = initials(r.user.name);
      refreshUserChip();
      showNameForm(false);
      toast("Name updated.", "success");
    } catch (err) {
      nameErr.textContent = err.message;
      nameErr.hidden = false;
      $("#nameInput", root).focus();
    } finally {
      restore();
    }
  });
  const rem = $("#remindersOn", root);
  // Changed in another tab: show the account's settings as they are now.
  const onUser = () => {
    if (!document.body.contains(rem)) return document.removeEventListener("ahg:user-changed", onUser);
    const u2 = state.user;
    if (!u2) return;
    if (!rem.disabled) rem.checked = u2.emailReminders !== false;
    if (nameForm?.hidden) {
      $("#nameText", root).textContent = u2.name;
      $(".avatar", root).textContent = initials(u2.name);
    }
    const left = $(".account-facts div:last-child dd", root);
    if (left) left.textContent = shootsLeft(u2.plan, u2.plan?.credits || 0);
    const radio = $(`input[name="photoFormat"][value="${currentFormat()}"]`, root);
    if (radio) radio.checked = true;
  };
  document.addEventListener("ahg:user-changed", onUser);
  rem.addEventListener("change", async () => {
    const on = rem.checked;
    rem.disabled = true;
    try {
      const r = await api("/api/account/preferences", { method: "POST", body: { reminders: on } });
      state.user = r.user;
      toast(on ? "Reminder emails are on." : "Reminder emails are off.", "success", 2500);
    } catch (err) {
      rem.checked = !on;
      toast(err.message, "error");
    }
    rem.disabled = false;
  });
  $("#signoutAll", root).addEventListener("click", async (e) => {
    const restore = busy(e.currentTarget, "Signing out…");
    try {
      await api("/api/auth/signout-all", { method: "POST" });
      toast("Signed out of your other devices. You're still signed in here.", "success");
    } catch (err) {
      toast(err.message, "error");
    }
    restore();
  });
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
      await api("/api/account/delete", { method: "POST", body: u.hasPassword === false ? { email: pw.value } : { password: pw.value } });
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
