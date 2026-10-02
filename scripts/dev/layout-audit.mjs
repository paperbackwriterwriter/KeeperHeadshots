// DEV/QA ONLY — layout audit: loads every page and app state at eight widths
// (320 to 1440px) and measures what a person would notice: sideways
// scrolling, text cut off or spilling out of its box, uneven gaps between
// items in a row, one item left alone on a wrapped row, overlapping
// elements, and buttons of different heights side by side. It also saves a
// full-page screenshot of every state at phone and desktop width, to look at.
//
// It also watches the wardrobe strip move (with the animation clock sped
// up, so a whole loop fits in a few seconds) and reports if it stands
// still or ever shows a gap.
//
// BROWSER=webkit runs it in WebKit, Safari's engine (default: chromium).
// Needs the server on BASE wired to scripts/dev/mock-ai.js, with
// AUDIT_OWNER (default audit-owner@example.com) in its OWNER_EMAILS, and a
// fresh DATA_DIR (scripts/dev/layout-ci.sh sets all of this up):
//   node scripts/dev/layout-audit.mjs <outDir>
// Writes <outDir>/report.txt (and prints it) plus <outDir>/shots/*.png.
// Exits 1 if anything was found.

import { chromium, webkit } from "playwright";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { portraitSVG } from "../../public/js/shared/portrait.js";

const BASE = process.env.BASE || "http://localhost:3100";
const MOCK = process.env.MOCK || "http://localhost:4010";
const OWNER = process.env.AUDIT_OWNER || "audit-owner@example.com";
const OUT = process.argv[2] || "layout-audit";
const WIDTHS = (process.env.WIDTHS || "320,375,390,412,768,1024,1280,1440").split(",").map(Number);
const SHOT_WIDTHS = [390, 1280];
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const BROWSER = process.env.BROWSER === "webkit" ? "webkit" : "chromium";
fs.mkdirSync(path.join(OUT, "shots"), { recursive: true });

/* ---------- Accounts and shoots, made through the API ---------- */

function client() {
  const jar = { v: "" };
  const f = async (p, o = {}) => {
    const r = await fetch(BASE + p, { redirect: "manual", ...o, headers: { "content-type": "application/json", cookie: jar.v, ...(o.headers || {}) } });
    const sc = r.headers.get("set-cookie");
    if (sc) jar.v = sc.split(";")[0];
    let j = null;
    try { j = await r.json(); } catch {}
    return { status: r.status, j };
  };
  f.jar = jar;
  return f;
}
const mails = () => fetch(`${MOCK}/mock-mail`).then((r) => r.json());
const t = Date.now();
async function account(email, name, { verify = true } = {}) {
  const f = client();
  const up = await f("/api/auth/signup", { method: "POST", body: JSON.stringify({ name, email, password: "password123" }) });
  if (up.status !== 201) await f("/api/auth/signin", { method: "POST", body: JSON.stringify({ email, password: "password123" }) });
  else if (verify) {
    // The newest link: the stand-in mailbox keeps mail from earlier runs.
    const link = (await mails()).filter((m) => m.to.includes(email.toLowerCase())).flatMap((m) => m.links).filter((l) => l.includes("/verify?token=")).pop();
    await f("/api/auth/verify", { method: "POST", body: JSON.stringify({ token: new URL(link).searchParams.get("token") }) });
  }
  return f;
}
async function buy(f, packageId) {
  const { j } = await f("/api/billing/checkout", { method: "POST", body: JSON.stringify({ packageId }) });
  const id = new URL(j.url).pathname.split("/").pop();
  await fetch(`${MOCK}/mock-pay/${id}?promo=FREE`, { redirect: "manual" });
  const r = await f("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId: id }) });
  // The stand-in Stripe numbers its sessions from 1 each time it starts, so an
  // old DATA_DIR can already hold that "payment" (and rightly won't credit it
  // twice). Use a fresh DATA_DIR for each audit.
  if (!(r.j?.user?.plan?.credits > 0)) throw new Error("test purchase wasn't credited: run the server with a fresh DATA_DIR");
}
const selfie = async (i) => "data:image/jpeg;base64," + (await sharp(Buffer.from(portraitSVG("audit" + i, { outfit: "white-shirt" }))).resize(900, 1125).jpeg().toBuffer()).toString("base64");
async function shoot(f, stage, looks = [{ backdrop: "studio-gray", outfit: "navy-suit" }, { backdrop: "library", outfit: "camel-knit" }]) {
  const { j } = await f("/api/shoots", { method: "POST", body: "{}" });
  const id = j.shoot.id;
  if (stage === "empty") return id;
  for (let i = 0; i < 3; i++) await f(`/api/shoots/${id}/selfies`, { method: "POST", body: JSON.stringify({ photo: await selfie(i) }) });
  if (stage === "photos") return id;
  await f(`/api/shoots/${id}/check`, { method: "POST", body: "{}" });
  if (stage === "checked") return id;
  await f(`/api/shoots/${id}/generate`, { method: "POST", body: JSON.stringify({ looks }) });
  if (stage === "developing") return id;
  for (let i = 0; i < 80; i++) {
    const s = (await f(`/api/shoots/${id}`)).j.shoot;
    if (!["generating", "reviewing"].includes(s.status)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return id;
}

console.log("setting up accounts and shoots…");
const maya = await account(`maya${t}@example.com`, "Maya Okafor");
await buy(maya, "starter");
const mayaEmpty = await shoot(maya, "empty");
const mayaPhotos = await shoot(maya, "photos");
const mayaChecked = await shoot(maya, "checked");
const mayaDone = await shoot(maya, "done", [{ backdrop: "studio-gray", outfit: "navy-suit" }, { backdrop: "library", outfit: "camel-knit" }, { backdrop: "city-terrace", outfit: "white-shirt" }, { backdrop: "glass-office", outfit: "charcoal-blazer" }]);
const fresh = await account(`fresh${t}@example.com`, "Jordan Lee");
const unverified = await account(`new${t}@example.com`, "Priya Shah", { verify: false });
const owner = await account(OWNER, "Dana Reyes");
await owner("/api/team", { method: "POST", body: JSON.stringify({ name: "Acme Legal", looks: [{ backdrop: "glass-office", outfit: "navy-suit" }] }) });
const inv = (await owner("/api/team/invites", { method: "POST", body: JSON.stringify({ emails: `sam${t}@example.com, lee${t}@example.com, alexandra.montgomery-whitfield${t}@example.com` }) })).j.results;
const tok = (i) => new URL(inv[i].link).pathname.split("/").pop();
const sam = await account(`sam${t}@example.com`, "Sam Park");
const samShoot = (await sam(`/api/join/${tok(0)}`, { method: "POST" })).j.shootId;
const lee = await account(`lee${t}@example.com`, "Lee Wong"); // invited, not yet accepted
for (let i = 0; i < 3; i++) await sam(`/api/shoots/${samShoot}/selfies`, { method: "POST", body: JSON.stringify({ photo: await selfie(i) }) });
await sam(`/api/shoots/${samShoot}/check`, { method: "POST", body: "{}" });
await sam(`/api/shoots/${samShoot}/generate`, { method: "POST", body: JSON.stringify({}) });
for (let i = 0; i < 60; i++) {
  const s = (await sam(`/api/shoots/${samShoot}`)).j.shoot;
  if (!["generating", "reviewing"].includes(s.status)) break;
  await new Promise((r) => setTimeout(r, 1000));
}

// Customer results: two approved (shown on the home page), one waiting.
const offer = async (f, sid, fields) => {
  const s = (await f(`/api/shoots/${sid}`)).j.shoot;
  const shot = s.shots.find((x) => x.status === "done");
  return (await f("/api/showcase", { method: "POST", body: JSON.stringify({ shootId: sid, shotId: shot.id, consent: true, ...fields }) })).j.entry;
};
const ana = await account(`ana${t}@example.com`, "Ana Lima");
const ben = await account(`ben${t}@example.com`, "Ben Adeyemi");
// Their free shoots are watermarked previews until they buy (lib/preview.js),
// and only bought ones can be shared.
const anaShoot = await shoot(ana, "done", [{ backdrop: "city-terrace", outfit: "camel-knit" }]);
const benShoot = await shoot(ben, "done", [{ backdrop: "library", outfit: "black-turtleneck" }]);
await buy(ana, "starter");
await buy(ben, "starter");
const shared = [
  await offer(sam, samShoot, { name: "Sam", role: "Associate, Acme Legal", quote: "Our whole team matched in an afternoon, and nobody had to book a photographer." }),
  await offer(ana, anaShoot, { name: "Ana", role: "Real estate agent", quote: "On my signs and listings the same week." }),
  await offer(ben, benShoot, { name: "Ben", role: "", quote: "" }),
];
// A free shoot that's still a watermarked preview.
const pia = await account(`pia${t}@example.com`, "Pia Novak");
const piaShoot = await shoot(pia, "done", [{ backdrop: "studio-gray", outfit: "navy-suit" }, { backdrop: "glass-office", outfit: "charcoal-blazer" }]);
for (const e of shared.slice(0, 2)) await owner(`/api/owner/showcase/${e.id}`, { method: "POST", body: JSON.stringify({ status: "approved" }) });

/* ---------- Pages and states ---------- */

const click = (sel) => async (p) => { await p.click(sel); await p.waitForTimeout(500); };
const openMenu = async (p) => { if (await p.locator("#navToggle").isVisible()) { await p.click("#navToggle"); await p.waitForTimeout(400); } };
const STATES = [
  ...["/", "/linkedin-headshots", "/team-headshots", "/real-estate-headshots", "/resume-headshots", "/doctor-headshots", "/lawyer-headshots", "/blog", "/contact", "/refunds", "/privacy", "/terms", "/signin", "/signup", "/forgot-password"].map((u) => ({ name: u === "/" ? "home" : u.slice(1), url: u })),
  { name: "home-menu", url: "/", prep: openMenu, phoneOnly: true },
  { name: "home-strip", url: "/", motion: stripMotion, widths: [390, 1280] },
  { name: "signin-errors", url: "/signin", prep: click("form button[type=submit]") },
  { name: "reset-invalid", url: "/reset?token=not-a-real-token-000000000" },
  { name: "verify-invalid", url: "/verify?token=not-a-real-token-000000000" },
  { name: "unsubscribe-no-link", url: "/unsubscribe" },
  { name: "unsubscribe-invalid", url: "/unsubscribe?token=usr_nobody.not-a-real-token-00000000000000" },
  { name: "not-found", url: "/no-such-page" },
  { name: "join-no-link", url: "/join" },
  { name: "join-signed-out", url: `/join/${tok(1)}` },
  { name: "join-signed-in", url: `/join/${tok(1)}`, who: lee },
  { name: "join-wrong-account", url: `/join/${tok(2)}`, who: maya },
  { name: "dashboard", url: "/app", who: maya },
  { name: "dashboard-empty", url: "/app", who: fresh },
  { name: "dashboard-unverified", url: "/app", who: unverified },
  { name: "app-menu", url: "/app", who: maya, prep: openMenu, phoneOnly: true },
  { name: "new-shoot", url: "/app/new", who: maya },
  { name: "shoot-empty", url: `/app/shoot/${mayaEmpty}`, who: maya },
  { name: "shoot-photos", url: `/app/shoot/${mayaPhotos}`, who: maya },
  { name: "shoot-checked", url: `/app/shoot/${mayaChecked}`, who: maya },
  { name: "shoot-looks", url: `/app/shoot/${mayaChecked}`, who: maya, prep: click("#toLooks") },
  { name: "shoot-developing", url: async () => `/app/shoot/${await shoot(owner, "developing")}`, who: owner },
  { name: "shoot-proofs", url: `/app/shoot/${mayaDone}`, who: maya },
  { name: "shoot-preview", url: `/app/shoot/${piaShoot}`, who: pia },
  { name: "shoot-lightbox", url: `/app/shoot/${mayaDone}`, who: maya, prep: async (p) => { await p.locator("#proofs img").first().click(); await p.waitForTimeout(500); }, full: false },
  { name: "team-shoot-looks", url: `/app/shoot/${samShoot}`, who: sam },
  { name: "account", url: "/app/account", who: maya },
  { name: "account-shared", url: "/app/account", who: sam, prep: async (p) => { await p.waitForSelector(".share-status"); } },
  { name: "shoot-share-form", url: `/app/shoot/${mayaDone}`, who: maya, prep: async (p) => { await p.click("#shareOpen"); await p.waitForSelector("#shareForm"); } },
  { name: "showcase-admin", url: "/app/showcase", who: owner, prep: async (p) => { await p.waitForSelector(".sc-item"); } },
  { name: "buy", url: "/app/buy/professional", who: maya },
  { name: "team-setup", url: "/app/team", who: maya },
  { name: "team-admin", url: "/app/team", who: owner },
  { name: "funnel", url: "/app/funnel", who: owner },
].filter((s) => !ONLY || ONLY.test(s.name));

/* ---------- The wardrobe strip, in motion ---------- */

// Samples the strip for a full loop and reports if it never moves, or if a
// gap wider than the normal space between cards ever shows. (Both happened
// on iPhone Safari: a blank stretch at the end of each loop, then a strip
// that stood still.)
const SPEEDUP = 8;
async function stripMotion(p) {
  const found = [];
  await p.locator(".marquee").scrollIntoViewIfNeeded();
  await p.waitForTimeout(600);
  const sample = () =>
    p.evaluate(() => {
      const box = document.querySelector(".marquee").getBoundingClientRect();
      const cards = [...document.querySelectorAll(".marquee-group > li")].filter((li) => getComputedStyle(li).display !== "none");
      const shown = cards.map((li) => li.getBoundingClientRect()).filter((r) => r.right > box.left && r.left < box.right).sort((a, b) => a.left - b.left);
      let gap = 0;
      let cur = box.left;
      for (const r of shown) {
        gap = Math.max(gap, r.left - cur);
        cur = Math.max(cur, r.right);
      }
      gap = Math.max(gap, box.right - cur);
      return { gap: Math.round(gap), pos: cards.map((li) => Math.round(li.getBoundingClientRect().left)).join(",") };
    });
  // Cards can be in place yet not drawn (what iPhone Safari did), so also
  // look at the pixels: the widest run of columns across the photo band
  // that are nothing but page background.
  const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor.match(/\d+/g).slice(0, 3).map(Number));
  const strip = p.locator(".marquee");
  const blank = async () => {
    const { data, info } = await sharp(await strip.screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const rows = [0.3, 0.4, 0.5, 0.6].map((f) => Math.round(info.height * f));
    let run = 0;
    let widest = 0;
    for (let x = 0; x < info.width; x++) {
      const empty = rows.every((y) => {
        const i = (y * info.width + x) * info.channels;
        return Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) < 24;
      });
      run = empty ? run + 1 : 0;
      widest = Math.max(widest, run);
    }
    return Math.round(widest / (info.width / (await strip.boundingBox()).width)); // in CSS px
  };
  const samples = [];
  // One loop is about a minute; sped up, it fits in about ten seconds.
  for (let i = 0; i < 40; i++) {
    samples.push({ ...(await sample()), blank: await blank() });
    await p.waitForTimeout(150);
  }
  if (new Set(samples.map((x) => x.pos)).size < 3) found.push({ kind: "strip doesn't move", el: "div.marquee", detail: "card positions unchanged over 10 seconds" });
  const worst = Math.max(...samples.map((x) => x.gap));
  if (worst > 24) found.push({ kind: "strip shows a gap", el: "div.marquee", detail: `${worst}px of empty strip at one point in the loop (cards are 16px apart)` });
  const unpainted = Math.max(...samples.map((x) => x.blank));
  if (unpainted > 40) found.push({ kind: "strip shows a blank stretch", el: "div.marquee", detail: `${unpainted}px of the strip drawn as bare background at one point in the loop` });
  return found;
}

/* ---------- What gets measured on each page ---------- */

function measure() {
  const vw = window.innerWidth;
  const found = [];
  const add = (kind, el, detail) => found.push({ kind, el: label(el), detail });
  function label(el) {
    if (!el || el === document.body) return "body";
    const cls = [...el.classList].filter((c) => !["in", "is-set"].includes(c)).slice(0, 2).join(".");
    const text = (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${cls ? "." + cls : ""}${text ? ` "${text}"` : ""}`;
  }
  const shown = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // Inside something that scrolls or clips sideways on purpose (the strip,
  // a scrolling table): overflow there is expected.
  const inScroller = (el) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const o = getComputedStyle(a).overflowX;
      if (o === "auto" || o === "scroll" || (o === "hidden" && a.classList.contains("marquee"))) return true;
    }
    return false;
  };
  const decorative = (el) => {
    const cs = getComputedStyle(el);
    return cs.position === "absolute" || cs.position === "fixed" || el.getAttribute("aria-hidden") === "true" || cs.pointerEvents === "none";
  };
  // Where an element's visible content actually is: its box if it paints
  // one (background, border, shadow, image), else the extent of its text.
  const extent = (el) => {
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const paints = cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.backgroundImage !== "none" || parseFloat(cs.borderLeftWidth) > 0 || parseFloat(cs.borderTopWidth) > 0 || cs.boxShadow !== "none" || /^(IMG|SVG|BUTTON|INPUT|SELECT|TEXTAREA|VIDEO|CANVAS|svg)$/.test(el.tagName) || el.classList.contains("btn");
    if (paints) return { l: box.left, r: box.right };
    const rg = document.createRange();
    rg.selectNodeContents(el);
    const rs = [...rg.getClientRects()].filter((x) => x.width > 0 && x.height > 0);
    if (!rs.length) return { l: box.left, r: box.right };
    return { l: Math.min(...rs.map((x) => x.left)), r: Math.max(...rs.map((x) => x.right)) };
  };

  // 1. Sideways scrolling of the whole page.
  const over = document.documentElement.scrollWidth - vw;
  if (over > 1) {
    const culprits = [...document.querySelectorAll("body *")].filter((e) => shown(e) && e.getBoundingClientRect().right > vw + 1 && !inScroller(e) && !decorative(e));
    const top = culprits.filter((e) => !culprits.includes(e.parentElement)).slice(0, 3);
    add("page scrolls sideways", top[0] || document.body, `${over}px too wide${top.length > 1 ? `; also ${top.slice(1).map(label).join(", ")}` : ""}`);
  }

  const all = [...document.querySelectorAll("body *")].filter(shown);
  const textRects = (el) => {
    const out = [];
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      const rg = document.createRange();
      rg.selectNodeContents(n);
      out.push(...[...rg.getClientRects()].filter((x) => x.width > 0));
    }
    return out;
  };
  for (const el of all) {
    const cs = getComputedStyle(el);
    // 2. Visible text cut off by a box that clips (ellipsis is on purpose,
    // scrollers scroll, screen-reader-only text and off-screen traps are
    // meant to be invisible).
    const rects = textRects(el);
    if (rects.length && !inScroller(el) && !el.closest("[aria-hidden=true], .sr-only, .visually-hidden")) {
      const l = Math.min(...rects.map((x) => x.left)), r = Math.max(...rects.map((x) => x.right));
      if (r > 0 && l < vw) {
        let clipRight = Infinity;
        for (let a = el; a && a !== document.body; a = a.parentElement) {
          const acs = getComputedStyle(a);
          if (!["hidden", "clip"].includes(acs.overflowX)) continue;
          const box = a.getBoundingClientRect();
          clipRight = Math.min(clipRight, box.right);
          if (acs.textOverflow === "ellipsis") continue; // shortened with "…" on purpose
          if (box.width <= 2) break;
          const cut = Math.max(r - box.right, box.left - l);
          if (cut > 1) add("text cut off", el, `${Math.round(cut)}px clipped by ${a === el ? "its own box" : label(a).split(" ")[0]}`);
          break;
        }
        // 2b. Text spilling past the edge of the screen.
        if (Math.min(r, clipRight) > vw + 1 && !decorative(el)) add("text runs off screen", el, `${Math.round(r - vw)}px past the right edge`);
      }
    }

    // Rows: flex rows and grids with two or more visible, in-flow children.
    const isRow = (cs.display.includes("flex") && !cs.flexDirection.startsWith("column")) || cs.display.includes("grid");
    if (!isRow || inScroller(el)) continue;
    const kids = [...el.children].filter((k) => shown(k) && !decorative(k) && k.tagName !== "BR");
    if (kids.length < 2) continue;
    const rows = [];
    for (const k of kids) {
      const r = k.getBoundingClientRect();
      const mid = (r.top + r.bottom) / 2;
      const row = rows.find((x) => mid > x.top && mid < x.bottom);
      row ? (row.items.push(k), (row.bottom = Math.max(row.bottom, r.bottom))) : rows.push({ top: r.top, bottom: r.bottom, items: [k] });
    }
    rows.sort((a, b) => a.top - b.top);
    // 3. One item left alone after a wrap (e.g. three stats as 2 + 1).
    const spans = (k) => { const c = getComputedStyle(k); return k.getBoundingClientRect().width > el.getBoundingClientRect().width * 0.8 || c.gridColumnEnd === "-1" || c.gridColumnEnd.startsWith("span"); };
    // Rows that are one full-width item (a heading, a brand block) don't
    // count; among the rest, is the last one a single item alone?
    // Grids laid out with named areas (an item spanning rows) aren't rows of peers.
    const grid = cs.gridTemplateAreas !== "none" ? [] : rows.filter((r) => !(r.items.length === 1 && spans(r.items[0])));
    if (kids.length >= 3 && kids.length <= 8 && grid.length >= 2 && grid[0].items.length >= 2 && grid.at(-1).items.length === 1 && grid.every((r, i) => i === grid.length - 1 || r.items.length === grid[0].items.length)) {
      add("lone item on its own row", el, `${rows.map((r) => r.items.length).join(" + ")} items per row`);
    }
    for (const row of rows) {
      if (row.items.length < 2) continue;
      let ext = row.items.map((k) => ({ k, ...extent(k), box: k.getBoundingClientRect() }));
      // Compare like with like: if any item shows a box, use every item's box.
      if (ext.some((x) => x.l === x.box.left && x.r === x.box.right) && ext.some((x) => x.l !== x.box.left || x.r !== x.box.right) && row.items.some((k) => getComputedStyle(k).borderLeftWidth !== "0px" || getComputedStyle(k).backgroundColor !== "rgba(0, 0, 0, 0)")) ext = ext.map((x) => ({ ...x, l: x.box.left, r: x.box.right }));
      ext.sort((a, b) => a.l - b.l);
      // 4. Overlap between neighbours in a row.
      for (let i = 1; i < ext.length; i++) {
        const a = ext[i - 1].box, b = ext[i].box;
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        const turned = [ext[i - 1].k, ext[i].k].some((k) => { for (let a = k; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).transform !== "none") return true; return parseFloat(getComputedStyle(k).marginLeft) < 0; });
        if (w > 3 && h > 3 && !turned) add("items overlap", ext[i].k, `overlaps ${label(ext[i - 1].k)} by ${Math.round(w)}px`);
      }
      // 5. Uneven space between the visible content of three or more items.
      const kind = (k) => `${k.tagName}.${k.classList[0] || ""}`;
      if (ext.length >= 3 && ext.every((x) => kind(x.k) === kind(ext[0].k))) {
        // Centred items are spaced by their centres; others by the space
        // between their visible edges.
        const boxed = ext.every((x) => x.l === x.box.left && x.r === x.box.right);
        const centred = !boxed && row.items.every((k) => getComputedStyle(k).textAlign === "center" || getComputedStyle(k).alignItems === "center");
        const gaps = centred ? ext.slice(1).map((x, i) => (x.l + x.r) / 2 - (ext[i].l + ext[i].r) / 2) : ext.slice(1).map((x, i) => x.l - ext[i].r);
        const lo = Math.min(...gaps), hi = Math.max(...gaps);
        if (lo >= 0 && hi - lo > Math.max(8, lo * 0.25)) add("uneven gaps", el, `gaps ${gaps.map(Math.round).join(" / ")}px between ${ext.map((x) => label(x.k).replace(/^\w+(#\w+)?(\.[\w-]+)*\s?/, "")).join(", ")}`);
      }
      // 6. Buttons side by side at different heights.
      const size = (k) => ["btn-sm", "btn-lg", "btn-icon", "btn-block"].filter((c) => k.classList.contains(c)).join() || "base";
      const btns = row.items.filter((k) => k.matches(".btn") && size(k) === size(row.items.find((x) => x.matches(".btn"))));
      if (btns.length >= 2) {
        const hs = btns.map((k) => Math.round(k.getBoundingClientRect().height));
        if (Math.max(...hs) - Math.min(...hs) > 2) add("buttons differ in height", el, `heights ${hs.join(" / ")}px`);
      }
    }
  }
  return found;
}

/* ---------- Run ---------- */

const placeholder = new Map();
async function exampleImage(url) {
  const w = Number(new URL(url).searchParams.get("w")) || 600;
  const id = new URL(url).pathname.split("/").pop().replace(/\.\w+$/, "");
  const key = `${id}@${w}`;
  if (!placeholder.has(key)) placeholder.set(key, await sharp(Buffer.from(portraitSVG(id, { outfit: "navy-suit" }))).resize(w, Math.round(w * 1.25)).webp({ quality: 60 }).toBuffer());
  return placeholder.get(key);
}

// A locally installed Chromium if there is one (this dev container); else
// Playwright's own browsers (CI installs them).
const localChromium = process.env.CHROMIUM || "/opt/pw-browsers/chromium";
const browser = BROWSER === "webkit" ? await webkit.launch() : await chromium.launch(fs.existsSync(localChromium) ? { executablePath: localChromium } : {});
console.log(`browser: ${BROWSER} ${browser.version()}`);
const results = new Map(); // key -> { state, kind, el, detail, widths }
const errors = [];
for (const s of STATES) {
  const url = typeof s.url === "function" ? null : s.url;
  for (const w of s.widths || WIDTHS) {
    if (s.phoneOnly && w > 640) continue;
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 700 ? 844 : 900 }, reducedMotion: s.motion ? "no-preference" : "reduce" });
    // Motion checks run the page's animation clock faster.
    if (s.motion) await ctx.addInitScript((k) => { const raf = window.requestAnimationFrame.bind(window); const t0 = performance.now(); window.requestAnimationFrame = (cb) => raf((t) => cb(t0 + (t - t0) * k)); }, SPEEDUP);
    if (s.who) await ctx.addCookies([{ name: s.who.jar.v.split("=")[0], value: s.who.jar.v.split("=").slice(1).join("="), url: BASE }]);
    await ctx.route("**/examples/**", async (route) => route.fulfill({ contentType: "image/webp", body: await exampleImage(route.request().url()) }));
    await ctx.route(/^https:\/\//, (route) => route.abort());
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(`${s.name} @${w}: ${e.message}`));
    try {
      await p.goto(BASE + (url || (await s.url())), { waitUntil: "networkidle", timeout: 20000 });
      // The film grain is fixed to the screen, so a full-page screenshot
      // would show it on the first screenful only (a false "seam").
      await p.addStyleTag({ content: "body::after { display: none !important; }" });
      await p.evaluate(() => document.fonts.ready);
      // Scroll through so lazy images load and every section is revealed.
      await p.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); }
        window.scrollTo(0, 0);
      });
      await p.waitForTimeout(300);
      if (s.prep) await s.prep(p);
      for (const f of s.motion ? await s.motion(p) : await p.evaluate(measure)) {
        const key = `${s.name}|${f.kind}|${f.el}`;
        const r = results.get(key) || { state: s.name, ...f, widths: [] };
        r.widths.push(w);
        results.set(key, r);
      }
      if (SHOT_WIDTHS.includes(w) && !s.motion) await p.screenshot({ path: path.join(OUT, "shots", `${s.name}-${w}.png`), fullPage: s.full !== false });
    } catch (err) {
      errors.push(`${s.name} @${w}: ${err.message.split("\n")[0]}`);
    }
    await ctx.close();
  }
  process.stdout.write(".");
}
await browser.close();

const lines = [];
const byState = new Map();
for (const r of results.values()) byState.set(r.state, [...(byState.get(r.state) || []), r]);
for (const [state, rs] of byState) {
  lines.push(`\n${state}`);
  for (const r of rs) lines.push(`  - ${r.kind}: ${r.el} — ${r.detail} [at ${r.widths.join(", ")}px]`);
}
if (errors.length) lines.push("\nErrors while loading", ...errors.map((e) => "  - " + e));
const summary = `${BROWSER}: ${STATES.length} pages/states x ${WIDTHS.length} widths: ${results.size} finding(s)${errors.length ? `, ${errors.length} error(s)` : ""}`;
const report = [summary, ...lines].join("\n");
fs.writeFileSync(path.join(OUT, "report.txt"), report + "\n");
console.log("\n" + report);
process.exit(results.size || errors.length ? 1 : 0);
