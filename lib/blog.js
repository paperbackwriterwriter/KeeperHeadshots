// The blog's articles, from Soro's RSS feed (trysoro.com). Soro writes the
// articles; this server reads its feed and serves each one as its own page,
// /blog/<slug> (lib/seo.js), so search engines see the whole article in the
// page itself.
//
// The feed's address is the credential (whoever has it can read the feed), so
// it lives in the SORO_FEED_URL setting, never in the code. Without it the
// blog shows Soro's embed instead (views/blog.js).
//
// Nothing is pushed to us: the feed is read at most once an hour, when someone
// opens the blog, and once a day by cron. The feed is the source of truth: an
// article Soro unpublishes disappears from the feed and so from the site. An
// empty feed never clears the blog, though (more likely a fault than every
// article unpublished at once). Soro caches the feed for about an hour.
//
// Stored as blog/index.json (every article's summary), blog/posts/<slug>.json
// (the article) and blog/img/<id>.jpg|webp (its images, copied here because
// Soro's image addresses may not last). Article HTML is cleaned to a short
// list of tags and attributes before it's stored.

import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import sharp from "sharp";
import sanitizeHtml from "sanitize-html";
import { waitUntil } from "@vercel/functions";
import { getJSON, putJSON, createJSON, updateJSON, getFile, putFile, del, list, UNCHANGED } from "./storage.js";
import { BLOG_SLUG } from "../public/js/shared/soro.js";

const INDEX = "blog/index.json";
const LOCK = "blog/lock.json";
const postKey = (slug) => `blog/posts/${slug}.json`;
export const IMG_NAME = /^[a-f0-9]{24}\.(jpg|webp)$/;
const REFRESH_MS = 60 * 60_000; // read the feed at most once an hour
const RETRY_MS = 10 * 60_000; // after a failed read
const LOCK_MS = 5 * 60_000;
const BUDGET_MS = 200_000; // per run; articles not reached wait for the next
const MAX_ITEMS = 400;
const MAX_IMAGES = 30; // per article
// Bump when the stored form of an article changes, so every article is rebuilt.
const FORMAT = 1;

export const feedUrl = () => (process.env.SORO_FEED_URL || "").trim();
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const validSlug = (s) => typeof s === "string" && s.length <= 150 && BLOG_SLUG.test(s);

/* ------------------------------- Reading the feed ------------------------------- */

const ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", nbsp: " " };
const decodeXml = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
// Element text: CDATA sections as they are, everything else entity-decoded.
function xmlText(s) {
  let out = "";
  let last = 0;
  for (const m of s.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
    out += decodeXml(s.slice(last, m.index)) + m[1];
    last = m.index + m[0].length;
  }
  return (out + decodeXml(s.slice(last))).trim();
}
const attrsOf = (s) => Object.fromEntries([...s.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)].map((m) => [m[1].toLowerCase(), decodeXml(m[3] ?? m[4])]));
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isUrl = (s) => /^https?:\/\/\S+$/i.test(s || "");

// One <item> as plain fields. Tag names Soro may use for the slug, excerpt
// and image alt text aren't documented, so those are matched loosely.
export function parseItem(xml) {
  // Set CDATA aside first, so tags inside an article's HTML aren't read as feed tags.
  const cdata = [];
  const safe = xml.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (m) => `\u0000${cdata.push(m) - 1}\u0000`);
  const restore = (s) => s.replace(/\u0000(\d+)\u0000/g, (_, i) => cdata[i]);
  const text = (name) => {
    const m = new RegExp(`<(${name})(?:\\s[^>]*)?>([\\s\\S]*?)</\\1>`, "i").exec(safe);
    return m ? xmlText(restore(m[2])) : "";
  };
  const local = (re) => {
    const m = new RegExp(`<((?:[\\w-]+:)?(?:${re}))(?:\\s[^>]*)?>([\\s\\S]*?)</\\1>`, "i").exec(safe);
    return m ? xmlText(restore(m[2])) : "";
  };
  const tags = (name) => [...safe.matchAll(new RegExp(`<${reEsc(name)}\\b([^>]*?)/?>`, "gi"))].map((m) => attrsOf(m[1]));

  const link = text("link");
  let slug = local("slug").toLowerCase();
  if (!validSlug(slug) && isUrl(link)) {
    const u = new URL(link);
    slug = (u.searchParams.get("post") || u.pathname.split("/").filter(Boolean).pop() || "").toLowerCase();
  }
  const content = text("content:encoded");
  const description = text("description");

  // The featured image: media:content / enclosure / media:thumbnail, or a
  // tag named like "image" holding an address.
  const isImage = (a) => isUrl(a.url) && (/^image\//i.test(a.type || "") || a.medium === "image" || /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(a.url));
  const media = [...tags("media:content"), ...tags("enclosure"), ...tags("media:thumbnail")].find(isImage);
  let image = media?.url || "";
  if (!image) {
    const m = new RegExp(`<((?:[\\w-]+:)?[\\w-]*image[\\w-]*)(?:\\s[^>]*)?>([\\s\\S]*?)</\\1>`, "i").exec(safe);
    const inner = m ? restore(m[2]) : "";
    image = isUrl(xmlText(inner)) ? xmlText(inner) : xmlText(/<url>([\s\S]*?)<\/url>/i.exec(inner)?.[1] || "");
    if (!isUrl(image)) image = "";
  }
  const imageAlt = media?.alt || local("media:description|media:title|[\\w-]*alt[\\w-]*") || "";

  return {
    slug,
    guid: text("guid"),
    title: text("title"),
    link,
    published: text("pubDate") || text("dc:date") || text("published"),
    author: text("dc:creator") || text("author"),
    html: content || description,
    excerpt: local("excerpt|summary") || (content ? description : ""),
    image,
    imageAlt,
  };
}

export function parseFeed(xml) {
  if (!/<(rss|rdf:RDF|channel)\b/i.test(xml)) throw new Error("That address didn't return an RSS feed.");
  const cdata = [];
  const safe = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, (m) => `\u0000${cdata.push(m) - 1}\u0000`);
  const items = (safe.match(/<item\b[\s\S]*?<\/item>/gi) || []).slice(0, MAX_ITEMS);
  return items.map((it) => parseItem(it.replace(/\u0000(\d+)\u0000/g, (_, i) => cdata[i])));
}

/* ------------------------------ Cleaning articles ------------------------------ */

export const plainText = (html) =>
  decodeXml(sanitizeHtml(String(html || ""), { allowedTags: [], allowedAttributes: {} }))
    .replace(/\s+/g, " ")
    .trim();
export const excerptOf = (s, max = 160) => {
  const t = plainText(s);
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), max * 0.6)).replace(/[\s,.;:–—-]+$/, "") + "…";
};

const SITE_HOSTS = new Set(["keeperheadshots.com", "www.keeperheadshots.com"]);
// Links between articles, however Soro writes them, point at /blog/<slug>.
function localHref(href) {
  if (href.startsWith("#")) return href;
  let u;
  try {
    u = new URL(href, "https://keeperheadshots.com");
  } catch {
    return null;
  }
  if (!SITE_HOSTS.has(u.hostname)) return href;
  const post = u.searchParams.get("post");
  if (u.pathname === "/blog" && post && validSlug(post.toLowerCase())) return `/blog/${post.toLowerCase()}${u.hash}`;
  return u.pathname + u.search + u.hash;
}

// Clean article HTML. `images` maps each original image address to the copy
// stored here; images without a copy are left out.
export function cleanHtml(html, { images = new Map(), title = "" } = {}) {
  let out = sanitizeHtml(String(html || ""), {
    allowedTags: ["p", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "strong", "b", "em", "i", "u", "s", "a", "img", "figure", "figcaption", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "br", "hr", "code", "pre", "sup", "sub", "mark", "small", "dl", "dt", "dd"],
    allowedAttributes: { a: ["href", "title"], img: ["src", "alt", "width", "height", "loading", "decoding"], th: ["colspan", "rowspan", "scope"], td: ["colspan", "rowspan"], ol: ["start"] },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https"] },
    allowProtocolRelative: false,
    // The page has its own <h1> (the title), so article headings start at <h2>.
    transformTags: {
      h1: "h2",
      a: (tag, attribs) => {
        const href = attribs.href && localHref(attribs.href);
        // No usable address: keep the words, drop the link.
        return href ? { tagName: "a", attribs: { ...attribs, href } } : { tagName: "span", attribs: {} };
      },
      img: (tag, attribs) => {
        const copy = images.get(attribs.src);
        if (!copy) return { tagName: "img", attribs: {} };
        return { tagName: "img", attribs: { src: copy.src, alt: attribs.alt || "", width: String(copy.width), height: String(copy.height), loading: "lazy", decoding: "async" } };
      },
    },
    exclusiveFilter: (frame) => (frame.tag === "img" && !frame.attribs.src) || (["p", "figure"].includes(frame.tag) && !frame.text.trim() && !frame.mediaChildren?.length),
  }).trim();
  // Soro may start the article with its title; the page already shows it.
  const first = /^<h2>([\s\S]*?)<\/h2>/.exec(out);
  if (first && title && plainText(first[1]).toLowerCase() === title.trim().toLowerCase()) out = out.slice(first[0].length).trim();
  return out;
}
const imageSources = (html) => [...String(html || "").matchAll(/<img\b[^>]*?\bsrc\s*=\s*("([^"]*)"|'([^']*)')/gi)].map((m) => decodeXml(m[2] ?? m[3])).filter(isUrl);

/* ------------------------------ Copying images ------------------------------ */

// Image addresses come from article content, so only public web addresses
// are fetched (never this server's own network). BLOG_ALLOW_LOCAL is for tests.
export function privateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return privateAddress(mapped[1]);
  return v === "::" || v === "::1" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || /^ff/.test(v);
}
async function checkAddress(u) {
  if (process.env.BLOG_ALLOW_LOCAL === "1") return;
  if (u.protocol !== "https:") throw new Error("not https");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => privateAddress(a.address))) throw new Error("not a public address");
}
async function readCapped(res, max) {
  const len = Number(res.headers.get("content-length") || 0);
  if (len > max) throw new Error("too large");
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > max) throw new Error("too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function fetchImage(url) {
  let u = new URL(url);
  for (let hop = 0; hop < 4; hop++) {
    await checkAddress(u);
    const res = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(20_000), headers: { accept: "image/*" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      u = new URL(res.headers.get("location"), u);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return readCapped(res, 15 * 1024 * 1024);
  }
  throw new Error("too many redirects");
}
// Stores a copy, re-encoded (so only plain image data is ever served), at
// most 1600 px wide. Photos become JPEG; images with transparency, WebP.
async function copyImage(url) {
  const src = await fetchImage(url);
  const im = sharp(src, { limitInputPixels: 60e6 }).rotate();
  const { hasAlpha } = await im.metadata();
  const sized = im.resize({ width: 1600, withoutEnlargement: true });
  const { data, info } = await (hasAlpha ? sized.webp({ quality: 82 }) : sized.jpeg({ quality: 82, mozjpeg: true })).toBuffer({ resolveWithObject: true });
  const name = `${sha(url).slice(0, 24)}.${hasAlpha ? "webp" : "jpg"}`;
  await putFile(`blog/img/${name}`, data, hasAlpha ? "image/webp" : "image/jpeg");
  return { src: `/blog/img/${name}`, width: info.width, height: info.height };
}

/* --------------------------------- Syncing --------------------------------- */

async function fetchFeed(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { accept: "application/rss+xml, application/xml, text/xml" } });
  if (!res.ok) throw new Error(`The feed answered HTTP ${res.status}.`);
  return (await readCapped(res, 20 * 1024 * 1024)).toString("utf8");
}

const dateOf = (s) => {
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

// Builds one stored article. `known` is the earlier copies of images (by
// original address), so unchanged images aren't fetched again.
async function buildPost(item, known) {
  const images = new Map();
  let missing = 0;
  const want = [...new Set([item.image, ...imageSources(item.html)].filter(isUrl))].slice(0, MAX_IMAGES + 1);
  for (const url of want) {
    if (known.has(url)) {
      images.set(url, known.get(url));
      continue;
    }
    try {
      images.set(url, await copyImage(url));
    } catch (err) {
      missing++;
      console.warn("[blog] image", item.slug, err.message);
    }
  }
  const title = plainText(item.title) || item.slug;
  const html = cleanHtml(item.html, { images, title });
  const hero = item.image && images.get(item.image);
  return {
    slug: item.slug,
    guid: item.guid || item.link || item.slug,
    title,
    excerpt: excerptOf(item.excerpt || item.html, 300),
    html,
    image: hero ? { ...hero, alt: plainText(item.imageAlt) } : null,
    author: plainText(item.author),
    published: dateOf(item.published),
    words: plainText(html).split(" ").filter(Boolean).length,
    images: Object.fromEntries(images),
    // Some images couldn't be copied: try again on the next read.
    incomplete: missing > 0,
  };
}
const summary = (p, hash, modified) => ({ slug: p.slug, title: p.title, excerpt: p.excerpt, image: p.image, published: p.published, modified, words: p.words, hash, incomplete: p.incomplete || undefined });

async function takeLock(now) {
  if (await createJSON(LOCK, { until: now + LOCK_MS })) return true;
  let got = false;
  await updateJSON(LOCK, (l) => {
    got = false;
    if (l && l.until > now) return UNCHANGED;
    got = true;
    return { until: now + LOCK_MS };
  });
  return got;
}

// Reads the feed and updates the stored articles. Returns a short report.
export async function syncBlog({ now = Date.now() } = {}) {
  const url = feedUrl();
  if (!url) return { skipped: "SORO_FEED_URL isn't set" };
  if (!(await takeLock(now))) return { skipped: "another read is running" };
  const started = Date.now();
  const old = (await getJSON(INDEX).catch(() => null)) || { posts: [] };
  const report = { items: 0, added: 0, updated: 0, removed: 0, unchanged: 0, skipped: 0, incomplete: 0 };
  try {
    let items;
    try {
      items = parseFeed(await fetchFeed(url));
    } catch (err) {
      await putJSON(INDEX, { ...old, checkedAt: new Date(now).toISOString(), error: err.message });
      bust();
      console.error("[blog] couldn't read the feed:", err.message);
      return { ...report, error: err.message };
    }
    report.items = items.length;
    if (!items.length && old.posts.length) {
      console.error("[blog] the feed is empty; keeping the", old.posts.length, "articles already on the site");
      await putJSON(INDEX, { ...old, checkedAt: new Date(now).toISOString(), error: "The feed was empty." });
      bust();
      return { ...report, error: "empty feed" };
    }

    const before = new Map(old.posts.map((p) => [p.slug, p]));
    const posts = [];
    const seen = new Set();
    let outOfTime = false;
    for (const item of items) {
      if (!validSlug(item.slug) || seen.has(item.slug) || !(item.title || item.html)) {
        report.skipped++;
        continue;
      }
      seen.add(item.slug);
      const prev = before.get(item.slug);
      const hash = sha(JSON.stringify([FORMAT, item]));
      if (prev && prev.hash === hash && !prev.incomplete) {
        posts.push(prev);
        report.unchanged++;
        continue;
      }
      if (Date.now() - started > BUDGET_MS) {
        // Keep what's there; the next read carries on.
        outOfTime = true;
        if (prev) posts.push(prev);
        continue;
      }
      const stored = prev ? await getJSON(postKey(item.slug)).catch(() => null) : null;
      const post = await buildPost(item, new Map(Object.entries(stored?.images || {})));
      const modified = prev && prev.hash !== hash ? new Date(now).toISOString() : prev?.modified || post.published || new Date(now).toISOString();
      await putJSON(postKey(item.slug), { ...post, hash, modified });
      posts.push(summary(post, hash, modified));
      if (post.incomplete) report.incomplete++;
      report[prev ? "updated" : "added"]++;
    }

    // Articles no longer in the feed were unpublished.
    const gone = old.posts.filter((p) => !seen.has(p.slug));
    report.removed = gone.length;
    posts.sort((a, b) => String(b.published || "").localeCompare(String(a.published || "")));
    await putJSON(INDEX, {
      posts,
      // Out of time: read again soon rather than in an hour.
      checkedAt: new Date(outOfTime ? now - REFRESH_MS + RETRY_MS : now).toISOString(),
      syncedAt: new Date(now).toISOString(),
    });
    bust();
    if (gone.length) await del(gone.map((p) => postKey(p.slug))).catch((err) => console.warn("[blog] delete", err.message));
    // Images no article uses any more.
    if (!outOfTime) {
      const used = new Set();
      for (const p of posts) {
        const full = await getJSON(postKey(p.slug)).catch(() => null);
        for (const c of Object.values(full?.images || {})) used.add(c.src.split("/").pop());
      }
      const stale = (await list("blog/img/")).filter((k) => !used.has(k.split("/").pop()));
      if (stale.length) await del(stale).catch((err) => console.warn("[blog] delete images", err.message));
      report.imagesRemoved = stale.length;
    }
    report.ms = Date.now() - started;
    console.log("[blog]", JSON.stringify(report));
    return report;
  } finally {
    await putJSON(LOCK, { until: 0 }).catch(() => {});
  }
}

/* ------------------------------- Serving ------------------------------- */

let mem = { at: 0, index: null };
const posts = new Map();
function bust() {
  mem = { at: 0, index: null };
  posts.clear();
}
async function readIndex() {
  if (Date.now() - mem.at < 30_000) return mem.index;
  const index = await getJSON(INDEX).catch(() => null);
  mem = { at: Date.now(), index };
  return index;
}

// Reads the feed in the background when the stored copy is an hour old (or
// there's none yet). The page being served doesn't wait for it.
let reading = false;
function refreshIfDue(index) {
  if (reading || !feedUrl()) return;
  const checked = Date.parse(index?.checkedAt || 0) || 0;
  if (Date.now() - checked < (index?.error ? RETRY_MS : REFRESH_MS)) return;
  reading = true;
  const run = syncBlog()
    .catch((err) => console.error("[blog] read failed:", err.message))
    .finally(() => (reading = false));
  waitUntil(run);
}

// The articles, newest first, when the blog is served from the feed; null
// when it isn't (no feed set, or nothing read from it yet).
export async function blogIndex() {
  if (!feedUrl()) return null;
  const index = await readIndex();
  refreshIfDue(index);
  return index?.posts?.length ? index : null;
}

export async function blogPost(slug) {
  const index = await blogIndex();
  const entry = validSlug(slug) && index?.posts.find((p) => p.slug === slug);
  if (!entry) return null;
  const cached = posts.get(slug);
  if (cached?.hash === entry.hash) return cached;
  const post = await getJSON(postKey(slug)).catch(() => null);
  if (!post) return null;
  if (posts.size > 100) posts.clear();
  posts.set(slug, post);
  return post;
}

export const blogImage = async (name) => (IMG_NAME.test(name) ? getFile(`blog/img/${name}`) : null);
