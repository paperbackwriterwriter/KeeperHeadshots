import { $, html, icon, api, state, toast, busy } from "../core.js";
import { stars } from "./review.js";

// Owner-only: the reviews customers sent from /app/review (lib/reviews.js).
// Approve the ones that may be published; decline or delete the rest.
const STATUS = { pending: ["badge-warn", "Waiting"], approved: ["badge-success", "Approved"], rejected: ["badge-muted", "Declined"] };
const date = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");

export function renderReviewsAdmin({ root, navigate }) {
  if (state.user?.plan?.tier !== "owner") return void navigate("/app", { replace: true });
  let disposed = false;
  root.innerHTML = html`<main id="main" class="container app-main view-enter">
    <div class="page-head"><div><p class="eyebrow">Owner</p><h1 class="display h-1" style="margin-top:8px">Customer reviews</h1></div></div>
    <p class="muted" style="max-width:64ch">Ratings and reviews from paying customers, newest first. Each paying customer is asked once by email, at least three days after a shoot of their own finishes. Customers can change or delete theirs at any time; a changed review waits for approval again.</p>
    <div id="rvaBody" aria-live="polite"><div class="skel" style="height:240px;border-radius:18px;margin-top:24px"></div></div>
  </main>`.v;
  const body = $("#rvaBody", root);

  async function load() {
    let list;
    try {
      list = (await api("/api/owner/reviews")).reviews;
    } catch (err) {
      if (disposed) return false;
      const retry = err.status >= 500 || err.status === 0;
      body.innerHTML = html`<div class="banner banner-danger"><div><b>Couldn't load the reviews.</b> ${err.message}</div>${retry ? html`<button class="btn btn-sm btn-ink" type="button" id="rvaRetry">Try again</button>` : ""}</div>`.v;
      $("#rvaRetry", body)?.addEventListener("click", () => navigate(location.pathname + location.search, { replace: true }));
      return false;
    }
    if (disposed) return false;
    const ok = list.filter((r) => r.status === "approved");
    const avg = ok.length ? (ok.reduce((s, r) => s + r.rating, 0) / ok.length).toFixed(1) : null;
    body.innerHTML = list.length
      ? html`<p class="small muted" style="margin-top:16px">${list.length} ${list.length === 1 ? "review" : "reviews"}${avg ? html` · ${ok.length} approved, average ${avg} of 5` : ""}</p>
        <div class="sc-list">${list.map((r) => {
          const [cls, label] = STATUS[r.status] || STATUS.pending;
          // Each button names whose review it acts on (the list has many).
          const whose = `the review from ${r.name || "a customer"}`;
          return html`<article class="panel rva-item" data-id="${r.id}" data-seen="${r.updatedAt || ""}">
            <p><span class="badge ${cls}">${label}</span></p>
            <p>${stars(r.rating)} <b>${r.name}</b></p>
            ${r.text ? html`<p><q>${r.text}</q></p>` : html`<p class="small muted">No written review.</p>`}
            <p class="small muted">${r.email || "Account deleted"} · sent ${date(r.updatedAt || r.createdAt)}${r.decidedAt ? html` · decided ${date(r.decidedAt)}` : ""}</p>
            <div class="btn-row">
              ${r.status !== "approved" ? html`<button class="btn btn-flash btn-sm" data-act="approved" aria-label="Approve ${whose}">${icon("check")} Approve</button>` : ""}
              ${r.status !== "rejected" ? html`<button class="btn btn-ghost btn-sm" data-act="rejected" aria-label="Decline ${whose}">${icon("x")} Decline</button>` : ""}
              <button class="btn btn-ghost btn-sm" data-act="remove" aria-label="Delete ${whose}">${icon("trash-2")} Delete</button>
            </div>
          </article>`;
        })}</div>`.v
      : html`<div class="panel" style="margin-top:24px"><p class="muted">No reviews yet. Paying customers are asked by email three days after a shoot finishes, and can leave one from their account page.</p></div>`.v;
    return true;
  }

  // The list is repainted after each action, which drops focus: put it back on
  // the same review (its next action, or the first), else on the review that
  // took a deleted one's place, else the heading.
  async function reload(id, act, index) {
    const ok = await load();
    if (disposed || (document.activeElement && document.activeElement !== document.body)) return;
    const items = [...body.querySelectorAll(".rva-item")];
    const item = items.find((el) => el.dataset.id === id);
    const target = item
      ? item.querySelector(`[data-act]:not([data-act="${act}"])`) || item.querySelector("[data-act]")
      : ok && items.length
        ? items[Math.min(index, items.length - 1)].querySelector("[data-act]")
        : $("#rvaRetry", body) || $("#main h1", root);
    if (target?.tagName === "H1") target.setAttribute("tabindex", "-1");
    target?.focus();
  }

  body.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const item = b.closest("[data-id]");
    const id = item.dataset.id;
    const index = [...body.querySelectorAll(".rva-item")].indexOf(item);
    const act = b.dataset.act;
    if (act === "remove" && !confirm("Delete this review?")) return;
    const restore = busy(b, "Saving…");
    try {
      await api(`/api/owner/reviews/${id}`, { method: "POST", body: act === "remove" ? { remove: true } : { status: act, seen: b.closest("[data-seen]")?.dataset.seen } });
      toast(act === "approved" ? "Approved." : act === "remove" ? "Deleted." : "Declined.", "success");
      reload(id, act, index);
    } catch (err) {
      restore();
      toast(err.message, "error");
      if (err.status === 409) reload(id, act, index);
    }
  });
  load();
  return () => (disposed = true);
}
