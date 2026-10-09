// Server-side SEO for the single-page app. Every HTML response gets its own
// title, description, canonical URL and robots rule; public pages also carry a
// prerendered copy of their content (lib/prerendered.js, made by
// `npm run prerender`) so crawlers that don't run JavaScript see the page.
// The browser app replaces that content with the live view as soon as it loads.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FAQ, LINKEDIN_FAQ, TEAM_FAQ, REAL_ESTATE_FAQ, RESUME_FAQ, MEDICAL_FAQ, LEGAL_FAQ } from "../public/js/shared/faq.js";
import { PACKAGES } from "../public/js/shared/catalog.js";
import { PRERENDERED } from "./prerendered.js";
import { BUILD } from "./build.js";
import { ogSlugFor } from "./og.js";
import { SORO_EMBED, BLOG_SLUG, titleFromSlug, postTitle } from "../public/js/shared/soro.js";
import { excerptOf, truncate } from "./blog.js";

export const SITE = "https://keeperheadshots.com";
const CANONICAL_HOST = new URL(SITE).host;
const dir = path.dirname(fileURLToPath(import.meta.url));
// The stylesheet URL carries a hash of its contents, so no cached copy of an
// older stylesheet is ever paired with newer markup. The scripts load from a
// folder named after the browser-code version (lib/build.js): /v/<build>/js/.
// They import each other by relative paths, so a page only ever runs scripts
// from one version, never an old cached module next to new ones. The page
// also carries the version for the "new version" check.
export const JS = `/v/${BUILD}/js`;
const CSS_VERSION = crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, "..", "public", "css", "app.css"))).digest("hex").slice(0, 10);
const TEMPLATE = fs.readFileSync(path.join(dir, "..", "templates", "index.html"), "utf8").replace('href="/css/app.css"', `href="/css/app.css?v=${CSS_VERSION}"`)
  .replace('src="/js/app.js"', `src="${JS}/app.js"`)
  .replace("</head>", `  <meta name="app-build" content="${BUILD}" />\n</head>`);

// Public, indexable pages. Titles here should match the browser app's titles
// (public/js/app.js) so nothing changes when the app takes over.
export const PAGES = {
  "/": {
    title: "Professional AI Headshots from Selfies | Keeper Headshots",
    description: "Turn a few selfies into studio-quality professional headshots for LinkedIn and your résumé. Every headshot is checked for likeness. Free preview, keep yours from $8.99.",
  },
  "/linkedin-headshots": {
    title: "LinkedIn Headshots from Selfies | Keeper Headshots",
    description: "Professional LinkedIn headshots from a few selfies, delivered ready to use with a perfect 1:1 square crop for LinkedIn and Microsoft Teams. First shoot free.",
  },
  "/team-headshots": {
    title: "Team Headshots for Companies | Keeper Headshots",
    description: "Matching professional headshots for your whole team from a few selfies each. Same backdrop for everyone, about $4 a person, no photographer to schedule.",
  },
  "/real-estate-headshots": {
    title: "Real Estate Agent Headshots | Keeper Headshots",
    description: "Real estate agent headshots from a few selfies, ready for business cards, signs, listings and social media, as a 3:4 portrait, a 1:1 square or both.",
  },
  "/resume-headshots": {
    title: "Résumé & CV Headshots from Selfies | Keeper Headshots",
    description: "Résumé and CV headshots from a few selfies: a 3:4 portrait for your CV and a 1:1 square for LinkedIn and job sites. Plus when to use a CV photo.",
  },
  "/doctor-headshots": {
    title: "Doctor & Medical Headshots | Keeper Headshots",
    description: "Headshots for doctors, nurses, dentists and therapists from a few selfies. White coat, scrubs or business attire, ready for provider pages and telehealth.",
  },
  "/lawyer-headshots": {
    title: "Lawyer & Attorney Headshots | Keeper Headshots",
    description: "Headshots for lawyers and law firms from a few selfies. Suit and tie, law library or modern office, ready for attorney bios, directories and LinkedIn.",
  },
  "/contact": {
    title: "Contact us · Keeper Headshots",
    description: "Questions about your headshots, billing or team pricing? Send us a message and we'll reply within one business day.",
  },
  "/refunds": {
    title: "Money-back guarantee · Keeper Headshots",
    description: "If none of the headshots from your first paid shoot are usable, we refund your package, less any later shoots you kept. Read how our money-back guarantee works.",
  },
  "/privacy": {
    title: "Privacy policy · Keeper Headshots",
    description: "How Keeper Headshots handles your photos and personal data. Your photos are never sold, never used to train AI, and you can delete them at any time.",
  },
  "/terms": {
    title: "Terms of service · Keeper Headshots",
    description: "The terms for using Keeper Headshots, the AI headshot studio: your photos, your headshots, payments and acceptable use.",
  },
  "/blog": {
    title: "Blog: headshot tips and guides · Keeper Headshots",
    description: "Advice on professional headshots: what to wear, where to use your headshot, LinkedIn and résumé photo tips, and how to look your best online.",
  },
  "/signup": {
    title: "Create your account · Keeper Headshots",
    description: "Create a free Keeper Headshots account and turn a few selfies into professional headshots. Your first shoot is a free preview.",
  },
};

// App pages: real routes, but not for search results.
const PRIVATE = [/^\/signin$/, /^\/verify$/, /^\/forgot-password$/, /^\/reset$/, /^\/app$/, /^\/app\/(new|account|funnel|team|showcase)$/, /^\/app\/buy\/[\w-]+$/, /^\/app\/shoot\/[\w-]+$/, /^\/join(\/[\w-]+)?$/, /^\/unsubscribe$/];
const PRIVATE_TITLE = "Keeper Headshots";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// JSON-LD inside <script>: keep "</script>" and friends from closing the tag.
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;

const faqLd = (items) => ({ "@type": "FAQPage", mainEntity: items.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) });

// Service + FAQ + breadcrumb for a search landing page.
const landingLd = ({ path, name, description, faq }) =>
  ld({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Service",
        name,
        serviceType: "AI headshot photography",
        description,
        provider: { "@type": "Organization", name: "Keeper Headshots", url: `${SITE}/` },
        url: `${SITE}${path}`,
        offers: { "@type": "AggregateOffer", lowPrice: String(Math.min(...PACKAGES.map((p) => p.price))), highPrice: String(Math.max(...PACKAGES.map((p) => p.price))), priceCurrency: "USD", offerCount: String(PACKAGES.length) },
      },
      faqLd(faq),
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Keeper Headshots", item: `${SITE}/` },
          { "@type": "ListItem", position: 2, name, item: `${SITE}${path}` },
        ],
      },
    ],
  });

const PAGE_LD = {
  "/team-headshots": landingLd({
    path: "/team-headshots",
    name: "Team headshots",
    description: "Matching professional headshots for teams from a few selfies per person: the same backdrop for everyone, each headshot checked for likeness, delivered as a portrait and a 1:1 square.",
    faq: TEAM_FAQ,
  }),
  "/real-estate-headshots": landingLd({
    path: "/real-estate-headshots",
    name: "Real estate headshots",
    description: "Professional headshots for real estate agents from a few selfies, each checked for likeness, delivered as a full-resolution 3:4 portrait for print and a 1:1 square for listing and social profiles.",
    faq: REAL_ESTATE_FAQ,
  }),
  "/resume-headshots": landingLd({
    path: "/resume-headshots",
    name: "Résumé and CV headshots",
    description: "Professional headshots for job seekers from a few selfies, each checked for likeness, delivered as a 3:4 portrait for CV photo boxes and a 1:1 square for LinkedIn and job-site profiles.",
    faq: RESUME_FAQ,
  }),
  "/doctor-headshots": landingLd({
    path: "/doctor-headshots",
    name: "Doctor and medical headshots",
    description: "Professional headshots for doctors, nurses, dentists and therapists from a few selfies, in a white coat, scrubs or business attire, each checked for likeness, delivered as a 3:4 portrait and a 1:1 square.",
    faq: MEDICAL_FAQ,
  }),
  "/lawyer-headshots": landingLd({
    path: "/lawyer-headshots",
    name: "Lawyer and attorney headshots",
    description: "Professional headshots for lawyers and law firms from a few selfies, in a suit and tie, navy suit or blazer, each checked for likeness, delivered as a 3:4 portrait and a 1:1 square.",
    faq: LEGAL_FAQ,
  }),
};

const LINKEDIN_LD = ld({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Service",
      name: "LinkedIn headshots",
      serviceType: "AI headshot photography",
      description: "Professional LinkedIn headshots from selfies, delivered ready to use as a full-resolution portrait and a 1:1 square crop for LinkedIn and Microsoft Teams.",
      provider: { "@type": "Organization", name: "Keeper Headshots", url: `${SITE}/` },
      url: `${SITE}/linkedin-headshots`,
      offers: { "@type": "AggregateOffer", lowPrice: String(Math.min(...PACKAGES.map((p) => p.price))), highPrice: String(Math.max(...PACKAGES.map((p) => p.price))), priceCurrency: "USD", offerCount: String(PACKAGES.length) },
    },
    faqLd(LINKEDIN_FAQ),
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Keeper Headshots", item: `${SITE}/` },
        { "@type": "ListItem", position: 2, name: "LinkedIn headshots", item: `${SITE}/linkedin-headshots` },
      ],
    },
  ],
});

const HOME_LD = ld({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE}/#org`,
      name: "Keeper Headshots",
      url: `${SITE}/`,
      logo: `${SITE}/apple-touch-icon.png`,
      email: "hello@keeperheadshots.com",
    },
    { "@type": "WebSite", "@id": `${SITE}/#website`, name: "Keeper Headshots", url: `${SITE}/`, publisher: { "@id": `${SITE}/#org` } },
    {
      "@type": "Service",
      name: "AI professional headshots",
      serviceType: "AI headshot photography",
      description: "Upload a few selfies and get studio-quality professional headshots in the backdrops and outfits you choose, each checked for likeness.",
      provider: { "@id": `${SITE}/#org` },
      url: `${SITE}/`,
      offers: PACKAGES.map((p) => ({
        "@type": "Offer",
        name: p.name,
        description: `${p.shoots} headshot shoots`,
        price: String(p.price),
        priceCurrency: "USD",
        url: `${SITE}/#pricing`,
      })),
    },
    faqLd(FAQ),
  ],
});

// The first page's own view module (the app loads views on demand), so the
// browser fetches it in parallel with app.js instead of discovering it later.
const VIEW_MODULE = {
  "/": "landing",
  "/linkedin-headshots": "linkedin",
  "/team-headshots": "team",
  "/real-estate-headshots": "realestate",
  "/resume-headshots": "resume",
  "/doctor-headshots": "medical",
  "/lawyer-headshots": "legal-headshots",
  "/contact": "contact",
  "/refunds": "refunds",
  "/privacy": "legal",
  "/terms": "legal",
  "/signup": "auth",
  "/blog": "blog",
};
const preloads = (pathname) => {
  const view = VIEW_MODULE[pathname];
  // The sign-up page's module (auth.js) doesn't use the landing page or its data.
  const shared = view && view !== "auth" ? ["/js/views/landing.js", "/js/shared/faq.js", "/js/shared/catalog.js"] : [];
  // Everything app.js imports up front (core, icons, pixel), so it can start
  // without a second round trip; plus the page's own view module.
  const mods = ["/js/core.js", "/js/icons.js", "/js/pixel.js", ...(view ? [`/js/views/${view}.js`] : []), ...shared];
  return [...new Set(mods)].map((m) => `<link rel="modulepreload" href="${m.replace(/^\/js/, JS)}" />`).join("\n  ");
};

function render({ title, description, canonical, robots, jsonLd = "", body = "", pathname = "", embed = pathname === "/blog", ogImage = "", ogType = "" }) {
  let html = TEMPLATE.replace(/<title>[^<]*<\/title>/, () => `<title>${esc(title)}</title>`);
  if (description) {
    html = html
      .replace(/<meta name="description" content="[^"]*" \/>/, () => `<meta name="description" content="${esc(description)}" />`)
      .replace(/<meta property="og:description" content="[^"]*" \/>/, () => `<meta property="og:description" content="${esc(description)}" />`);
  }
  html = html.replace(/<meta property="og:title" content="[^"]*" \/>/, () => `<meta property="og:title" content="${esc(title)}" />`);
  if (canonical) html = html.replace(/<meta property="og:url" content="[^"]*" \/>/, () => `<meta property="og:url" content="${canonical}" />`);
  // Landing pages have their own preview image (lib/og.js); the rest share og.png.
  const og = ogSlugFor(pathname);
  if (ogImage) {
    html = html
      .replace(/<meta property="og:image" content="[^"]*" \/>/, () => `<meta property="og:image" content="${esc(ogImage.url)}" />`)
      .replace(/<meta property="og:image:width" content="[^"]*" \/>/, `<meta property="og:image:width" content="${Number(ogImage.width)}" />`)
      .replace(/<meta property="og:image:height" content="[^"]*" \/>/, `<meta property="og:image:height" content="${Number(ogImage.height)}" />`);
  } else if (og) html = html.replace(/<meta property="og:image" content="[^"]*" \/>/, () => `<meta property="og:image" content="${SITE}/og/${og}.png" />`);
  if (ogType) html = html.replace('<meta property="og:type" content="website" />', `<meta property="og:type" content="${ogType}" />`);
  const head = [preloads(pathname), canonical && `<link rel="canonical" href="${canonical}" />`, robots && `<meta name="robots" content="${robots}" />`, jsonLd].filter(Boolean).join("\n  ");
  html = html.replace("</head>", () => `  ${head}\n</head>`);
  if (body) html = html.replace('<div id="app"></div>', () => `<div id="app">${body}</div>`);
  // The blog: Soro's snippet, as Soro gives it (the div is in the prerendered
  // body; views/blog.js keeps it when the app takes over).
  if (embed) html = html.replace("</body>", () => `  <script src="${SORO_EMBED}" defer></script>\n</body>`);
  return html;
}

// Blog articles (Soro's embed, views/blog.js) live at /blog?post=<slug>.
// Each is its own page for search engines: it points to its own address
// (not /blog) and gets a title from its slug until the embed fills in the
// real one ("professional-ai-headshots" → "Professional AI Headshots").
const blogCache = new Map();
export function blogPostPage(slug) {
  if (!BLOG_SLUG.test(slug) || slug.length > 150) return null;
  if (blogCache.has(slug)) return blogCache.get(slug);
  const title = titleFromSlug(slug);
  let html = render({
    title: postTitle(slug),
    description: `${title}: an article from the Keeper Headshots blog, with advice on professional headshots.`,
    canonical: `${SITE}/blog?post=${slug}`,
    robots: "index, follow, max-image-preview:large",
    body: PRERENDERED["/blog"] || "",
    pathname: "/blog",
  });
  html = html.replace('<meta property="og:type" content="website" />', '<meta property="og:type" content="article" />');
  const out = { status: 200, html };
  if (blogCache.size < 1000) blogCache.set(slug, out);
  return out;
}

/* ---------------- The blog, served from Soro's feed (lib/blog.js) ----------------
   The page's <main> holds the articles; the browser app keeps that element
   when it takes over (views/blog.js), like the prerendered pages' content. */

const BLOG_TITLE = PAGES["/blog"].title;
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : "");
const readMins = (words) => Math.max(1, Math.round((words || 0) / 230));
const blogShell = (main) => (PRERENDERED["/blog"] || "").replace(/<main\b[\s\S]*?<\/main>/, () => main);
const imgTag = (im, { alt = im.alt || "", lazy = true, cls = "" } = {}) =>
  `<img${cls ? ` class="${cls}"` : ""} src="${esc(im.src)}" alt="${esc(alt)}" width="${Number(im.width)}" height="${Number(im.height)}"${lazy ? ' loading="lazy" decoding="async"' : ' fetchpriority="high"'} />`;
const card = (p, level = "h2") => `<li class="blog-card"><a href="/blog/${p.slug}">${p.image ? imgTag(p.image, { alt: "", cls: "blog-card-img" }) : '<span class="blog-card-img blog-card-blank" aria-hidden="true"></span>'}<span class="blog-card-body">${p.published ? `<time class="blog-date" datetime="${esc(p.published)}">${fmtDate(p.published)}</time>` : ""}<${level} class="blog-card-title">${esc(p.title)}</${level}>${p.excerpt ? `<span class="blog-card-excerpt">${esc(truncate(p.excerpt, 170))}</span>` : ""}</span></a></li>`;
const blogCrumbs = (items) => ({
  "@type": "BreadcrumbList",
  itemListElement: items.map(([name, url], i) => ({ "@type": "ListItem", position: i + 1, name, item: url })),
});

export function blogIndexPage(index) {
  const main = `<main id="main" class="container app-main blog-page" data-blog-ssr data-title="${esc(BLOG_TITLE)}">
    <header class="blog-head"><p class="eyebrow"><span class="dot"></span>Blog</p><h1 class="display h-1" style="margin-top:12px">Headshot tips and guides</h1><p class="lede">Advice on professional headshots: what to wear, where to use them, and how to make a great first impression online.</p></header>
    <ul class="blog-list" role="list">${index.posts.map((p) => card(p)).join("")}</ul>
  </main>`;
  const jsonLd = ld({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Blog",
        name: "Keeper Headshots Blog",
        url: `${SITE}/blog`,
        publisher: { "@type": "Organization", name: "Keeper Headshots", url: `${SITE}/` },
        blogPost: index.posts.slice(0, 30).map((p) => ({ "@type": "BlogPosting", headline: p.title, url: `${SITE}/blog/${p.slug}`, ...(p.published && { datePublished: p.published }), ...(p.image && { image: SITE + p.image.src }) })),
      },
      blogCrumbs([["Keeper Headshots", `${SITE}/`], ["Blog", `${SITE}/blog`]]),
    ],
  });
  return { status: 200, html: render({ ...PAGES["/blog"], canonical: `${SITE}/blog`, robots: "index, follow, max-image-preview:large", jsonLd, body: blogShell(main), pathname: "/blog", embed: false }) };
}

export function blogArticlePage(post, index) {
  const url = `${SITE}/blog/${post.slug}`;
  const title = `${post.title} · Keeper Headshots Blog`;
  // The stored excerpt is plain text already; the article is HTML.
  const description = post.excerpt ? truncate(post.excerpt, 160) : excerptOf(post.html, 160);
  const more = index.posts.filter((p) => p.slug !== post.slug).slice(0, 3);
  const meta = [post.published && `<time datetime="${esc(post.published)}">${fmtDate(post.published)}</time>`, `${readMins(post.words)} min read`].filter(Boolean).join(" · ");
  const main = `<main id="main" class="container app-main blog-page" data-blog-ssr data-title="${esc(title)}">
    <article class="blog-article">
      <p class="blog-back"><a class="link" href="/blog">← All articles</a></p>
      <header class="blog-article-head"><h1 class="display h-1">${esc(post.title)}</h1><p class="blog-meta">${meta}</p></header>
      ${post.image ? `<figure class="blog-hero">${imgTag(post.image, { lazy: false })}</figure>` : ""}
      <div class="prose">${post.html}</div>
    </article>
    <aside class="panel blog-cta" aria-labelledby="blogCta"><h2 class="h-3" id="blogCta">Get your own professional headshots</h2><p class="muted">Upload a few selfies and get studio-quality headshots, each checked for likeness. Your first shoot is a free preview.</p><p><a class="btn btn-flash" href="/signup">Try it free</a></p></aside>
    ${more.length ? `<section class="blog-more" aria-labelledby="blogMore"><h2 class="h-3" id="blogMore">More articles</h2><ul class="blog-list" role="list">${more.map((p) => card(p, "h3")).join("")}</ul></section>` : ""}
  </main>`;
  const org = { "@type": "Organization", name: "Keeper Headshots", url: `${SITE}/`, logo: { "@type": "ImageObject", url: `${SITE}/apple-touch-icon.png` } };
  const jsonLd = ld({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BlogPosting",
        headline: post.title,
        description,
        url,
        mainEntityOfPage: url,
        ...(post.published && { datePublished: post.published }),
        ...((post.modified || post.published) && { dateModified: post.modified || post.published }),
        ...(post.image && { image: { "@type": "ImageObject", url: SITE + post.image.src, width: post.image.width, height: post.image.height } }),
        author: post.author ? { "@type": "Person", name: post.author } : org,
        publisher: org,
        wordCount: post.words,
      },
      blogCrumbs([["Keeper Headshots", `${SITE}/`], ["Blog", `${SITE}/blog`], [post.title, url]]),
    ],
  });
  const html = render({
    title,
    description,
    canonical: url,
    robots: "index, follow, max-image-preview:large",
    jsonLd,
    body: blogShell(main),
    pathname: "/blog",
    embed: false,
    ogType: "article",
    ogImage: post.image && { url: SITE + post.image.src, width: post.image.width, height: post.image.height },
  });
  return { status: 200, html };
}

// An article address that isn't (or is no longer) on the blog. A real 404
// for search engines, with a way back to the articles for people.
export function blogNotFoundPage(index) {
  const title = "Article not found · Keeper Headshots Blog";
  const main = `<main id="main" class="container app-main blog-page" data-blog-ssr data-title="${esc(title)}">
    <header class="blog-head"><p class="eyebrow"><span class="dot"></span>Blog</p><h1 class="display h-1" style="margin-top:12px">We couldn't find that article</h1><p class="lede">It may have been moved or taken down. Here are our latest articles instead.</p></header>
    <ul class="blog-list" role="list">${index.posts.slice(0, 3).map((p) => card(p)).join("")}</ul>
    <p class="blog-back" style="margin-top:var(--s-6)"><a class="link" href="/blog">See all articles</a></p>
  </main>`;
  return { status: 404, html: render({ title, robots: "noindex", body: blogShell(main), pathname: "/blog", embed: false }) };
}

export function blogSitemap(index) {
  const urls = (index?.posts || []).map((p) => `  <url><loc>${SITE}/blog/${p.slug}</loc>${p.modified || p.published ? `<lastmod>${(p.modified || p.published).slice(0, 10)}</lastmod>` : ""}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}${urls.length ? "\n" : ""}</urlset>\n`;
}

// Built once per path at startup; the responses never change between deploys.
const cache = new Map();
export function pageFor(pathname) {
  if (cache.has(pathname)) return cache.get(pathname);
  let out;
  const page = PAGES[pathname];
  if (page) {
    out = {
      status: 200,
      html: render({
        ...page,
        canonical: `${SITE}${pathname === "/" ? "/" : pathname}`,
        robots: "index, follow, max-image-preview:large",
        jsonLd: pathname === "/" ? HOME_LD : pathname === "/linkedin-headshots" ? LINKEDIN_LD : PAGE_LD[pathname] || "",
        body: PRERENDERED[pathname] || "",
        pathname,
      }),
    };
  } else if (/^\/blog\/[\w-]{1,120}$/.test(pathname)) {
    // An article address, if Soro's embed uses them (views/blog.js). The embed
    // fills in the article; the page is indexable at its own address.
    out = { status: 200, html: render({ ...PAGES["/blog"], canonical: `${SITE}${pathname}`, robots: "index, follow, max-image-preview:large", body: PRERENDERED["/blog"] || "", pathname: "/blog" }) };
  } else if (PRIVATE.some((re) => re.test(pathname))) {
    out = { status: 200, html: render({ title: PRIVATE_TITLE, robots: "noindex, nofollow" }) };
  } else {
    // Unknown address: the app shows its "not found" page, and crawlers get a real 404.
    out = { status: 404, html: render({ title: "Not found · Keeper Headshots", robots: "noindex" }) };
  }
  if (cache.size < 500) cache.set(pathname, out);
  return out;
}

// The site is also reachable on *.vercel.app addresses; keep those out of search.
export const isCanonicalHost = (host) => !host || host === CANONICAL_HOST || /^localhost(:\d+)?$/.test(host) || /^127\.0\.0\.1(:\d+)?$/.test(host);
