import { $, $$, html, raw, icon, api, toast, busy, media, state } from "../core.js";

// Customer results (lib/showcase.js): on the results page, customers can offer
// one headshot, with their first name, job and a few words, for the home page.
// Nothing is shown until we approve it, and they can take it down any time.

const LIMITS = { name: 40, role: 60, quote: 240 };
const STATUS = {
  pending: ["badge-muted", "Waiting for review", "Thank you! We'll take a look soon. It appears on our home page once it's approved."],
  approved: ["badge-success", "On our home page", "Thank you for sharing it. You can take it down at any time."],
  rejected: ["badge-muted", "Not featured", "Thank you for offering it. We aren't featuring this one, and it isn't shown anywhere."],
};
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "";

// The customer's current entry, with a button to take it down. Used on the
// results page and the account page.
export function shareStatus(entry) {
  const [cls, label, text] = STATUS[entry.status] || STATUS.pending;
  return html`<div class="share-status">
    <img src="/showcase/${entry.id}.webp?w=360" alt="The headshot you shared" width="96" height="128" />
    <div>
      <p><span class="badge ${cls}">${label}</span></p>
      <p class="small">${entry.name}${entry.role ? html`, ${entry.role}` : ""}${entry.quote ? html` · <q>${entry.quote}</q>` : ""}</p>
      <p class="small muted">${text}</p>
      <button class="btn btn-ghost btn-sm" type="button" data-share-remove>${icon("trash-2")} Take it down</button>
    </div>
  </div>`;
}

export function wireShareRemove(scope, after) {
  $("[data-share-remove]", scope)?.addEventListener("click", async (e) => {
    const restore = busy(e.currentTarget, "Taking it down…");
    try {
      await api("/api/showcase/mine", { method: "DELETE" });
      toast("Taken down. It disappears from the site within about 10 minutes.", "success");
      after();
    } catch (err) {
      restore();
      toast(err.message, "error");
    }
  });
}

// The results-page panel. `done` is the shoot's finished headshots, best first.
export async function mountShare(slot, s, done, best) {
  if (!slot || s.sample || state.user?.demo || !done.length) return;
  let entry = null;
  try {
    entry = (await api("/api/showcase/mine")).entry;
  } catch {
    return; // Not worth an error on the results page.
  }
  if (!slot.isConnected) return;
  let open = false;
  const paint = () => {
    slot.innerHTML = html`<section class="panel share-panel" aria-labelledby="shareTitle">
      <div class="share-head">
        <span class="ficon">${icon("share-2")}</span>
        <div>
          <h2 class="h-3" id="shareTitle">Share your results?</h2>
          <p class="muted">Happy with your headshots? With your permission, we'd love to show one on our home page, with your first name and a few words about your shoot. We check every one first, and you can take it down at any time.</p>
        </div>
      </div>
      ${entry ? shareStatus(entry) : ""}
      ${open ? form() : html`<div class="btn-row"><button class="btn btn-ghost" type="button" id="shareOpen">${icon("share-2")} ${entry ? "Share a different headshot" : "Share a headshot"}</button></div>`}
    </section>`.v;
    wireShareRemove(slot, () => {
      entry = null;
      paint();
    });
    $("#shareOpen", slot)?.addEventListener("click", () => {
      open = true;
      paint();
      $('input[name="shot"]:checked', slot)?.focus();
    });
    if (open) wireForm();
  };
  const form = () => html`<form class="share-form" id="shareForm" novalidate>
    <fieldset>
      <legend>Which headshot?</legend>
      <div class="share-picks">${done.slice(0, 8).map(
        (t) => html`<label class="share-pick"><input type="radio" name="shot" value="${t.id}" ${t.id === best?.id ? raw("checked") : ""} /><img src="${media(t.file)}" alt="Frame ${String(t.n).padStart(2, "0")}" loading="lazy" /></label>`,
      )}</div>
    </fieldset>
    <div class="share-fields">
      <div class="field"><label for="shareName">Name to show</label><input class="input" id="shareName" name="name" maxlength="${LIMITS.name}" autocomplete="given-name" value="${firstName(state.user?.name)}" required aria-describedby="err-shareName" /><span class="field-error" id="err-shareName" hidden></span></div>
      <div class="field"><label for="shareRole">Job <span class="muted">(optional)</span></label><input class="input" id="shareRole" name="role" maxlength="${LIMITS.role}" autocomplete="organization-title" placeholder="Real estate agent" /></div>
    </div>
    <div class="field"><label for="shareQuote">A few words <span class="muted">(optional)</span></label><textarea class="input share-quote" id="shareQuote" name="quote" rows="3" maxlength="${LIMITS.quote}" placeholder="What did you use your headshots for?"></textarea></div>
    <label class="check"><input type="checkbox" id="shareConsent" /> <span>I give Keeper Headshots permission to show this headshot, with the name, job and words above, on keeperheadshots.com. I can take it down at any time.</span></label>
    <span class="field-error" id="err-shareConsent" role="alert" hidden></span>
    <div class="btn-row">
      <button class="btn btn-flash" type="submit">${icon("send")} Send for review</button>
      <button class="btn btn-ghost" type="button" id="shareCancel">Cancel</button>
    </div>
  </form>`;
  const wireForm = () => {
    const f = $("#shareForm", slot);
    const err = (id, msg) => {
      const el = $(`#err-${id}`, slot);
      el.textContent = msg || "";
      el.hidden = !msg;
    };
    $("#shareCancel", slot).addEventListener("click", () => {
      open = false;
      paint();
      $("#shareOpen", slot)?.focus();
    });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      err("shareName", "");
      err("shareConsent", "");
      const name = f.name.value.trim();
      if (!name) return err("shareName", "Add the name to show with your headshot."), f.name.focus();
      if (!$("#shareConsent", slot).checked) return err("shareConsent", "Tick the box to give your permission."), $("#shareConsent", slot).focus();
      const restore = busy(e.submitter || $("button[type=submit]", f), "Sending…");
      try {
        const r = await api("/api/showcase", { method: "POST", body: { shootId: s.id, shotId: $('input[name="shot"]:checked', f)?.value, name, role: f.role.value, quote: f.quote.value, consent: true } });
        entry = r.entry;
        open = false;
        paint();
        toast("Thank you! We'll review it soon.", "success");
      } catch (e2) {
        restore();
        if (e2.data?.fields?.name) err("shareName", e2.data.fields.name);
        else toast(e2.message, "error");
      }
    });
  };
  paint();
}
