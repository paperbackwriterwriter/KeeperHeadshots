// The home page's "From our customers" section (lib/showcase.js approved
// entries). Shared by the server, which puts it in the page so search engines
// see it, and the browser, which fills it in on later visits.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function customersInner(entries) {
  const figures = entries
    .map(
      (e) => `<figure class="customer">
        <img src="/showcase/${esc(e.id)}.webp?w=600&amp;v=${esc(e.v)}" alt="Headshot of ${esc(e.name)}, made by Keeper Headshots" loading="lazy" width="600" height="800" />
        <figcaption>${e.quote ? `<blockquote>“${esc(e.quote)}”</blockquote>` : ""}<p><b>${esc(e.name)}</b>${e.role ? `<span>, ${esc(e.role)}</span>` : ""}</p></figcaption>
      </figure>`,
    )
    .join("");
  return `<div class="container">
    <div class="section-head">
      <div>
        <p class="eyebrow">From our customers</p>
        <h2 class="display h-1" id="customersTitle" style="margin-top:16px">Real customers. <em>Their</em> headshots.</h2>
      </div>
      <p class="lede">Made from their own selfies, and shared with us by the people in them.</p>
    </div>
    <div class="customers">${figures}</div>
    <p class="small muted customers-note">Shared with permission. Want yours here? Use "Share your results" on your finished shoot.</p>
  </div>`;
}

// The whole section, as the server puts it in the page.
export const customersSection = (entries) =>
  `<section class="section" id="customers" style="padding-top:0" aria-labelledby="customersTitle">${customersInner(entries)}</section>`;
