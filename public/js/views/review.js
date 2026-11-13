import { $, $$, html, raw, icon, api, toast, busy, state } from "../core.js";

// /app/review: a paying customer rates the site (1 to 5 stars) and writes a
// few words (lib/reviews.js). One review per account; sending it again
// replaces it. Nothing is treated as public until we approve it.

const LIMITS = { name: 40, text: 600 };
const STATUS = {
  pending: ["badge-muted", "Waiting for approval", "Thank you! We read every review and will take a look at yours soon."],
  approved: ["badge-success", "Approved", "Thank you for your review. You can change or delete it at any time."],
  rejected: ["badge-muted", "Not published", "Thank you for telling us. This review isn't shown anywhere."],
};
const WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "";
export const stars = (n) => html`<span class="stars-shown" role="img" aria-label="${n} of 5 stars">${"★".repeat(n)}<span class="stars-off">${"★".repeat(5 - n)}</span></span>`;

export function renderReview({ root }) {
  let disposed = false;
  root.innerHTML = html`<main id="main" class="container app-main view-enter">
    <div class="page-head"><div><p class="eyebrow">Your review</p><h1 class="display h-1" style="margin-top:8px">How did your headshots turn out?</h1></div></div>
    <p class="muted" style="max-width:64ch">Rate Keeper Headshots and say a few words. Honest feedback helps other people decide, and helps us improve.</p>
    <div id="rvBody" aria-live="polite"><div class="skel" style="height:240px;border-radius:18px;margin-top:24px"></div></div>
  </main>`.v;
  const body = $("#rvBody", root);

  const paint = ({ eligible, review }) => {
    if (!eligible && !review) {
      body.innerHTML = html`<div class="panel" style="margin-top:24px"><p>Reviews are for customers who have bought a package or a headshot.</p><div class="btn-row" style="margin-top:12px"><a class="btn btn-ghost" href="/app" data-link>Back to your shoots</a></div></div>`.v;
      return;
    }
    const [cls, label, text] = review ? STATUS[review.status] || STATUS.pending : [];
    body.innerHTML = html`<section class="panel review-panel" style="margin-top:24px">
      ${review
        ? html`<div class="review-current"><p><span class="badge ${cls}">${label}</span></p><p>${stars(review.rating)} <b>${review.name}</b></p>${review.text ? html`<p><q>${review.text}</q></p>` : ""}<p class="small muted">${text}</p></div>`
        : ""}
      ${eligible
        ? html`<form class="review-form" id="rvForm" novalidate>
        <fieldset class="stars" aria-describedby="err-rvRating">
          <legend>${review ? "Change your rating" : "Your rating"}</legend>
          <div class="stars-row">${[1, 2, 3, 4, 5].map((n) => html`<input type="radio" name="rating" id="rvStar${n}" value="${n}" ${review?.rating === n ? raw("checked") : ""} /><label for="rvStar${n}" data-n="${n}"><span aria-hidden="true">★</span><span class="sr-only">${n} ${n === 1 ? "star" : "stars"}: ${WORDS[n]}</span></label>`)}</div>
          <p class="small muted" id="rvWord" aria-hidden="true">${review ? WORDS[review.rating] : "Choose 1 to 5 stars."}</p>
        </fieldset>
        <span class="field-error" id="err-rvRating" role="alert" hidden></span>
        <div class="field"><label for="rvText">Your review <span class="muted">(optional)</span></label><textarea class="input" id="rvText" name="text" rows="5" maxlength="${LIMITS.text}" placeholder="What did you use your headshots for? What stood out?" aria-describedby="err-rvText">${review?.text || ""}</textarea><span class="field-error" id="err-rvText" hidden></span></div>
        <div class="field" style="max-width:320px"><label for="rvName">Name to show</label><input class="input" id="rvName" name="name" maxlength="${LIMITS.name}" autocomplete="given-name" value="${review?.name || firstName(state.user?.name)}" required aria-describedby="err-rvName" /><span class="field-error" id="err-rvName" hidden></span></div>
        <label class="check"><input type="checkbox" id="rvConsent" /> <span>I give Keeper Headshots permission to show this review, with the name above, on keeperheadshots.com. I can delete it at any time.</span></label>
        <span class="field-error" id="err-rvConsent" role="alert" hidden></span>
        <div class="btn-row">
          <button class="btn btn-flash" type="submit">${icon("send")} ${review ? "Send the new review" : "Send review"}</button>
          ${review ? html`<button class="btn btn-ghost" type="button" id="rvDelete">${icon("trash-2")} Delete my review</button>` : ""}
        </div>
      </form>`
        : html`<div class="btn-row"><button class="btn btn-ghost" type="button" id="rvDelete">${icon("trash-2")} Delete my review</button></div>`}
    </section>`.v;
    wire({ eligible, review });
  };

  const wire = (data) => {
    const f = $("#rvForm", body);
    const err = (id, msg) => {
      const el = $(`#err-${id}`, body);
      if (!el) return;
      el.textContent = msg || "";
      el.hidden = !msg;
    };
    const show = () => {
      const v = Number($('input[name="rating"]:checked', body)?.value || 0);
      for (const l of $$(".stars-row label", body)) l.classList.toggle("on", Number(l.dataset.n) <= v);
      if (v) $("#rvWord", body).textContent = WORDS[v];
    };
    if (f) {
      show();
      f.addEventListener("change", (e) => e.target.name === "rating" && (show(), err("rvRating", "")));
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        for (const id of ["rvRating", "rvText", "rvName", "rvConsent"]) err(id, "");
        const rating = Number($('input[name="rating"]:checked', f)?.value || 0);
        if (!rating) return err("rvRating", "Choose 1 to 5 stars."), $("#rvStar5", f).focus();
        const name = f.name.value.trim();
        if (!name) return err("rvName", "Add the name to show with your review."), f.name.focus();
        if (!$("#rvConsent", f).checked) return err("rvConsent", "Tick the box to give your permission."), $("#rvConsent", f).focus();
        const restore = busy(e.submitter || $("button[type=submit]", f), "Sending…");
        try {
          const r = await api("/api/review", { method: "POST", body: { rating, text: f.text.value, name, consent: true } });
          if (disposed) return;
          paint({ eligible: true, review: r.review });
          toast("Thank you for your review!", "success");
          $("#main h1", root)?.focus?.();
        } catch (e2) {
          restore();
          const fields = e2.data?.fields || {};
          const map = { rating: "rvRating", text: "rvText", name: "rvName", consent: "rvConsent" };
          const hit = Object.keys(map).find((k) => fields[k]);
          if (hit) err(map[hit], fields[hit]);
          else toast(e2.message, "error");
        }
      });
    }
    $("#rvDelete", body)?.addEventListener("click", async (e) => {
      if (!confirm("Delete your review?")) return;
      const restore = busy(e.currentTarget, "Deleting…");
      try {
        await api("/api/review/mine", { method: "DELETE" });
        if (disposed) return;
        paint({ eligible: data.eligible, review: null });
        toast("Your review is deleted.", "success");
      } catch (e2) {
        restore();
        toast(e2.message, "error");
      }
    });
  };

  api("/api/review/mine")
    .then((d) => !disposed && paint(d))
    .catch((err) => {
      if (!disposed) body.innerHTML = html`<div class="banner banner-danger"><div><b>Couldn't load this page.</b> ${err.message}</div></div>`.v;
    });
  return () => (disposed = true);
}
