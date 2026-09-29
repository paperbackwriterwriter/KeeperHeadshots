import { $$, html, api, state } from "../core.js";

// Owner-only: how many people reached each step of the sign-up funnel in the
// last 7, 30 or 90 days (counted by the server as it happens, lib/stats.js).
const STEPS = [
  ["signup", "Signed up"],
  ["verified", "Confirmed their email"],
  ["checked", "Checked their photos"],
  ["developed", "Developed a shoot"],
  ["buyer", "Bought a package"],
];
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const money = (cents) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const shortDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function renderFunnel({ root, navigate }) {
  if (state.user?.plan?.tier !== "owner") return void navigate("/app", { replace: true });
  let days = 30;
  let disposed = false;

  root.innerHTML = html`<main id="main" class="container app-main view-enter funnel-page">
    <div class="page-head">
      <div><p class="eyebrow">Owner</p><h1 class="display h-1" style="margin-top:8px">Sales funnel</h1></div>
      <div class="filters" role="group" aria-label="Period">
        ${[7, 30, 90].map((d) => html`<button type="button" class="filter" data-days="${d}" aria-pressed="${d === days}">Last ${d} days</button>`)}
      </div>
    </div>
    <div id="funnelBody" aria-live="polite"><div class="skel" style="height:320px;border-radius:18px"></div></div>
  </main>`.v;

  const body = root.querySelector("#funnelBody");
  async function load() {
    let r;
    try {
      r = await api(`/api/owner/funnel?days=${days}`);
    } catch (err) {
      if (!disposed) body.innerHTML = html`<div class="banner banner-danger"><div><b>Couldn't load the funnel.</b> ${err.message}</div></div>`.v;
      return;
    }
    if (disposed) return;
    const t = r.totals;
    // Days with nothing happening are left out of the table.
    const active = r.rows.filter((d) => STEPS.some(([k]) => d[k]) || d.purchases);
    const top = Math.max(1, t.signup);
    body.innerHTML = html`
      <section class="panel funnel" aria-label="Funnel, last ${days} days">
        ${STEPS.map(([k, label], i) => {
          const n = t[k];
          const prev = i ? t[STEPS[i - 1][0]] : null;
          // People can buy before developing (or without it), so the last step
          // is measured against sign-ups rather than the step before.
          const buyer = k === "buyer";
          return html`<div class="funnel-row${buyer ? " funnel-row-buy" : ""}">
            <span class="funnel-label">${label}</span>
            <span class="funnel-track"><span class="funnel-bar" style="width:${Math.max(n ? 1.5 : 0, Math.min(100, (n / top) * 100))}%"></span></span>
            <span class="funnel-n">${n}</span>
            <span class="funnel-rate">${buyer ? html`<b>${pct(n, t.signup)}</b><small>of sign-ups</small>` : i ? html`<b>${pct(n, prev)}</b><small>of previous</small>` : html`<b>${n ? "100%" : "—"}</b><small>starting point</small>`}</span>
          </div>`;
        })}
        <div class="funnel-sum">
          <div><b>${t.buyer}</b><span>first-time buyers</span></div>
          <div><b>${t.purchases}</b><span>purchases</span></div>
          <div><b>${money(t.revenue)}</b><span>revenue after discounts</span></div>
          <div><b>${t.purchases ? money(Math.round(t.revenue / t.purchases)) : "—"}</b><span>average order</span></div>
        </div>
      </section>
      <p class="small muted funnel-note">Each person is counted once per step, on the day they reach it, so a period's steps can include people who signed up before it. Demo and owner accounts aren't counted. Days with no activity aren't listed. Counting started on 28 Sep 2026. Visitors are in <a class="link" href="https://vercel.com/christianswebsites/keeperheadshots/analytics" target="_blank" rel="noopener">Vercel Analytics</a>.</p>
      <p class="small muted funnel-scroll-hint">Swipe the table sideways to see every column.</p>
      <div class="panel funnel-table-wrap">
        <table class="funnel-table">
          <thead><tr><th scope="col">Day</th>${STEPS.map(([, l]) => html`<th scope="col">${l.replace(/ (their|a) /, " ")}</th>`)}<th scope="col">Purchases</th><th scope="col">Revenue</th></tr></thead>
          <tbody>
            ${active.length ? "" : html`<tr><td colspan="${STEPS.length + 3}" style="text-align:left">No activity in this period yet.</td></tr>`}
            ${active.map((d) => html`<tr><th scope="row">${shortDate(d.date)}</th>${STEPS.map(([k]) => html`<td>${d[k] || ""}</td>`)}<td>${d.purchases || ""}</td><td>${d.revenue || d.purchases ? money(d.revenue || 0) : ""}</td></tr>`)}
          </tbody>
        </table>
      </div>`.v;
  }

  for (const b of $$(".filter[data-days]", root)) {
    b.addEventListener("click", () => {
      days = Number(b.dataset.days);
      for (const o of $$(".filter[data-days]", root)) o.setAttribute("aria-pressed", String(o === b));
      load();
    });
  }
  load();
  return () => (disposed = true);
}
