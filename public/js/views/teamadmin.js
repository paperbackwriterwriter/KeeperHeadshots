import { $, $$, html, raw, icon, api, state, toast, busy, media, squareMedia, sizeMedia } from "../core.js";
import { BACKDROPS, OUTFITS, MAX_LOOKS, PACKAGES } from "../shared/catalog.js";
import { downloadAll } from "./format.js";
import { planBanner } from "./dashboard.js";

// /app/team: a team admin sets the team's look, invites colleagues by email
// (each invite uses one of their shoots) and collects everyone's headshots.
// Server side: lib/teams.js and the /api/team routes.

const STATUS = {
  invited: ["Invited", "badge badge-muted"],
  joined: ["Joined", "badge badge-info"],
  returned: ["Shoot returned", "badge badge-muted"],
  deleted: ["Shoot deleted", "badge badge-muted"],
  account_deleted: ["Account deleted", "badge badge-muted"],
  expired: ["Expired · shoot returned", "badge badge-muted"],
};
const shootLabel = (m) => {
  if (m.status !== "joined") return STATUS[m.status] || [m.status, "badge"];
  if (m.shootStatus === "done") return ["Headshots ready", "badge badge-success"];
  if (["generating", "reviewing"].includes(m.shootStatus)) return ["Developing", "badge badge-warn"];
  if (m.shootStatus === "checked" || m.shootStatus === "checking") return ["Photos checked", "badge badge-info"];
  return [m.selfies ? `Uploading (${m.selfies} photo${m.selfies === 1 ? "" : "s"})` : "Joined, no photos yet", "badge badge-info"];
};
const lookLabel = (l) => `${BACKDROPS.find((b) => b.id === l.backdrop)?.name || l.backdrop} · ${OUTFITS.find((o) => o.id === l.outfit)?.name || l.outfit}`;

export async function renderTeamAdmin({ root, navigate }) {
  let data;
  let disposed = false;
  const load = async () => {
    data = await api("/api/team");
    if (data.user) state.user = data.user; // a lapsed invitation may just have handed a shoot back
    return data;
  };
  try {
    await load();
  } catch (err) {
    root.innerHTML = html`<main id="main" class="container app-main"><div class="banner banner-danger">${icon("circle-alert")}<div><b>Couldn't load your team.</b> ${err.message}</div></div></main>`.v;
    return;
  }
  if (disposed) return;

  const u = state.user;
  // Read fresh: confirming the email on this page (the code box) or in another
  // tab unlocks it without a reload (app.js "ahg:user-changed").
  const lockedNow = () => (state.user?.demo ? "The demo account can't order for a team. Create a free account to try it." : state.user?.plan?.needsEmail ? "email" : "");
  // An unconfirmed email gets the banner with the 6-digit code box.
  const lockBanner = () => {
    const locked = lockedNow();
    return locked === "email" ? planBanner("blocked") : locked ? html`<div class="banner banner-warn">${icon("info")}<div>${locked}</div></div>` : "";
  };

  function paintSetup(team) {
    let looks = team?.looks?.length ? team.looks.map((l) => ({ ...l })) : [{ backdrop: "glass-office", outfit: "navy-suit" }];
    root.innerHTML = html`<main id="main" class="container app-main view-enter team-admin">
      <div class="page-head"><div><p class="eyebrow">Team headshots</p><h1 class="display h-1" style="margin-top:8px">${team ? "Team settings" : "Set up your team"}</h1>
      <p class="lede" style="margin-top:12px">Choose the looks everyone gets, so your team page matches. Then invite people by email: each invite uses one of your shoots, and each person uploads their own selfies.</p></div></div>
      ${lockBanner()}
      <form class="panel team-form" id="teamForm" novalidate>
        <div class="field"><label for="teamName">Team name</label><input class="input" id="teamName" name="name" maxlength="60" required value="${team?.name || ""}" placeholder="Acme Inc." /><span class="field-hint">Shown in the invitation email.</span></div>
        <fieldset class="field"><legend>Team look${MAX_LOOKS > 1 ? html` <span class="muted">(up to ${MAX_LOOKS}; each person gets 2 headshots per look)</span>` : ""}</legend>
          <ol class="team-looks" id="looks"></ol>
          <button type="button" class="btn btn-ghost btn-sm" id="addLook">${icon("plus")} Add a look</button>
        </fieldset>
        <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn-flash" id="saveTeam" ${lockedNow() ? raw("disabled") : ""}>${team ? "Save" : "Create team"} ${icon("arrow-right")}</button>${team ? html`<button type="button" class="btn btn-ghost" id="cancelSetup">Cancel</button>` : ""}</div>
      </form>
    </main>`.v;
    const drawLooks = () => {
      $("#looks").innerHTML = html`${looks.map(
        (l, i) => html`<li class="team-look">
          <label class="sr-only" for="bd-${i}">Backdrop for look ${i + 1}</label>
          <select class="input" id="bd-${i}" data-i="${i}" data-k="backdrop">${BACKDROPS.map((b) => html`<option value="${b.id}" ${b.id === l.backdrop ? raw("selected") : ""}>${b.name}</option>`)}</select>
          <label class="sr-only" for="of-${i}">Outfit for look ${i + 1}</label>
          <select class="input" id="of-${i}" data-i="${i}" data-k="outfit">${OUTFITS.map((o) => html`<option value="${o.id}" ${o.id === l.outfit ? raw("selected") : ""}>${o.name}</option>`)}</select>
          ${looks.length > 1 ? html`<button type="button" class="btn btn-ghost btn-icon btn-sm" data-remove="${i}" aria-label="Remove look ${i + 1}">${icon("x")}</button>` : ""}
        </li>`,
      )}`.v;
      $("#addLook").hidden = looks.length >= MAX_LOOKS;
    };
    drawLooks();
    $("#looks").addEventListener("change", (e) => {
      const el = e.target.closest("[data-k]");
      if (el) looks[Number(el.dataset.i)][el.dataset.k] = el.value;
    });
    $("#looks").addEventListener("click", (e) => {
      const b = e.target.closest("[data-remove]");
      if (b) looks.splice(Number(b.dataset.remove), 1), drawLooks();
    });
    $("#addLook").addEventListener("click", () => {
      const used = new Set(looks.map((l) => l.backdrop));
      looks.push({ backdrop: (BACKDROPS.find((b) => !used.has(b.id)) || BACKDROPS[0]).id, outfit: looks[0].outfit });
      drawLooks();
    });
    $("#cancelSetup")?.addEventListener("click", () => paintTeam());
    $("#teamForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const restore = busy($("#saveTeam"), "Saving…");
      try {
        const r = await api("/api/team", { method: "POST", body: { name: $("#teamName").value, looks } });
        state.user = r.user;
        data.team = r.team;
        toast(team ? "Team saved." : "Team created. Now invite your colleagues.", "success");
        paintTeam();
      } catch (err) {
        restore();
        toast(err.message, "error", 7000);
      }
    });
  }

  function paintTeam() {
    const t = data.team;
    if (!t) return paintSetup(null);
    const credits = state.user.plan?.tier === "owner" ? "unlimited" : String(state.user.plan?.credits || 0);
    const ready = t.members.filter((m) => m.pick);
    root.innerHTML = html`<main id="main" class="container app-main view-enter team-admin">
      <div class="page-head">
        <div><p class="eyebrow">Team headshots</p><h1 class="display h-1" style="margin-top:8px">${t.name}</h1>
        <p class="lede" style="margin-top:12px">Everyone gets ${t.looks.map(lookLabel).join("; ")}. <button type="button" class="link" id="editTeam" style="background:none;border:0;padding:0;font:inherit;cursor:pointer">Change</button></p></div>
        ${ready.length ? html`<button class="btn btn-flash btn-lg" id="dlTeam">${icon("download")} Download ${ready.length} headshot${ready.length === 1 ? "" : "s"}</button>` : ""}
      </div>
      ${lockBanner()}

      <section class="panel team-invite" aria-labelledby="inviteTitle">
        <div class="team-invite-head"><h2 class="h-4" id="inviteTitle">Invite people</h2><span class="chip">${icon("ticket")} ${credits} shoot${credits === "1" ? "" : "s"} to give</span></div>
        <p class="small muted">One shoot per person. They'll get an email with a link; their photos stay private, and you'll see their finished headshots here. An invitation not accepted within 90 days lapses and the shoot comes back to you.${data.email ? "" : " Email isn't set up here, so copy each person's link and send it yourself."}</p>
        <form id="inviteForm" class="team-invite-form" novalidate>
          <label class="sr-only" for="emails">Email addresses</label>
          <textarea class="input" id="emails" rows="2" placeholder="alex@company.com, sam@company.com"></textarea>
          <button class="btn btn-ink" id="sendInvites" ${lockedNow() ? raw("disabled") : ""}>${icon("send")} Send invites</button>
        </form>
        ${credits === "0" ? html`<p class="small">No shoots left to give. <a class="link" href="/app/buy/${PACKAGES[PACKAGES.length - 1].id}" data-link>Buy ${PACKAGES[PACKAGES.length - 1].name} (${PACKAGES[PACKAGES.length - 1].shoots} shoots)</a> or <a class="link" href="/#pricing">see all packages</a>.</p>` : ""}
      </section>

      <section aria-labelledby="membersTitle" style="margin-top:32px">
        <h2 class="h-3" id="membersTitle">People <span class="mono muted">${t.members.length}</span></h2>
        ${t.members.length
          ? html`<ul class="team-members">${t.members.map((m) => {
              const [label, cls] = shootLabel(m);
              return html`<li class="team-member">
                <div class="tm-who">${m.pick ? html`<img src="${media(m.pick)}" alt="" loading="lazy" />` : html`<span class="avatar" aria-hidden="true">${(m.name || m.email)[0].toUpperCase()}</span>`}
                  <div><b title="${m.name || m.email}">${m.name || m.email}</b>${m.name ? html`<span class="muted small">${m.email}</span>` : ""}</div></div>
                <span class="${cls}">${label}</span>
                <div class="tm-actions">
                  ${m.pick ? html`<a class="btn btn-ghost btn-sm" href="${media(m.pick, true)}" download>Portrait</a><a class="btn btn-ghost btn-sm" href="${squareMedia(m.pick)}" download>Square</a><a class="btn btn-ghost btn-sm" href="${sizeMedia(m.pick, "linkedin")}" download>LinkedIn</a>` : ""}
                  ${m.status === "invited"
                    ? html`<button class="btn btn-ghost btn-sm" data-copy="${m.id}">Copy link</button>${data.email ? html`<button class="btn btn-ghost btn-sm" data-resend="${m.id}">Resend</button>` : ""}<button class="btn btn-ghost btn-sm" data-cancel="${m.id}">Cancel</button>`
                    : ""}
                </div>
              </li>`;
            })}</ul>`
          : html`<p class="muted">No one yet. Invite your first colleague above.</p>`}
      </section>
    </main>`.v;

    $("#editTeam").addEventListener("click", () => paintSetup(t));
    $("#dlTeam")?.addEventListener("click", async (e) => {
      const restore = busy(e.currentTarget, "Downloading…");
      await downloadAll(ready.flatMap((m) => [media(m.pick, true), squareMedia(m.pick)]));
      restore();
    });
    $("#inviteForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const restore = busy($("#sendInvites"), "Sending…");
      try {
        const r = await api("/api/team/invites", { method: "POST", body: { emails: $("#emails").value } });
        state.user = r.user;
        data.team = r.team;
        const ok = r.results.filter((x) => x.ok);
        const bad = r.results.filter((x) => !x.ok);
        paintTeam();
        if (ok.length) toast(`${ok.length} invite${ok.length === 1 ? "" : "s"} ${ok.every((x) => x.sent) ? "sent" : "created; copy the links to send them"}.`, "success", 6000);
        for (const x of ok.filter((x) => x.capped)) toast(`We've already emailed ${x.email} 3 times today, so this one wasn't emailed. Copy their link and send it yourself.`, "info", 9000);
        for (const x of bad) toast(x.error, "error", 9000);
        if (bad.length) $("#emails").value = bad.map((x) => x.email).join(", ");
      } catch (err) {
        restore();
        toast(err.message, "error", 7000);
      }
    });
    $$("[data-copy]").forEach((b) =>
      b.addEventListener("click", async () => {
        try {
          const { link } = await api(`/api/team/invites/${b.dataset.copy}/link`);
          await navigator.clipboard.writeText(link);
          toast("Invite link copied.", "success", 2500);
        } catch (err) {
          toast(err.message || "Couldn't copy the link.", "error");
        }
      }),
    );
    $$("[data-resend]").forEach((b) =>
      b.addEventListener("click", async () => {
        const restore = busy(b, "Sending…");
        try {
          await api(`/api/team/invites/${b.dataset.resend}/resend`, { method: "POST" });
          restore();
          toast("Invite sent again.", "success");
        } catch (err) {
          restore();
          toast(err.message, "error", 7000);
        }
      }),
    );
    $$("[data-cancel]").forEach((b) =>
      b.addEventListener("click", async () => {
        const restore = busy(b, "Cancelling…");
        const before = state.user?.plan?.credits || 0;
        try {
          const r = await api(`/api/team/invites/${b.dataset.cancel}`, { method: "DELETE" });
          state.user = r.user;
          data.team = r.team;
          paintTeam();
          // A seat a refund already took back doesn't come back as a shoot.
          // (The owner's shoots aren't counted, so there's nothing to give back.)
          toast(r.user?.plan?.tier === "owner" ? "Invite cancelled." : (r.user?.plan?.credits || 0) > before ? "Invite cancelled. The shoot is back in your balance." : "Invite cancelled. That shoot went toward your refund.", "success");
        } catch (err) {
          restore();
          toast(err.message, "error", 7000);
        }
      }),
    );
  }

  paintTeam();
  // Progress changes while people upload and develop; refresh now and then.
  const timer = setInterval(async () => {
    if (document.hidden || document.activeElement?.id === "emails") return;
    try {
      await load();
      if (!disposed && data.team && !$("#teamForm")) paintTeam();
    } catch {}
  }, 30_000);
  const onUser = () => {
    if (lockedNow()) return;
    for (const id of ["#saveTeam", "#sendInvites"]) $(id)?.removeAttribute("disabled");
  };
  document.addEventListener("ahg:user-changed", onUser);
  return () => {
    document.removeEventListener("ahg:user-changed", onUser);
    disposed = true;
    clearInterval(timer);
  };
}
