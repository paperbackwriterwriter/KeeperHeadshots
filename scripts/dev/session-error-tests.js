// DEV/QA ONLY — the account couldn't be loaded (H18-3): an /api/me failure
// that isn't a 401 (a storage time-out, offline) keeps the person on the page
// they asked for with "We couldn't reach your account just now" and Try again,
// instead of sending a signed-in person to sign in. A real 401 still signs out.
// Needs the layout-ci server.   node scripts/dev/session-error-tests.js <out dir>
import assert from "node:assert/strict";
import fs from "node:fs";
import { existsSync } from "node:fs";
import { chromium, webkit } from "playwright";
const B = process.env.BASE || "http://localhost:3100";
const OUT = process.argv[2] || "/tmp/session-error";
fs.mkdirSync(OUT, { recursive: true });
const executablePath = process.env.CHROMIUM || "/opt/pw-browsers/chromium";
const browser = process.env.BROWSER === "webkit" ? await webkit.launch() : await chromium.launch(existsSync(executablePath) ? { executablePath } : {});
let passed = 0;
const pass = (name) => (passed++, console.log(`PASS ${name}`));
const TIMEOUT = { status: 503, contentType: "application/json", body: JSON.stringify({ error: "That's taking longer than usual. Please try again." }) };

// A signed-in browser whose /api/me answers with `answers` in turn (then for real).
async function signedIn(answers) {
  const context = await browser.newContext({ viewport: { width: 390, height: 860 }, reducedMotion: "reduce" });
  const email = `session-error-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  assert.ok((await context.request.post(B + "/api/auth/signup", { data: { name: "Sam Session", email, password: "password123" } })).ok());
  const queue = [...answers];
  const seen = [];
  await context.route("**/api/me", async (route) => {
    const next = queue.shift();
    seen.push(next ? (next === "offline" ? "offline" : next.status) : 200);
    if (next === "offline") return route.abort("internetdisconnected");
    if (next) return route.fulfill(next);
    return route.continue();
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { context, page, seen, errors };
}

const panel = (page) => page.locator("[data-session-error]");

try {
  // 1. A time-out on the first load, then a working one: the panel, then the account.
  {
    const { context, page, seen, errors } = await signedIn([TIMEOUT]);
    await page.goto(B + "/app/account");
    await panel(page).waitFor();
    assert.equal(new URL(page.url()).pathname, "/app/account", "stays on the page asked for");
    assert.equal(await page.locator("main h1").textContent(), "We couldn't reach your account just now");
    assert.match(await page.locator("[data-session-error] [role=alert]").textContent(), /taking longer than usual/);
    assert.equal(await page.title(), "Couldn't reach your account · Keeper Headshots");
    const retry = page.getByRole("button", { name: "Try again" });
    assert.equal(await retry.isVisible(), true);
    await page.screenshot({ path: `${OUT}/panel.png` });
    pass("a 503 from /api/me keeps /app/account with the 'couldn't reach your account' panel");
    // Keyboard: Try again from the keyboard loads the account; focus goes to its heading.
    await retry.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { level: 1, name: "Your account", exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/app/account");
    assert.equal(await panel(page).count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Your account");
    assert.ok(await page.locator(".user-chip").isVisible(), "the signed-in header is back");
    assert.deepEqual(seen, [503, 200]);
    assert.deepEqual(errors, []);
    pass("Try again loads the account in place, focus on its heading");
    await context.close();
  }

  // 2. Try again that fails again (offline) keeps the panel, says so, and keeps focus on Try again.
  {
    const { context, page, seen, errors } = await signedIn([TIMEOUT, "offline"]);
    await page.goto(B + "/app/account");
    await panel(page).waitFor();
    const retry = page.getByRole("button", { name: "Try again" });
    await retry.focus();
    await page.keyboard.press("Enter");
    await page.locator("[role=alert]", { hasText: "You appear to be offline" }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/app/account");
    assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute("data-session-retry")), true);
    assert.deepEqual(seen, [503, "offline"]);
    assert.deepEqual(errors, []);
    pass("a failed Try again keeps the panel with the new reason, focus stays on Try again");
    await context.close();
  }

  // 3. A time-out, then in-app navigation to another signed-in page loads it normally.
  {
    const { context, page, seen } = await signedIn([TIMEOUT]);
    await page.goto(B + "/app/account");
    await panel(page).waitFor();
    await page.evaluate(() => {
      const a = document.createElement("a");
      a.href = "/app";
      a.dataset.link = "";
      a.id = "zz-go";
      a.textContent = "Your shoots";
      a.style.cssText = "position:fixed;top:0;left:0;z-index:99999;background:#fff";
      document.body.append(a);
    });
    await page.click("#zz-go");
    await page.locator("[data-first-name]").waitFor();
    assert.equal(new URL(page.url()).pathname, "/app");
    assert.deepEqual(seen, [503, 200]);
    pass("the next navigation to a signed-in page asks again and proceeds normally");
    await context.close();
  }

  // 4. Public pages carry on as signed out while the account is unknown.
  {
    const { context, page, errors } = await signedIn([TIMEOUT]);
    await page.goto(B + "/privacy");
    await page.locator("main h1").first().waitFor();
    assert.equal(await panel(page).count(), 0);
    assert.equal(new URL(page.url()).pathname, "/privacy");
    assert.deepEqual(errors, []);
    pass("a public page still works while the account is unknown");
    await context.close();
  }

  // 5. A real 401 still means signed out: off to sign in, no panel.
  {
    const { context, page } = await signedIn([{ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Please sign in to continue.", code: "signed_out" }) }]);
    await page.goto(B + "/app/account");
    await page.waitForURL((u) => u.pathname === "/signin");
    assert.equal(new URL(page.url()).searchParams.get("next"), "/app/account");
    assert.equal(await panel(page).count(), 0);
    pass("a 401 from /api/me still goes to /signin?next=/app/account");
    await context.close();
  }

  // 6. Signed out for real (no session): unchanged, straight to sign in.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(B + "/app/account");
    await page.waitForURL((u) => u.pathname === "/signin");
    assert.equal(await panel(page).count(), 0);
    pass("signed out: /app/account still goes to /signin");
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(`${passed} passed`);
