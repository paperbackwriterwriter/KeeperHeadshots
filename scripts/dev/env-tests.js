// DEV/QA ONLY — keeping previews apart from the live site: storage keys get a
// namespace (preview/) except shared example images, and Stripe keys only
// work in the matching environment (live on production, test elsewhere).
//   node scripts/dev/env-tests.js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kh-env-"));
for (const k of ["BLOB_READ_WRITE_TOKEN", "BLOB_STORE_ID"]) delete process.env[k];
Object.assign(process.env, { DATA_DIR: dir, STORAGE_NAMESPACE: "preview/" });
const storage = await import("../../lib/storage.js");
const billing = await import("../../lib/billing.js");

const results = [];
const ok = (name, cond, extra = "") => (results.push(!!cond), console.log(cond ? "PASS" : "FAIL", name, extra));
const exists = (p) => fs.existsSync(path.join(dir, p));

// Storage namespace
await storage.putJSON("users/id/usr_a.json", { id: "usr_a" });
await storage.createJSON("payments/cs_1.json", { n: 1 });
await storage.updateJSON("payments/cs_1.json", (r) => ({ ...r, n: 2 }));
await storage.putFile("media/sht_1/p.jpg", Buffer.from("x"), "image/jpeg");
await storage.putFile("examples/hero-1.jpg", Buffer.from("x"), "image/jpeg");
ok("preview data is written under preview/", exists("preview/users/id/usr_a.json") && exists("preview/payments/cs_1.json") && !exists("users/id/usr_a.json"));
ok("reads, updates and lists see plain keys", (await storage.getJSON("payments/cs_1.json")).n === 2 && JSON.stringify(await storage.list("users/")) === JSON.stringify(["users/id/usr_a.json"]) && (await storage.listFolders("media/")).includes("sht_1"));
ok("example images are shared with the live site", exists("examples/hero-1.jpg") && !exists("preview/examples/hero-1.jpg") && !!(await storage.getFile("examples/hero-1.jpg")));
await storage.del(["users/id/usr_a.json"]);
ok("deletes stay in the namespace", !exists("preview/users/id/usr_a.json"));

// Stripe key modes
const errors = [];
const origError = console.error;
console.error = (...a) => errors.push(a.join(" "));
const mode = (env, key, pk) => {
  process.env.VERCEL_ENV = env;
  process.env.STRIPE_SECRET_KEY = key;
  process.env.STRIPE_PUBLISHABLE_KEY = pk || "";
  return { on: billing.billingEnabled(), pk: billing.stripePublishableKey(), mode: billing.stripeMode() };
};
const prodLive = mode("production", "sk_live_abc", "pk_live_abc");
const prodTest = mode("production", "sk_test_abc", "pk_test_abc");
const prevTest = mode("preview", "sk_test_abc", "pk_test_abc");
const prevLive = mode("preview", "sk_live_abc", "pk_live_abc");
const mixed = mode("preview", "sk_test_abc", "pk_live_abc");
console.error = origError;
ok("live key works on production", prodLive.on && prodLive.pk === "pk_live_abc" && prodLive.mode === "live");
ok("test key is refused on production", !prodTest.on && !prodTest.pk);
ok("test key works on previews", prevTest.on && prevTest.pk === "pk_test_abc" && prevTest.mode === "test");
ok("live key is refused on previews, and it's reported", !prevLive.on && errors.some((e) => /live-mode Stripe key is set on preview/.test(e)));
ok("publishable key of the other mode isn't used", mixed.on && mixed.pk === null);

fs.rmSync(dir, { recursive: true, force: true });
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
