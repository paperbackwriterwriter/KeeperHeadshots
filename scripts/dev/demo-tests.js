// DEV/QA ONLY — demo conversion and checkout regression tests against a
// local server with a throwaway DATA_DIR. No real Stripe/AI requests.
// DATA_DIR=<same as server> BASE=http://localhost:3100 node scripts/dev/demo-tests.js
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { seed, DEMO } from "../seed.js";
import { users, shoots } from "../../lib/store.js";

const BASE = process.env.BASE || "http://localhost:3100";
assert.match(BASE, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/, "Run only against a local test server");
assert.ok(process.env.DATA_DIR, "Set DATA_DIR to the server's throwaway test store");
const OUT = process.env.OUT || "/tmp/keeper-demo-fix-shots";
await fs.mkdir(OUT, { recursive: true });
const pass = (name) => console.log(`PASS ${name}`);

await seed();
const demo = await users.byEmail(DEMO.email);
const samples = await shoots.forUser(demo.id);
const sample = samples.find((s) => s.name === "LinkedIn refresh");
const count = Object.values(sample.review.shots).filter((g) => g.grade === "keeper").length;
assert.equal(sample.review.headline, `${count} keepers — your studio gray look leads.`);
pass("new demo verdict agrees with its actual keeper grades");
const untouched = samples.find((s) => s.id !== sample.id);
await shoots.updateMeta(sample.id, (s) => {
  s.review.headline = "Seven keepers — your studio gray look leads.";
  return s;
});
await seed();
const repaired = await shoots.getMeta(sample.id);
assert.equal(repaired.review.headline, `${count} keepers — your studio gray look leads.`);
assert.deepEqual(repaired.shots, sample.shots);
assert.deepEqual(repaired.review.shots, sample.review.shots);
assert.deepEqual(await shoots.getMeta(untouched.id), untouched);
await seed();
assert.deepEqual(await shoots.getMeta(sample.id), repaired);
pass("existing stale demo verdict is repaired without reseeding, and the repair is idempotent");

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/usr/bin/chromium" });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    let checkouts = 0;
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => { if (new URL(r.url()).pathname === "/api/billing/checkout") checkouts++; });
    const signInDemo = async (url = "/signin") => {
      await page.goto(BASE + url);
      await page.locator("#demo").click();
      await page.waitForURL(/\/app(?:\?|\/|$)/);
    };
    const assertSignedOut = async () => {
      await page.locator("#authForm").waitFor();
      assert.equal((await (await context.request.get(BASE + "/api/me")).json()).user, null);
      await page.reload();
      await page.locator("#authForm").waitFor();
      assert.equal(new URL(page.url()).pathname, "/signup");
    };

    await signInDemo();
    await page.locator("#demoSignup").click();
    await page.waitForURL("**/signup");
    await page.locator("#authForm").waitFor();
    await assertSignedOut();
    pass(`${width}px dashboard signup clears the demo session, including after reload`);

    await signInDemo();
    await page.locator(`a[href="/app/shoot/${sample.id}"]`).click();
    await page.locator("h1").filter({ hasText: `${count} keepers` }).waitFor();
    await page.screenshot({ path: `${OUT}/verdict-${width}.png`, fullPage: true });
    await page.locator("#upgrade a[href='/signup']").click();
    await page.waitForURL("**/signup");
    await assertSignedOut();
    pass(`${width}px sample-shoot signup reaches the real signup form`);

    await signInDemo();
    await context.route("**/api/auth/signout", (route) => route.fulfill({ status: 503, json: { error: "Sign-out temporarily unavailable." } }));
    await page.locator("#demoSignup").click();
    await page.getByText(/We couldn't leave the demo/).waitFor();
    assert.equal(new URL(page.url()).pathname, "/app");
    assert.equal((await (await context.request.get(BASE + "/api/me")).json()).user.demo, true);
    await context.unroute("**/api/auth/signout");
    await page.locator("#demoSignup").click();
    await page.waitForURL("**/signup");
    await assertSignedOut();
    pass(`${width}px failed demo sign-out preserves the session and can be retried`);

    await page.goto(BASE + "/");
    await page.locator("a[href='/app/buy/professional']").click();
    await page.waitForURL("**/signin?next=*");
    await page.locator("#demo").click();
    await page.waitForURL("**/app/buy/professional");
    await page.getByRole("heading", { name: "Create your account to continue." }).waitFor();
    assert.match(await page.locator("main").innerText(), /demo account is read-only/);
    assert.equal(checkouts, 0);
    assert.equal(await page.locator("script[src*='js.stripe.com']").count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${OUT}/checkout-${width}.png`, fullPage: true });
    await page.getByRole("link", { name: "Create free account" }).click();
    await page.waitForURL("**/signup?next=*");
    assert.equal(new URL(page.url()).searchParams.get("next"), "/app/buy/professional");
    await assertSignedOut();
    pass(`${width}px demo checkout offers signup, preserves the package, and never starts Stripe`);

    await page.locator("#name").fill("Demo Graduate");
    await page.locator("#email").fill(`demo-graduate-${width}-${Date.now()}@example.com`);
    await page.locator("#password").fill("test-password-123");
    await page.locator("#submit").click();
    await page.waitForURL("**/app/buy/professional");
    await page.getByRole("heading", { name: "We couldn't start checkout." }).waitFor();
    // Local server has no Stripe credentials; its actual API error is visible.
    assert.match(await page.locator("main").innerText(), /Payments aren't set up yet/);
    const me = (await (await context.request.get(BASE + "/api/me")).json()).user;
    assert.ok(me && !me.demo);
    await page.goto(BASE + "/signup");
    await page.waitForURL("**/app");
    pass(`${width}px signup creates a real local account and retains ordinary customer route protection`);
    assert.deepEqual(errors, []);
    await context.close();
  }

  // Use a local customer session with a Stripe test double. The API rejection
  // must render before Stripe is initialized, not reject inside its callback.
  for (const result of ["rejected", "missing-secret", "success", "load-fallback"]) {
    const context = await browser.newContext();
    const account = await context.request.post(BASE + "/api/auth/signup", {
      data: { name: "Checkout QA", email: `checkout-${result}-${Date.now()}@example.com`, password: "test-password-123" },
    });
    assert.equal(account.status(), 201);
    await context.route("**/api/me", async (route) => {
      const res = await route.fetch();
      const data = await res.json();
      data.stripe = { publishableKey: "pk_test_local", mode: "test" };
      await route.fulfill({ response: res, json: data });
    });
    await context.route("https://js.stripe.com/**", async (route) => {
      if (result === "load-fallback") return route.abort();
      await route.fulfill({ contentType: "application/javascript", body: `window.Stripe = () => ({ createEmbeddedCheckoutPage: async ({ fetchClientSecret }) => { window.checkoutSecret = await fetchClientSecret(); return { mount: (selector) => { document.querySelector(selector).textContent = 'Local payment form ready'; }, destroy() {} }; } });` });
    });
    let calls = 0;
    await context.route("**/api/billing/checkout", async (route) => {
      calls++;
      if (result === "rejected") return route.fulfill({ status: 429, json: { error: "Please wait before starting another checkout." } });
      if (result === "missing-secret") return route.fulfill({ json: {} });
      if (result === "load-fallback") {
        assert.equal(route.request().postDataJSON().embedded, undefined);
        return route.fulfill({ json: { url: BASE + "/signin", value: 39 } });
      }
      assert.equal(route.request().postDataJSON().embedded, true);
      return route.fulfill({ json: { clientSecret: "local-secret", value: 39 } });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(BASE + "/app/buy/professional");
    if (["rejected", "missing-secret"].includes(result)) {
      await page.getByRole("heading", { name: "We couldn't start checkout." }).waitFor();
      assert.match(await page.locator("main").innerText(), result === "rejected" ? /Please wait before starting another checkout/ : /Checkout isn't available right now/);
      assert.equal(await page.evaluate(() => window.checkoutSecret), undefined);
    } else if (result === "success") {
      await page.getByText("Local payment form ready").waitFor();
      assert.equal(await page.evaluate(() => window.checkoutSecret), "local-secret");
    } else {
      await page.waitForURL("**/app"); // hosted stand-in /signin redirects this signed-in customer
    }
    assert.equal(calls, 1);
    assert.deepEqual(errors, []);
    pass(`embedded checkout ${result}: correct UI outcome, one checkout request, no uncaught errors`);
    await context.close();
  }
} finally {
  await browser.close();
}
