// DEV/QA ONLY — site search (lib/search.js, GET /api/search).
// Run against a local server:  node scripts/dev/search-tests.js
import { searchSite } from "../../lib/search.js";
const B = process.env.BASE || "http://localhost:3100";
const results = [];
const ok = (name, cond, extra = "") => (results.push(!!cond), console.log(cond ? "PASS" : "FAIL", name, extra));
const top = (q, opts) => searchSite(q, opts).map((r) => `${r.type}: ${r.title}`);

ok("'pricing' finds the pricing section and packages", top("pricing").some((t) => t === "Page: Pricing") && top("price").some((t) => t.startsWith("Pricing: Starter")), JSON.stringify(top("price")));
ok("'how much does it cost' finds prices", top("how much does it cost").some((t) => /Pricing|cost/i.test(t)));
ok("'linkedin' puts the LinkedIn page first", top("linkedin")[0] === "Page: LinkedIn Headshots from Selfies");
ok("accents don't matter: 'resume' finds the résumé page", top("resume").includes("Page: Résumé & CV Headshots from Selfies"));
ok("a word's start matches: 'linke'", top("linke").length > 0);
ok("'refund' finds the money-back guarantee", top("refund")[0] === "Page: Money-back guarantee");
ok("FAQ answers link to their page's FAQ", searchSite("what should a lawyer wear")[0]?.url === "/lawyer-headshots#faq");
ok("nonsense finds nothing", top("xyzzy plugh").length === 0);
ok("one letter or only stop words find nothing", top("a").length === 0 && top("").length === 0);
ok("at most 8 results", searchSite("headshot").length <= 8);
ok("sign-up isn't a result", !searchSite("create your account").some((r) => r.url === "/signup"));
{
  const posts = [{ slug: "what-to-wear-for-headshots", title: "What to wear for your headshot", excerpt: "Solid colors, fitted jackets and nothing too busy near the face." }];
  const r = searchSite("jackets", { posts });
  ok("blog articles are searched", r[0]?.type === "Article" && r[0].url === "/blog/what-to-wear-for-headshots", JSON.stringify(r[0]));
}
{
  const s = searchSite("watermark")[0]?.snippet || "";
  ok("snippets show the matching passage", /watermark/i.test(s) && s.length <= 170, s);
}
{
  const prices = searchSite("price").filter((r) => r.type === "Pricing").map((r) => r.snippet);
  ok("price snippets read as one sentence (no capitals mid-list)", prices.length >= 4 && prices.every((s) => !/[:,] (Up|Full|Our|Best|Great|The|Every)\b/.test(s)) && prices.some((s) => /LinkedIn/.test(s)), prices.join(" | "));
}

// Every FAQ result's #anchor exists on the page it links to.
{
  const urls = new Set(["linkedin", "team", "estate", "resume", "doctor", "lawyer", "free"].flatMap((q) => searchSite(q)).filter((r) => r.type === "FAQ").map((r) => r.url));
  const missing = [];
  for (const u of urls) {
    const [path, hash] = u.split("#");
    if (hash && !(await (await fetch(B + path)).text()).includes(`id="${hash}"`)) missing.push(u);
  }
  ok("FAQ results link to anchors that exist", urls.size >= 5 && !missing.length, `${urls.size} urls; missing ${missing.join(", ")}`);
}

// The endpoint.
{
  const r = await fetch(`${B}/api/search?q=linkedin`);
  const j = await r.json();
  ok("GET /api/search answers", r.status === 200 && j.results.length > 0 && j.results[0].url === "/linkedin-headshots", `${r.status}`);
  ok("and is cacheable", /public/.test(r.headers.get("cache-control") || ""));
  const short = await (await fetch(`${B}/api/search?q=a`)).json();
  ok("a one-letter query returns nothing", Array.isArray(short.results) && short.results.length === 0);
  const odd = await fetch(`${B}/api/search?q[]=x&q[]=y`);
  ok("an odd query string is handled", odd.status === 200 && (await odd.json()).results.length === 0, `${odd.status}`);
  const long = await (await fetch(`${B}/api/search?q=${"linkedin ".repeat(40)}`)).json();
  ok("a long query is cut short", long.q.length <= 80);
}

const failed = results.filter((x) => !x).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
