import { html, icon, api, state, busy, spinner, toast } from "../core.js";

// /join: the page a team invitation links to (/join/<token>; app.js moves the
// token out of the address before anything else loads). Shows who invited you
// and to which team; signing in (or up) with the invited address and
// accepting creates your paid team shoot.
const savedToken = () => {
  try {
    return sessionStorage.getItem("ahg-join") || state.joinToken || "";
  } catch {
    return state.joinToken || "";
  }
};
const forgetToken = () => {
  try {
    sessionStorage.removeItem("ahg-join");
  } catch {}
  state.joinToken = null;
};

export async function renderJoin({ root, navigate }) {
  const token = savedToken();
  const shell = (body) => (root.innerHTML = html`<main id="main" class="container app-main view-enter"><div class="join-card">${body}</div></main>`.v);
  if (!token) {
    shell(html`<p class="eyebrow">Team invitation</p><h1 class="display h-2">Open the link from your invitation email.</h1><p class="lede">This page needs the link your team admin sent you. If it doesn't work, ask them for a new one.</p><a class="btn btn-ink" href="/" data-link>Go to Keeper Headshots</a>`);
    return;
  }
  shell(html`<div style="display:flex;justify-content:center">${spinner()}</div>`);
  let inv;
  try {
    inv = await api(`/api/join/${encodeURIComponent(token)}`);
  } catch (err) {
    shell(html`<p class="eyebrow">Team invitation</p><h1 class="display h-2">This invitation doesn't work.</h1><p class="lede">${err.message}</p><a class="btn btn-ink" href="/" data-link>Go to Keeper Headshots</a>`);
    return;
  }
  if (inv.mine) {
    forgetToken();
    return void navigate(`/app/shoot/${inv.mine}`, { replace: true });
  }

  const here = "/join";
  const me = state.user;
  const sameEmail = me && me.email.toLowerCase() === inv.email;
  const intro = html`<p class="eyebrow">${icon("users")} Team invitation</p>
    <h1 class="display h-2">${inv.team.ownerName} invited you to get your ${inv.team.name} headshot.</h1>
    <p class="lede">Your shoot is already paid for and set to the team's look, so everyone matches. Upload a few recent photos of just you, and your headshots are ready in minutes.</p>
    <div class="join-looks">${inv.team.looks.map((l) => html`<span class="chip">${l}</span>`)}</div>
    <p class="small muted">Your photos stay private. ${inv.team.ownerName} will see and can download your finished headshots.</p>`;

  if (inv.status !== "invited") {
    shell(html`${intro}<div class="banner banner-warn">${icon("info")}<div>This invitation has already been used or cancelled. If that wasn't you, ask ${inv.team.ownerName} for a new one.</div></div>`);
    return;
  }
  if (!me) {
    const q = `?next=${encodeURIComponent(here)}&email=${encodeURIComponent(inv.email)}`;
    shell(html`${intro}<p>Sent to <b>${inv.email}</b>. Use that address to continue.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center"><a class="btn btn-flash btn-lg" href="/signup${q}" data-link>Create my account ${icon("arrow-right")}</a><a class="btn btn-ghost btn-lg" href="/signin${q}" data-link>I have an account</a></div>`);
    return;
  }
  if (!sameEmail) {
    shell(html`${intro}<div class="banner banner-warn">${icon("info")}<div>This invitation was sent to <b>${inv.email}</b>, but you're signed in as ${me.email}. Sign out, then sign in or create an account with ${inv.email}.</div></div>`);
    return;
  }
  shell(html`${intro}<button class="btn btn-flash btn-lg" id="accept">Start my headshot ${icon("arrow-right")}</button>`);
  root.querySelector("#accept").addEventListener("click", async (e) => {
    const restore = busy(e.currentTarget, "Setting up…");
    try {
      const r = await api(`/api/join/${encodeURIComponent(token)}`, { method: "POST" });
      state.user = r.user;
      forgetToken();
      toast(`Welcome to ${inv.team.name}. Add a few photos to start.`, "success");
      navigate(`/app/shoot/${r.shootId}`);
    } catch (err) {
      restore();
      toast(err.message, "error", 7000);
    }
  });
}
