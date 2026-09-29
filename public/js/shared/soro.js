// The blog's articles come from Soro (trysoro.com) through this embed script.
// It renders into <div id="soro-blog"></div> (views/blog.js, lib/seo.js).
export const SORO_EMBED = "https://app.trysoro.com/api/embed/1cec6634-2353-4a99-a706-b269ffe2172d";

// Articles live at /blog?post=<slug>. Until the embed shows the real title,
// the page title comes from the slug: "professional-ai-headshots" becomes
// "Professional AI Headshots" (lib/seo.js for search engines, views/blog.js).
export const BLOG_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+){0,30}$/;
const WORDS = { ai: "AI", linkedin: "LinkedIn", cv: "CV", ceo: "CEO", seo: "SEO", faq: "FAQ", hr: "HR", diy: "DIY", usa: "USA", uk: "UK", vs: "vs", iphone: "iPhone" };
const SMALL = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);
export const titleFromSlug = (slug) =>
  slug
    .split("-")
    .filter(Boolean)
    .map((w, i) => WORDS[w] || (i > 0 && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
export const postTitle = (slug) => `${titleFromSlug(slug)} · Keeper Headshots Blog`;
