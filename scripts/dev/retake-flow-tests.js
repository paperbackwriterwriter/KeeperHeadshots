// DEV/QA ONLY — photo-check retakes in the browser. Under MIN_CHECK_SCORE
// there's no way forward but new selfies; "Add new selfies" opens the device's
// picker (take a photo or choose one), swaps out the photos marked Replace and
// re-checks. Under RECOMMENDED_CHECK_SCORE the person may continue anyway.
// Needs the layout-ci server and mock (a 5-photo set scores 62, 4 photos 70).
//   node scripts/dev/retake-flow-tests.js <out dir>
import fs from "node:fs";
import { existsSync } from "node:fs";
import sharp from "sharp";
import { chromium, webkit } from "playwright";
import { portraitSVG } from "../../public/js/shared/portrait.js";
import { MIN_CHECK_SCORE, RECOMMENDED_CHECK_SCORE } from "../../public/js/shared/catalog.js";
const B = process.env.BASE || "http://localhost:3100", M = process.env.MOCK || "http://localhost:4010";
const OUT = process.argv[2] || "/tmp/retake-flow";
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (name, cond, extra = "") => (results.push(!!cond), console.log(cond ? "PASS" : "FAIL", name, extra));
let cookie = "";
const f = async (p, o = {}) => { const r = await fetch(B + p, { ...o, headers: { "content-type": "application/json", cookie } }); const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0]; return r.json().catch(() => null); };
const email = `retake${Date.now()}@x.com`;
await f("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Rae Take", email, password: "password123" }) });
const mails = await fetch(`${M}/mock-mail`).then((r) => r.json());
await f("/api/auth/verify", { method: "POST", body: JSON.stringify({ created: true, token: new URL(mails.filter((m) => m.to.includes(email)).flatMap((m) => m.links).findLast((l) => l.includes("/verify?token="))).searchParams.get("token") }) });
const jpg = (i) => sharp(Buffer.from(portraitSVG("rt" + i, {}))).resize(900, 1125).jpeg().toBuffer();
async function checkedShoot(n) {
  const sid = (await f("/api/shoots", { method: "POST", body: "{}" })).shoot.id;
  for (let i = 0; i < n; i++) await f(`/api/shoots/${sid}/selfies`, { method: "POST", body: JSON.stringify({ photo: "data:image/jpeg;base64," + (await jpg(i)).toString("base64") }) });
  await f(`/api/shoots/${sid}/check`, { method: "POST", body: "{}" });
  return sid;
}
const sid = await checkedShoot(5);
const soft = await checkedShoot(4);
const before = (await f(`/api/shoots/${sid}`)).shoot;
const flagged = before.check.photos.filter((p) => !p.keep || p.score < RECOMMENDED_CHECK_SCORE).map((p) => before.selfies[p.index].file);
for (const i of [10, 11]) fs.writeFileSync(`${OUT}/new${i}.jpg`, await jpg(i));

const executablePath = process.env.CHROMIUM || "/opt/pw-browsers/chromium";
const browser = process.env.BROWSER === "webkit" ? await webkit.launch() : await chromium.launch(existsSync(executablePath) ? { executablePath } : {});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addCookies([{ name: cookie.split("=")[0], value: cookie.split("=").slice(1).join("="), url: B }]);
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto(`${B}/app/shoot/${sid}`);
await page.waitForSelector("#retakePanel");
ok("a set under the minimum shows the retake directions", (await page.locator("#retakePanel h2").innerText()).includes(String(MIN_CHECK_SCORE)));
const ringLow = await page.locator(".verdict .ring").getAttribute("style");
ok("a set under the minimum has a red score ring, like its badge", /--col:\s*#ff8a73/.test(ringLow), ringLow);
ok("with no way to continue without new selfies", !(await page.locator("#toLooks, #continueAnyway").count()));
ok("the photos to replace are marked", (await page.locator(".pcheck .badge:has-text('Replace')").count()) === flagged.length && flagged.length > 0);
ok("the file input takes photos from the camera or the library", (await page.getAttribute("#retakeFile", "accept")) === "image/*" && (await page.getAttribute("#retakeFile", "capture")) === null);
await page.locator("#retakeBtn").scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/retake.png` });
const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 5000 }), page.click("#retakeBtn")]);
ok("'Add new selfies' opens the picker, for several photos", chooser.isMultiple());
await chooser.setFiles([`${OUT}/new10.jpg`, `${OUT}/new11.jpg`]);
await page.waitForSelector("#toLooks", { timeout: 30000 });
const after = (await f(`/api/shoots/${sid}`)).shoot;
ok("the new selfies replace the marked photos", after.selfies.length === 6 && flagged.every((file) => !after.selfies.some((s) => s.file === file)), `${before.selfies.length} → ${after.selfies.length}`);
ok("and the set is re-checked, passing", after.check.overall_score >= RECOMMENDED_CHECK_SCORE && after.check.verdict !== "retake", `${after.check.overall_score} ${after.check.verdict}`);

// A set of 70: the same directions, plus a way to go ahead with these selfies.
await page.goto(`${B}/app/shoot/${soft}`);
await page.waitForSelector("#retakePanel");
const title = await page.locator("#retakeTitle").innerText();
const ringMid = await page.locator(".verdict .ring").getAttribute("style");
ok("a set that can continue anyway has an amber score ring", /--col:\s*#f5b94a/.test(ringMid), ringMid);
ok("a set of 70 says what we recommend, not what a shoot needs", title.includes("scored 70") && title.includes(`We recommend ${RECOMMENDED_CHECK_SCORE} or more`) && !title.includes("needs"), title);
const order = await page.evaluate(() => { const h = document.getElementById("retakeTitle"), b = document.getElementById("continueAnyway"); return !!b && !!(h.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) && b.previousElementSibling?.tagName === "P"; });
ok("'Continue with these selfies anyway' follows the heading and its paragraph", order && (await page.locator("#continueAnyway").innerText()).trim() === "Continue with these selfies anyway");
await page.locator("#continueAnyway").scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/continue-anyway.png` });
await page.click("#continueAnyway");
await page.waitForSelector("#develop:not([disabled])");
await page.click("#develop");
let status = "";
for (let i = 0; i < 40 && !["generating", "reviewing", "done"].includes(status); i++) {
  await page.waitForTimeout(250);
  status = (await f(`/api/shoots/${soft}`)).shoot.status;
}
ok("and continuing develops the shoot", ["generating", "reviewing", "done"].includes(status), status);

// Straight from upload (the check runs on the page): "Continue anyway" right
// after the result, then picking looks while the poll started during the
// check lands, still develops with those looks.
{
  const { url } = await f("/api/billing/checkout", { method: "POST", body: JSON.stringify({ packageId: "starter" }) });
  const session = new URL(url).pathname.split("/").pop();
  await fetch(`${M}/mock-pay/${session}?promo=FREE`, { redirect: "manual" });
  await f("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId: session }) });
  const fresh = (await f("/api/shoots", { method: "POST", body: "{}" })).shoot.id;
  for (let i = 0; i < 4; i++) await f(`/api/shoots/${fresh}/selfies`, { method: "POST", body: JSON.stringify({ photo: "data:image/jpeg;base64," + (await jpg(20 + i)).toString("base64") }) });
  await page.evaluate((sid) => sessionStorage.setItem("ahg-autocheck", sid), fresh);
  await page.goto(`${B}/app/shoot/${fresh}`);
  // As soon as the result shows (before that poll), as a quick tap would.
  await page.waitForSelector("#continueAnyway", { timeout: 30000 });
  await page.evaluate(() => document.getElementById("continueAnyway").click());
  await page.evaluate(() => document.getElementById("fillAll").click());
  await page.waitForTimeout(3500); // past the poll the check scheduled
  await page.click("#develop");
  let st = "";
  for (let i = 0; i < 40 && !["generating", "reviewing", "done"].includes(st); i++) {
    await page.waitForTimeout(250);
    st = (await f(`/api/shoots/${fresh}`)).shoot.status;
  }
  const looks = (await f(`/api/shoots/${fresh}`)).shoot.looks?.length;
  ok("continuing straight after an on-page check develops, with the looks picked", ["generating", "reviewing", "done"].includes(st) && looks === 4, `${st} looks=${looks}`);
}

// Choosing several large photos at once: "Check my photos" stays off until
// every one is ready, so none is left out of the shoot. Phone-sized photos
// (8 megapixels), in a page of their own so WebKit on CI isn't holding the
// earlier pages' images too.
{
  const big = [];
  for (let i = 0; i < 4; i++) {
    const file = `${OUT}/big${i}.jpg`;
    fs.writeFileSync(file, await sharp({ create: { width: 2448, height: 3264, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 30 } } }).jpeg({ quality: 85 }).toBuffer());
    big.push(file);
  }
  await ctx.close();
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx2.addCookies([{ name: cookie.split("=")[0], value: cookie.split("=").slice(1).join("="), url: B }]);
  const page = await ctx2.newPage();
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`${B}/app/new`);
  await page.waitForSelector("#go");
  // Every animation frame, note the button's state and the photo count.
  await page.evaluate(() => {
    window.__seen = [];
    const tick = () => { const go = document.getElementById("go"); if (!go) return; window.__seen.push([go.disabled, document.getElementById("count").textContent]); requestAnimationFrame(tick); };
    tick();
  });
  await page.setInputFiles("#file", big);
  await page.waitForFunction(() => /^4 \//.test(document.getElementById("count").textContent) && !document.getElementById("go").disabled, null, { timeout: 60000 });
  const seen = await page.evaluate(() => window.__seen);
  const early = seen.filter(([disabled, count]) => !disabled && !/^4 \/ \d+ PHOTOS$/.test(count));
  ok("'Check my photos' waits until every chosen photo is ready", seen.some(([d, c]) => d && /ADDING/.test(c)) && !early.length, `${seen.length} frames; enabled early at ${JSON.stringify(early.slice(0, 2))}`);
  await ctx2.close();
}
ok("no page errors", !errs.length, errs.join("; "));
await browser.close();
const failed = results.filter((x) => !x).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
