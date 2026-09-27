// Cloudflare Turnstile bot check. Loads only when the server reports a site
// key (TURNSTILE_SITE_KEY + TURNSTILE_SECRET_KEY). Most people never see it;
// it asks for a click only when a visit looks automated.
import { state } from "./core.js";

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__keeperTurnstile";
const LOAD_ERROR = "The security check couldn't load. Check your connection, or allow challenges.cloudflare.com in your content blocker, then reload the page.";
let loading = null;

// (Checks for the render function: any element with id="turnstile" would also
// show up as window.turnstile.)
const loaded = () => typeof window.turnstile?.render === "function";

function load() {
  if (loaded()) return Promise.resolve(window.turnstile);
  return (loading ??= new Promise((resolve, reject) => {
    window.__keeperTurnstile = () => resolve(window.turnstile);
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onerror = () => {
      loading = null;
      s.remove();
      reject(new Error(LOAD_ERROR));
    };
    document.head.append(s);
  }));
}

// Mounts the widget in `container`. Returns null when the check is off, or
// { token(), reset(), remove() }; token() waits for the widget to finish.
export function mountTurnstile(container, { action }) {
  const sitekey = state.turnstile?.siteKey;
  if (!sitekey || !container) return null;
  let id = null;
  let token = "";
  let error = null;
  const waiters = [];
  const settle = () => waiters.splice(0).forEach((w) => w());

  load()
    .then((t) => {
      if (!container.isConnected) return;
      id = t.render(container, {
        sitekey,
        action,
        theme: "light",
        appearance: "interaction-only",
        callback: (tk) => ((token = tk), (error = null), settle()),
        "expired-callback": () => (token = ""),
        "error-callback": () => ((error = "The security check hit a problem. Please try again."), settle()),
      });
    })
    .catch((e) => ((error = e.message), settle()));

  return {
    async token(timeoutMs = 20000) {
      if (!token && !error) await new Promise((r) => (waiters.push(r), setTimeout(r, timeoutMs)));
      if (token) return token;
      throw new Error(error || "Please complete the security check above the button.");
    },
    reset() {
      token = "";
      error = null;
      if (id != null && loaded()) window.turnstile.reset(id);
    },
    remove() {
      if (id != null && loaded()) window.turnstile.remove(id);
    },
  };
}
