import { $, $$, html, api, state, toast, busy } from "../core.js";

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
    <section class="owner-section" aria-labelledby="shootsTitle">
      <h2 class="display h-3" id="shootsTitle">Customer shoots</h2>
      <p class="small muted">How each shoot went in the same period. Scores are the AI grades (out of 100). Downloads are tracked from 2 Oct 2026.</p>
      <div id="shootsBody" aria-live="polite"><div class="skel" style="height:200px;border-radius:18px"></div></div>
    </section>
    <section class="owner-section panel" aria-labelledby="offerTitle">
      <h2 class="display h-3" id="offerTitle">Follow-up offer</h2>
      <p class="small muted">A one-time email with a discount code to everyone who confirmed their email and hasn't bought, unless they turned reminder emails off. Create the code in Stripe first (Product catalog → Coupons → add a promotion code), then enter it here exactly as it is in Stripe. Each person gets a given code once.</p>
      <form id="offerForm" class="offer-form" novalidate>
        <div class="field"><label for="offerCode">Promotion code</label><input class="input" id="offerCode" name="code" required maxlength="31" placeholder="KEEP30" autocomplete="off" /></div>
        <div class="field"><label for="offerDiscount">Discount</label><input class="input" id="offerDiscount" name="discount" maxlength="40" placeholder="30% off" /></div>
        <div class="field"><label for="offerUntil">Ends</label><input class="input" id="offerUntil" name="until" maxlength="40" placeholder="Sunday 12 Oct" /></div>
        <div class="btn-row"><button class="btn btn-ghost" type="button" id="offerCount">Count recipients</button><button class="btn btn-flash" type="submit">Send offer</button></div>
        <p class="small" id="offerResult" role="status"></p>
      </form>
    </section>
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
      loadShoots();
    });
  }
  const shootsBody = root.querySelector("#shootsBody");
  const when = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  async function loadShoots() {
    let r;
    try {
      r = await api(`/api/owner/shoots?days=${days}`);
    } catch (err) {
      if (!disposed) shootsBody.innerHTML = html`<div class="banner banner-danger"><div><b>Couldn't load shoots.</b> ${err.message}</div></div>`.v;
      return;
    }
    if (disposed) return;
    const m = r.summary;
    shootsBody.innerHTML = html`
      <div class="funnel-sum shoot-sum">
        <div><b>${m.free}</b><span>free shoots</span></div>
        <div><b>${m.freeFinished}</b><span>finished</span></div>
        <div><b>${m.freeWithFailures}</b><span>with failed frames</span></div>
        <div><b>${m.freeAvgBest ?? "—"}</b><span>average best score</span></div>
        <div><b>${m.freeDownloaded}</b><span>downloaded (since 2 Oct)</span></div>
        <div><b>${m.buyers}</b><span>buyers</span></div>
      </div>
      <p class="small muted funnel-scroll-hint">Swipe the table sideways to see every column.</p>
      <div class="panel funnel-table-wrap">
        <table class="funnel-table shoots-table">
          <thead><tr><th scope="col">Day</th><th scope="col">Customer</th><th scope="col">Paid with</th><th scope="col">Status</th><th scope="col">Photo check</th><th scope="col">Frames</th><th scope="col">Failed</th><th scope="col">Retakes</th><th scope="col">Best</th><th scope="col">Average</th><th scope="col">Likeness</th><th scope="col">Minutes</th><th scope="col">Downloaded</th><th scope="col">Bought</th></tr></thead>
          <tbody>
            ${r.shoots.length ? "" : html`<tr><td colspan="14" style="text-align:left">No customer shoots in this period.</td></tr>`}
            ${r.shoots.map((x) => html`<tr>
              <th scope="row">${when(x.createdAt)}</th><td>${x.email}</td><td>${x.paidWith || "—"}${x.preview ? " (preview)" : ""}</td><td>${x.status}${x.reviewError ? " ⚠" : ""}</td>
              <td>${x.checkScore ?? "—"}</td><td>${x.done}/${x.frames}</td><td>${x.failed || ""}</td><td>${x.retakes || ""}</td>
              <td>${x.bestScore ?? "—"}</td><td>${x.avgScore ?? "—"}</td><td>${x.avgLikeness ?? "—"}</td><td>${x.minutes ?? "—"}</td>
              <td>${x.downloaded ? "Yes" : ""}</td><td>${x.bought ? "Yes" : ""}</td></tr>`)}
          </tbody>
        </table>
      </div>`.v;
  }

  // The follow-up offer: count first, then send after a confirmation.
  const form = root.querySelector("#offerForm");
  const result = root.querySelector("#offerResult");
  const fields = () => ({ code: form.code.value.trim().toUpperCase(), discount: form.discount.value.trim(), until: form.until.value.trim() });
  async function offer(send, btn) {
    const f = fields();
    if (!f.code) return void ((result.textContent = "Enter the promotion code first."), form.code.focus());
    const restore = busy(btn, send ? "Sending…" : "Counting…");
    try {
      const r = await api("/api/owner/offer", { method: "POST", body: { ...f, send } });
      result.textContent = send
        ? `Sent ${r.sent} email${r.sent === 1 ? "" : "s"}${r.failed ? `, ${r.failed} failed` : ""}${r.capped ? `. ${r.capped} more are left for another send (at most 60 at a time)` : ""}.`
        : `${r.eligible} ${r.eligible === 1 ? "person" : "people"} would get code ${f.code}${r.capped ? ` (60 now, ${r.capped} in a later send)` : ""}.`;
      if (send) toast("Offer sent.", "success");
      return r;
    } catch (err) {
      result.textContent = err.message;
    } finally {
      restore();
    }
  }
  $("#offerCount", root).addEventListener("click", (e) => offer(false, e.currentTarget));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter || $("button[type=submit]", form);
    const r = await offer(false, btn);
    if (!r?.eligible) return;
    if (!confirm(`Email code ${fields().code} to ${Math.min(r.eligible, 60)} ${r.eligible === 1 ? "person" : "people"}? This can't be undone.`)) return;
    await offer(true, btn);
  });

  load();
  loadShoots();
  return () => (disposed = true);
}
