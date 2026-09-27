import { $, $$, html, icon, logoMark, wordmark, api, state, toast, busy } from "../core.js";
import { portraitDataURL } from "../shared/portrait.js";
import { BACKDROPS, OUTFITS } from "../shared/catalog.js";

const DEMO = { email: "demo@keeperheadshots.com", password: "studio-demo" };

export function renderAuth({ root, navigate }, mode) {
  const isUp = mode === "signup";
  const next = new URLSearchParams(location.search).get("next");
  const dest = next && next.startsWith("/app") ? next : isUp ? "/app/new" : "/app";

  const mosaic = Array.from({ length: 16 }, (_, i) =>
    portraitDataURL("auth" + i, { backdrop: BACKDROPS[i % BACKDROPS.length].id, outfit: OUTFITS[(i * 5) % OUTFITS.length].id }),
  );

  root.innerHTML = html`
  <main id="main" class="auth">
    <div class="auth-form-wrap">
      <a class="logo" href="/" data-link aria-label="Keeper Headshots home">${logoMark()}${wordmark()}</a>
      <div class="auth-form view-enter">
        <p class="eyebrow"><span class="dot"></span>${isUp ? "Step 1 of 3" : "Welcome back"}</p>
        <h1 class="display h-2">${isUp ? "Create your account" : "Sign in to your studio"}</h1>
        <p class="muted">${isUp ? "Your shoots, photo checks and proofs are saved here." : "Pick up where you left off — your proofs are waiting."}</p>
        <form class="form" id="authForm" novalidate>
          <div class="form-alert" id="formAlert" role="alert" hidden></div>
          ${isUp
            ? html`<div class="field"><label for="name">Full name</label><input class="input" id="name" name="name" autocomplete="name" placeholder="Maya Okafor" required /><span class="field-error" id="err-name" hidden></span></div>`
            : ""}
          <div class="field"><label for="email">Email</label><input class="input" id="email" name="email" type="email" autocomplete="email" inputmode="email" placeholder="you@company.com" required /><span class="field-error" id="err-email" hidden></span></div>
          <div class="field">
            <label for="password">Password</label>
            <div class="input-wrap">
              <input class="input" id="password" name="password" type="password" autocomplete="${isUp ? "new-password" : "current-password"}" placeholder="${isUp ? "At least 8 characters" : "Your password"}" required minlength="${isUp ? 8 : 1}" style="padding-right:52px" />
              <button type="button" class="reveal" id="reveal" aria-label="Show password" aria-pressed="false">${icon("eye")}</button>
            </div>
            <span class="field-error" id="err-password" hidden></span>
          </div>
          <button class="btn btn-flash btn-lg btn-block" type="submit" id="submit">${isUp ? "Create account" : "Sign in"} ${icon("arrow-right")}</button>
        </form>
        <p class="muted small" style="margin-top:20px;text-align:center">
          ${isUp ? "Already have an account?" : "New to Keeper Headshots?"}
          <a class="link" href="${isUp ? "/signin" : "/signup"}${next ? `?next=${encodeURIComponent(next)}` : ""}" data-link>${isUp ? "Sign in" : "Create an account"}</a>
        </p>
        ${!isUp
          ? html`<div class="demo-box"><div><b>Just looking?</b><div class="muted">Explore a demo account with sample shoots.</div></div><button class="btn btn-ghost btn-sm" id="demo" type="button">Use demo</button></div>`
          : html`<p class="field-hint" style="margin-top:20px;text-align:center">${icon("lock")} Your photos are private and never used to train AI.</p>`}
      </div>
    </div>
    <aside class="auth-side" aria-hidden="true">
      <div class="auth-mosaic">${mosaic.map((src) => html`<img src="${src}" alt="" />`)}</div>
      <span class="stars" style="color:#d2a85c">${[1, 2, 3, 4, 5].map(() => icon("star"))}</span>
      <p class="display h-2" style="margin:16px 0 12px;max-width:18ch">“Four selfies at lunch. New LinkedIn photo by 2 p.m.”</p>
      <p style="color:#a9b1bd">Daniel R., product lead, fintech</p>
    </aside>
  </main>`.v;

  const form = $("#authForm");
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

  async function submit(data) {
    alertBox.hidden = true;
    const fields = validate(data);
    setErrors(fields);
    if (Object.keys(fields).length) {
      $(`#${Object.keys(fields)[0]}`).focus();
      return;
    }
    const restore = busy($("#submit"), isUp ? "Creating account…" : "Signing in…");
    try {
      const res = await api(`/api/auth/${isUp ? "signup" : "signin"}`, { method: "POST", body: data });
      state.user = res.user;
      toast(isUp ? `Welcome, ${res.user.name.split(" ")[0]}. Let's make some headshots.` : `Welcome back, ${res.user.name.split(" ")[0]}.`, "success");
      navigate(dest);
    } catch (err) {
      restore();
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
  $("#demo")?.addEventListener("click", () => {
    $("#email").value = DEMO.email;
    pw.value = DEMO.password;
    submit(DEMO);
  });
  (isUp ? $("#name") : $("#email")).focus({ preventScroll: true });
}
