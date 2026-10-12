import { $, $$, html, raw, icon, logoMark, wordmark, api, state, toast, busy, example, safeNext } from "../core.js";

import { mountTurnstile } from "../turnstile.js";

const DEMO = { email: "demo@keeperheadshots.com", password: "studio-demo" };

// Google refuses sign-in inside apps' built-in browsers (Facebook, Instagram,
// TikTok…), so the button only shows in a real browser.
const IN_APP = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Line\/|MicroMessenger|TikTok|musical_ly|BytedanceWebview|Snapchat|LinkedInApp|; wv\)/i;
const GOOGLE_G = raw(`<svg class="google-g" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`);
// What /api/auth/google/callback sends back with when it couldn't sign in.
const GOOGLE_ERRORS = {
  cancelled: "Google sign-in was cancelled. Try again, or use your email below.",
  expired: "That took too long, or Google opened in a different browser. Please try again.",
  failed: "We couldn't sign you in with Google. Please try again, or use your email below.",
};

export function renderAuth({ root, navigate }, mode) {
  const isUp = mode === "signup";
  const params = new URLSearchParams(location.search);
  const next = safeNext(params.get("next"));
  const dest = next || (isUp ? "/app/new" : "/app");
  // A team invitation links here with the invited address filled in.
  const prefill = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(params.get("email") || "") ? params.get("email") : "";
  const showGoogle = state.google && !IN_APP.test(navigator.userAgent);
  const googleError = GOOGLE_ERRORS[params.get("google")];
  if (params.has("google")) {
    params.delete("google");
    history.replaceState(history.state, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
  }
  const googleHref = `/api/auth/google?mode=${isUp ? "signup" : "signin"}${next ? `&next=${encodeURIComponent(next)}` : ""}`;

  const mosaic = ["strip-1", "hero-2", "strip-2", "rv-2", "strip-3", "hero-4", "strip-4", "rv-3", "hero-7", "strip-5", "hero-1", "strip-6", "rv-1", "strip-7", "hero-6", "hero-9"].map((id) => example(id, 360));

  root.innerHTML = html`
  <main id="main" class="auth">
    <div class="auth-form-wrap">
      <a class="logo" href="/" data-link>${logoMark()}${wordmark()}</a>
      <div class="auth-form view-enter">
        <p class="eyebrow"><span class="dot"></span>${isUp ? "Step 1 of 3" : "Welcome back"}</p>
        <h1 class="display h-2">${isUp ? "Create your account" : "Sign in to your studio"}</h1>
        <p class="muted">${isUp ? "Your shoots, photo checks and proofs are saved here." : "Pick up where you left off — your proofs are waiting."}</p>
        ${showGoogle
          ? html`<a class="btn btn-google btn-lg btn-block" href="${googleHref}" id="googleBtn">${GOOGLE_G} Continue with Google</a>
        <div class="auth-or" role="separator"><span>or use your email</span></div>`
          : ""}
        <form class="form" id="authForm" novalidate>
          <div class="form-alert" id="formAlert" role="alert" ${googleError ? "" : raw("hidden")}>${googleError ? html`${icon("circle-alert")}<span>${googleError}</span>` : ""}</div>
          ${isUp
            ? html`<div class="field"><label for="name">Full name</label><input class="input" id="name" name="name" autocomplete="name" placeholder="Maya Okafor" required /><span class="field-error" id="err-name" hidden></span></div>`
            : ""}
          <div class="field"><label for="email">Email</label><input class="input" id="email" name="email" type="email" autocomplete="email" inputmode="email" placeholder="you@company.com" value="${prefill}" required /><span class="field-error" id="err-email" hidden></span></div>
          <div class="field">
            ${isUp
              ? html`<label for="password">Password</label>`
              : html`<div class="label-row"><label for="password">Password</label><a class="link small" href="/forgot-password" data-link id="forgotLink">Forgot password?</a></div>`}
            <div class="input-wrap">
              <input class="input" id="password" name="password" type="password" autocomplete="${isUp ? "new-password" : "current-password"}" placeholder="${isUp ? "At least 8 characters" : "Your password"}" required minlength="${isUp ? 8 : 1}" style="padding-right:52px" />
              <button type="button" class="reveal" id="reveal" aria-label="Show password" aria-pressed="false">${icon("eye")}</button>
            </div>
            <span class="field-error" id="err-password" hidden></span>
          </div>
          ${isUp ? html`<div class="turnstile-slot" id="botCheck"></div>` : ""}
          <button class="btn btn-flash btn-lg btn-block" type="submit" id="submit">${isUp ? "Create account" : "Sign in"} ${icon("arrow-right")}</button>
        </form>
        <p class="muted small" style="margin-top:20px;text-align:center">
          ${isUp ? "Already have an account?" : "New to Keeper Headshots?"}
          <a class="link" href="${isUp ? "/signin" : "/signup"}${next ? `?next=${encodeURIComponent(next)}` : ""}" data-link>${isUp ? "Sign in" : "Create an account"}</a>
        </p>
        ${!isUp
          ? html`<div class="demo-box"><div><b>Just looking?</b><div class="muted">Explore a demo account with sample shoots.</div></div><button class="btn btn-ghost btn-sm" id="demo" type="button">Use demo</button></div>`
          : html`<p class="field-hint" style="margin-top:20px;display:flex;justify-content:center;align-items:center;gap:6px">${icon("lock")} Your photos are private and never used to train AI.</p>
            <p class="field-hint" style="margin-top:8px;text-align:center">By creating an account, you agree to our <a class="link" href="/terms" data-link>Terms</a> and <a class="link" href="/privacy" data-link>Privacy Policy</a>.</p>`}
      </div>
    </div>
    <aside class="auth-side" aria-hidden="true">
      <div class="auth-mosaic">${mosaic.map((src, i) => html`<img src="${src}" alt="" loading="${i < 6 ? "eager" : "lazy"}" decoding="async" />`)}</div>
      <p class="display h-2" style="margin:0 0 12px;max-width:18ch">Headshots worth keeping.</p>
      <p style="color:#a9b1bd;max-width:44ch">Every headshot is checked against your own photos for likeness and polish before you see it.</p>
    </aside>
  </main>`.v;

  const form = $("#authForm");
  // Bot check on sign-up (Cloudflare Turnstile), when configured.
  const human = isUp ? mountTurnstile($("#botCheck"), { action: "signup" }) : null;
  const alertBox = $("#formAlert");
  const pw = $("#password");

  $("#reveal").addEventListener("click", (e) => {
    const show = pw.type === "password";
    pw.type = show ? "text" : "password";
    e.currentTarget.setAttribute("aria-pressed", String(show));
    e.currentTarget.setAttribute("aria-label", show ? "Hide password" : "Show password");
    e.currentTarget.innerHTML = icon(show ? "eye-off" : "eye").v;
  });

  const setErrors = (fields = {}) => {
    $$(".field-error", form).forEach((el) => {
      const key = el.id.replace("err-", "");
      const input = $(`#${key}`);
      if (fields[key]) {
        el.innerHTML = `${icon("circle-alert").v}${fields[key].replace(/</g, "&lt;")}`;
        el.hidden = false;
        input.setAttribute("aria-invalid", "true");
        input.setAttribute("aria-describedby", el.id);
      } else {
        el.hidden = true;
        input.removeAttribute("aria-invalid");
        input.removeAttribute("aria-describedby");
      }
    });
  };

  const validate = (d) => {
    const f = {};
    if (isUp && (!d.name || d.name.trim().length < 2)) f.name = "Tell us what to call you.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email || "")) f.email = "Enter a valid email address.";
    if (!d.password) f.password = "Enter your password.";
    else if (isUp && d.password.length < 8) f.password = "Use at least 8 characters.";
    return f;
  };

  // One request at a time, whichever button started it (the demo button
  // isn't the one disabled while busy).
  let inFlight = false;
  async function submit(data) {
    if (inFlight) return;
    alertBox.hidden = true;
    const fields = validate(data);
    setErrors(fields);
    if (Object.keys(fields).length) {
      $(`#${Object.keys(fields)[0]}`).focus();
      return;
    }
    inFlight = true;
    const done = busy($("#submit"), isUp ? "Creating account…" : "Signing in…");
    const restore = () => ((inFlight = false), done());
    try {
      if (human) data = { ...data, turnstileToken: await human.token() };
      const res = await api(`/api/auth/${isUp ? "signup" : "signin"}`, { method: "POST", body: data });
      state.user = res.user;
      const first = res.user.name.split(" ")[0];
      if (!isUp) toast(`Welcome back, ${first}.`, "success");
      else if (res.user.plan?.needsEmail && dest !== "/join") {
        if (res.verificationSent === true) toast(`Welcome, ${first}. We emailed a 6-digit code to ${res.user.email}: enter it to unlock your free shoot.`, "success", 9000);
        else toast("Your account is ready, but we couldn't send the confirmation email. Request another from your studio in a minute, or contact us for help.", "error", 9000);
      }
      else toast(`Welcome, ${first}. Let's make some headshots.`, "success");
      navigate(dest);
    } catch (err) {
      restore();
      human?.reset(); // tokens are single-use
      if (err.data?.fields) setErrors(err.data.fields);
      alertBox.innerHTML = `${icon("circle-alert").v}<span>${err.message.replace(/</g, "&lt;")}</span>`;
      alertBox.hidden = false;
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submit(Object.fromEntries(new FormData(form)));
  });
  form.addEventListener("input", (e) => {
    if (e.target.getAttribute("aria-invalid")) {
      e.target.removeAttribute("aria-invalid");
      $(`#err-${e.target.id}`).hidden = true;
    }
  });
  // Carry the typed email over to the reset page.
  $("#forgotLink")?.addEventListener("click", (e) => {
    const address = $("#email").value.trim();
    if (address) e.currentTarget.href = `/forgot-password?email=${encodeURIComponent(address)}`;
  });
  $("#demo")?.addEventListener("click", () => {
    $("#email").value = DEMO.email;
    pw.value = DEMO.password;
    submit(DEMO);
  });
  (isUp ? $("#name") : $("#email")).focus({ preventScroll: true });
  return () => human?.remove();
}
