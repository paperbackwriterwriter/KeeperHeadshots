import { chromium } from "playwright"; import fs from "node:fs";
const B = process.env.B || "http://localhost:3200", axe = fs.readFileSync(process.argv[2], "utf8");
const pub = ["/", "/blog", "/blog/a", "/blog/b", "/linkedin-headshots", "/team-headshots", "/real-estate-headshots", "/resume-headshots", "/doctor-headshots", "/lawyer-headshots", "/refunds", "/privacy", "/terms", "/verify", "/forgot-password", "/reset?token=x", "/contact", "/signin", "/signup", "/nope"];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
let total = 0, pages = 0; const out = [];
for (const scheme of ["light", "dark"]) for (const w of [390, 1280]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme, bypassCSP: true, reducedMotion: "reduce" });
  const p = await ctx.newPage();
  const run = async (path) => {
    await p.goto(B + path, { waitUntil: "networkidle" }); await p.waitForTimeout(300);
    await p.addScriptTag({ content: axe });
    const r = await p.evaluate(() => axe.run(document, { resultTypes: ["violations"] }));
    const ov = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    pages++; total += r.violations.length;
    if (r.violations.length || ov) out.push(`${scheme} ${w} ${path}: ${r.violations.map(v => `${v.id}(${v.nodes.length}) ${v.nodes[0].target} ${v.nodes[0].any?.[0]?.message?.slice(0,120) || ""}`).join(" | ")}${ov ? " OVERFLOW" : ""}`);
  };
  for (const path of pub) await run(path);
  await p.request.post(B + "/api/auth/signin", { data: { email: "demo@keeperheadshots.com", password: "studio-demo" } });
  const sh = (await (await p.request.get(B + "/api/shoots")).json()).shoots || [];
  for (const path of ["/app", "/app/account", "/app/new", "/app/buy/starter", ...sh.map(s => "/app/shoot/" + s.id)]) await run(path);
  await ctx.close();
}
console.log(`${pages} page checks, ${total} violations`); console.log(out.join("\n"));
await b.close();
