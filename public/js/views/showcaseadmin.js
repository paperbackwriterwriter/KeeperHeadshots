import { $, html, icon, api, state, toast, busy } from "../core.js";

// Owner-only: review the headshots customers offered for the home page
// (lib/showcase.js). Only approved ones are shown there.
const STATUS = { pending: ["badge-warn", "Waiting"], approved: ["badge-success", "On the home page"], rejected: ["badge-muted", "Not featured"] };
const date = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");

export function renderShowcaseAdmin({ root, navigate }) {
  if (state.user?.plan?.tier !== "owner") return void navigate("/app", { replace: true });
  let disposed = false;
  root.innerHTML = html`<main id="main" class="container app-main view-enter">
    <div class="page-head"><div><p class="eyebrow">Owner</p><h1 class="display h-1" style="margin-top:8px">Customer results</h1></div></div>
    <p class="muted" style="max-width:64ch">Headshots customers offered for the home page, newest first. Only approved ones are shown, at most six, newest approval first. Customers can take theirs down at any time.</p>
    <div id="scBody" aria-live="polite"><div class="skel" style="height:240px;border-radius:18px;margin-top:24px"></div></div>
  </main>`.v;
  const body = $("#scBody", root);

  async function load() {
    let entries;
    try {
      entries = (await api("/api/owner/showcase")).entries;
    } catch (err) {
      if (!disposed) body.innerHTML = html`<div class="banner banner-danger"><div><b>Couldn't load them.</b> ${err.message}</div></div>`.v;
      return;
    }
    if (disposed) return;
    body.innerHTML = entries.length
      ? html`<div class="sc-list">${entries.map((e) => {
          const [cls, label] = STATUS[e.status] || STATUS.pending;
          return html`<article class="panel sc-item" data-id="${e.id}">
            <img src="/showcase/${e.id}.webp?w=360" alt="Headshot offered by ${e.name}" loading="lazy" />
            <div>
              <p><span class="badge ${cls}">${label}</span></p>
              <p><b>${e.name}</b>${e.role ? html`, ${e.role}` : ""}</p>
              ${e.quote ? html`<p><q>${e.quote}</q></p>` : ""}
              <p class="small muted">${e.email || "Account deleted"} · offered ${date(e.createdAt)}${e.decidedAt ? html` · decided ${date(e.decidedAt)}` : ""}</p>
              <div class="btn-row">
                ${e.status !== "approved" ? html`<button class="btn btn-flash btn-sm" data-act="approved">${icon("check")} Approve</button>` : ""}
                ${e.status !== "rejected" ? html`<button class="btn btn-ghost btn-sm" data-act="rejected">${icon("x")} ${e.status === "approved" ? "Stop showing" : "Don't feature"}</button>` : ""}
                <button class="btn btn-ghost btn-sm" data-act="remove">${icon("trash-2")} Delete</button>
              </div>
            </div>
          </article>`;
        })}</div>`.v
      : html`<div class="panel" style="margin-top:24px"><p class="muted">Nothing offered yet. Customers can offer a headshot from their results page.</p></div>`.v;
  }

  body.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const id = b.closest("[data-id]").dataset.id;
    const act = b.dataset.act;
    if (act === "remove" && !confirm("Delete this entry and its copy of the headshot?")) return;
    const restore = busy(b, "Saving…");
    try {
      await api(`/api/owner/showcase/${id}`, { method: "POST", body: act === "remove" ? { remove: true } : { status: act } });
      toast(act === "approved" ? "Approved. It shows on the home page within a few minutes." : act === "remove" ? "Deleted." : "Saved. It isn't shown.", "success");
      load();
    } catch (err) {
      restore();
      toast(err.message, "error");
    }
  });
  load();
  return () => (disposed = true);
}
