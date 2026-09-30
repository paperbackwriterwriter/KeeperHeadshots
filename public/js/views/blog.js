import { html } from "../core.js";
import { footer } from "./landing.js";
import { SORO_EMBED, BLOG_SLUG, postTitle } from "../shared/soro.js";

// /blog: articles written by Soro (trysoro.com). When the site reads Soro's
// RSS feed (SORO_FEED_URL, lib/blog.js), the server sends the articles in the
// page itself and this view keeps them. Otherwise, Soro's embed: the server sends
// Soro's snippet in the page itself (lib/seo.js): <div id="soro-blog"></div>
// and its script. Soro's script runs once per page load and fills that div,
// so this view keeps the same div (app.js carries it over while the page is
// swapped in) rather than making a new one. The page's Content Security
// Policy allows Soro on /blog pages only (server.js), so links to and from the
// blog load the page fresh (app.js).
let shown = false;

export function renderBlog({ root }) {
  // Back/Forward within the blog: load that address fresh, from the server.
  if (shown) return void location.reload();
  shown = true;
  // Served from Soro's feed (lib/blog.js): the server sent the articles in the
  // page; keep them (app.js carried the element over) and add the footer.
  const ssr = root.querySelector("[data-blog-ssr]");
  if (ssr) {
    if (ssr.dataset.title) document.title = ssr.dataset.title;
    root.innerHTML = footer().v;
    root.prepend(ssr);
    return;
  }
  // An article: its own title (the server sent the same), not the blog's.
  const post = new URLSearchParams(location.search).get("post");
  if (post && BLOG_SLUG.test(post)) document.title = postTitle(post);
  const soro = document.getElementById("soro-blog");
  root.innerHTML = html`
  <main id="main" class="container app-main view-enter blog-page">
    <header class="blog-head">
      <p class="eyebrow"><span class="dot"></span>Blog</p>
      <h1 class="display h-1" style="margin-top:12px">Headshot tips and guides</h1>
      <p class="lede">Advice on professional headshots: what to wear, where to use them, and how to make a great first impression online.</p>
    </header>
    <div class="blog-embed"><div id="soro-blog"></div></div>
    <p class="blog-fallback muted" id="blogFallback" hidden data-prerender-skip>The articles didn't load. Check your connection and <a class="link" href="/blog">try again</a>.</p>
  </main>
  ${footer()}`.v;
  const box = soro || root.querySelector("#soro-blog");
  if (soro) root.querySelector("#soro-blog").replaceWith(soro);

  // Only if the page arrived without Soro's script (it normally has it).
  let script = document.querySelector(`script[src="${SORO_EMBED}"]`);
  if (!script) {
    script = document.createElement("script");
    script.src = SORO_EMBED;
    script.defer = true;
    document.body.appendChild(script);
  }
  const showFallback = () => {
    if (box.isConnected && !box.childElementCount) root.querySelector("#blogFallback").hidden = false;
  };
  script.addEventListener("error", showFallback);
  const timer = setTimeout(showFallback, 12000);
  return () => clearTimeout(timer);
}
