// Site search: the magnifier in the header (or "/" anywhere) opens a search
// box over the page. Results come from /api/search (pages, FAQ answers,
// prices and blog articles); choosing an FAQ answer opens it on its page.
import { $, html, icon, api } from "./core.js";

const FAQ_KEY = "kh:open-faq";
let dialog = null;

export function searchButton() {
  return html`<button class="btn btn-ghost btn-icon nav-search" type="button" data-search aria-label="Search the site" title="Search (/)">${icon("search")}</button>`;
}

const fold = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// The text with the query's words marked. Built from text nodes, never HTML.
function marked(text, terms) {
  const frag = document.createDocumentFragment();
  if (!terms.length) return frag.append(text), frag;
  const re = new RegExp(`\\b(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  // Matched on the accent-free text, whose positions line up with the
  // original as long as folding keeps each character's length.
  const plain = fold(text);
  const same = plain.length === text.length;
  let last = 0;
  for (const m of (same ? plain : text).matchAll(re)) {
    frag.append(text.slice(last, m.index));
    const mark = document.createElement("mark");
    mark.textContent = text.slice(m.index, m.index + m[0].length);
    frag.append(mark);
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

export function openSearch(initial = "") {
  if (dialog?.open) return dialog.querySelector("input").focus();
  dialog = document.createElement("dialog");
  dialog.className = "search-dialog";
  dialog.setAttribute("aria-label", "Search the site");
  dialog.innerHTML = html`<form class="search-box" role="search" method="dialog">
      <span class="search-icon" aria-hidden="true">${icon("search")}</span>
      <label class="sr-only" for="siteSearch">Search Keeper Headshots</label>
      <input id="siteSearch" type="search" name="q" autocomplete="off" spellcheck="false" enterkeyhint="search" maxlength="80"
        placeholder="Search pricing, LinkedIn, what to wear…" aria-controls="searchResults" aria-describedby="searchStatus" />
      <button class="btn btn-ghost btn-icon" type="button" data-close aria-label="Close search">${icon("x")}</button>
    </form>
    <p class="search-status small muted" id="searchStatus" role="status" aria-live="polite"></p>
    <ul class="search-results" id="searchResults"></ul>
    <div class="search-suggest">
      <p class="small muted">Popular</p>
      <div class="search-chips">${["Pricing", "Guarantee", "LinkedIn photo", "What to wear", "Refunds", "Team headshots"].map((q) => html`<button type="button" class="chip" data-q="${q}">${q}</button>`)}</div>
    </div>`.v;
  document.body.appendChild(dialog);
  const input = dialog.querySelector("input");
  const list = dialog.querySelector("#searchResults");
  const status = dialog.querySelector("#searchStatus");
  const suggest = dialog.querySelector(".search-suggest");
  let timer = null;
  let ctrl = null;
  let seq = 0;
  let shown = 0; // the request whose results are on screen

  const show = (q, results) => {
    const terms = [...new Set(fold(q).match(/[a-z0-9]+/g) || [])].filter((t) => t.length >= 2);
    list.replaceChildren(
      ...results.map((r) => {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = r.url;
        a.className = "search-hit";
        if (r.type === "FAQ") a.dataset.faq = r.title;
        const type = document.createElement("span");
        type.className = "search-type";
        type.textContent = r.type;
        const title = document.createElement("b");
        title.append(marked(r.title, terms));
        const text = document.createElement("span");
        text.className = "search-snippet";
        text.append(marked(r.snippet, terms));
        a.append(type, title, text);
        li.append(a);
        return li;
      }),
    );
    status.textContent = results.length ? `${results.length} result${results.length === 1 ? "" : "s"}` : `No results for “${q}”. Try another word, or contact us.`;
    if (!results.length) {
      const li = document.createElement("li");
      li.innerHTML = html`<a class="search-hit" href="/contact" data-link><span class="search-type">Contact</span><b>Ask us directly</b><span class="search-snippet">We reply within one business day.</span></a>`.v;
      list.append(li);
    }
  };

  const run = async () => {
    const q = input.value.trim();
    ctrl?.abort();
    suggest.hidden = q.length >= 2;
    if (q.length < 2) {
      list.replaceChildren();
      status.textContent = "";
      return;
    }
    ctrl = new AbortController();
    const mine = ++seq;
    try {
      const { results } = await api(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
      if (mine === seq) show(q, results || []), (shown = mine);
    } catch (err) {
      if (err.name !== "AbortError" && mine === seq) status.textContent = err.message;
    }
  };

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => ((timer = null), run()), 140);
  });
  // Enter goes to the first result; arrows move between results.
  // Enter: the first result for what's typed now (not a previous query's).
  dialog.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    // Results still on their way (or not yet asked for): fetch them first.
    if (timer || seq !== shown) {
      clearTimeout(timer);
      timer = null;
      await run();
    }
    list.querySelector("a")?.click();
  });
  dialog.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const links = [...list.querySelectorAll("a")];
    if (!links.length) return;
    e.preventDefault();
    const i = links.indexOf(document.activeElement);
    const next = e.key === "ArrowDown" ? (i < 0 ? 0 : Math.min(links.length - 1, i + 1)) : i <= 0 ? -1 : i - 1;
    (next < 0 ? input : links[next]).focus();
  });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) return dialog.close(); // the backdrop
    if (e.target.closest("[data-close]")) return dialog.close();
    const chip = e.target.closest("[data-q]");
    if (chip) {
      input.value = chip.dataset.q;
      input.focus();
      return run();
    }
    const hit = e.target.closest("a");
    if (!hit) return;
    if (hit.dataset.faq) {
      try { sessionStorage.setItem(FAQ_KEY, hit.dataset.faq); } catch {}
      openPendingFaq();
    }
    dialog.close();
  });
  dialog.addEventListener("close", () => {
    clearTimeout(timer);
    ctrl?.abort();
    dialog.remove();
    dialog = null;
  });
  dialog.showModal();
  input.value = initial;
  input.focus();
  if (initial) run();
}

// Opens the FAQ answer chosen in search once its page has rendered (or the
// page has loaded fresh, coming from the blog), and scrolls it into view.
export function openPendingFaq() {
  let q = null;
  try { q = sessionStorage.getItem(FAQ_KEY); } catch {}
  if (!q) return;
  const until = Date.now() + 4000;
  const tick = () => {
    const summary = [...document.querySelectorAll("details > summary")].find((s) => s.textContent.trim().startsWith(q));
    if (!summary) return Date.now() < until ? setTimeout(tick, 100) : clear();
    clear();
    const d = summary.parentElement;
    d.open = true;
    d.closest("[data-reveal]")?.classList.add("in");
    d.classList.add("in");
    requestAnimationFrame(() => {
      d.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      summary.focus({ preventScroll: true });
    });
  };
  const clear = () => { try { sessionStorage.removeItem(FAQ_KEY); } catch {} };
  setTimeout(tick, 60);
}

// The header button (re-rendered with each page) and the "/" shortcut.
export function initSearch() {
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-search]")) openSearch();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || dialog) return;
    const el = document.activeElement;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    if (!$("[data-search]")) return;
    e.preventDefault();
    openSearch();
  });
  openPendingFaq();
}
