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
import http from "node:http";
import https from "node:https";
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
const FORMAT = 2;

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
// The feed comes from outside, so everything here reads it in linear time:
// no pattern that can re-scan the rest of the text from every position.

// CDATA sections, found with indexOf. An unterminated one runs to the end.
function cdataParts(s) {
  const parts = [];
  let pos = 0;
  for (;;) {
    const a = s.indexOf("<![CDATA[", pos);
    if (a < 0) break;
    const b = s.indexOf("]]>", a + 9);
    const end = b < 0 ? s.length : b + 3;
    parts.push({ start: a, end, text: s.slice(a + 9, b < 0 ? s.length : b) });
    if (b < 0) break;
    pos = end;
  }
  return parts;
}
// Element text: CDATA sections as they are, everything else entity-decoded.
function xmlText(s) {
  let out = "";
  let last = 0;
  for (const c of cdataParts(s)) {
    out += decodeXml(s.slice(last, c.start)) + c.text;
    last = c.end;
  }
  return (out + decodeXml(s.slice(last))).trim();
}
// Replaces CDATA sections with placeholders, so tags inside an article's HTML
// aren't read as feed tags; `restore` puts them back.
function protectCdata(s) {
  const kept = [];
  let out = "";
  let last = 0;
  for (const c of cdataParts(s)) {
    out += s.slice(last, c.start) + `\u0000${kept.push(s.slice(c.start, c.end)) - 1}\u0000`;
    last = c.end;
  }
  return { safe: out + s.slice(last), restore: (t) => t.replace(/\u0000(\d+)\u0000/g, (_, i) => kept[i]) };
}
// Attributes of a tag: names must follow whitespace (so a long run of name
// characters is scanned once).
const attrsOf = (s) => Object.fromEntries([...s.matchAll(/(?:^|\s)([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)].map((m) => [m[1].toLowerCase(), decodeXml(m[3] ?? m[4])]));
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isUrl = (s) => /^https?:\/\/\S+$/i.test(s || "") && URL.canParse(s);
// The first element whose name matches `namePattern` (a regex source) and
// that is closed: its name and inner text. Opening tags are found with
// [^<>] (stops at the next tag), closing tags with a plain search.
function element(safe, namePattern) {
  const open = new RegExp(`<(${namePattern})(?:\\s[^<>]*)?>`, "gi");
  for (let tries = 0, m; tries < 20 && (m = open.exec(safe)); tries++) {
    const close = new RegExp(`</${reEsc(m[1])}>`, "gi");
    close.lastIndex = open.lastIndex;
    const c = close.exec(safe);
    if (!c) return null; // nothing after this is closed either
    return { name: m[1], inner: safe.slice(open.lastIndex, c.index) };
  }
  return null;
}

// One <item> as plain fields. Tag names Soro may use for the slug, excerpt
// and image alt text aren't documented, so those are matched loosely.
export function parseItem(xml) {
  const { safe, restore } = protectCdata(xml);
  const text = (name) => {
    const e = element(safe, reEsc(name));
    return e ? xmlText(restore(e.inner)) : "";
  };
  const local = (re) => {
    const e = element(safe, `(?:[\\w-]+:)?(?:${re})`);
    return e ? xmlText(restore(e.inner)) : "";
  };
  const tags = (name) => [...safe.matchAll(new RegExp(`<${reEsc(name)}\\b([^<>]*)>`, "gi"))].map((m) => attrsOf(m[1].replace(/\/$/, "")));

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
    const e = element(safe, "(?:[\\w-]+:)?[\\w-]*image[\\w-]*");
    const inner = e ? restore(e.inner) : "";
    const url = element(inner, "url");
    image = isUrl(xmlText(inner)) ? xmlText(inner) : xmlText(url ? url.inner : "");
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

const MAX_ITEM = 2 * 1024 * 1024; // an article bigger than this is skipped
let lastShapes = "";
export function parseFeed(xml) {
  if (!/<(rss|rdf:RDF|channel)\b/i.test(xml)) throw new Error("That address didn't return an RSS feed.");
  const { safe, restore } = protectCdata(xml);
  const items = [];
  const open = /<item\b[^<>]*>/gi;
  const close = /<\/item>/gi;
  for (let m; items.length < MAX_ITEMS && (m = open.exec(safe)); ) {
    close.lastIndex = open.lastIndex;
    const c = close.exec(safe);
    if (!c) break;
    if (c.index - m.index <= MAX_ITEM) items.push(safe.slice(m.index, close.lastIndex));
    open.lastIndex = close.lastIndex;
  }
  // The tags Soro uses, names and attribute names only (never their content),
  // for the logs: the feed's format isn't documented.
  const shapes = new Set();
  for (const it of items.slice(0, 5)) {
    for (const m of it.matchAll(/<([\w:-]+)([^<>]*)>/g)) {
      const names = [...m[2].matchAll(/(?:^|\s)([\w:-]+)\s*=/g)].map((a) => a[1]);
      shapes.add(m[1] + (names.length ? `[${names.join(",")}]` : ""));
    }
  }
  lastShapes = [...shapes].filter((t) => t !== "item").sort().join(" ");
  const out = [];
  for (const it of items) {
    try {
      out.push(parseItem(restore(it)));
    } catch (err) {
      // One broken item doesn't stop the rest.
      console.warn("[blog] skipped an item:", err.message);
    }
  }
  return out;
}

/* ------------------------------ Cleaning articles ------------------------------ */

export const plainText = (html) =>
  decodeXml(sanitizeHtml(String(html || ""), { allowedTags: [], allowedAttributes: {} }))
    .replace(/\s+/g, " ")
    .trim();
export const excerptOf = (s, max = 160) => truncate(plainText(s), max);
// Shortens text that is already plain (not HTML) at a word boundary.
export const truncate = (text, max = 160) => {
  const t = String(text || "").replace(/\s+/g, " ").trim();
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
    allowedAttributes: { a: ["href", "title", "rel"], img: ["src", "alt", "width", "height", "loading", "decoding"], th: ["colspan", "rowspan", "scope"], td: ["colspan", "rowspan"], ol: ["start"] },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https"] },
    allowProtocolRelative: false,
    // The page has its own <h1> (the title), so article headings start at <h2>.
    transformTags: {
      h1: "h2",
      a: (tag, attribs) => {
        const href = attribs.href && localHref(attribs.href);
        // No usable address: keep the words, drop the link.
        // Off-site links (a hijacked feed could add them) aren't followed or given a referrer.
        return href ? { tagName: "a", attribs: { ...attribs, href, ...(/^https?:/i.test(href) ? { rel: "nofollow noopener" } : {}) } } : { tagName: "span", attribs: {} };
      },
      img: (tag, attribs) => {
        const copy = images.get(attribs.src);
        if (!copy) return { tagName: "img", attribs: {} };
        return { tagName: "img", attribs: { src: copy.src, alt: attribs.alt || "", width: String(copy.width), height: String(copy.height), loading: "lazy", decoding: "async" } };
      },
    },
    exclusiveFilter: (frame) => (frame.tag === "img" && !frame.attribs.src) || (["p", "figure"].includes(frame.tag) && !frame.text.trim() && !frame.mediaChildren?.length),
  }).trim();
  out = out.replace(/<p>(\|(?:(?!<\/p>)[\s\S])*\|)<\/p>/g, (m, body) => pipeTable(body) || m);
  // Soro may start the article with its title; the page already shows it.
  const first = /^<h2>([\s\S]*?)<\/h2>/.exec(out);
  if (first && title && plainText(first[1]).toLowerCase() === title.trim().toLowerCase()) out = out.slice(first[0].length).trim();
  return out;
}
// Soro writes tables as Markdown ("| a | b | | --- | --- | | 1 | 2 |"),
// which arrives as one paragraph (rows joined by "| |" or by line breaks).
// Returns a real table, or null if the paragraph isn't one. Cells are
// already-cleaned HTML, and may be empty.
export function pipeTable(body) {
  // "| a | b | | --- |" splits into "", " a ", " b ", " ", " --- ", ...: the
  // outer empties go, and a blank piece separates rows.
  const t = body.split("|").slice(1, -1).map((c) => c.trim());
  const dash = (c) => /^:?-{3,}:?$/.test(c);
  const s = t.findIndex(dash);
  const n = s - 1; // header cells come before the blank that ends the row
  if (n < 1 || t[s - 1] !== "" || !t.slice(s, s + n).every(dash)) return null;
  const head = t.slice(0, n);
  const rows = [];
  let i = s + n;
  while (i < t.length) {
    if (t[i] !== "") return null;
    const row = t.slice(i + 1, i + 1 + n);
    if (row.length !== n) return null;
    rows.push(row);
    i += n + 1;
  }
  if (!rows.length) return null;
  return `<table><thead><tr>${head.map((c) => `<th scope="col">${c}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

const imageSources = (html) => [...String(html || "").matchAll(/<img\b[^>]*?\bsrc\s*=\s*("([^"]*)"|'([^']*)')/gi)].map((m) => decodeXml(m[2] ?? m[3])).filter(isUrl);

/* ------------------------------ Copying images ------------------------------ */

// Image addresses come from article content, so only public web addresses
// are fetched (never this server's own network). The address is checked as
// the connection is made (the lookup hook below), so a name can't resolve to
// one address for the check and another for the download. BLOG_ALLOW_LOCAL
// is for tests.
const v4Private = (n) => {
  const [a, b] = [n >>> 24, (n >>> 16) & 255];
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
};
const v4Num = (ip) => ip.split(".").reduce((n, x) => n * 256 + Number(x), 0) >>> 0;
// An IPv6 address as eight 16-bit groups.
function v6Groups(ip) {
  let [head, tail] = ip.toLowerCase().split("::");
  const part = (s) => (s ? s.split(":") : []);
  const fix = (arr) => arr.flatMap((g) => (g.includes(".") ? [v4Num(g) >>> 16, v4Num(g) & 0xffff].map((x) => x.toString(16)) : [g]));
  const h = fix(part(head));
  const t = fix(part(tail));
  const groups = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  return groups.map((g) => parseInt(g, 16));
}
export function privateAddress(ip) {
  if (net.isIPv4(ip)) return v4Private(v4Num(ip));
  if (!net.isIPv6(ip)) return true;
  const g = v6Groups(ip);
  const v4 = (hi, lo) => v4Private(((hi << 16) | lo) >>> 0);
  const zero = (n) => g.slice(0, n).every((x) => x === 0);
  if (zero(5) && g[5] === 0xffff) return v4(g[6], g[7]); // ::ffff:a.b.c.d
  if (zero(6)) return true; // ::, ::1 and the old ::a.b.c.d form
  if (g[0] === 0x64 && g[1] === 0xff9b) return v4(g[6], g[7]); // NAT64
  if (g[0] === 0x2002) return v4(g[1], g[2]); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentation
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // discard
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0 || (g[0] & 0xff00) === 0xff00;
}
function checkedLookup(host, opts, cb) {
  dns.lookup(host, { ...opts, all: true }).then(
    (addrs) => {
      const bad = !addrs.length || addrs.some((a) => privateAddress(a.address));
      if (bad) return cb(new Error("not a public address"));
      if (opts?.all) return cb(null, addrs);
      cb(null, addrs[0].address, addrs[0].family);
    },
    (err) => cb(err),
  );
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
// One GET with node's own client (so the lookup hook applies), within `signal`.
function getOnce(u, signal, max) {
  const local = process.env.BLOG_ALLOW_LOCAL === "1";
  return new Promise((resolve, reject) => {
    if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return reject(new Error("not https"));
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (!local && net.isIP(host) && privateAddress(host)) return reject(new Error("not a public address"));
    const req = (u.protocol === "https:" ? https : http).get(u, { signal, headers: { accept: "image/*" }, ...(local ? {} : { lookup: checkedLookup }) }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve({ redirect: new URL(res.headers.location, u) });
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      if (Number(res.headers["content-length"] || 0) > max) {
        res.destroy();
        return reject(new Error("too large"));
      }
      const chunks = [];
      let size = 0;
      res.on("data", (c) => {
        size += c.length;
        if (size > max) {
          res.destroy();
          reject(new Error("too large"));
        } else chunks.push(c);
      });
      res.on("end", () => resolve({ body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("error", reject);
  });
}
// At most 20 s per image, redirects included.
export async function fetchImage(url) {
  const signal = AbortSignal.timeout(20_000);
  let u = new URL(url);
  for (let hop = 0; hop < 4; hop++) {
    const r = await getOnce(u, signal, 15 * 1024 * 1024);
    if (r.body) return r.body;
    u = r.redirect;
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
// original address), so unchanged images aren't fetched again. Images not
// reached by `deadline` are left for the next read.
async function buildPost(item, known, deadline) {
  const images = new Map();
  let missing = 0;
  const want = [...new Set([item.image, ...imageSources(item.html)].filter(isUrl))].slice(0, MAX_IMAGES + 1);
  for (const url of want) {
    if (known.has(url)) {
      images.set(url, known.get(url));
      continue;
    }
    if (Date.now() > deadline) {
      missing++;
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
const summary = (p, extra) => ({ slug: p.slug, title: p.title, excerpt: p.excerpt, image: p.image, published: p.published, words: p.words, ...extra });

// One read at a time across all servers. The lock names its holder, so a
// run that overruns never releases a lock another server has since taken.
async function takeLock(now, owner) {
  if (await createJSON(LOCK, { until: now + LOCK_MS, owner })) return true;
  let got = false;
  await updateJSON(LOCK, (l) => {
    got = false;
    if (l && l.until > now) return UNCHANGED;
    got = true;
    return { until: now + LOCK_MS, owner };
  });
  return got;
}
const releaseLock = (owner) => updateJSON(LOCK, (l) => (l?.owner === owner ? { until: 0 } : UNCHANGED));

// The stored index, or null when there isn't one yet. A failed read throws:
// treating it as "no articles" would drop them all.
async function storedIndex() {
  const index = await getJSON(INDEX);
  if (index) return index;
  // Missing, or unreadable? Blob storage reads back nothing either way, so
  // check for stored articles: with some there, an index should exist too.
  if ((await list("blog/posts/")).length) throw new Error("The blog index couldn't be read.");
  return null;
}

// Reads the feed and updates the stored articles. Returns a short report.
export async function syncBlog({ now = Date.now() } = {}) {
  const url = feedUrl();
  if (!url) return { skipped: "SORO_FEED_URL isn't set" };
  const owner = crypto.randomBytes(9).toString("base64url");
  if (!(await takeLock(now, owner))) return { skipped: "another read is running" };
  const started = Date.now();
  const deadline = started + BUDGET_MS;
  const report = { items: 0, added: 0, updated: 0, removed: 0, unchanged: 0, skipped: 0, incomplete: 0 };
  // A problem that leaves the articles as they are: note it, and try again
  // in RETRY_MS rather than on every visit.
  const keep = async (old, error) => {
    console.error("[blog]", error);
    await putJSON(INDEX, { ...old, checkedAt: new Date(now).toISOString(), error, format: FORMAT });
    bust();
    return { ...report, error };
  };
  try {
    const old = (await storedIndex()) || { posts: [] };
    let items;
    try {
      items = parseFeed(await fetchFeed(url));
    } catch (err) {
      return await keep(old, `Couldn't read the feed: ${err.message}`);
    }
    report.items = items.length;
    report.tags = lastShapes;

    // The articles this read can use: a valid address, not seen already.
    const seen = new Set();
    const usable = items.filter((item) => {
      const ok = validSlug(item.slug) && !seen.has(item.slug) && !!(item.title || item.html);
      if (ok) seen.add(item.slug);
      else report.skipped++;
      return ok;
    });
    // Nothing usable, while the site has articles: more likely a fault (or a
    // change in the feed's format) than every article unpublished at once.
    if (!usable.length && old.posts.length) return await keep(old, `The feed had no usable articles (${items.length} items); kept the ${old.posts.length} already on the site.`);

    const before = new Map(old.posts.map((p) => [p.slug, p]));
    let gone = old.posts.filter((p) => !seen.has(p.slug));
    // Most of the blog vanishing at once is also more likely a fault: keep
    // those articles, and say so (errors reach the alert email).
    if (gone.length >= 3 && gone.length > old.posts.length / 2) {
      console.error(`[blog] ${gone.length} of ${old.posts.length} articles are missing from the feed; keeping them. Unpublish fewer at a time, or clear blog/index.json to accept it.`);
      gone = [];
    }

    // Articles kept although the feed lacks them (the guard above) stay listed.
    const goneSlugs = new Set(gone.map((p) => p.slug));
    const posts = old.posts.filter((p) => !seen.has(p.slug) && !goneSlugs.has(p.slug));
    let outOfTime = false;
    for (const item of usable) {
      const prev = before.get(item.slug);
      const hash = sha(JSON.stringify([FORMAT, item])); // rebuild when this changes
      const chash = sha(JSON.stringify(item)); // the article itself changed
      // Unchanged, or missing images that aren't due for another try yet.
      if (prev && prev.hash === hash && (!prev.incomplete || now < (prev.retryAt || 0))) {
        posts.push(prev);
        report.unchanged++;
        continue;
      }
      if (Date.now() > deadline) {
        // Keep what's there; the next read carries on.
        outOfTime = true;
        if (prev) posts.push(prev);
        continue;
      }
      const stored = await getJSON(postKey(item.slug)).catch(() => null);
      const post = await buildPost(item, new Map(Object.entries(stored?.images || {})), deadline);
      const edited = prev?.chash && prev.chash !== chash;
      const modified = edited ? new Date(now).toISOString() : prev?.modified || post.published || new Date(now).toISOString();
      // Images that couldn't be copied: try again later, less often each time.
      const tries = post.incomplete ? (prev?.hash === hash ? prev.tries || 0 : 0) + 1 : undefined;
      const extra = { hash, chash, modified, incomplete: post.incomplete || undefined, tries, retryAt: tries ? now + Math.min(6 * 60, 15 * 2 ** (tries - 1)) * 60_000 : undefined };
      await putJSON(postKey(item.slug), { ...post, ...extra });
      posts.push(summary(post, extra));
      if (post.incomplete) report.incomplete++;
      report[prev ? "updated" : "added"]++;
    }

    // Articles no longer in the feed were unpublished.
    report.removed = gone.length;
    posts.sort((a, b) => String(b.published || "").localeCompare(String(a.published || "")));
    await putJSON(INDEX, {
      posts,
      // Out of time: read again soon rather than in an hour.
      checkedAt: new Date(outOfTime ? now - REFRESH_MS + RETRY_MS : now).toISOString(),
      syncedAt: new Date(now).toISOString(),
      format: FORMAT,
    });
    bust();
    if (gone.length) await del(gone.map((p) => postKey(p.slug))).catch((err) => console.warn("[blog] delete", err.message));
    // Images no article uses any more. Only when every article was read
    // back: an image is never deleted because its article couldn't be read.
    if (!outOfTime) {
      const used = new Set();
      let unread = 0;
      for (const p of posts) {
        const full = await getJSON(postKey(p.slug)).catch(() => null);
        if (!full) unread++;
        for (const c of Object.values(full?.images || {})) used.add(c.src.split("/").pop());
      }
      if (!unread) {
        const stale = (await list("blog/img/")).filter((k) => !used.has(k.split("/").pop()));
        if (stale.length) await del(stale).catch((err) => console.warn("[blog] delete images", err.message));
        report.imagesRemoved = stale.length;
      }
    }
    report.ms = Date.now() - started;
    console.log("[blog]", JSON.stringify(report));
    return report;
  } finally {
    await releaseLock(owner).catch(() => {});
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
  // A new way of storing articles (FORMAT) rebuilds them on the next visit.
  const due = index?.format !== FORMAT || Date.now() - checked >= (index?.error ? RETRY_MS : REFRESH_MS);
  if (!due) return;
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
