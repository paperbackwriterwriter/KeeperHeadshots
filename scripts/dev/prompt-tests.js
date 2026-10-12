// DEV/QA ONLY — the headshot brief puts likeness first (lib/ai.js buildPrompt).
import assert from "node:assert/strict";
import { buildPrompt, sceneBrief } from "../../lib/ai.js";

const look = { outfit: { prompt: "a navy suit" }, backdrop: { prompt: "a grey studio backdrop", light: "soft key light" } };
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("PASS", name); };

test("likeness leads the brief, before wardrobe and set", () => {
  const p = buildPrompt({ look, take: 0, subject: { glasses: false, hair: "Long locs past the shoulders.", smile: "neutral" } });
  assert.ok(p.startsWith("Create a professional headshot") && /Likeness is the top priority/.test(p.split("\n\n")[0]));
  assert.ok(p.indexOf("Hair and facial hair exactly as in the photos") < p.indexOf("Wardrobe:"));
  assert.match(p, /never younger, never older/);
  assert.match(p, /In the photos: Long locs past the shoulders\./);
});
test("expression follows the person's own photos, never a stock grin", () => {
  assert.match(buildPrompt({ look, take: 0, subject: { smile: "neutral" } }), /lips closed, no teeth/);
  assert.doesNotMatch(buildPrompt({ look, take: 0, subject: { smile: "neutral" } }), /smile that reaches the eyes/);
  assert.match(buildPrompt({ look, take: 1, subject: { smile: "teeth" } }), /never wider or toothier/);
  // Older checks without a smile field get the safe closed-mouth default.
  assert.match(buildPrompt({ look, take: 2, subject: { glasses: true } }), /closed-mouth smile from the photos/);
});
test("a retake's correction comes straight after the likeness rules", () => {
  const p = buildPrompt({ look, take: 1, subject: {}, retake: "Nose narrowed; restore its width." });
  const at = p.indexOf("Correct this first");
  assert.ok(at > p.indexOf("Hair and facial hair") && at < p.indexOf("Wardrobe:"));
  assert.doesNotMatch(buildPrompt({ look, take: 1, subject: {} }), /Correct this first/);
});
test("site examples keep their stock poses and expressions", () => {
  assert.match(sceneBrief({ look, take: 0 }).join(" "), /closed-mouth smile that reaches the eyes/);
});
console.log(`\n${passed}/${passed} passed`);
