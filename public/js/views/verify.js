import { html, icon, api, state, busy } from "../core.js";
import { pixel, pageUrl } from "../pixel.js";

// Landing page for the link in the "Confirm your email" message. Confirming
// takes a button press: mail scanners open links (some run the page's
// script too), and opening the link mustn't confirm an address for someone
// who doesn't own the inbox.
export async function renderVerify({ root, navigate }) {
  const token = state.linkToken || new URLSearchParams(location.search).get("token") || "";
  state.linkToken = null;
  // What this page showed after the link worked, kept on its history entry
  // for the Back button (below).
  const before = history.state?.verified;
  // Keep the token out of the address bar and browser history.
  history.replaceState(before ? { verified: before } : {}, "", "/verify");
  // Coming back here (Back button) after the link was used: the token is gone
  // from the address, so there's nothing to confirm. Signed in and confirmed
  // means it worked; go on to the shoots.
  if (!token && state.user?.emailVerified) return void navigate("/app", { replace: true });

  const shell = (body) => (root.innerHTML = html`<main id="main" class="container app-main view-enter verify-page"><div class="verify-card">${body}</div></main>`.v);
  const fail = (err) => {
    const expired = err.data?.code === "expired";
    // (Only for the account the link is for: the server says whether that's who is signed in.)
    const canResend = expired ? !!err.data?.signedIn : !!state.user && !state.user.emailVerified;
    shell(html`
      <div class="verify-icon verify-icon-warn">${icon("circle-alert")}</div>
      <h1 class="display h-2">${expired ? "This link has expired." : "We couldn't confirm that link."}</h1>
      <p class="lede">${err.message}</p>
      <div class="verify-actions">
        ${canResend
          ? html`<button class="btn btn-flash btn-lg" data-resend-verify type="button">${icon("mail")} Send a new link</button>`
          : html`<a class="btn btn-flash btn-lg" href="/signin?next=/app" data-link>Sign in to get a new link</a>`}
        <a class="btn btn-ghost btn-lg" href="/contact?topic=general" data-link>Contact us</a>
      </div>`);
  };
  // Back to this page after the link worked (signed out, or as someone else):
  // show that result again rather than a missing-link error.
  if (!token && before) return void (before.status === "secured" ? secured(before) : done(before));
  if (!token) return fail(Object.assign(new Error("This page needs the link from your confirmation email."), { data: {} }));

  shell(html`<div class="verify-icon">${icon("mail")}</div><h1 class="display h-2">Confirm your email</h1>
    <p class="lede">One click and your address is confirmed.</p>
    <div class="verify-actions"><button class="btn btn-flash btn-lg" type="button" id="confirmEmail">${icon("mail-check")} Confirm my email</button></div>`);
  const btn = root.querySelector("#confirmEmail");
  btn.focus();
  btn.addEventListener("click", () => send(btn, "Confirming…"));

  async function send(button, label, created) {
    const restore = busy(button, label);
    let res;
    try {
      res = await api("/api/auth/verify", { method: "POST", body: { token, pageUrl: pageUrl(), ...(created === undefined ? {} : { created }) } });
    } catch (err) {
      restore();
      return fail(err);
    }
    if (res.status === "ask") return ask(res.purges);
    history.replaceState({ verified: { status: res.status, email: res.email, purged: res.purged } }, "", "/verify");
    if (res.status === "secured") return secured(res);
    done(res);
  }

  // Opened in a browser that didn't make the account (server.js): whoever
  // signed up with this address may not be the inbox's owner.
  function ask(purges) {
    shell(html`<div class="verify-icon">${icon("circle-help")}</div><h1 class="display h-2">Did you create this account?</h1>
      <p class="lede">Someone signed up for Keeper Headshots with this email address. If it was you, on another phone or computer, confirm it. If it wasn't, the account becomes yours: we sign out whoever made it and remove their password${purges ? ", and delete the selfies and unfinished shoots they added (finished headshots stay)" : ""}.</p>
      <div class="verify-actions">
        <button class="btn btn-flash btn-lg" type="button" id="createdYes">${icon("mail-check")} Yes, I created it</button>
        <button class="btn btn-ghost btn-lg" type="button" id="createdNo">No, it wasn't me</button>
      </div>`);
    const yes = root.querySelector("#createdYes");
    const no = root.querySelector("#createdNo");
    root.querySelector("h1").setAttribute("tabindex", "-1");
    root.querySelector("h1").focus();
    yes.addEventListener("click", () => send(yes, "Confirming…", true));
    no.addEventListener("click", () => send(no, "Securing…", false));
  }

  function secured(res) {
    if (res.eventId) pixel("CompleteRegistration", {}, res.eventId);
    // This browser was signed in to the account: it's signed out too (the header follows).
    if (res.signedOut) document.dispatchEvent(new Event("ahg:signed-out"));
    shell(html`
      <div class="verify-icon verify-icon-ok">${icon("shield-check")}</div>
      <h1 class="display h-2">The account is yours now.</h1>
      <p class="lede">Your email is confirmed. Whoever made the account has been signed out and their password removed${res.purged ? ", and the selfies and unfinished shoots they added deleted" : ""}. Set your own password to sign in.</p>
      <div class="verify-actions">
        <a class="btn btn-flash btn-lg" href="/forgot-password?email=${encodeURIComponent(res.email || "")}" data-link>${icon("lock")} Set a password ${icon("arrow-right")}</a>
      </div>`);
  }

  function done(res) {
    if (res.user) state.user = res.user;
    if (res.status === "verified" && res.eventId) pixel("CompleteRegistration", {}, res.eventId);
    const free = state.user?.plan?.freeShootAvailable;
    shell(html`
      <div class="verify-icon verify-icon-ok">${icon("mail-check")}</div>
      <h1 class="display h-2">${res.status === "verified" ? "Email confirmed." : "You're already confirmed."}</h1>
      <p class="lede">${free ? "Your free preview shoot is unlocked: up to 2 looks and 4 headshots, each checked for likeness before you see it." : "Thanks for confirming your email address."}</p>
      <div class="verify-actions">
        ${state.user
          ? html`<a class="btn btn-flash btn-lg" href="${free ? "/app/new" : "/app"}" data-link>${free ? "Start your free shoot" : "Go to your shoots"} ${icon("arrow-right")}</a>`
          : html`<a class="btn btn-flash btn-lg" href="/signin?next=/app/new" data-link>Sign in to start ${icon("arrow-right")}</a>`}
      </div>`);
  }
}
