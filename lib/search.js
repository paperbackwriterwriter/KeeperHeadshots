// Site search (GET /api/search): the public pages, every FAQ answer, the
// packages and the blog's articles, searched on our own server (no third-party
// search, no ads). Small enough to score in memory on every request.

import { PAGES } from "./seo.js";
import { FAQ, LINKEDIN_FAQ, TEAM_FAQ, REAL_ESTATE_FAQ, RESUME_FAQ, MEDICAL_FAQ, LEGAL_FAQ } from "../public/js/shared/faq.js";
import { PACKAGES } from "../public/js/shared/catalog.js";

// Each FAQ list and the page that shows it.
const FAQS = [
  [FAQ, "/#faq"],
  [LINKEDIN_FAQ, "/linkedin-headshots#faq"],
  [TEAM_FAQ, "/team-headshots#faq"],
  [REAL_ESTATE_FAQ, "/real-estate-headshots#faq"],
  [RESUME_FAQ, "/resume-headshots#faq"],
  [MEDICAL_FAQ, "/doctor-headshots#faq"],
  [LEGAL_FAQ, "/lawyer-headshots#faq"],
];

// Sections of the home page, which have no page of their own.
const SECTIONS = [
  ["How it works", "/#how", "Upload a few selfies, our AI photo check reviews them, pick your looks and the studio develops your headshots in minutes, each graded for likeness."],
  ["Looks: backdrops and outfits", "/#styles", "Studio gray, glass office, city terrace, library, studio white and botanical backdrops, with suits, blazers, shirts, knitwear, white coats and scrubs."],
  ["Pricing", "/#pricing", "Prices and costs: one-time packages from $29, each shoot with up to 4 looks and 8 headshots, and a money-back guarantee on your first package."],
];

const SKIP = new Set(["/signup"]);
const plainTitle = (t) => t.replace(/\s*[|·]\s*Keeper Headshots$/, "").trim();
const money = (n) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

// Lowercased, accents removed (résumé matches resume), split into words, and
// a trailing plural "s" dropped so "headshots" matches "headshot".
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const stem = (w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
export const words = (s) => (fold(s).match(/[a-z0-9]+/g) || []).map(stem);

const STOP = new Set(["a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "is", "it", "do", "i", "my", "me", "can", "how", "what", "with", "you", "your", "are", "be", "doe", "does"]);
// A few ways people ask for the same thing.
const ALIASES = { cost: ["price"], costs: ["price"], pricing: ["price"], much: ["price"], cheap: ["price"], refund: ["refund", "money"], cv: ["resume", "cv"], doctor: ["doctor", "medical"], attorney: ["lawyer", "attorney"], realtor: ["real", "agent"], company: ["team"], business: ["team"] };

// Features read as one sentence: "3 shoots, up to 24 headshots, …" (names
// like LinkedIn and AI keep their capitals).
const sentence = (features) => features.map((f) => (/^[A-Z][a-z-]*(\s|,|$)/.test(f) ? f[0].toLowerCase() + f.slice(1) : f)).join(", ");

function entry(type, title, url, body) {
  return { type, title, url, body, t: words(title), b: words(body), ft: fold(title), fb: fold(body) };
}

// Everything but the blog, built once.
let base = null;
function baseEntries() {
  if (base) return base;
  const out = [];
  for (const [path, p] of Object.entries(PAGES)) if (!SKIP.has(path)) out.push(entry("Page", plainTitle(p.title), path, p.description));
  for (const [title, url, body] of SECTIONS) out.push(entry("Page", title, url, body));
  for (const [list, url] of FAQS) for (const [q, a] of list) out.push(entry("FAQ", q, url, a));
  for (const p of PACKAGES) out.push(entry("Pricing", `${p.name} package · ${money(p.price)}`, "/#pricing", `Price ${money(p.price)}: ${sentence(p.features)}.`));
  return (base = out);
}

export const blogEntries = (posts) => (posts || []).map((p) => entry("Article", p.title, `/blog/${p.slug}`, p.excerpt || ""));

// How well one entry matches the query's terms: title hits count most, and
// a term may match the start of a word ("lin" finds LinkedIn) once it has
// three letters. Every term must match somewhere, or the entry scores 0.
function score(e, terms, phrase) {
  let total = 0;
  for (const alts of terms) {
    let best = 0;
    for (const term of alts) {
      const prefix = term.length >= 3;
      const hit = (list) => (list.includes(term) ? 2 : prefix && list.some((w) => w.startsWith(term)) ? 1 : 0);
      best = Math.max(best, hit(e.t) * 3, hit(e.b));
    }
    if (!best) return 0;
    total += best;
  }
  if (phrase && e.ft.includes(phrase)) total += 6;
  else if (phrase && e.fb.includes(phrase)) total += 2;
  // Pages and FAQ answers before articles, for an equal match.
  return total + (e.type === "Article" ? 0 : 0.5);
}

// A short passage of the body around the first matching word.
function snippet(body, terms, max = 160) {
  const text = String(body || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const folded = fold(text);
  let at = -1;
  for (const alts of terms) for (const t of alts) {
    const m = new RegExp(`\\b${t}`).exec(folded);
    if (m && (at < 0 || m.index < at)) at = m.index;
  }
  let start = Math.max(0, at - 50);
  if (start > 0) start = text.indexOf(" ", start) + 1 || start;
  let end = Math.min(text.length, start + max);
  if (end < text.length) end = text.lastIndexOf(" ", end) > start ? text.lastIndexOf(" ", end) : end;
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

export function searchSite(q, { posts = [], limit = 8 } = {}) {
  const query = String(q || "").slice(0, 80);
  const raw = words(query);
  // Only words that say something: "how do I" alone finds nothing.
  const list = raw.filter((w) => !STOP.has(w) && (w.length > 1 || /\d/.test(w)));
  if (!list.length) return [];
  const terms = [...new Set(list)].slice(0, 8).map((w) => [w, ...(ALIASES[w] || [])].map(stem));
  const phrase = list.length > 1 ? fold(query).replace(/[^a-z0-9]+/g, " ").trim() : "";
  const entries = [...baseEntries(), ...blogEntries(posts)];
  return entries
    .map((e) => ({ e, s: score(e, terms, phrase) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.e.title.length - b.e.title.length)
    .slice(0, limit)
    .map(({ e }) => ({ type: e.type, title: e.title, url: e.url, snippet: snippet(e.body, terms) }));
}
