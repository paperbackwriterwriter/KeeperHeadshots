import { html, icon, api, state, spinner } from "../core.js";
import { pixel, pageUrl } from "../pixel.js";

// Landing page for the link in the "Confirm your email" message.
export async function renderVerify({ root, navigate }) {
  const token = state.linkToken || new URLSearchParams(location.search).get("token") || "";
  state.linkToken = null;
  // Keep the token out of the address bar and browser history.
  history.replaceState({}, "", "/verify");
  // Coming back here (Back button) after the link was used: the token is gone
  // from the address, so there's nothing to confirm. Signed in and confirmed
  // means it worked; go on to the shoots.
  if (!token && state.user?.emailVerified) return void navigate("/app", { replace: true });

  const shell = (body) => (root.innerHTML = html`<main id="main" class="container app-main view-enter verify-page"><div class="verify-card">${body}</div></main>`.v);
  shell(html`<div class="verify-icon">${spinner()}</div><h1 class="display h-2">Confirming your email…</h1>`);

  let res;
  try {
    if (!token) throw Object.assign(new Error("This page needs the link from your confirmation email."), { data: {} });
    res = await api("/api/auth/verify", { method: "POST", body: { token, pageUrl: pageUrl() } });
  } catch (err) {
    const expired = err.data?.code === "expired";
    const canResend = expired ? err.data?.signedIn || !!state.user : !!state.user && !state.user.emailVerified;
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
    return;
  }

  if (res.user) state.user = res.user;
  if (res.status === "verified") pixel("CompleteRegistration", {}, res.eventId);
  const free = state.user?.plan?.freeShootAvailable;
  shell(html`
    <div class="verify-icon verify-icon-ok">${icon("mail-check")}</div>
    <h1 class="display h-2">${res.status === "verified" ? "Email confirmed." : "You're already confirmed."}</h1>
    <p class="lede">${free ? "Your free shoot is unlocked: up to 2 looks and 4 headshots, each checked for likeness before you see it." : "Thanks for confirming your email address."}</p>
    <div class="verify-actions">
      ${state.user
        ? html`<a class="btn btn-flash btn-lg" href="${free ? "/app/new" : "/app"}" data-link>${free ? "Start your free shoot" : "Go to your shoots"} ${icon("arrow-right")}</a>`
        : html`<a class="btn btn-flash btn-lg" href="/signin?next=/app/new" data-link>Sign in to start ${icon("arrow-right")}</a>`}
    </div>`);
}
