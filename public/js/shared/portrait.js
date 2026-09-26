// Faceless editorial portrait illustrations. Used for sample content only
// (landing page, seeded demo shoots) so the app never shows an empty frame
// before real AI headshots exist. Deterministic per seed.

import { BACKDROPS, OUTFITS } from "./catalog.js";

const SKIN = [
  ["#f3d4bf", "#d8ae93"],
  ["#e8bf9f", "#c7967a"],
  ["#d5a07c", "#ad7858"],
  ["#b98060", "#8e5a3f"],
  ["#8d5a3f", "#643b27"],
  ["#6a412c", "#472a1b"],
];
const HAIR = ["#1b1411", "#2e2019", "#4a3222", "#6b4a2e", "#a57a4c", "#d2b48a", "#8a8a88", "#2a2a2e"];
const STYLES = ["short", "side", "long", "bun", "curly", "crop", "wavy"];

function rng(seed) {
  let s = 0;
  for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < 4; i++) next();
  return next;
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

function hair(style, c, back) {
  // `back` layers are drawn behind the head, front layers on top of it.
  switch (style) {
    case "long":
      return back
        ? `<path d="M128 230 C120 150 170 138 200 138 C236 138 282 150 274 232 C282 300 292 360 300 400 L100 400 C110 350 120 300 128 230Z" fill="${c}"/>`
        : `<path d="M137 232 C132 170 168 150 204 150 C244 150 270 176 264 226 C250 196 226 180 196 184 C172 188 150 204 137 232Z" fill="${c}"/>`;
    case "wavy":
      return back
        ? `<path d="M130 236 C118 160 168 140 202 140 C240 140 286 160 272 238 C284 280 280 320 266 346 C250 330 150 330 134 346 C120 316 118 280 130 236Z" fill="${c}"/>`
        : `<path d="M138 226 C140 170 170 152 204 152 C242 152 266 178 262 222 C244 190 220 186 204 196 C186 184 158 192 138 226Z" fill="${c}"/>`;
    case "bun":
      return back
        ? `<circle cx="206" cy="146" r="30" fill="${c}"/>`
        : `<path d="M139 222 C136 176 168 156 202 156 C238 156 266 178 262 224 C252 194 230 178 202 178 C172 178 150 196 139 222Z" fill="${c}"/>`;
    case "curly": {
      if (back) return "";
      const blobs = [];
      for (let i = 0; i < 13; i++) {
        const a = Math.PI * (1.04 + (i / 12) * 0.92);
        blobs.push(`<circle cx="${(200 + Math.cos(a) * 62).toFixed(1)}" cy="${(222 + Math.sin(a) * 72).toFixed(1)}" r="${20 + (i % 3) * 3}" fill="${c}"/>`);
      }
      return blobs.join("") + `<ellipse cx="200" cy="170" rx="52" ry="26" fill="${c}"/>`;
    }
    case "crop":
      return back ? "" : `<path d="M140 214 C140 172 170 158 202 158 C236 158 262 174 260 214 C246 196 226 188 200 188 C174 188 154 196 140 214Z" fill="${c}" opacity=".92"/>`;
    case "side":
      return back
        ? ""
        : `<path d="M138 222 C132 170 170 150 208 152 C246 154 268 180 262 222 C258 206 250 194 236 188 C206 196 170 190 150 200 C144 206 140 214 138 222Z" fill="${c}"/>`;
    default:
      return back
        ? ""
        : `<path d="M139 218 C136 172 170 154 202 154 C236 154 266 174 261 218 C254 200 240 190 222 186 C196 182 166 188 139 218Z" fill="${c}"/>`;
  }
}

export function portraitSVG(seed, opts = {}) {
  const r = rng(seed);
  const backdrop = BACKDROPS.find((b) => b.id === opts.backdrop) || pick(r, BACKDROPS);
  const outfit = OUTFITS.find((o) => o.id === opts.outfit) || pick(r, OUTFITS);
  const [skinHi, skinLo] = opts.skin != null ? SKIN[opts.skin % SKIN.length] : pick(r, SKIN);
  const hairColor = opts.hairTone != null ? HAIR[opts.hairTone % HAIR.length] : pick(r, HAIR);
  const style = opts.hair || pick(r, STYLES);
  const tilt = (r() * 6 - 3).toFixed(1);
  const [bgA, bgB] = backdrop.tones;
  const [jacket, shirt] = outfit.colors;
  const isLight = ["studio-white", "glass-office"].includes(backdrop.id);
  const hasBokeh = ["glass-office", "city-terrace", "botanical", "library"].includes(backdrop.id);
  const turtle = outfit.id === "black-turtleneck";
  const knitOnly = outfit.id === "white-shirt";

  let bokeh = "";
  if (hasBokeh) {
    for (let i = 0; i < 9; i++) {
      const x = (r() * 400).toFixed(0);
      const y = (r() * 300).toFixed(0);
      const rad = (18 + r() * 38).toFixed(0);
      bokeh += `<circle cx="${x}" cy="${y}" r="${rad}" fill="#fff" opacity="${(0.06 + r() * 0.12).toFixed(2)}"/>`;
    }
  }

  const torso = turtle
    ? `<path d="M-20 500 C-4 424 84 384 160 372 L240 372 C316 384 404 424 420 500Z" fill="${jacket}"/>
       <path d="M168 318 L232 318 L238 376 C220 386 180 386 162 376Z" fill="${jacket}"/>
       <path d="M168 330 C190 338 212 338 232 330" stroke="#000" stroke-opacity=".25" stroke-width="3" fill="none"/>`
    : knitOnly
      ? `<path d="M-20 500 C-4 424 84 382 160 370 L240 370 C316 382 404 424 420 500Z" fill="${jacket}"/>
         <path d="M160 370 L200 430 L240 370 L226 352 L200 392 L174 352Z" fill="#dcd8d0"/>
         <path d="M200 430 L200 500" stroke="#cfcac1" stroke-width="2"/>`
      : `<path d="M-20 500 C-4 424 84 382 158 370 L242 370 C316 382 404 424 420 500Z" fill="${jacket}"/>
         <path d="M170 366 L200 452 L230 366Z" fill="${shirt}"/>
         <path d="M158 370 L200 470 L176 380Z M242 370 L200 470 L224 380Z" fill="#000" opacity=".22"/>
         <path d="M170 366 L186 348 L200 390 L214 348 L230 366 L200 404Z" fill="${shirt}" opacity=".96"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice">
<defs>
  <radialGradient id="bg" cx="42%" cy="34%" r="80%"><stop offset="0" stop-color="${bgA}"/><stop offset="1" stop-color="${bgB}"/></radialGradient>
  <linearGradient id="skin" x1="0" y1="0" x2="1" y2=".3"><stop offset="0" stop-color="${skinHi}"/><stop offset=".62" stop-color="${skinHi}"/><stop offset="1" stop-color="${skinLo}"/></linearGradient>
  <linearGradient id="neck" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${skinLo}"/><stop offset="1" stop-color="${skinHi}"/></linearGradient>
  <radialGradient id="vig" cx="50%" cy="42%" r="75%"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${isLight ? 0.16 : 0.38}"/></radialGradient>
  <linearGradient id="key" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="10"/></filter>
</defs>
<rect width="400" height="500" fill="url(#bg)"/>
<g filter="url(#soft)">${bokeh}</g>
<ellipse cx="200" cy="492" rx="210" ry="40" fill="#000" opacity=".18" filter="url(#soft)"/>
<g transform="translate(200 540) scale(1.3) translate(-200 -500) rotate(${tilt} 200 300)">
  ${hair(style, hairColor, true)}
  <path d="M174 290 L226 290 L230 372 C214 380 186 380 170 372Z" fill="url(#neck)"/>
  ${torso}
  <ellipse cx="139" cy="240" rx="10" ry="17" fill="${skinLo}"/>
  <ellipse cx="261" cy="240" rx="10" ry="17" fill="${skinLo}"/>
  <ellipse cx="200" cy="232" rx="62" ry="80" fill="url(#skin)"/>
  <ellipse cx="232" cy="262" rx="26" ry="36" fill="${skinLo}" opacity=".35"/>
  <ellipse cx="184" cy="196" rx="26" ry="16" fill="#fff" opacity=".10"/>
  ${hair(style, hairColor, false)}
</g>
<rect width="400" height="500" fill="url(#key)"/>
<rect width="400" height="500" fill="url(#vig)"/>
</svg>`;
}

export function portraitDataURL(seed, opts) {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(portraitSVG(seed, opts));
}
