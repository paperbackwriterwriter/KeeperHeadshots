// The shoot flow. One page, driven by the shoot's server-side status:
//   (new) upload -> draft/checking -> checked (photo check + looks) -> generating/reviewing -> done (proofs)

import { $, $$, html, raw, icon, api, state, toast, media, squareMedia, busy, spinner, greaseCircle, silhouette, esc, reduceMotion, loadSession } from "../core.js";
import { BACKDROPS, OUTFITS, MAX_LOOKS as MAX_LOOKS_ALL, TAKES_PER_LOOK, MAX_SELFIES, PACKAGES, lookFor } from "../shared/catalog.js";
import { portraitDataURL } from "../shared/portrait.js";
import { aiBanner, planBanner } from "./dashboard.js";
import { currentFormat, formatPicker, formatHrefs, formatName, saveFormat, downloadAll } from "./format.js";

const STEPS = ["Upload", "Photo check", "Looks", "Develop", "Proofs"];
const LIVE = ["checking", "generating", "reviewing"];

function stepper(current) {
  return html`<ol class="stepper" aria-label="Shoot progress">
    ${STEPS.map((s, i) => html`<li class="${i < current ? "done" : i === current ? "current" : ""}" ${i === current ? raw('aria-current="step"') : ""}>${String(i + 1).padStart(2, "0")}<b>${s}</b></li>`)}
  </ol>`;
}

const lookName = (b, o) => {
  const l = lookFor(b, o);
  return l ? `${l.backdrop.name} · ${l.outfit.name}` : "";
};

const scoreColor = (n) => (n >= 80 ? "#6fdca8" : n >= 60 ? "#f5b94a" : "#ff8a73");
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const gradeLabel = (g) => ({ keeper: "Keeper", solid: "Solid", retake: "Retake" })[g] || g;
// Changes whenever a frame moves stage, so the contact sheet repaints it.
const frameKey = (t) => [t.status, t.stage || "", t.attempt || ""].join("|");
const meterColor = (v) => (v >= 8 ? "var(--success)" : v >= 6 ? "var(--warning)" : "var(--danger)");

export async function renderStudio(ctx, id) {
  const { root } = ctx;
  let timer = null;
  let disposed = false;
  let view = null; // local sub-view for "checked" shoots: "check" | "looks"
  let shoot = null;
  // Reads and photo uploads started on this page are cancelled when you leave
  // it. One-off actions (start, grade, delete…) are left to finish: the server
  // completes them either way.
  const aborter = new AbortController();
  const signal = aborter.signal;

  const stop = () => {
    clearTimeout(timer);
    timer = null;
  };

  if (!id) return renderUpload(ctx);

  root.innerHTML = html`<main id="main" class="container app-main"><div class="loading-page" aria-busy="true">
    <div class="skel" style="height:14px;width:120px"></div><div class="skel" style="height:56px;width:min(520px,90%)"></div>
    <div class="skel" style="height:320px;border-radius:18px"></div></div></main>`.v;

  let pollErrors = 0;
  async function refresh() {
    try {
      const data = await api(`/api/shoots/${id}`, { signal });
      if (disposed) return;
      pollErrors = 0;
      const prev = shoot;
      shoot = data.shoot;
      ctx.setTitle(shoot.name);
      paint(prev);
      // After uploading, the new shoot's check starts automatically (on the
      // first load that succeeds, even if that's a "Try again").
      if (!prev) autoCheck();
    } catch (err) {
      if (disposed) return;
      if (err.status === 404) {
        root.innerHTML = html`<main id="main" class="container app-main"><div class="empty"><p class="eyebrow">Not found</p><h1 class="display h-2">We couldn't find that shoot.</h1><p class="lede">It may have been deleted.</p><a class="btn btn-ink" href="/app" data-link>Back to your shoots</a></div></main>`.v;
        return;
      }
      // The first load failed (offline, server error): say so, with a retry,
      // rather than leaving the loading skeleton up.
      if (!shoot) {
        root.innerHTML = html`<main id="main" class="container app-main"><div class="empty"><p class="eyebrow">Couldn't load</p><h1 class="display h-2">We couldn't load this shoot.</h1><p class="lede">${err.message}</p><div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><button class="btn btn-ink" type="button" id="retryLoad">${icon("refresh-cw")} Try again</button><a class="btn btn-ghost" href="/app" data-link>Back to your shoots</a></div></div></main>`.v;
        $("#retryLoad")?.addEventListener("click", () => {
          root.innerHTML = html`<main id="main" class="container app-main"><div class="loading-page" aria-busy="true"><div class="skel" style="height:320px;border-radius:18px"></div></div></main>`.v;
          refresh();
        });
        return;
      }
      // Keep polling through a hiccup, but show the message once (not every
      // poll) and back off until a poll succeeds again.
      if (!pollErrors++) toast(err.message, "error");
    }
    // Frames take 30–60 s each, so while developing a check every 4 s is
    // plenty (each check reads the shoot and its frames from storage).
    const every = shoot?.status === "generating" ? 4000 : 3000;
    if (!disposed && shoot && LIVE.includes(shoot.status)) timer = setTimeout(refresh, Math.min(every * 2 ** pollErrors, 15000));
  }

  function paint(prev) {
    const s = shoot;
    // Incremental update while developing keeps finished frames from re-animating.
    if (prev && ["generating", "reviewing"].includes(s.status) && ["generating", "reviewing"].includes(prev.status) && $("#contact")) {
      patchDevelop(s);
      return;
    }
    // While the check runs, nothing on screen changes; don't rebuild it every poll
    // (that would replay animations and re-announce the status to screen readers).
    if (prev?.status === "checking" && s.status === "checking") return;
    if (s.status === "draft" || s.status === "checking") return paintCheck(s);
    if (s.status === "checked") return view === "looks" ? paintLooks(s) : paintCheck(s);
    if (s.status === "generating" || s.status === "reviewing") return paintDevelop(s);
    if (s.status === "error") return s.shots.length ? paintDevelop(s) : paintCheck(s);
    return paintProofs(s);
  }

  /* ---------------------------- Photo check ---------------------------- */

  function paintCheck(s) {
    const checking = s.status === "checking";
    const c = s.check;
    root.innerHTML = html`<main id="main" class="container app-main view-enter">
      ${stepper(1)}
      ${aiBanner()}
      ${s.error ? html`<div class="banner banner-danger" role="alert">${icon("circle-alert")}<div><b>The photo check didn't finish.</b>${s.error}</div></div>` : ""}
      ${checking || !c ? checkPending(s, checking) : checkResult(s)}
    </main>`.v;

    const ring = $("[data-ring]");
    if (ring) requestAnimationFrame(() => requestAnimationFrame(() => ring.style.setProperty("--val", ring.dataset.ring)));
    $("#runCheck")?.addEventListener("click", runCheck);
    $("#recheck")?.addEventListener("click", runCheck);
    wireAddPhotos();
    $$("[data-remove-selfie]").forEach((b) => b.addEventListener("click", () => removeSelfie(b.dataset.removeSelfie, b)));
    $("#toLooks")?.addEventListener("click", () => {
      view = "looks";
      paintLooks(shoot);
      window.scrollTo({ top: 0, behavior: reduceMotion() ? "instant" : "smooth" });
    });
    $("#override")?.addEventListener("click", () => {
      view = "looks";
      shoot._override = true;
      paintLooks(shoot);
    });
    wireDelete();
  }

  async function runCheck(e) {
    const restore = e?.currentTarget ? busy(e.currentTarget, "Checking…") : () => {};
    shoot.status = "checking";
    shoot.error = null;
    paintCheck(shoot);
    try {
      const data = await api(`/api/shoots/${id}/check`, { method: "POST" });
      if (disposed) return;
      shoot = data.shoot;
      paintCheck(shoot);
      toast("Photo check complete.", "success");
      loadSession().catch(() => {});
    } catch (err) {
      restore();
      if (disposed) return;
      await refresh();
      if (err.data?.code !== "ai_not_configured") toast(err.message, "error");
      else toast(err.message, "error", 7000);
    }
  }

  // Add photos to this shoot (keeping the existing ones), then re-check the set.
  function addPhotosPanel(s, tips = []) {
    const room = MAX_SELFIES - s.selfies.length;
    return html`<section class="panel add-more" id="addMore" aria-labelledby="addMoreTitle">
      <div class="add-more-copy">
        <h3 class="h-4" id="addMoreTitle">${icon("image-plus")} Add more photos</h3>
        <p class="small muted">Your ${s.selfies.length} photo${s.selfies.length === 1 ? "" : "s"} stay${s.selfies.length === 1 ? "s" : ""} in this shoot. Add ${room ? `up to ${room} more` : "more after removing one"} and we'll re-check the whole set.</p>
        ${tips.length ? html`<ul class="tips" style="margin-top:14px">${tips.map((t) => html`<li>${icon("arrow-right")}<span>${t}</span></li>`)}</ul>` : ""}
      </div>
      ${room
        ? html`<label class="dropzone dz-compact" id="addDz">
            <input type="file" id="addFile" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple aria-describedby="addStatus" />
            <span class="dz-icon">${icon("upload")}</span>
            <span><span class="h-4" style="display:block">Add photos</span><span class="small muted" id="addStatus">${s.selfies.length} of ${MAX_SELFIES} used · JPG, PNG or WebP</span></span>
          </label>`
        : html`<p class="small muted" id="addStatus">You're at the ${MAX_SELFIES}-photo limit. Remove a photo to make room.</p>`}
    </section>`;
  }

  function wireAddPhotos() {
    const input = $("#addFile");
    const dz = $("#addDz");
    if (!input || !dz) return;
    input.addEventListener("change", () => {
      const files = [...input.files];
      input.value = "";
      addPhotos(files);
    });
    ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => (e.preventDefault(), dz.classList.add("drag"))));
    ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => (e.preventDefault(), dz.classList.remove("drag"))));
    dz.addEventListener("drop", (e) => addPhotos([...e.dataTransfer.files]));
  }

  async function addPhotos(files) {
    const list = files.filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (!list.length) return toast("Those files aren't photos. Try JPG, PNG or WebP.", "error");
    const room = MAX_SELFIES - shoot.selfies.length;
    if (list.length > room) toast(`Only ${MAX_SELFIES} photos per shoot — adding the first ${room}.`, "info");
    const status = $("#addStatus");
    const dz = $("#addDz");
    dz?.classList.add("busy");
    let added = 0;
    const batch = list.slice(0, room);
    for (let i = 0; i < batch.length && !disposed; i++) {
      if (status) status.textContent = `Uploading ${i + 1} of ${batch.length}…`;
      try {
        await api(`/api/shoots/${id}/selfies`, { method: "POST", body: { photo: await toJpegDataURL(batch[i]) }, signal });
        added++;
      } catch (err) {
        if (!disposed) toast(err.message, "error", 6000);
      }
    }
    dz?.classList.remove("busy");
    if (disposed) return;
    if (!added) return refresh();
    let data;
    try {
      data = await api(`/api/shoots/${id}`, { signal });
    } catch {
      return refresh();
    }
    if (disposed) return;
    shoot = data.shoot;
    toast(`Added ${added} photo${added === 1 ? "" : "s"}. Re-checking your set…`, "success");
    if (state.ai.vision) runCheck();
    else paintCheck(shoot);
  }

  async function removeSelfie(file, btn) {
    if (!confirm("Remove this photo from the shoot?")) return;
    const restore = busy(btn, "");
    try {
      const data = await api(`/api/shoots/${id}/selfies/${encodeURIComponent(file.split("/").pop())}`, { method: "DELETE" });
      shoot = data.shoot;
      paintCheck(shoot);
      toast("Photo removed.", "success");
    } catch (err) {
      restore();
      toast(err.message, "error");
    }
  }

  function checkPending(s, checking) {
    const phrases = ["Measuring light on your face…", "Checking focus and sharpness…", "Looking for sunglasses, hats and filters…", "Comparing angles across your set…"];
    if (checking) {
      setTimeout(() => {
        const el = $("#phrase");
        if (!el) return;
        let i = 0;
        const t = setInterval(() => {
          if (!document.body.contains(el)) return clearInterval(t);
          i = (i + 1) % phrases.length;
          el.textContent = phrases[i];
        }, 2200);
      });
    }
    return html`<div class="page-head">
        <div><p class="eyebrow">${s.name}</p><h1 class="display h-1" style="margin-top:8px">${checking ? "Reviewing your photos" : "Ready for your photo check"}</h1></div>
        ${checking ? "" : html`<button class="btn btn-flash btn-lg" id="runCheck">${icon("scan-face")} Run photo check</button>`}
      </div>
      ${checking
        ? html`<p class="status-line">${spinner()}<span id="phrase" aria-live="polite">${phrases[0]}</span></p>`
        : html`<p class="lede" style="margin-bottom:24px">Our AI photo check scores every photo for lighting, sharpness, visibility and expression, then tells you what to fix — before any rendering time is spent.</p>`}
      <div class="scan-grid">
        ${s.selfies.map((p, i) => html`<div class="scan ${checking ? "" : "idle"}" style="--i:${i}"><img src="${media(p.file)}" alt="Your photo ${i + 1}" /><span class="corners"></span>${!checking && s.selfies.length > 1 ? html`<button class="rm-photo" data-remove-selfie="${p.file}" aria-label="Remove photo ${i + 1}">${icon("x")}</button>` : ""}</div>`)}
      </div>
      ${checking
        ? html`<div class="panel" style="margin-top:24px"><div class="skel skel-line" style="width:40%"></div><div class="skel skel-line" style="width:85%"></div><div class="skel skel-line" style="width:70%"></div></div>`
        : html`<div style="margin-top:24px">${addPhotosPanel(s)}</div><div class="actions-bar"><button class="btn btn-ghost btn-sm" id="delete">${icon("trash-2")} Delete shoot</button></div>`}`;
  }

  function checkResult(s) {
    const c = s.check;
    const verdict = { ready: ["Ready to shoot", "badge-success"], usable: ["Usable", "badge-warn"], retake: ["Retake needed", "badge-danger"] }[c.verdict];
    const kept = c.photos.filter((p) => p.keep).length;
    return html`<section class="verdict">
        <div class="ring" style="--val:0;--col:${scoreColor(c.overall_score)}" data-ring="${c.overall_score}">
          <svg viewBox="0 0 120 120"><circle class="track" cx="60" cy="60" r="54"/><circle class="bar" cx="60" cy="60" r="54"/></svg>
          <div class="val"><strong class="tabular">${c.overall_score}</strong><span>of 100</span></div>
        </div>
        <div style="position:relative;z-index:1">
          <span class="badge ${verdict[1]}">${icon(c.verdict === "retake" ? "circle-alert" : "check")} ${verdict[0]}</span>
          <h1 class="display h-2" style="margin:14px 0 10px">${c.headline}</h1>
          <p class="muted" style="max-width:62ch">${c.summary}</p>
          <p class="mono" style="margin-top:14px;color:#a9b1bd">${kept} OF ${s.selfies.length} PHOTOS WILL BE USED AS REFERENCES</p>
        </div>
      </section>

      <div class="photo-checks">
        ${c.photos.map((p, i) => {
          const selfie = s.selfies[p.index];
          if (!selfie) return "";
          return html`<article class="pcheck ${p.keep ? "" : "skip"}" style="--i:${i}">
            <div class="pcheck-img"><img src="${media(selfie.file)}" alt="Your photo ${p.index + 1}" /></div>
            <div class="pcheck-body">
              <div class="pcheck-top"><span class="pcheck-score tabular">${p.score}</span><span style="display:flex;gap:6px;align-items:center">${p.keep ? html`<span class="badge badge-success">${icon("check")} Using</span>` : html`<span class="badge badge-danger">${icon("x")} Skipped</span>`}${s.selfies.length > 1 ? html`<button class="rm-inline" data-remove-selfie="${selfie.file}" aria-label="Remove photo ${p.index + 1}" title="Remove photo">${icon("trash-2")}</button>` : ""}</span></div>
              <div class="meters">
                ${[["Lighting", p.lighting], ["Sharpness", p.sharpness], ["Visibility", p.face_visibility], ["Expression", p.expression]].map(
                  ([k, v]) => html`<div class="meter" style="--i:${i}"><span>${k}</span><div class="meter-track"><div class="meter-fill" style="--v:${v};--mcol:${meterColor(v)}"></div></div><b>${v}</b></div>`,
                )}
              </div>
              ${p.issues.length ? html`<div class="issues">${p.issues.map((x) => html`<span class="issue">${x}</span>`)}</div>` : ""}
              <p class="small muted" style="line-height:1.45">${p.note}</p>
            </div>
          </article>`;
        })}
      </div>

      <div style="margin-top:24px">${addPhotosPanel(s, c.tips || [])}</div>

      <div class="actions-bar">
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" id="delete">${icon("trash-2")} Delete</button><button class="btn btn-ghost btn-sm" id="recheck">${icon("refresh-cw")} Re-check photos</button></div>
        ${c.verdict === "retake"
          ? html`<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost" id="override">Continue anyway</button><a class="btn btn-flash" href="#addMore">${icon("camera")} Add better photos</a></div>`
          : html`<button class="btn btn-flash btn-lg" id="toLooks">Choose your looks ${icon("arrow-right")}</button>`}
      </div>
      <p class="disclaimer" style="margin-top:16px">${icon("info")} Scores are AI estimates of how well each photo will work as a reference — not a judgment of how you look.</p>`;
  }

  /* ------------------------------- Looks ------------------------------- */

  // Well-matched starting looks, in the order new slots get filled.
  const SUGGESTED = [
    ["studio-gray", "navy-suit"],
    ["glass-office", "charcoal-blazer"],
    ["city-terrace", "camel-knit"],
    ["library", "black-turtleneck"],
    ["studio-white", "white-shirt"],
    ["botanical", "oxford"],
  ];

  function paintLooks(s) {
    const plan = state.user?.plan;
    const MAX_LOOKS = plan?.maxLooks || MAX_LOOKS_ALL;
    const trial = plan?.tier === "trial";
    let looks = (s.looks?.length ? s.looks.map((l) => ({ ...l })) : SUGGESTED.slice(0, 2).map(([backdrop, outfit]) => ({ backdrop, outfit }))).slice(0, MAX_LOOKS);
    let active = 0;
    const same = (a, b) => a.backdrop === b.backdrop && a.outfit === b.outfit;
    const taken = (look, except = -1) => looks.some((l, i) => i !== except && same(l, look));
    const suggest = () => {
      const fresh = SUGGESTED.map(([backdrop, outfit]) => ({ backdrop, outfit })).filter((l) => !taken(l));
      // Prefer a backdrop that isn't on the list yet, for variety.
      return fresh.find((l) => !looks.some((x) => x.backdrop === l.backdrop)) || fresh[0] || { backdrop: BACKDROPS[0].id, outfit: OUTFITS.find((o) => !taken({ backdrop: BACKDROPS[0].id, outfit: o.id }))?.id };
    };
    const preview = (l) => portraitDataURL("look-" + l.backdrop + l.outfit, { backdrop: l.backdrop, outfit: l.outfit, skin: 2, hair: "short", hairTone: 1 });

    root.innerHTML = html`<main id="main" class="container app-main view-enter looks-page">
      ${stepper(2)}
      <div class="page-head"><div><p class="eyebrow">${s.name}</p><h1 class="display h-1" style="margin-top:8px">Dress the set.</h1><p class="lede" style="margin-top:12px">Up to ${MAX_LOOKS} looks, ${TAKES_PER_LOOK} takes each. Tap a look to change its backdrop or outfit, or tap an empty slot to add one.</p></div></div>

      ${trial ? html`<div class="banner banner-info">${icon("sparkles")}<div><b>Your free shoot.</b>Up to ${MAX_LOOKS} looks (${MAX_LOOKS * TAKES_PER_LOOK} headshots). Paid packages unlock up to ${MAX_LOOKS_ALL} looks per shoot.</div></div>` : ""}
      ${plan && !plan.canDevelop ? planBanner() : ""}
      <section aria-labelledby="looksTitle">
        <div class="looks-head">
          <h2 class="h-4" id="looksTitle">Your looks <span class="mono muted" id="lookCount"></span></h2>
          <button type="button" class="btn btn-ghost btn-sm" id="fillAll">${icon("sparkles")} Fill remaining slots</button>
        </div>
        <ol class="look-cards" id="slots"></ol>
      </section>

      <section class="look-editor" id="editor" aria-labelledby="editorTitle">
        <p class="eyebrow" id="editorTitle" aria-live="polite"></p>
        <div class="opt-group">
          <h3 class="h-4">Backdrop</h3>
          <div class="backdrops" id="backdrops" role="group" aria-label="Backdrop">
            ${BACKDROPS.map((b) => html`<button type="button" class="opt" data-backdrop="${b.id}" aria-pressed="false">
              <span class="sw" style="background:radial-gradient(circle at 42% 34%, ${b.tones[0]}, ${b.tones[1]})"></span>
              <span><span class="opt-name">${b.name}</span><br /><span class="opt-sub">${b.blurb}</span></span>
              <span class="tick">${icon("check")}</span>
            </button>`)}
          </div>
        </div>
        <div class="opt-group">
          <h3 class="h-4">Outfit</h3>
          <div class="outfits" id="outfits" role="group" aria-label="Outfit">
            ${OUTFITS.map((o) => html`<button type="button" class="pill-opt" data-outfit="${o.id}" aria-pressed="false"><span class="swatch" style="background:linear-gradient(135deg, ${o.colors[0]} 55%, ${o.colors[1]} 55%)"></span>${o.name}</button>`)}
          </div>
        </div>
      </section>

      <div class="develop-bar">
        <button class="btn btn-ghost btn-sm" id="backCheck" aria-label="Back to photo check">${icon("arrow-left")}<span class="hide-s">Photo check</span></button>
        <p class="develop-tally"><strong class="tabular" id="tally">0</strong> <span id="tallySub">headshots</span></p>
        <button class="btn btn-flash btn-lg" id="develop">${icon("aperture")} Develop</button>
      </div>
    </main>`.v;

    const sync = () => {
      const cur = looks[active];
      $("#slots").innerHTML = html`${looks.map((l, i) => {
        const look = lookFor(l.backdrop, l.outfit);
        return html`<li class="look-card-wrap">
          <button type="button" class="look-card" data-select="${i}" aria-pressed="${i === active}" aria-label="Look ${i + 1}: ${lookName(l.backdrop, l.outfit)}${i === active ? ", editing" : ""}">
            <img src="${preview(l)}" alt="" />
            <span class="look-num">${i + 1}</span>
            <span class="look-text"><b>${look.backdrop.name}</b><span>${look.outfit.name}</span></span>
            ${i === active ? html`<span class="look-editing">${icon("pencil")} Editing</span>` : html`<span class="look-tap">Tap to edit</span>`}
          </button>
          ${looks.length > 1 ? html`<button type="button" class="look-remove" data-remove="${i}" aria-label="Remove look ${i + 1}">${icon("x")}</button>` : ""}
        </li>`;
      })}${Array.from({ length: MAX_LOOKS - looks.length }, (_, k) => html`<li class="look-card-wrap"><button type="button" class="look-card empty" data-add aria-label="Add look ${looks.length + k + 1}"><span class="plus">${icon("plus")}</span><span>Add look</span></button></li>`)}`.v;
      $("#lookCount").textContent = `${looks.length}/${MAX_LOOKS}`;
      $("#fillAll").hidden = looks.length >= MAX_LOOKS;
      $("#editorTitle").textContent = cur ? `Editing look ${active + 1} · ${lookName(cur.backdrop, cur.outfit)}` : "Add a look to start";
      $$("#backdrops .opt").forEach((b) => b.setAttribute("aria-pressed", String(!!cur && b.dataset.backdrop === cur.backdrop)));
      $$("#outfits .pill-opt").forEach((b) => b.setAttribute("aria-pressed", String(!!cur && b.dataset.outfit === cur.outfit)));
      $("#tally").textContent = looks.length * TAKES_PER_LOOK;
      $("#tallySub").textContent = `headshots · ${looks.length} look${looks.length === 1 ? "" : "s"} × ${TAKES_PER_LOOK}`;
      $("#develop").disabled = !looks.length || (plan && !plan.canDevelop);
    };

    const addLook = () => {
      if (looks.length >= MAX_LOOKS) return;
      looks.push(suggest());
      active = looks.length - 1;
      sync();
      // On small screens, bring the editor into view so the change is obvious.
      const ed = $("#editor");
      if (ed.getBoundingClientRect().top > window.innerHeight * 0.6) ed.scrollIntoView({ behavior: reduceMotion() ? "instant" : "smooth", block: "start" });
    };

    const edit = (patch) => {
      if (active < 0 || !looks[active]) {
        if (looks.length >= MAX_LOOKS) return;
        looks.push({ ...suggest(), ...patch });
        active = looks.length - 1;
        return sync();
      }
      const next = { ...looks[active], ...patch };
      if (taken(next, active)) return toast(`“${lookName(next.backdrop, next.outfit)}” is already look ${looks.findIndex((l) => same(l, next)) + 1}.`, "info");
      looks[active] = next;
      sync();
    };

    $("#slots").addEventListener("click", (e) => {
      const rm = e.target.closest("[data-remove]");
      if (rm) {
        const i = Number(rm.dataset.remove);
        looks.splice(i, 1);
        if (active >= i) active = Math.max(0, active - 1);
        return sync();
      }
      if (e.target.closest("[data-add]")) return addLook();
      const sel = e.target.closest("[data-select]");
      if (sel) (active = Number(sel.dataset.select)), sync();
    });
    $("#fillAll").addEventListener("click", () => {
      while (looks.length < MAX_LOOKS) looks.push(suggest());
      sync();
    });
    $("#backdrops").addEventListener("click", (e) => {
      const b = e.target.closest("[data-backdrop]");
      if (b) edit({ backdrop: b.dataset.backdrop });
    });
    $("#outfits").addEventListener("click", (e) => {
      const b = e.target.closest("[data-outfit]");
      if (b) edit({ outfit: b.dataset.outfit });
    });
    $("#backCheck").addEventListener("click", () => {
      view = "check";
      paintCheck(shoot);
    });
    $("#develop").addEventListener("click", async (e) => {
      const restore = busy(e.currentTarget, "Setting up…");
      try {
        const data = await api(`/api/shoots/${id}/generate`, { method: "POST", body: { looks, override: !!shoot._override } });
        shoot = data.shoot;
        paintDevelop(shoot);
        window.scrollTo({ top: 0, behavior: "instant" });
        timer = setTimeout(refresh, 1500);
        loadSession().catch(() => {});
      } catch (err) {
        restore();
        toast(err.message, "error", 7000);
      }
    });
    sync();
  }

  /* ------------------------------ Develop ------------------------------ */

  function frameHTML(t, i) {
    const label = html`<span>${String(i + 1).padStart(2, "0")}</span><span>${lookFor(t.backdrop, t.outfit)?.backdrop.name}</span>`;
    if (t.status === "done") return html`<div class="frame done" data-id="${t.id}" data-status="${frameKey(t)}"><img src="${media(t.file)}" alt="Headshot ${i + 1}: ${lookName(t.backdrop, t.outfit)}" /><div class="fcap">${label}</div></div>`;
    if (t.status === "error") {
      const held = !!t.qa;
      return html`<div class="frame error" data-id="${t.id}" data-status="${frameKey(t)}" title="${t.error}"><div>${icon(held ? "shield-check" : "circle-alert")}<b>Frame ${i + 1} ${held ? "held back" : "failed"}</b><div style="opacity:.8;margin-top:4px">${held ? "It didn't pass our quality check. Retry it for free." : String(t.error || "").slice(0, 90)}</div></div></div>`;
    }
    const stage = t.status !== "rendering" ? "Queued" : t.stage === "qa" ? "Quality check" : t.attempt > 1 ? `Retake ${t.attempt}` : "Developing";
    return html`<div class="frame ${t.status}" data-id="${t.id}" data-status="${frameKey(t)}" role="img" aria-label="Frame ${i + 1}: ${stage.toLowerCase()}">${silhouette()}
      <span class="frame-state">${t.status === "rendering" ? html`<span class="badge badge-live">${stage}</span>` : html`<span class="badge" style="background:rgba(245,241,234,.1);color:#a9b1bd">Queued</span>`}</span><div class="fcap">${label}</div></div>`;
  }

  function developCopy(s) {
    const done = s.shots.filter((x) => x.status === "done").length;
    const failed = s.shots.filter((x) => x.status === "error").length;
    const total = s.shots.length;
    if (s.status === "reviewing") return { title: "Your retoucher is grading the set", sub: `All ${plural(done, "headshot")} developed. Now scoring likeness, polish and lighting, and picking your best shot…`, pct: 96, done, total, failed };
    if (s.status === "error") return { title: "The shoot hit a snag", sub: s.error || "Some frames couldn't be developed.", pct: (done / total) * 100, done, total, failed };
    // Every studio slot is busy with other shoots: this one starts next.
    if (s.queued) return { title: done ? `${done} of ${total} developed` : "Your shoot is next in line", sub: "The studio is busy with other shoots right now. Your frames start as soon as a slot frees up, usually within a minute or two. Keep this page open; if you leave, the shoot picks up again when you come back.", pct: Math.max(4, ((done + failed) / total) * 92), done, total, failed };
    return { title: done ? `${done} of ${total} developed` : "Developing your headshots", sub: "Each frame is rendered from your reference photos, then checked for likeness and polish before you see it. Anything that falls short is retaken automatically. Keep this page open while they develop; if you leave, the shoot picks up again when you come back.", pct: Math.max(4, ((done + failed) / total) * 92), done, total, failed };
  }

  function paintDevelop(s) {
    const c = developCopy(s);
    root.innerHTML = html`<main id="main" class="container app-main view-enter">
      ${stepper(3)}
      <div class="develop-head">
        <div><p class="eyebrow" id="devEyebrow">${s.status === "error" ? "Paused" : html`<span class="dot"></span>Live`} · ${s.name}</p><h1 class="display h-1" style="margin-top:8px" id="devTitle">${c.title}</h1><p class="lede" style="margin-top:10px" id="devSub">${c.sub}</p></div>
        <div id="devActions">${developActions(s)}</div>
      </div>
      <div class="progress" role="progressbar" aria-label="Development progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(c.pct)}"><div id="bar" style="width:${c.pct}%"></div></div>
      <div class="contact" id="contact">${s.shots.map((t, i) => frameHTML(t, i))}</div>
    </main>`.v;
    wireDevelopActions();
  }

  function developActions(s) {
    const failed = s.shots.filter((x) => x.status === "error").length;
    if (s.status === "error" || (failed && !LIVE.includes(s.status))) return html`<button class="btn btn-flash" id="resume">${icon("refresh-cw")} Retry ${failed} failed frame${failed === 1 ? "" : "s"}</button>`;
    if (s.status === "reviewing") return html`<span class="badge badge-live">Grading</span>`;
    return html`<span class="mono muted tabular" id="elapsed"></span>`;
  }

  function wireDevelopActions() {
    $("#resume")?.addEventListener("click", async (e) => {
      const restore = busy(e.currentTarget, "Resuming…");
      try {
        const data = await api(`/api/shoots/${id}/resume`, { method: "POST" });
        shoot = data.shoot;
        stop();
        refresh();
      } catch (err) {
        restore();
        toast(err.message, "error");
      }
    });
    const el = $("#elapsed");
    if (el && shoot.updatedAt) {
      const started = Math.min(...shoot.shots.map((x) => new Date(x.startedAt || shoot.updatedAt).getTime()));
      const tick = () => {
        if (!document.body.contains(el)) return;
        const sec = Math.max(0, Math.floor((Date.now() - started) / 1000));
        el.textContent = `ELAPSED ${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
        setTimeout(tick, 1000);
      };
      tick();
    }
  }

  function patchDevelop(s) {
    s.shots.forEach((t, i) => {
      const el = $(`#contact [data-id="${t.id}"]`);
      if (el && el.dataset.status !== frameKey(t)) el.outerHTML = frameHTML(t, i).v;
    });
    const c = developCopy(s);
    $("#devTitle").textContent = c.title;
    $("#devSub").textContent = c.sub;
    $("#bar").style.width = `${c.pct}%`;
    $(".progress").setAttribute("aria-valuenow", String(Math.round(c.pct)));
    if (s.status === "reviewing" && !$("#devActions .badge")) {
      $("#devActions").innerHTML = developActions(s).v;
    }
  }

  /* ------------------------------- Proofs ------------------------------ */

  // The upsell after the proofs, tailored to what the account can do next.
  function upgradeBand(s, doneCount) {
    const plan = state.user?.plan;
    const perks = [
      [icon("layers"), `${MAX_LOOKS_ALL} looks per shoot`, `${MAX_LOOKS_ALL * TAKES_PER_LOOK} headshots instead of ${doneCount}`],
      [icon("briefcase"), "Mix more backdrops & outfits", "Studio, office, rooftop and library looks in one shoot"],
      [icon("badge-check"), "Every shot checked & graded", "The same AI retoucher on every shoot"],
    ];
    const pkgs = html`<div class="upsell-pkgs">${PACKAGES.map(
      (p) => html`<a class="upsell-pkg ${p.popular ? "pop" : ""}" href="/app/buy/${p.id}" data-link>
        ${p.popular ? html`<span class="upsell-badge">Most popular</span>` : ""}
        <span class="upsell-name">${p.name}</span>
        <span class="upsell-price"><strong>$${p.price}</strong> · ${p.shoots} shoots</span>
        <span class="upsell-go">Choose ${icon("arrow-right")}</span>
      </a>`,
    )}</div>`;

    if (s.sample || plan?.tier === "demo") {
      return html`<section class="upsell" id="upgrade" aria-labelledby="upsellTitle">
        <div><p class="eyebrow">Your turn</p><h2 class="display h-2" id="upsellTitle">Make headshots like these from your own selfies.</h2><p class="upsell-sub">Your first shoot is free: 2 looks, 4 headshots, checked and graded by AI.</p></div>
        <div class="upsell-actions"><a class="btn btn-flash btn-lg" href="/signup" data-link>Create free account ${icon("arrow-right")}</a></div>
      </section>`;
    }
    if (plan?.tier === "paid") {
      return html`<section class="upsell" id="upgrade" aria-labelledby="upsellTitle">
        <div><p class="eyebrow">Keep going</p><h2 class="display h-2" id="upsellTitle">Try another look.</h2><p class="upsell-sub">You have ${plan.credits} shoot${plan.credits === 1 ? "" : "s"} left. Each one is ${MAX_LOOKS_ALL} looks and ${MAX_LOOKS_ALL * TAKES_PER_LOOK} fresh headshots.</p></div>
        <div class="upsell-actions"><a class="btn btn-flash btn-lg" href="/app/new" data-link>${icon("plus")} Start another shoot</a><a class="btn btn-ghost-inverse btn-lg" href="/#pricing">Buy more</a></div>
      </section>`;
    }
    return html`<section class="upsell" id="upgrade" aria-labelledby="upsellTitle">
      <div>
        <p class="eyebrow">Upgrade</p>
        <h2 class="display h-2" id="upsellTitle">Upgrade for more options.</h2>
        <p class="upsell-sub">${s.paidWith === "free" ? `That was your free shoot. ` : ""}Paid shoots give you more looks, more takes and more headshots to choose from.</p>
        <ul class="upsell-perks">${perks.map(([ic, t, d]) => html`<li><span class="ficon">${ic}</span><div><b>${t}</b><span>${d}</span></div></li>`)}</ul>
      </div>
      ${pkgs}
    </section>`;
  }

  function paintProofs(s) {
    const done = s.shots.map((t, i) => ({ ...t, n: i + 1 })).filter((t) => t.status === "done");
    const failed = s.shots.filter((t) => t.status === "error").length;
    const r = s.review;
    const grade = (t) => r?.shots?.[t.id];
    const aiBest = done.find((t) => t.id === r?.bestShotId) || done[0];
    const picked = done.find((t) => t.id === s.pickedShotId);
    const best = picked || aiBest;
    const bestG = best && grade(best);
    const isMine = !!picked && picked.id !== aiBest?.id;
    const keepers = done.filter((t) => grade(t)?.grade === "keeper").length;
    const avgLikeness = r ? (done.reduce((a, t) => a + (grade(t)?.likeness || 0), 0) / Math.max(1, done.length)).toFixed(1) : "—";
    const counts = { all: done.length, keeper: keepers, solid: done.filter((t) => grade(t)?.grade === "solid").length, retake: done.filter((t) => grade(t)?.grade === "retake").length };
    let filter = "all";
    // Sort by score (best first) when graded, otherwise by frame order.
    const ordered = r ? [...done].sort((a, b) => (grade(b)?.overall || 0) - (grade(a)?.overall || 0)) : done;

    root.innerHTML = html`<main id="main" class="container app-main view-enter">
      ${stepper(4)}
      ${s.sample ? html`<div class="banner banner-info">${icon("info")}<div><b>This is a sample shoot.</b>It shows exactly what your proofs will look like — sample images are illustrations. Start a new shoot to develop real headshots from your photos.</div><a class="btn btn-sm btn-flash" href="/app/new" data-link>New shoot</a></div>` : ""}
      ${s.reviewError ? html`<div class="banner banner-warn">${icon("circle-alert")}<div><b>Your headshots are ready, but grading didn't finish.</b>${s.reviewError}</div><button class="btn btn-sm btn-ink" id="regrade">${icon("refresh-cw")} Retry grading</button></div>` : ""}
      ${failed ? html`<div class="banner banner-warn">${icon("circle-alert")}<div><b>${failed} frame${failed === 1 ? "" : "s"} didn't develop.</b>You can retry just those frames — the rest stay as they are.</div><button class="btn btn-sm btn-ink" id="resume">${icon("refresh-cw")} Retry</button></div>` : ""}

      <section class="proof-hero">
        <div class="best-print">
          ${best
            ? html`<span class="best-tag">${icon("crown")} ${isMine ? "Your pick" : "Best pick"}${bestG ? ` · ${bestG.overall}` : ""}</span>
              <div class="print"><button class="open" data-open="${best.id}" aria-label="Open best pick full size"><img src="${media(best.file)}" alt="Your best headshot: ${lookName(best.backdrop, best.outfit)}" /></button>
              <div class="print-cap"><b>Frame ${String(best.n).padStart(2, "0")}</b><span>${lookName(best.backdrop, best.outfit)}</span></div></div>${greaseCircle()}`
            : ""}
        </div>
        <div>
          <p class="eyebrow"><span class="dot"></span>${r ? "Retoucher's verdict" : "Your proofs"} · ${s.name}</p>
          <h1 class="display h-1">${r?.headline || `${plural(done.length, "headshot")}, developed.`}</h1>
          <p class="lede">${r?.summary || "Every frame is below. Grading scores will appear here once the AI review completes."}</p>
          <div class="scoreboard">
            <div><strong class="tabular">${r ? keepers : done.length}</strong><span>${r ? "Keepers" : "Headshots"}</span></div>
            <div><strong class="tabular">${avgLikeness}</strong><span>Avg. likeness /10</span></div>
            <div><strong class="tabular">${bestG?.overall ?? "—"}</strong><span>Best score</span></div>
          </div>
          ${bestG
            ? html`<div class="bars" style="max-width:420px;margin-bottom:24px">${[["Likeness", bestG.likeness], ["Polish", bestG.polish], ["Lighting", bestG.lighting]].map(([k, v]) => html`<div class="bar-row"><span>${k}</span><div class="meter-track"><div class="meter-fill" style="--v:${v};--mcol:var(--teal-600)"></div></div><b>${v}</b></div>`)}</div>
              <p class="small" style="margin-bottom:24px"><span class="chip">${icon("briefcase")} Best for ${bestG.best_for}</span> <span class="muted" style="margin-left:6px">${bestG.note}</span></p>`
            : ""}
          ${isMine && aiBest
            ? html`<p class="small muted" style="margin:-8px 0 20px">The retoucher's pick was frame ${String(aiBest.n).padStart(2, "0")}. <button class="link" id="resetPick" style="background:none;border:0;padding:0;cursor:pointer;font:inherit">Use the retoucher's pick</button></p>`
            : ""}
          <div class="fmt-row">
            <span class="fmt-label" id="fmtLabel">Download as</span>
            ${formatPicker(currentFormat())}
          </div>
          <div id="dlRow"></div>
          <p class="small muted" style="margin-top:14px;max-width:60ch">Every headshot is ready to use as it is, in either shape: a full-resolution 3:4 portrait for websites, print and business cards, or a 1:1 square for LinkedIn, Microsoft Teams and social media, framed for round profile photos with your face centered and room around it. No cropping needed.</p>
        </div>
      </section>

      <section aria-labelledby="proofsTitle">
        <div class="page-head" style="margin-bottom:8px">
          <h2 class="display h-2" id="proofsTitle">Contact sheet</h2>
          <div class="filters" role="group" aria-label="Filter headshots">
            ${[["all", "All"], ...(r ? [["keeper", "Keepers"], ["solid", "Solid"], ["retake", "Retakes"]] : [])].map(
              ([k, l]) => html`<button class="filter" data-filter="${k}" aria-pressed="${k === "all"}">${l} <span class="n">${counts[k]}</span></button>`,
            )}
          </div>
        </div>
        <div class="proofs" id="proofs"></div>
      </section>

      ${upgradeBand(s, done.length)}

      <section class="panel" style="margin-top:48px;display:flex;gap:24px;align-items:center;justify-content:space-between;flex-wrap:wrap">
        <div>
          <p class="eyebrow">References used</p>
          <div class="refs" style="margin-top:10px">${s.selfies.map((p, i) => html`<img src="${media(p.file)}" alt="Reference photo ${i + 1}" loading="lazy" />`)}</div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          ${s.check ? html`<span class="score-pill g-${s.check.overall_score >= 80 ? "keeper" : s.check.overall_score >= 60 ? "solid" : "retake"}"><i></i>Photo check ${s.check.overall_score}</span>` : ""}
          ${s.sample ? "" : html`<button class="btn btn-ghost btn-sm" id="regradeAll" title="Run the AI grading again on these headshots">${icon("refresh-cw")} Re-grade</button><button class="btn btn-ghost btn-sm" id="delete">${icon("trash-2")} Delete shoot</button>`}
          <a class="btn btn-ink btn-sm" href="/app/new" data-link>${icon("plus")} New shoot</a>
        </div>
      </section>
      <p class="disclaimer" style="margin-top:16px">${icon("info")} Grades are AI assessments to help you choose; always pick the photo you feel represents you best.</p>
      <dialog class="lightbox" id="lb" aria-label="Headshot viewer"></dialog>
    </main>`.v;

    // Download buttons follow the chosen format (portrait, square or both).
    const drawDl = () => {
      const fmt = currentFormat();
      const n = done.length;
      const what = fmt === "both" ? "as portraits and squares" : fmt === "square" ? "as 1:1 squares" : "as 3:4 portraits";
      $("#dlRow").innerHTML = html`<div style="display:flex;gap:10px;flex-wrap:wrap">
        ${best ? html`<button class="btn btn-flash btn-lg" id="dlBest">${icon("download")} Download ${isMine ? "your pick" : "best pick"}${fmt === "both" ? "" : ` · ${fmt === "square" ? "1:1" : "3:4"}`}</button>` : ""}
        <button class="btn btn-ghost btn-lg" id="dlAll" aria-label="Download all ${plural(n, "headshot")}, ${what}">${icon("download")} All ${n}</button>
        <a class="btn btn-ghost btn-lg" href="#upgrade">${icon("sparkles")} More options</a>
      </div>`.v;
      $("#dlBest")?.addEventListener("click", () => downloadAll(formatHrefs(best.file, fmt)));
      $("#dlAll").addEventListener("click", async (e) => {
        const restore = busy(e.currentTarget, "Downloading…");
        await downloadAll(ordered.flatMap((t) => formatHrefs(t.file, fmt)));
        restore();
        toast(`${plural(n, "headshot")} downloaded ${what}.`, "success");
      });
    };
    drawDl();
    $$("[data-format]").forEach((b) =>
      b.addEventListener("click", async () => {
        const fmt = b.dataset.format;
        $$("[data-format]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        try {
          await saveFormat(fmt);
          toast(`Downloads set to ${formatName(fmt).toLowerCase()}.`, "success", 2500);
        } catch {
          $$("[data-format]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.format === currentFormat())));
        }
        drawDl();
      }),
    );

    const grid = $("#proofs");
    const drawGrid = () => {
      const list = ordered.filter((t) => filter === "all" || grade(t)?.grade === filter);
      grid.innerHTML = list.length
        ? html`${list.map((t, i) => {
            const g = grade(t);
            return html`<article class="proof ${t.id === best?.id ? "is-best" : ""}" style="--i:${i}">
              <div class="print">
                <button class="open" data-open="${t.id}" aria-label="Open frame ${t.n} full size"><img src="${media(t.file)}" alt="Headshot ${t.n}: ${lookName(t.backdrop, t.outfit)}" loading="lazy" /></button>
                ${g ? html`<span class="score-pill g-${g.grade} score-badge" title="${gradeLabel(g.grade)}" role="img" aria-label="${gradeLabel(g.grade)}, ${g.overall} out of 100"><i></i>${g.overall}</span>` : ""}
                <div class="print-cap"><b>${String(t.n).padStart(2, "0")} · ${lookFor(t.backdrop, t.outfit)?.backdrop.name || "Headshot"}</b><span>${g ? g.best_for : lookFor(t.backdrop, t.outfit)?.outfit.name || ""}</span></div>
                ${g ? html`<p class="proof-note">${g.note}</p>` : ""}
                <div class="proof-actions">${s.sample ? "" : t.id === best?.id
                  ? html`<span class="pick-label">${icon("crown")} ${isMine ? "Your pick" : "Best pick"}</span>`
                  : html`<button class="pick-btn" data-pick="${t.id}">${icon("crown")} Make this my pick</button>`}</div>
              </div>
            </article>`;
          })}`.v
        : html`<p class="muted" style="grid-column:1/-1;padding:32px 0">No headshots in this group.</p>`.v;
    };
    drawGrid();

    $$("[data-filter]").forEach((b) =>
      b.addEventListener("click", () => {
        filter = b.dataset.filter;
        $$("[data-filter]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        drawGrid();
      }),
    );

    // Lightbox
    const lb = $("#lb");
    let current = 0;
    const openAt = (shotId) => {
      const list = ordered;
      current = Math.max(0, list.findIndex((t) => t.id === shotId));
      drawLb();
      if (!lb.open) lb.showModal();
    };
    const drawLb = () => {
      const t = ordered[current];
      const g = grade(t);
      lb.innerHTML = html`<button class="btn btn-paper btn-icon lb-close" id="lbClose" aria-label="Close viewer">${icon("x")}</button>
      <div class="lb">
        <div class="lb-img"><img src="${media(t.file)}" alt="Headshot ${t.n}: ${lookName(t.backdrop, t.outfit)}" /></div>
        <div class="lb-side">
          <div><p class="eyebrow">Frame ${String(t.n).padStart(2, "0")} · ${current + 1} of ${ordered.length}</p><h2 class="display h-3" style="margin-top:8px">${lookName(t.backdrop, t.outfit)}</h2></div>
          ${g
            ? html`<div style="display:flex;gap:12px;align-items:center"><span class="score-pill g-${g.grade}" style="height:34px;font-size:14px"><i></i>${g.overall} / 100</span><span class="badge ${g.grade === "keeper" ? "badge-success" : g.grade === "solid" ? "badge-warn" : "badge-danger"}">${gradeLabel(g.grade)}</span></div>
              <div class="bars">${[["Likeness", g.likeness], ["Polish", g.polish], ["Lighting", g.lighting]].map(([k, v]) => html`<div class="bar-row"><span>${k}</span><div class="meter-track"><div class="meter-fill" style="--v:${v};--mcol:${meterColor(v)}"></div></div><b>${v}</b></div>`)}</div>
              <p style="color:#a9b1bd">${g.note}</p><p class="small"><b>Best for:</b> ${g.best_for}</p>`
            : html`<p style="color:#a9b1bd">Not graded yet.</p>`}
          ${(() => {
            // Both shapes are always offered; the chosen format goes first.
            const sq = currentFormat() === "square";
            const portrait = html`<a class="btn ${sq ? "btn-ghost-inverse" : "btn-flash"}" href="${media(t.file, true)}" download>${icon("download")} Download portrait (3:4)</a>`;
            const square = html`<a class="btn ${sq ? "btn-flash" : "btn-ghost-inverse"}" href="${squareMedia(t.file)}" download>${icon("focus")} Download square (1:1)</a>`;
            return sq ? html`${square}${portrait}` : html`${portrait}${square}`;
          })()}
          ${s.sample ? "" : t.id === best?.id
            ? html`<span class="chip" style="align-self:flex-start">${icon("crown")} ${isMine ? "Your pick" : "Best pick"}</span>`
            : html`<button class="btn btn-ghost-inverse" data-pick="${t.id}">${icon("crown")} Make this my pick</button>`}
          <div class="lb-nav"><button class="btn btn-ghost-inverse btn-sm" id="lbPrev" ${ordered.length < 2 ? raw("disabled") : ""}>${icon("arrow-left")} Prev</button><button class="btn btn-ghost-inverse btn-sm" id="lbNext" ${ordered.length < 2 ? raw("disabled") : ""}>Next ${icon("arrow-right")}</button></div>
        </div>
      </div>`.v;
      $("#lbClose").onclick = () => lb.close();
      $("#lbPrev").onclick = () => step(-1);
      $("#lbNext").onclick = () => step(1);
    };
    const step = (d) => {
      current = (current + d + ordered.length) % ordered.length;
      // Redrawing replaces the buttons; keep keyboard focus on the one that was used.
      const focused = document.activeElement?.id;
      drawLb();
      if (focused) lb.querySelector(`#${focused}`)?.focus();
    };
    lb.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    });
    lb.addEventListener("click", (e) => e.target === lb && lb.close());
    $("#main").addEventListener("click", (e) => {
      const b = e.target.closest("[data-open]");
      if (b) openAt(b.dataset.open);
    });

    // The person's own pick overrides the retoucher's and becomes the cover.
    async function setPick(shotId, btn) {
      const restore = btn ? busy(btn, "Saving…") : () => {};
      try {
        const data = await api(`/api/shoots/${id}`, { method: "PATCH", body: { pickedShotId: shotId } });
        if (lb.open) lb.close();
        shoot = data.shoot;
        paintProofs(shoot);
        toast(shotId ? "Saved as your pick." : "Back to the retoucher's pick.", "success");
      } catch (err) {
        restore();
        toast(err.message, "error");
      }
    }
    $("#main").addEventListener("click", (e) => {
      const b = e.target.closest("[data-pick]");
      if (b) setPick(b.dataset.pick, b);
    });
    // (The lightbox sits inside #main, so the listener above covers its pick button too.)
    $("#resetPick")?.addEventListener("click", (e) => setPick(null, e.currentTarget));

    $$("#regrade, #regradeAll").forEach((el) => el.addEventListener("click", async (e) => {
      const restore = busy(e.currentTarget, "Grading…");
      try {
        const data = await api(`/api/shoots/${id}/review`, { method: "POST" });
        shoot = data.shoot;
        paintDevelop(shoot);
        timer = setTimeout(refresh, 2000);
      } catch (err) {
        restore();
        toast(err.message, "error");
      }
    }));
    $("#resume")?.addEventListener("click", async (e) => {
      const restore = busy(e.currentTarget, "Resuming…");
      try {
        const data = await api(`/api/shoots/${id}/resume`, { method: "POST" });
        shoot = data.shoot;
        paintDevelop(shoot);
        timer = setTimeout(refresh, 2000);
      } catch (err) {
        restore();
        toast(err.message, "error");
      }
    });
    wireDelete();
  }

  function wireDelete() {
    $("#delete")?.addEventListener("click", async (e) => {
      if (!confirm("Delete this shoot and all its photos? This can't be undone.")) return;
      const restore = busy(e.currentTarget, "Deleting…");
      try {
        await api(`/api/shoots/${id}`, { method: "DELETE" });
        toast("Shoot deleted.", "success");
        ctx.navigate("/app");
      } catch (err) {
        restore();
        toast(err.message, "error");
      }
    });
  }

  function autoCheck() {
    if (shoot?.status !== "draft" || shoot.check || sessionStorage.getItem("ahg-autocheck") !== id) return;
    sessionStorage.removeItem("ahg-autocheck");
    if (state.ai.vision) runCheck();
  }

  await refresh();
  return () => {
    disposed = true;
    stop();
    aborter.abort();
  };
}

/* ------------------------------- Upload -------------------------------- */

async function toJpegDataURL(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(/heic|heif/i.test(file.type + file.name) ? `${file.name}: HEIC photos aren't supported by this browser — export it as JPG first.` : `${file.name} couldn't be read as an image.`);
  }
  if (Math.min(bitmap.width, bitmap.height) < 256) throw new Error(`${file.name} is too small — use photos at least 256px on each side.`);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.9);
}

function renderUpload({ root, navigate }) {
  const photos = [];
  // Leaving mid-upload cancels the rest (and removes the half-made shoot).
  const aborter = new AbortController();
  const signal = aborter.signal;
  root.innerHTML = html`<main id="main" class="container app-main view-enter">
    ${stepper(0)}
    ${aiBanner()}
    ${planBanner()}
    <div class="studio-grid">
      <div>
        <p class="eyebrow">New shoot</p>
        <h1 class="display h-1" style="margin:8px 0 12px">Start with a few selfies.</h1>
        <p class="lede" style="margin-bottom:28px">Add 1–${MAX_SELFIES} recent photos of just you. More angles and expressions help the studio nail your likeness.</p>
        <label class="dropzone" id="dz">
          <input type="file" id="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple aria-describedby="dzHelp" />
          <div>
            <span class="dz-icon">${icon("image-plus")}</span>
            <p class="h-4" style="margin-top:16px">Drop photos here or <span style="text-decoration:underline;text-decoration-color:var(--flash-500);text-underline-offset:4px">browse</span></p>
            <p class="small muted" id="dzHelp" style="margin-top:4px">JPG, PNG or WebP · up to ${MAX_SELFIES} photos</p>
          </div>
        </label>
        <div class="thumbs" id="thumbs" aria-live="polite"></div>
        <div class="actions-bar">
          <span class="mono muted tabular" id="count">0 / ${MAX_SELFIES} PHOTOS</span>
          <button class="btn btn-flash btn-lg" id="go" disabled>${icon("scan-face")} Check my photos</button>
        </div>
      </div>
      <aside class="panel" aria-labelledby="guideTitle">
        <h2 class="h-4" id="guideTitle">What makes a great reference</h2>
        <ul class="guide" style="margin-top:16px">
          <li><span class="gi gi-yes">${icon("sun")}</span><div><b>Soft, even light</b><span>Face a window. Avoid harsh overhead light.</span></div></li>
          <li><span class="gi gi-yes">${icon("scan-face")}</span><div><b>Face clearly visible</b><span>Eyes open, face filling a good part of the frame.</span></div></li>
          <li><span class="gi gi-yes">${icon("smile")}</span><div><b>A few angles & expressions</b><span>Straight on, slight turn, smiling and neutral.</span></div></li>
          <li><span class="gi gi-no">${icon("x")}</span><div><b>No sunglasses or hats</b><span>Regular glasses are fine if you usually wear them.</span></div></li>
          <li><span class="gi gi-no">${icon("users")}</span><div><b>No group photos</b><span>Just you, so the studio knows who to shoot.</span></div></li>
          <li><span class="gi gi-no">${icon("wand-sparkles")}</span><div><b>No beauty filters</b><span>Filters distort features and hurt likeness.</span></div></li>
        </ul>
        <p class="field-hint" style="margin-top:20px;display:flex;gap:6px">${icon("lock")} Private to your account. Never used to train AI.</p>
      </aside>
    </div>
  </main>`.v;

  const dz = $("#dz");
  const input = $("#file");
  const thumbs = $("#thumbs");
  const go = $("#go");
  // Demo accounts and accounts without a shoot left can't start one.
  const canStart = state.user?.plan?.canDevelop !== false;

  const draw = () => {
    thumbs.innerHTML = html`${photos.map(
      (p, i) => html`<div class="thumb"><img src="${p.url}" alt="Photo ${i + 1}: ${p.name}" /><span class="idx">${String(i + 1).padStart(2, "0")}</span><button class="rm" data-rm="${i}" aria-label="Remove photo ${i + 1}">${icon("x")}</button></div>`,
    )}`.v;
    $("#count").textContent = `${photos.length} / ${MAX_SELFIES} PHOTOS`;
    go.disabled = !photos.length || !canStart;
    dz.classList.toggle("dz-compact", photos.length > 0);
  };

  async function add(files) {
    const list = [...files].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (files.length && !list.length) return toast("Those files aren't photos. Try JPG, PNG or WebP.", "error");
    const room = MAX_SELFIES - photos.length;
    if (list.length > room) toast(`Only ${MAX_SELFIES} photos per shoot — adding the first ${room}.`, "info");
    for (const f of list.slice(0, room)) {
      try {
        photos.push({ name: f.name, url: await toJpegDataURL(f) });
        draw();
      } catch (err) {
        toast(err.message, "error", 6000);
      }
    }
  }

  input.addEventListener("change", () => {
    add(input.files);
    input.value = "";
  });
  ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => (e.preventDefault(), dz.classList.add("drag"))));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => (e.preventDefault(), dz.classList.remove("drag"))));
  dz.addEventListener("drop", (e) => add(e.dataTransfer.files));
  thumbs.addEventListener("click", (e) => {
    const b = e.target.closest("[data-rm]");
    if (b) photos.splice(Number(b.dataset.rm), 1), draw();
  });
  go.addEventListener("click", async () => {
    const restore = busy(go, "Uploading…");
    const label = go.querySelector("span");
    let shootId = null;
    try {
      ({ shoot: { id: shootId } } = await api("/api/shoots", { method: "POST", body: {} }));
      // One photo per request keeps each upload small and reliable.
      for (let i = 0; i < photos.length; i++) {
        signal.throwIfAborted();
        if (label) label.textContent = `Uploading ${i + 1} of ${photos.length}…`;
        await api(`/api/shoots/${shootId}/selfies`, { method: "POST", body: { photo: photos[i].url }, signal });
      }
      signal.throwIfAborted();
      sessionStorage.setItem("ahg-autocheck", shootId);
      navigate(`/app/shoot/${shootId}`);
    } catch (err) {
      // Don't leave a half-uploaded shoot behind.
      if (shootId) api(`/api/shoots/${shootId}`, { method: "DELETE" }).catch(() => {});
      if (signal.aborted) return;
      restore();
      toast(err.message, "error", 6000);
    }
  });
  return () => aborter.abort();
}
