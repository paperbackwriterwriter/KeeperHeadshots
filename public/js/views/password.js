import { $, html, icon, api, state, toast, busy, logoMark, wordmark } from "../core.js";
import { mountTurnstile } from "../turnstile.js";
import { pageUrl } from "../pixel.js";

// Password reset: /forgot-password asks for the email address and sends a
// one-hour link; /reset?token=… (the link in that email) sets a new password.

// Like sign-in and sign-up: no site menu, just the logo (home) above the card.
const shell = (root, body) => (root.innerHTML = html`<main id="main" class="container app-main view-enter verify-page auth-lite"><a class="logo" href="/" data-link>${logoMark()}${wordmark()}</a><div class="verify-card reset-card">${body}</div></main>`.v);

const showAlert = (box, message) => {
  box.innerHTML = `${icon("circle-alert").v}<span>${message.replace(/</g, "&lt;")}</span>`;
  box.hidden = false;
};

const showFieldError = (input, message) => {
  const el = $(`#err-${input.id}`);
  el.innerHTML = `${icon("circle-alert").v}${message.replace(/</g, "&lt;")}`;
  el.hidden = false;
  input.setAttribute("aria-invalid", "true");
  input.setAttribute("aria-describedby", el.id);
  input.focus();
};

const clearFieldError = (input) => {
  $(`#err-${input.id}`).hidden = true;
  input.removeAttribute("aria-invalid");
  input.removeAttribute("aria-describedby");
};

export function renderForgot({ root }) {
  const prefill = new URLSearchParams(location.search).get("email") || state.user?.email || "";
  shell(
    root,
    html`
    <div class="verify-icon">${icon("lock")}</div>
    <h1 class="display h-2">Reset your password</h1>
    <p class="lede">Enter the email address you signed up with and we'll send you a link to choose a new password.</p>
    <form class="form reset-form" id="forgotForm" novalidate>
      <div class="form-alert" id="formAlert" role="alert" hidden></div>
      <div class="field"><label for="email">Email</label><input class="input" id="email" name="email" type="email" autocomplete="email" inputmode="email" placeholder="you@company.com" value="${prefill}" required /><span class="field-error" id="err-email" hidden></span></div>
      <div class="turnstile-slot" id="botCheck"></div>
      <button class="btn btn-flash btn-lg btn-block" type="submit" id="submit">Email me a reset link ${icon("arrow-right")}</button>
    </form>
    <p class="muted small"><a class="link" href="/signin" data-link>Back to sign in</a></p>`,
  );

  const form = $("#forgotForm");
  const email = $("#email");
  const alertBox = $("#formAlert");
  const human = mountTurnstile($("#botCheck"), { action: "reset" });

  email.addEventListener("input", () => clearFieldError(email));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    alertBox.hidden = true;
    const address = email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return showFieldError(email, "Enter a valid email address.");
    const restore = busy($("#submit"), "Sending…");
    try {
      const body = { email: address };
      if (human) body.turnstileToken = await human.token();
      await api("/api/auth/password/forgot", { method: "POST", body });
    } catch (err) {
      restore();
      human?.reset(); // tokens are single-use
      if (err.data?.fields?.email) return showFieldError(email, err.data.fields.email);
      return showAlert(alertBox, err.message);
    }
    human?.remove();
    shell(
      root,
      html`
      <div class="verify-icon verify-icon-ok">${icon("mail-check")}</div>
      <h1 class="display h-2">Check your inbox.</h1>
      <p class="lede">If there's a Keeper Headshots account for <b>${address}</b>, we've sent it a link to reset your password. The link works for 1 hour.</p>
      <p class="muted small">Nothing there after a few minutes? Check your spam folder, make sure that's the address you signed up with, or <a class="link" href="/contact?topic=general" data-link>contact us</a>.</p>
      <div class="verify-actions"><a class="btn btn-ghost btn-lg" href="/signin" data-link>${icon("arrow-left")} Back to sign in</a></div>`,
    );
    const heading = $("h1", root);
    heading.tabIndex = -1;
    heading.focus();
  });
  if (!prefill) email.focus({ preventScroll: true });
  return () => human?.remove();
}

export async function renderReset({ root, navigate }) {
  const token = state.linkToken || new URLSearchParams(location.search).get("token") || "";
  state.linkToken = null;
  // Keep the token out of the address bar and browser history.
  history.replaceState({}, "", "/reset");

  const failed = (message) =>
    shell(
      root,
      html`
      <div class="verify-icon verify-icon-warn">${icon("circle-alert")}</div>
      <h1 class="display h-2">We couldn't use that link.</h1>
      <p class="lede">${message}</p>
      <div class="verify-actions">
        <a class="btn btn-flash btn-lg" href="/forgot-password" data-link>Send a new link ${icon("arrow-right")}</a>
        <a class="btn btn-ghost btn-lg" href="/signin" data-link>Back to sign in</a>
      </div>`,
    );

  // Coming back here (Back button) after a reset, already signed in.
  if (!token && state.user) return void navigate("/app", { replace: true });
  if (!token) return failed("This page needs the link from your password reset email. Ask for a new one below.");
  try {
    await api("/api/auth/password/reset/check", { method: "POST", body: { token } });
  } catch (err) {
    return failed(err.message);
  }

  shell(
    root,
    html`
    <div class="verify-icon">${icon("lock")}</div>
    <h1 class="display h-2">Choose a new password</h1>
    <p class="lede">Use at least 8 characters. You'll be signed out on your other devices.</p>
    <form class="form reset-form" id="resetForm" novalidate>
      <div class="form-alert" id="formAlert" role="alert" hidden></div>
      <input type="email" name="username" autocomplete="username" value="${state.user?.email || ""}" hidden />
      <div class="field">
        <label for="password">New password</label>
        <div class="input-wrap">
          <input class="input" id="password" name="password" type="password" autocomplete="new-password" placeholder="At least 8 characters" required minlength="8" maxlength="200" style="padding-right:52px" />
          <button type="button" class="reveal" id="reveal" aria-label="Show password" aria-pressed="false">${icon("eye")}</button>
        </div>
        <span class="field-error" id="err-password" hidden></span>
      </div>
      <button class="btn btn-flash btn-lg btn-block" type="submit" id="submit">Save new password ${icon("arrow-right")}</button>
    </form>
    <p class="muted small"><a class="link" href="/signin" data-link>Back to sign in</a></p>`,
  );

  const form = $("#resetForm");
  const pw = $("#password");
  const alertBox = $("#formAlert");

  $("#reveal").addEventListener("click", (e) => {
    const show = pw.type === "password";
    pw.type = show ? "text" : "password";
    e.currentTarget.setAttribute("aria-pressed", String(show));
    e.currentTarget.setAttribute("aria-label", show ? "Hide password" : "Show password");
    e.currentTarget.innerHTML = icon(show ? "eye-off" : "eye").v;
  });
  pw.addEventListener("input", () => clearFieldError(pw));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    alertBox.hidden = true;
    if (pw.value.length < 8) return showFieldError(pw, "Use at least 8 characters.");
    const restore = busy($("#submit"), "Saving…");
    let res;
    try {
      res = await api("/api/auth/password/reset", { method: "POST", body: { token, password: pw.value, pageUrl: pageUrl() } });
    } catch (err) {
      restore();
      if (err.data?.fields?.password) return showFieldError(pw, err.data.fields.password);
      if (err.data?.code === "invalid" || err.data?.code === "expired") return failed(err.message);
      return showAlert(alertBox, err.message);
    }
    state.user = res.user;
    toast("Password changed. You're signed in, and your other devices are signed out.", "success", 7000);
    navigate("/app");
  });
  pw.focus({ preventScroll: true });
}
