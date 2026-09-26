// The shoot flow. One page, driven by the shoot's server-side status:
//   (new) upload -> draft/checking -> checked (photo check + looks) -> generating/reviewing -> done (proofs)

import { $, $$, html, raw, icon, api, state, toast, media, busy, spinner, greaseCircle, silhouette, esc, reduceMotion } from "../core.js";
import { BACKDROPS, OUTFITS, MAX_LOOKS, TAKES_PER_LOOK, MAX_SELFIES, lookFor } from "../shared/catalog.js";
import { portraitDataURL } from "../shared/portrait.js";
import { aiBanner } from "./dashboard.js";

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

const scoreColor = (n) => (n >= 80 ? "#5fd3c7" : n >= 60 ? "#f5b94a" : "#ff8a73");
const meterColor = (v) => (v >= 8 ? "var(--success)" : v >= 6 ? "var(--warning)" : "var(--danger)");

export async function renderStudio(ctx, id) {
  const { root } = ctx;
  let timer = null;
  let disposed = false;
  let view = null; // local sub-view for "checked" shoots: "check" | "looks"
  let shoot = null;

  const stop = () => {
    clearTimeout(timer);
    timer = null;
  };

  if (!id) {
    renderUpload(ctx);
    return () => (disposed = true);
  }

  root.innerHTML = html`<main id="main" class="container app-main"><div class="loading-page" aria-busy="true">
    <div class="skel" style="height:14px;width:120px"></div><div class="skel" style="height:56px;width:min(520px,90%)"></div>
    <div class="skel" style="height:320px;border-radius:18px"></div></div></main>`.v;

  async function refresh() {
    try {
      const data = await api(`/api/shoots/${id}`);
      if (disposed) return;
      const prev = shoot;
      shoot = data.shoot;
      ctx.setTitle(shoot.name);
      paint(prev);
    } catch (err) {
      if (disposed) return;
      if (err.status === 404) {
        root.innerHTML = html`<main id="main" class="container app-main"><div class="empty"><p class="eyebrow">Not found</p><h1 class="display h-2">We couldn't find that shoot.</h1><p class="lede">It may have been deleted.</p><a class="btn btn-ink" href="/app" data-link>Back to your shoots</a></div></main>`.v;
        return;
      }
      toast(err.message, "error");
    }
    if (!disposed && shoot && LIVE.includes(shoot.status)) timer = setTimeout(refresh, 2000);
  }

  function paint(prev) {
    const s = shoot;
    // Incremental update while developing keeps finished frames from re-animating.
    if (prev && ["generating", "reviewing"].includes(s.status) && ["generating", "reviewing"].includes(prev.status) && $("#contact")) {
      patchDevelop(s);
      return;
    }
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
    } catch (err) {
      restore();
      if (disposed) return;
      await refresh();
      if (err.data?.code !== "ai_not_configured") toast(err.message, "error");
      else toast(err.message, "error", 7000);
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
        : html`<p class="lede" style="margin-bottom:24px">Our AI photo specialist scores every photo for lighting, sharpness, visibility and expression, then tells you what to fix — before any rendering time is spent.</p>`}
      <div class="scan-grid">
        ${s.selfies.map((p, i) => html`<div class="scan ${checking ? "" : "idle"}" style="--i:${i}"><img src="${media(p.file)}" alt="Your photo ${i + 1}" /><span class="corners"></span></div>`)}
      </div>
      ${checking
        ? html`<div class="panel" style="margin-top:24px"><div class="skel skel-line" style="width:40%"></div><div class="skel skel-line" style="width:85%"></div><div class="skel skel-line" style="width:70%"></div></div>`
        : html`<div class="actions-bar"><button class="btn btn-ghost btn-sm" id="delete">${icon("trash-2")} Delete shoot</button><a class="btn btn-ghost btn-sm" href="/app/new" data-link>${icon("upload")} Use different photos</a></div>`}`;
  }

  function checkResult(s) {
    const c = s.check;
    const verdict = { ready: ["Ready to shoot", "badge-success"], usable: ["Usable", "badge-warn"], retake: ["Retake needed", "badge-danger"] }[c.verdict];
    const kept = c.photos.filter((p) => p.keep).length;
    return html`<section class="verdict" style="--verdict-glow:${scoreColor(c.overall_score)}44">
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
              <div class="pcheck-top"><span class="pcheck-score tabular">${p.score}</span>${p.keep ? html`<span class="badge badge-success">${icon("check")} Using</span>` : html`<span class="badge badge-danger">${icon("x")} Skipped</span>`}</div>
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

      ${c.tips?.length
        ? html`<div class="panel" style="margin-top:24px"><h3 class="h-4">${icon("sparkles")} To get even better results</h3><ul class="tips" style="margin-top:12px">${c.tips.map((t) => html`<li>${icon("arrow-right")}<span>${t}</span></li>`)}</ul></div>`
        : ""}

      <div class="actions-bar">
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" id="delete">${icon("trash-2")} Delete</button><a class="btn btn-ghost btn-sm" href="/app/new" data-link>${icon("upload")} New photos</a></div>
        ${c.verdict === "retake"
          ? html`<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost" id="override">Continue anyway</button><a class="btn btn-flash" href="/app/new" data-link>${icon("camera")} Upload better photos</a></div>`
          : html`<button class="btn btn-flash btn-lg" id="toLooks">Choose your looks ${icon("arrow-right")}</button>`}
      </div>
      <p class="disclaimer" style="margin-top:16px">${icon("info")} Scores are AI estimates of how well each photo will work as a reference — not a judgment of how you look.</p>`;
  }

  /* ------------------------------- Looks ------------------------------- */

  function paintLooks(s) {
    let looks = s.looks?.length ? s.looks.map((l) => ({ ...l })) : [{ backdrop: "studio-gray", outfit: "navy-suit" }, { backdrop: "glass-office", outfit: "charcoal-blazer" }];
    let backdrop = "city-terrace";
    let outfit = "camel-knit";

    root.innerHTML = html`<main id="main" class="container app-main view-enter">
      ${stepper(2)}
      <div class="page-head"><div><p class="eyebrow">${s.name}</p><h1 class="display h-1" style="margin-top:8px">Dress the set.</h1><p class="lede" style="margin-top:12px">Pair a backdrop with an outfit to make a look. Pick up to ${MAX_LOOKS}; we'll shoot ${TAKES_PER_LOOK} takes of each with different poses.</p></div></div>
      <div class="look-builder">
        <div>
          <div class="opt-group">
            <h3 class="h-4">Backdrop <span class="mono muted">01</span></h3>
            <div class="backdrops" id="backdrops" role="group" aria-label="Backdrop">
              ${BACKDROPS.map((b) => html`<button type="button" class="opt" data-backdrop="${b.id}" aria-pressed="false">
                <span class="sw" style="background:radial-gradient(circle at 42% 34%, ${b.tones[0]}, ${b.tones[1]})"></span>
                <span><span class="opt-name">${b.name}</span><br /><span class="opt-sub">${b.blurb}</span></span>
                <span class="tick">${icon("check")}</span>
              </button>`)}
            </div>
          </div>
          <div class="opt-group">
            <h3 class="h-4">Outfit <span class="mono muted">02</span></h3>
            <div class="outfits" id="outfits" role="group" aria-label="Outfit">
              ${OUTFITS.map((o) => html`<button type="button" class="pill-opt" data-outfit="${o.id}" aria-pressed="false"><span class="swatch" style="background:linear-gradient(135deg, ${o.colors[0]} 55%, ${o.colors[1]} 55%)"></span>${o.name}</button>`)}
            </div>
          </div>
          <div style="margin-top:24px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
            <button class="btn btn-ink" id="addLook">${icon("plus")} Add look</button>
            <span class="small muted" id="addHint" aria-live="polite"></span>
          </div>
        </div>
        <aside class="look-summary panel panel-ink" aria-label="Your looks">
          <p class="eyebrow">Shot list</p>
          <ul class="look-slots" id="slots"></ul>
          <div class="tally"><span class="muted">Headshots to develop</span><strong class="tabular" id="tally">0</strong></div>
          <button class="btn btn-flash btn-lg btn-block" id="develop">${icon("aperture")} Develop headshots</button>
          <p class="small" style="color:#a9b1bd;margin-top:12px;text-align:center">Usually ready in a few minutes.</p>
        </aside>
      </div>
      <div class="actions-bar"><button class="btn btn-ghost btn-sm" id="backCheck">${icon("arrow-left")} Back to photo check</button></div>
    </main>`.v;

    const sync = () => {
      $$("#backdrops .opt").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.backdrop === backdrop)));
      $$("#outfits .pill-opt").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.outfit === outfit)));
      const exists = looks.some((l) => l.backdrop === backdrop && l.outfit === outfit);
      const full = looks.length >= MAX_LOOKS;
      const add = $("#addLook");
      add.disabled = exists || full;
      $("#addHint").textContent = full ? `That's the maximum of ${MAX_LOOKS} looks for one shoot.` : exists ? "That look is already on your shot list." : `Add “${lookName(backdrop, outfit)}”`;
      $("#slots").innerHTML = html`${looks.map(
        (l, i) => html`<li class="look-slot"><img src="${portraitDataURL("look-" + l.backdrop + l.outfit, { backdrop: l.backdrop, outfit: l.outfit, skin: 2, hair: "short", hairTone: 1 })}" alt="" />
          <div><b>${lookFor(l.backdrop, l.outfit).backdrop.name}</b><span>${lookFor(l.backdrop, l.outfit).outfit.name} · ${TAKES_PER_LOOK} takes</span></div>
          <button type="button" data-remove="${i}" aria-label="Remove ${lookName(l.backdrop, l.outfit)}">${icon("x")}</button></li>`,
      )}${Array.from({ length: Math.max(0, MAX_LOOKS - looks.length) }, () => html`<li class="look-slot empty-slot">Empty slot</li>`)}`.v;
      $("#tally").textContent = looks.length * TAKES_PER_LOOK;
      $("#develop").disabled = !looks.length;
    };

    $("#backdrops").addEventListener("click", (e) => {
      const b = e.target.closest("[data-backdrop]");
      if (b) (backdrop = b.dataset.backdrop), sync();
    });
    $("#outfits").addEventListener("click", (e) => {
      const b = e.target.closest("[data-outfit]");
      if (b) (outfit = b.dataset.outfit), sync();
    });
    $("#addLook").addEventListener("click", () => {
      looks.push({ backdrop, outfit });
      sync();
    });
    $("#slots").addEventListener("click", (e) => {
      const b = e.target.closest("[data-remove]");
      if (b) looks.splice(Number(b.dataset.remove), 1), sync();
    });
    $("#backCheck").addEventListener("click", () => {
      view = "check";
      paintCheck(shoot);
    });
    $("#develop").addEventListener("click", async (e) => {
      const restore = busy(e.currentTarget, "Setting up the studio…");
      try {
        const data = await api(`/api/shoots/${id}/generate`, { method: "POST", body: { looks, override: !!shoot._override } });
        shoot = data.shoot;
        paintDevelop(shoot);
        window.scrollTo({ top: 0, behavior: "instant" });
        timer = setTimeout(refresh, 1500);
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
    if (t.status === "done") return html`<div class="frame done" data-id="${t.id}" data-status="done"><img src="${media(t.file)}" alt="Headshot ${i + 1}: ${lookName(t.backdrop, t.outfit)}" /><div class="fcap">${label}</div></div>`;
    if (t.status === "error") return html`<div class="frame error" data-id="${t.id}" data-status="error" title="${t.error}"><div>${icon("circle-alert")}<b>Frame ${i + 1} failed</b><div style="opacity:.8;margin-top:4px">${String(t.error || "").slice(0, 90)}</div></div></div>`;
    return html`<div class="frame ${t.status}" data-id="${t.id}" data-status="${t.status}" aria-label="Frame ${i + 1} ${t.status === "rendering" ? "developing" : "queued"}">${silhouette()}
      <span class="frame-state">${t.status === "rendering" ? html`<span class="badge badge-live">Developing</span>` : html`<span class="badge" style="background:rgba(245,241,234,.1);color:#a9b1bd">Queued</span>`}</span><div class="fcap">${label}</div></div>`;
  }

  function developCopy(s) {
    const done = s.shots.filter((x) => x.status === "done").length;
    const failed = s.shots.filter((x) => x.status === "error").length;
    const total = s.shots.length;
    if (s.status === "reviewing") return { title: "Your retoucher is grading the set", sub: `All ${done} headshots developed. Now scoring likeness, polish and lighting, and picking your best shot…`, pct: 96, done, total, failed };
    if (s.status === "error") return { title: "The shoot hit a snag", sub: s.error || "Some frames couldn't be developed.", pct: (done / total) * 100, done, total, failed };
    return { title: done ? `${done} of ${total} developed` : "Developing your headshots", sub: "Each frame is rendered from your reference photos. Stay on this page to watch them come in — or come back later, we'll keep working.", pct: Math.max(4, ((done + failed) / total) * 92), done, total, failed };
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
      if (el && el.dataset.status !== t.status) el.outerHTML = frameHTML(t, i).v;
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
          <h1 class="display h-1">${r?.headline || `${done.length} headshots, developed.`}</h1>
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
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            ${best ? html`<a class="btn btn-flash btn-lg" href="${media(best.file, true)}" download>${icon("download")} Download ${isMine ? "your pick" : "best"}</a>` : ""}
            <button class="btn btn-ghost btn-lg" id="dlAll">${icon("download")} All ${done.length}</button>
          </div>
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

      <section class="panel" style="margin-top:48px;display:flex;gap:24px;align-items:center;justify-content:space-between;flex-wrap:wrap">
        <div>
          <p class="eyebrow">References used</p>
          <div class="refs" style="margin-top:10px">${s.selfies.map((p, i) => html`<img src="${media(p.file)}" alt="Reference photo ${i + 1}" loading="lazy" />`)}</div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          ${s.check ? html`<span class="score-pill g-${s.check.overall_score >= 80 ? "keeper" : s.check.overall_score >= 60 ? "solid" : "retake"}"><i></i>Photo check ${s.check.overall_score}</span>` : ""}
          ${s.sample ? "" : html`<button class="btn btn-ghost btn-sm" id="delete">${icon("trash-2")} Delete shoot</button>`}
          <a class="btn btn-ink btn-sm" href="/app/new" data-link>${icon("plus")} New shoot</a>
        </div>
      </section>
      <p class="disclaimer" style="margin-top:16px">${icon("info")} Grades are AI assessments to help you choose; always pick the photo you feel represents you best.</p>
      <dialog class="lightbox" id="lb" aria-label="Headshot viewer"></dialog>
    </main>`.v;

    const grid = $("#proofs");
    const drawGrid = () => {
      const list = ordered.filter((t) => filter === "all" || grade(t)?.grade === filter);
      grid.innerHTML = list.length
        ? html`${list.map((t, i) => {
            const g = grade(t);
            return html`<article class="proof ${t.id === best?.id ? "is-best" : ""}" style="--i:${i}">
              <div class="print">
                <button class="open" data-open="${t.id}" aria-label="Open frame ${t.n} full size"><img src="${media(t.file)}" alt="Headshot ${t.n}: ${lookName(t.backdrop, t.outfit)}" loading="lazy" /></button>
                ${g ? html`<span class="score-pill g-${g.grade} score-badge" title="${g.grade}"><i></i>${g.overall}</span>` : ""}
                <div class="print-cap"><b>${String(t.n).padStart(2, "0")} · ${lookFor(t.backdrop, t.outfit).backdrop.name}</b><span>${g ? g.best_for : lookFor(t.backdrop, t.outfit).outfit.name}</span></div>
                ${g ? html`<p class="proof-note">${g.note}</p>` : ""}
                <div class="proof-actions">${t.id === best?.id
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
            ? html`<div style="display:flex;gap:12px;align-items:center"><span class="score-pill g-${g.grade}" style="height:34px;font-size:14px"><i></i>${g.overall} / 100</span><span class="badge ${g.grade === "keeper" ? "badge-success" : g.grade === "solid" ? "badge-warn" : "badge-danger"}">${g.grade}</span></div>
              <div class="bars">${[["Likeness", g.likeness], ["Polish", g.polish], ["Lighting", g.lighting]].map(([k, v]) => html`<div class="bar-row"><span>${k}</span><div class="meter-track"><div class="meter-fill" style="--v:${v};--mcol:${meterColor(v)}"></div></div><b>${v}</b></div>`)}</div>
              <p style="color:#a9b1bd">${g.note}</p><p class="small"><b>Best for:</b> ${g.best_for}</p>`
            : html`<p style="color:#a9b1bd">Not graded yet.</p>`}
          <a class="btn btn-flash" href="${media(t.file, true)}" download>${icon("download")} Download full resolution</a>
          ${t.id === best?.id
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
      drawLb();
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
    lb.addEventListener("click", (e) => {
      const b = e.target.closest("[data-pick]");
      if (b) setPick(b.dataset.pick, b);
    });
    $("#resetPick")?.addEventListener("click", (e) => setPick(null, e.currentTarget));

    $("#dlAll")?.addEventListener("click", async (e) => {
      const restore = busy(e.currentTarget, "Downloading…");
      for (const t of ordered) {
        const a = document.createElement("a");
        a.href = media(t.file, true);
        a.download = "";
        document.body.appendChild(a);
        a.click();
        a.remove();
        await new Promise((r) => setTimeout(r, 350));
      }
      restore();
      toast(`${ordered.length} headshots downloaded.`, "success");
    });
    $("#regrade")?.addEventListener("click", async (e) => {
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
    });
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

  // After uploading, the new shoot's check starts automatically.
  await refresh();
  if (shoot?.status === "draft" && !shoot.check && sessionStorage.getItem("ahg-autocheck") === id) {
    sessionStorage.removeItem("ahg-autocheck");
    if (state.ai.vision) runCheck();
  }
  return () => {
    disposed = true;
    stop();
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
  root.innerHTML = html`<main id="main" class="container app-main view-enter">
    ${stepper(0)}
    ${aiBanner()}
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

  const draw = () => {
    thumbs.innerHTML = html`${photos.map(
      (p, i) => html`<div class="thumb"><img src="${p.url}" alt="Photo ${i + 1}: ${p.name}" /><span class="idx">${String(i + 1).padStart(2, "0")}</span><button class="rm" data-rm="${i}" aria-label="Remove photo ${i + 1}">${icon("x")}</button></div>`,
    )}`.v;
    $("#count").textContent = `${photos.length} / ${MAX_SELFIES} PHOTOS`;
    go.disabled = !photos.length;
    dz.classList.toggle("dz-compact", photos.length > 0);
  };

  async function add(files) {
    const list = [...files].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (files.length && !list.length) return toast("Those files aren't photos. Try JPG, PNG or WebP.", "error");
    const room = MAX_SELFIES - photos.length;
    if (list.length > room) toast(`Only ${MAX_SELFIES} photos per shoot — added the first ${room}.`, "info");
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
        if (label) label.textContent = `Uploading ${i + 1} of ${photos.length}…`;
        await api(`/api/shoots/${shootId}/selfies`, { method: "POST", body: { photo: photos[i].url } });
      }
      sessionStorage.setItem("ahg-autocheck", shootId);
      navigate(`/app/shoot/${shootId}`);
    } catch (err) {
      restore();
      // Don't leave a half-uploaded shoot behind.
      if (shootId) api(`/api/shoots/${shootId}`, { method: "DELETE" }).catch(() => {});
      toast(err.message, "error", 6000);
    }
  });
}
