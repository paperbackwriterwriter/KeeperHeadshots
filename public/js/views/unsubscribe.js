import { html, icon, api, busy, logoMark, wordmark } from "../core.js";

// /unsubscribe?token=… : the link at the foot of every reminder email
// (lib/reminders.js). Turns reminder emails off for that account; account
// emails (confirmations, password resets) still arrive. The page asks for a
// click first: mail scanners open links, and opening one mustn't unsubscribe
// anyone (a mail app's own unsubscribe button posts straight to the API).
export async function renderUnsubscribe({ root }) {
  const token = new URLSearchParams(location.search).get("token") || "";
  history.replaceState({}, "", "/unsubscribe"); // keep the token out of history
  const shell = (body) => (root.innerHTML = html`<main id="main" class="container app-main view-enter verify-page auth-lite"><a class="logo" href="/" data-link>${logoMark()}${wordmark()}</a><div class="verify-card reset-card">${body}</div></main>`.v);
  if (!token) {
    shell(html`<div class="verify-icon">${icon("mail")}</div><h1 class="display h-2">Reminder emails</h1><p class="lede">Use the link at the bottom of a reminder email, or turn reminders off on your account page.</p><div class="verify-actions"><a class="btn btn-flash btn-lg" href="/app/account" data-link>Go to my account</a></div>`);
    return;
  }
  shell(html`<div class="verify-icon">${icon("mail")}</div><h1 class="display h-2">Stop reminder and offer emails?</h1><p class="lede">Emails about your account, like password resets, still arrive. You can turn reminders back on from your account page at any time.</p><div class="verify-actions"><button type="button" class="btn btn-flash btn-lg" id="stopEmails">Stop these emails</button><a class="btn btn-ghost btn-lg" href="/app/account" data-link>Keep them</a></div>`);
  root.querySelector("#stopEmails").addEventListener("click", async (e) => {
    const restore = busy(e.currentTarget, "Stopping…");
    try {
      await api("/api/unsubscribe", { method: "POST", body: { token } });
      shell(html`<div class="verify-icon">${icon("check")}</div><h1 class="display h-2">You're unsubscribed.</h1><p class="lede">We won't send you reminder or offer emails. Emails about your account, like password resets, still arrive. Changed your mind? Turn reminders back on from your account page.</p><div class="verify-actions"><a class="btn btn-flash btn-lg" href="/app" data-link>Go to my shoots</a><a class="btn btn-ghost btn-lg" href="/app/account" data-link>Account settings</a></div>`);
    } catch (err) {
      restore();
      shell(html`<div class="verify-icon verify-icon-warn">${icon("circle-alert")}</div><h1 class="display h-2">We couldn't use that link.</h1><p class="lede">${err.message}</p><div class="verify-actions"><a class="btn btn-flash btn-lg" href="/app/account" data-link>Go to my account</a></div>`);
    }
  });
}
