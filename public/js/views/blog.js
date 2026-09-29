import { html } from "../core.js";
import { footer } from "./landing.js";

// /blog: articles written and hosted by Soro (trysoro.com), shown through its
// embed script, which renders into #soro-blog. The page's Content Security
// Policy allows Soro's script only on /blog pages (server.js), so links to the
// blog load the page fresh rather than through the in-app router (app.js).
export const SORO_EMBED = "https://app.trysoro.com/api/embed/1cec6634-2353-4a99-a706-b269ffe2172d";

export function renderBlog({ root }) {
  root.innerHTML = html`
  <main id="main" class="container app-main view-enter blog-page">
    <header class="blog-head">
      <p class="eyebrow"><span class="dot"></span>Blog</p>
      <h1 class="display h-1" style="margin-top:12px">Headshot tips and guides</h1>
      <p class="lede">Advice on professional headshots: what to wear, where to use them, and how to make a great first impression online.</p>
    </header>
    <div id="soro-blog" class="blog-embed" aria-live="polite" data-prerender-empty></div>
    <p class="blog-fallback muted" id="blogFallback" hidden data-prerender-skip>The articles didn't load. Check your connection and <a class="link" href="/blog">try again</a>.</p>
  </main>
  ${footer()}`.v;

  // Load the embed fresh each time the page is shown, so it reads the current
  // address (which article) and renders into the new #soro-blog.
  document.querySelectorAll("script[data-soro]").forEach((s) => s.remove());
  const s = document.createElement("script");
  s.src = SORO_EMBED;
  s.defer = true;
  s.dataset.soro = "";
  const box = root.querySelector("#soro-blog");
  const showFallback = () => {
    if (box.isConnected && !box.childElementCount) root.querySelector("#blogFallback").hidden = false;
  };
  s.onerror = showFallback;
  const timer = setTimeout(showFallback, 12000);
  document.body.appendChild(s);
  return () => clearTimeout(timer);
}
