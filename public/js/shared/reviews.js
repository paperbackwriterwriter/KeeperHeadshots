// The home page's "Reviews" section (lib/reviews.js approved reviews, with
// their count and average). Shared by the server, which puts it in the page,
// and the browser, which fills it in on later visits.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const starsHtml = (n) => `<span class="stars-shown" role="img" aria-label="${n} of 5 stars">${"★".repeat(n)}<span class="stars-off">${"★".repeat(5 - n)}</span></span>`;

export function reviewsInner({ count, average, reviews }) {
  const cards = reviews
    .map(
      (r) => `<figure class="review-card">
        <p>${starsHtml(r.rating)}</p>
        ${r.text ? `<blockquote>“${esc(r.text)}”</blockquote>` : ""}
        <figcaption><b>${esc(r.name)}</b><span>, verified customer</span></figcaption>
      </figure>`,
    )
    .join("");
  return `<div class="container">
    <div class="section-head">
      <div>
        <p class="eyebrow">Reviews</p>
        <h2 class="display h-1" id="reviewsTitle" style="margin-top:16px">Rated ${esc(Number(average).toFixed(1))} out of 5.</h2>
      </div>
      <p class="lede">${starsHtml(Math.round(average))} from ${count} ${count === 1 ? "customer review" : "customer reviews"}. Every review is from someone who paid for their headshots.</p>
    </div>
    <div class="review-cards">${cards}</div>
  </div>`;
}

// The whole section, as the server puts it in the page.
export const reviewsSection = (data) => `<section class="section" id="reviews" style="padding-top:0" aria-labelledby="reviewsTitle">${reviewsInner(data)}</section>`;
