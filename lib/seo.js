// Server-side SEO for the single-page app. Every HTML response gets its own
// title, description, canonical URL and robots rule; public pages also carry a
// prerendered copy of their content (lib/prerendered.js, made by
// `npm run prerender`) so crawlers that don't run JavaScript see the page.
// The browser app replaces that content with the live view as soon as it loads.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FAQ, LINKEDIN_FAQ, TEAM_FAQ, REAL_ESTATE_FAQ, RESUME_FAQ, MEDICAL_FAQ, LEGAL_FAQ } from "../public/js/shared/faq.js";
import { PACKAGES } from "../public/js/shared/catalog.js";
import { PRERENDERED } from "./prerendered.js";

export const SITE = "https://keeperheadshots.com";
const CANONICAL_HOST = new URL(SITE).host;
const dir = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = fs.readFileSync(path.join(dir, "..", "templates", "index.html"), "utf8");

// Public, indexable pages. Titles here should match the browser app's titles
// (public/js/app.js) so nothing changes when the app takes over.
export const PAGES = {
  "/": {
    title: "Professional AI Headshots from Selfies | Keeper Headshots",
    description: "Turn a few selfies into studio-quality professional headshots for LinkedIn and your résumé. Every headshot is checked for likeness. First shoot free, from $29.",
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
    description: "If none of the headshots from your first paid shoot are usable, we refund your purchase in full. Read how our money-back guarantee works.",
  },
  "/privacy": {
    title: "Privacy policy · Keeper Headshots",
    description: "How Keeper Headshots handles your photos and personal data. Your photos are never sold, never used to train AI, and you can delete them at any time.",
  },
  "/terms": {
    title: "Terms of service · Keeper Headshots",
    description: "The terms for using Keeper Headshots, the AI headshot studio: your photos, your headshots, payments and acceptable use.",
  },
  "/signup": {
    title: "Create your account · Keeper Headshots",
    description: "Create a free Keeper Headshots account and turn a few selfies into professional headshots. Your first shoot is free.",
  },
};

// App pages: real routes, but not for search results.
const PRIVATE = [/^\/signin$/, /^\/verify$/, /^\/forgot-password$/, /^\/reset$/, /^\/app$/, /^\/app\/(new|account)$/, /^\/app\/buy\/[\w-]+$/, /^\/app\/shoot\/[\w-]+$/];
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
};
const preloads = (pathname) => {
  const view = VIEW_MODULE[pathname];
  const mods = ["/js/core.js", "/js/icons.js", ...(view ? [`/js/views/${view}.js`, "/js/views/landing.js", "/js/shared/faq.js", "/js/shared/catalog.js"] : [])];
  return [...new Set(mods)].map((m) => `<link rel="modulepreload" href="${m}" />`).join("\n  ");
};

function render({ title, description, canonical, robots, jsonLd = "", body = "", pathname = "" }) {
  let html = TEMPLATE.replace(/<title>[^<]*<\/title>/, () => `<title>${esc(title)}</title>`);
  if (description) {
    html = html
      .replace(/<meta name="description" content="[^"]*" \/>/, () => `<meta name="description" content="${esc(description)}" />`)
      .replace(/<meta property="og:description" content="[^"]*" \/>/, () => `<meta property="og:description" content="${esc(description)}" />`);
  }
  html = html.replace(/<meta property="og:title" content="[^"]*" \/>/, () => `<meta property="og:title" content="${esc(title)}" />`);
  if (canonical) html = html.replace(/<meta property="og:url" content="[^"]*" \/>/, () => `<meta property="og:url" content="${canonical}" />`);
  const head = [preloads(pathname), canonical && `<link rel="canonical" href="${canonical}" />`, robots && `<meta name="robots" content="${robots}" />`, jsonLd].filter(Boolean).join("\n  ");
  html = html.replace("</head>", () => `  ${head}\n</head>`);
  if (body) html = html.replace('<div id="app"></div>', () => `<div id="app">${body}</div>`);
  return html;
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
