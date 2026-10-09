// DEV/QA ONLY — the blog served from Soro's RSS feed (lib/blog.js): reading
// and cleaning articles, copying their images, the pages and redirects, and
// following the feed as articles change or are unpublished. Self-contained:
// starts a stand-in feed and its own app server on a throwaway store.
//   node scripts/dev/blog-tests.js
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { parseFeed, cleanHtml, privateAddress, excerptOf, pipeTable, truncate, fetchImage } from "../../lib/blog.js";

const results = [];
const ok = (name, cond, extra = "") => (results.push(!!cond), console.log(cond ? "PASS" : "FAIL", name, extra));
const FEED_PORT = 4030, APP_PORT = 3130;
const F = `http://localhost:${FEED_PORT}`, B = `http://localhost:${APP_PORT}`;
const SECRET = "blog-tests-cron-secret-blog-tests";

/* ------------------------------ Unit checks ------------------------------ */

const clean = cleanHtml('<h1>My Title</h1><p onclick="x">Hi <a href="javascript:alert(1)">x</a> <a href="https://keeperheadshots.com/blog?post=other-one">o</a></p><script>alert(1)</script><iframe src="https://e.com"></iframe><p><img src="https://e.com/a.jpg" onerror="x"></p><img src="https://e.com/b.jpg"><p style="color:red">ok</p>', {
  title: "My title",
  images: new Map([["https://e.com/b.jpg", { src: "/blog/img/aaaaaaaaaaaaaaaaaaaaaaaa.jpg", width: 10, height: 5 }]]),
});
ok("clean: no script, handlers, iframes or styles", !/script|onclick|onerror|iframe|style=|javascript:/i.test(clean), clean);
ok("clean: leading title heading dropped", !clean.includes("My Title"));
ok("clean: article links point at /blog/<slug>", clean.includes('href="/blog/other-one"'));
ok("clean: image without a copy left out, copied one rewritten", !clean.includes("e.com/a.jpg") && clean.includes('src="/blog/img/aaaaaaaaaaaaaaaaaaaaaaaa.jpg"') && clean.includes('width="10"'));
ok("clean: h1 inside the article becomes h2", cleanHtml("<p>a</p><h1>Sub</h1>").includes("<h2>Sub</h2>"));
ok("clean: off-site links get nofollow, article links don't", /<a href="https:\/\/other\.example\/x" rel="nofollow noopener">/.test(cleanHtml('<p><a href="https://other.example/x">e</a></p>')) && !/rel=/.test(cleanHtml('<p><a href="https://keeperheadshots.com/blog?post=other-one">o</a></p>')), cleanHtml('<p><a href="https://other.example/x">e</a></p>'));
ok("tables: Markdown table in a paragraph becomes a table", cleanHtml("<p>| Use | Crop | | --- | --- | | LinkedIn | Square | | Website | Portrait |</p>") === '<table><thead><tr><th scope="col">Use</th><th scope="col">Crop</th></tr></thead><tbody><tr><td>LinkedIn</td><td>Square</td></tr><tr><td>Website</td><td>Portrait</td></tr></tbody></table>');
ok("tables: other text with bars left alone", pipeTable("| just | some bars |") === null && cleanHtml("<p>a | b</p>") === "<p>a | b</p>");
ok("tables: empty cells keep their place", pipeTable("| | Price | | --- | --- | | Studio | $300 |") === '<table><thead><tr><th scope="col"></th><th scope="col">Price</th></tr></thead><tbody><tr><td>Studio</td><td>$300</td></tr></tbody></table>' && pipeTable("| a | b | c |\n| --- | --- | --- |\n| 1 |  | 3 |").includes("<td>1</td><td></td><td>3</td>"));
ok("tables: a table is read within its own paragraph", cleanHtml("<p>| x | y |</p><p>| A | B | | --- | --- | | 1 | 2 |</p>") === '<p>| x | y |</p><table><thead><tr><th scope="col">A</th><th scope="col">B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
ok("excerpt: plain text with angle brackets kept", truncate("Use <b> tags and a <title> element.", 160) === "Use <b> tags and a <title> element.");
ok("excerpt: cut at a word", excerptOf("word ".repeat(80), 50).endsWith("word…"));
ok("addresses: private ones refused", ["127.0.0.1", "10.1.2.3", "192.168.0.1", "169.254.169.254", "172.20.0.1", "::1", "fd00::1", "::ffff:127.0.0.1"].every(privateAddress) && !["8.8.8.8", "2606:4700::1111"].some(privateAddress));
ok("addresses: IPv6 forms of private addresses refused", ["::ffff:7f00:1", "::ffff:a9fe:a9fe", "64:ff9b::a9fe:a9fe", "::7f00:1", "fec0::1", "2002:7f00:1::", "100::1"].every(privateAddress) && !["::ffff:8.8.8.8", "2002:808:808::1"].some(privateAddress));
for (const u of ["https://localhost:9/x.jpg", "https://127.0.0.1/x.jpg", "https://[::ffff:127.0.0.1]/x.jpg", "http://example.com/x.jpg"]) {
  const err = await fetchImage(u).then(() => "fetched", (e) => e.message);
  ok(`images: ${u} refused`, /not a public address|not https/.test(err), err);
}
// Hostile feeds are read in linear time (no pattern re-scans the text).
const timed = (xml) => {
  const t = Date.now();
  try { parseFeed(xml); } catch {}
  return Date.now() - t;
};
const slow = Math.max(timed("<rss><item><enclosure " + "a".repeat(1e6) + "/></item>"), timed("<rss>" + "<item>".repeat(3e5)), timed("<rss><item>" + "<link>".repeat(1e5) + "</item>"), timed("<rss>" + "<![CDATA[".repeat(2e5)));
ok("feed: hostile input read quickly", slow < 2000, `${slow} ms`);
ok("feed: one broken item doesn't stop the rest", parseFeed('<rss><item><title>a</title><link>https://[</link></item><item><title>b</title><link>https://keeperheadshots.com/blog?post=ok-one</link></item></rss>').map((i) => i.slug).join() === ",ok-one");
let threw = false;
try { parseFeed("<html><body>Not a feed</body></html>"); } catch { threw = true; }
ok("feed: an HTML page isn't read as a feed", threw);

/* ------------------------------ Stand-in feed ------------------------------ */

const png = (color, w = 1200, h = 675) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg().toBuffer();
const IMAGES = { "/img/hero.jpg": await png("#446688"), "/img/inline.jpg": await png("#884444", 800, 500), "/img/second.jpg": await png("#448844") };
const item = ({ slug, title, date, body, extra = "" }) => `
  <item>
    <title>${title}</title>
    <link>https://keeperheadshots.com/blog?post=${slug}</link>
    <guid isPermaLink="false">guid-${slug}</guid>
    <pubDate>${date}</pubDate>
    ${extra}
    ${body}
  </item>`;
const first = (title = "What to Wear for a Headshot") =>
  item({
    slug: "what-to-wear",
    title,
    date: "Tue, 29 Sep 2026 10:00:00 GMT",
    extra: `<slug>what-to-wear</slug><enclosure url="${F}/img/hero.jpg" type="image/jpeg" length="1" />`,
    body: `<description><![CDATA[Pick solid colors and a good fit. Here is how.]]></description>
    <content:encoded><![CDATA[<h1>${title}</h1><p>Solid colors work best. See <a href="https://keeperheadshots.com/blog?post=linkedin-photo-tips">our LinkedIn tips</a>.</p><script>alert(1)</script><p><img src="${F}/img/inline.jpg" alt="A navy suit"></p><h2>Colors</h2><ul><li>Navy</li><li>Gray</li></ul>]]></content:encoded>`,
  });
const second = item({
  slug: "linkedin-photo-tips",
  title: "LinkedIn Photo Tips &amp; Tricks",
  date: "Mon, 28 Sep 2026 09:00:00 GMT",
  extra: `<media:content url="${F}/img/second.jpg" medium="image"><media:description>A smiling professional</media:description></media:content>`,
  body: `<description>&lt;p&gt;Your LinkedIn photo is often the first impression &amp;amp; it matters.&lt;/p&gt;</description>`,
});
const bad = item({ slug: "", title: "No address", date: "Sun, 27 Sep 2026 09:00:00 GMT", body: "<description>x</description>" }).replace(/<link>.*<\/link>/, "");
const feed = (items) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">
<channel><title>Keeper Headshots</title><link>https://keeperheadshots.com/blog</link><description>Blog</description>
${items.join("\n")}
</channel></rss>`;

let current = feed([first(), second, bad]);
let failFeed = false;
const feedServer = http.createServer((req, res) => {
  if (req.url.startsWith("/feed.xml")) {
    if (failFeed) return res.writeHead(500).end("oops");
    return res.writeHead(200, { "content-type": "application/rss+xml" }).end(current);
  }
  const img = IMAGES[req.url];
  if (img) return res.writeHead(200, { "content-type": "image/jpeg" }).end(img);
  res.writeHead(404).end();
});
await new Promise((r) => feedServer.listen(FEED_PORT, r));

const parsed = parseFeed(current);
ok("feed: three items read", parsed.length === 3);
ok("feed: slug from <slug>, from ?post=, and none", parsed[0].slug === "what-to-wear" && parsed[1].slug === "linkedin-photo-tips" && parsed[2].slug === "");
ok("feed: featured image from enclosure and media:content, with alt", parsed[0].image.endsWith("/img/hero.jpg") && parsed[1].image.endsWith("/img/second.jpg") && parsed[1].imageAlt === "A smiling professional");
ok("feed: CDATA article and escaped description", parsed[0].html.includes("<h2>Colors</h2>") && parsed[1].html.includes("<p>Your LinkedIn photo") && parsed[1].title === "LinkedIn Photo Tips & Tricks");

/* ------------------------------- App server ------------------------------- */

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "blog-tests-"));
const app = spawn(process.execPath, ["server.js"], {
  env: { ...process.env, DATA_DIR: DATA, PORT: String(APP_PORT), SESSION_SECRET: "blog-tests-session-secret-blog-tests", SORO_FEED_URL: `${F}/feed.xml?key=abc`, BLOG_ALLOW_LOCAL: "1", CRON_SECRET: SECRET, VERCEL: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
app.stdout.on("data", (d) => (log += d));
app.stderr.on("data", (d) => (log += d));
const done = async (code) => {
  app.kill();
  feedServer.close();
  fs.rmSync(DATA, { recursive: true, force: true });
  const failed = results.filter((r) => !r).length;
  if (failed) console.log(log.split("\n").slice(-40).join("\n"));
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(code ?? (failed ? 1 : 0));
};
const get = (p, o = {}) => fetch(B + p, { redirect: "manual", ...o });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  for (let i = 0; i < 60; i++) {
    if (await get("/api/version").then((r) => r.ok, () => false)) break;
    await sleep(250);
  }

  // The first visit shows the embed and reads the feed in the background.
  let r = await get("/blog");
  let page = await r.text();
  ok("before the first read: the embed page", page.includes("soro-blog"));
  for (let i = 0; i < 60 && !page.includes("data-blog-ssr"); i++) {
    await sleep(250);
    page = await (await get("/blog")).text();
  }
  r = await get("/blog");
  page = await r.text();
  ok("list: served from the feed", page.includes("data-blog-ssr"));
  ok("list: no Soro script, and a strict page policy", !page.includes("trysoro.com") && !r.headers.get("content-security-policy").includes("trysoro"));
  ok("list: newest first, invalid item skipped", page.indexOf("/blog/what-to-wear") < page.indexOf("/blog/linkedin-photo-tips") && !page.includes("No address"));
  ok("list: titles escaped", page.includes("LinkedIn Photo Tips &amp; Tricks"));
  ok("list: Blog structured data", page.includes('"@type":"Blog"'));

  r = await get("/blog/what-to-wear");
  page = await r.text();
  ok("article: 200 with its title", r.status === 200 && page.includes("<title>What to Wear for a Headshot · Keeper Headshots Blog</title>"));
  ok("article: its own canonical", page.includes('<link rel="canonical" href="https://keeperheadshots.com/blog/what-to-wear" />'));
  ok("article: description from the excerpt", page.includes('<meta name="description" content="Pick solid colors and a good fit. Here is how." />'));
  ok("article: og article with its image", page.includes('content="article"') && /og:image" content="https:\/\/keeperheadshots\.com\/blog\/img\/[a-f0-9]{24}\.jpg"/.test(page) && page.includes('og:image:width" content="1200"'));
  ok("article: BlogPosting structured data", page.includes('"@type":"BlogPosting"') && page.includes('"datePublished":"2026-09-29T10:00:00.000Z"'));
  ok("article: script removed, one h1", !page.includes("alert(1)") && (page.match(/<h1\b/g) || []).length === 1);
  ok("article: link to the other article rewritten", page.includes('href="/blog/linkedin-photo-tips"'));
  const imgs = [...page.matchAll(/src="(\/blog\/img\/[a-f0-9]{24}\.jpg)"/g)].map((m) => m[1]);
  ok("article: hero and inline images served from here", imgs.length >= 2 && !page.includes(`${F}/img`));
  const ir = await get(imgs[0]);
  ok("image: served, cached for good", ir.status === 200 && ir.headers.get("content-type") === "image/jpeg" && /immutable/.test(ir.headers.get("cache-control")));
  ok("image: unknown name 404", (await get("/blog/img/ffffffffffffffffffffffff.jpg")).status === 404 && (await get("/blog/img/..%2F..%2Fusers.json")).status === 404);

  r = await get("/blog?post=what-to-wear");
  ok("old embed address: 301 to /blog/<slug>", r.status === 301 && r.headers.get("location") === "/blog/what-to-wear");
  ok("old embed address, unknown article: 404", (await get("/blog?post=not-here")).status === 404);
  ok("unknown article: 404", (await get("/blog/not-here")).status === 404);
  r = await get("/blog/What-To-Wear");
  ok("capitals: 301 to the lowercase address", r.status === 301 && r.headers.get("location") === "/blog/what-to-wear");
  const sm = await (await get("/blog/sitemap.xml")).text();
  ok("sitemap: both articles", sm.includes("<loc>https://keeperheadshots.com/blog/what-to-wear</loc>") && sm.includes("/blog/linkedin-photo-tips</loc>"));
  ok("cron: needs the secret", (await get("/api/cron/blog")).status === 404);
  const cron = () => get("/api/cron/blog", { headers: { authorization: `Bearer ${SECRET}` } }).then((x) => x.json());

  // Nothing changed: nothing rebuilt.
  let rep = await cron();
  ok("read again: all unchanged", rep.unchanged === 2 && !rep.added && !rep.updated, JSON.stringify(rep));

  // One article edited, one unpublished.
  current = feed([first("What to Wear for Your Headshot")]);
  rep = await cron();
  ok("read again: one updated, one removed", rep.updated === 1 && rep.removed === 1, JSON.stringify(rep));
  ok("unpublished article: 404", (await get("/blog/linkedin-photo-tips")).status === 404);
  ok("edited article: new title", (await (await get("/blog/what-to-wear")).text()).includes("<h1 class=\"display h-1\">What to Wear for Your Headshot</h1>"));
  ok("unused images removed", fs.readdirSync(path.join(DATA, "blog", "img")).length === 2, fs.readdirSync(path.join(DATA, "blog", "img")).join(","));

  // An empty feed or a failed read keeps what's there.
  current = feed([]);
  rep = await cron();
  ok("empty feed: kept the articles", /no usable articles/.test(rep.error || "") && (await get("/blog/what-to-wear")).status === 200, JSON.stringify(rep));
  // A feed whose articles all have addresses we can't use: also kept.
  current = feed([first().replace(/<slug>what-to-wear<\/slug>/, "<slug>What_To_Wear</slug>").replace(/\?post=what-to-wear/, "?post=What_To_Wear")]);
  rep = await cron();
  ok("no usable articles: kept the articles", /no usable articles/.test(rep.error || "") && (await get("/blog/what-to-wear")).status === 200, JSON.stringify(rep));
  failFeed = true;
  rep = await cron();
  ok("failed read: kept the articles", /500/.test(rep.error || "") && (await get("/blog/what-to-wear")).status === 200, JSON.stringify(rep));
  failFeed = false;

  // Articles missing from the blog: a 404 page with the latest articles.
  r = await get("/blog/not-here");
  page = await r.text();
  ok("unknown article: a blog 404 page", r.status === 404 && page.includes("We couldn't find that article") && page.includes("data-blog-ssr") && page.includes('content="noindex"'));

  // Most of the blog vanishing at once is treated as a fault.
  const many = ["one-a", "two-b", "three-c", "four-d"].map((slug, i) => item({ slug, title: `Post ${i}`, date: `Mon, 2${i} Sep 2026 09:00:00 GMT`, body: "<description>x</description><content:encoded><![CDATA[<p>Body</p>]]></content:encoded>" }));
  current = feed(many);
  rep = await cron();
  current = feed([many[0]]);
  rep = await cron();
  ok("most articles gone at once: kept", rep.removed === 0 && (await get("/blog/four-d")).status === 200, JSON.stringify(rep));
  current = feed(many.slice(0, 3));
  rep = await cron();
  ok("one article unpublished: removed", rep.removed === 1 && (await get("/blog/four-d")).status === 404, JSON.stringify(rep));

  // An image that can't be copied is retried later, not on every read.
  current = feed([item({ slug: "broken-image", title: "Broken image", date: "Tue, 29 Sep 2026 09:00:00 GMT", extra: `<enclosure url="${F}/img/missing.jpg" type="image/jpeg" length="1" />`, body: "<description>x</description>" }), ...many.slice(0, 3)]);
  rep = await cron();
  const rep2 = await cron();
  ok("missing image: retried later, not every read", rep.incomplete === 1 && rep2.unchanged === 4 && !rep2.incomplete, JSON.stringify([rep, rep2]));

  // Other pages keep their normal policy.
  const home = await get("/");
  ok("other pages unchanged", home.status === 200 && !home.headers.get("content-security-policy").includes("trysoro"));
} catch (err) {
  console.log("FAIL", err.stack);
  results.push(false);
}
await done();
