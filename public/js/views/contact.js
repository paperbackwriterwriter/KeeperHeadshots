import { $, $$, html, icon, api, state, busy } from "../core.js";
import { footer } from "./landing.js";

export const CONTACT_EMAIL = "hello@keeperheadshots.com";

// Kept in sync with TOPICS in server.js.
const TOPICS = [
  ["general", "General question"],
  ["shoot", "Help with a shoot"],
  ["billing", "Billing or refunds"],
  ["team", "Team headshots"],
  ["press", "Press or partnerships"],
];

const mailto = (subject) => `mailto:${CONTACT_EMAIL}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`;

export function renderContact({ root }) {
  const q = new URLSearchParams(location.search);
  const topic = TOPICS.some(([id]) => id === q.get("topic")) ? q.get("topic") : "general";
  const u = state.user && !state.user.demo ? state.user : null;

  root.innerHTML = html`
  <main id="main" class="container app-main view-enter contact-page">
    <div class="contact-grid">
      <section aria-labelledby="contactTitle">
        <p class="eyebrow"><span class="dot"></span>Contact</p>
        <h1 class="display h-1" id="contactTitle" style="margin-top:12px">Get in touch.</h1>
        <p class="lede" style="margin-top:14px;max-width:52ch">Questions about a shoot, billing or headshots for your team? Send us a note and a real person will write back to you by email.</p>

        <div id="contactBody">
          <form class="form contact-form" id="contactForm" novalidate>
            <div class="form-alert" id="formAlert" role="alert" hidden></div>
            <div class="contact-row">
              <div class="field"><label for="name">Your name</label><input class="input" id="name" name="name" autocomplete="name" maxlength="80" value="${u?.name || ""}" required /><span class="field-error" id="err-name" hidden></span></div>
              <div class="field"><label for="email">Email</label><input class="input" id="email" name="email" type="email" autocomplete="email" inputmode="email" maxlength="200" placeholder="you@company.com" value="${u?.email || ""}" required /><span class="field-error" id="err-email" hidden></span></div>
            </div>
            <div class="field">
              <label for="topic">What's it about?</label>
              <select class="input" id="topic" name="topic">${TOPICS.map(([id, label]) => html`<option value="${id}" ${id === topic ? "selected" : ""}>${label}</option>`)}</select>
            </div>
            <div class="field">
              <label for="message">Message</label>
              <textarea class="input" id="message" name="message" rows="7" maxlength="5000" placeholder="How can we help? If it's about a shoot, tell us its name." required></textarea>
              <span class="field-error" id="err-message" hidden></span>
            </div>
            <div class="hp" aria-hidden="true"><label for="company">Company website</label><input id="company" name="company" tabindex="-1" autocomplete="off" /></div>
            <div class="contact-submit">
              <button class="btn btn-flash btn-lg" type="submit" id="submit">Send message ${icon("send")}</button>
              <p class="field-hint">Or email <a class="link" href="${mailto()}">${CONTACT_EMAIL}</a></p>
            </div>
          </form>
        </div>
      </section>

      <aside class="contact-side" aria-label="Other ways to reach us">
        <div class="contact-card">
          <span class="ficon">${icon("mail")}</span>
          <div><b>Email</b><span>Write to us directly and we'll reply from the same address.</span><a class="link" href="${mailto()}">${CONTACT_EMAIL}</a></div>
        </div>
        <div class="contact-card">
          <span class="ficon">${icon("users")}</span>
          <div><b>Team headshots</b><span>Need matching headshots for a whole team? Tell us how many people and we'll help you pick a package.</span><a class="link" href="/contact?topic=team" id="teamLink">Ask about teams</a></div>
        </div>
        <div class="contact-card">
          <span class="ficon">${icon("receipt")}</span>
          <div><b>Billing</b><span>Include the email you paid with so we can find your order quickly.</span><a class="link" href="${mailto("Billing question")}">Email billing</a></div>
        </div>
        <div class="contact-card">
          <span class="ficon">${icon("circle-help")}</span>
          <div><b>Quick answers</b><span>Photo tips, turnaround, ownership and more.</span><a class="link" href="/#faq">Read the FAQ</a></div>
        </div>
      </aside>
    </div>
  </main>
  ${footer()}`.v;

  const form = $("#contactForm");
  const alertBox = $("#formAlert");

  // The team card links to this same page; just switch the topic.
  $("#teamLink").addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    $("#topic").value = "team";
    $("#message").focus();
  });

  const setErrors = (fields = {}) => {
    $$(".field-error", form).forEach((el) => {
      const key = el.id.replace("err-", "");
      const input = $(`#${key}`);
      if (fields[key]) {
        el.innerHTML = `${icon("circle-alert").v}${fields[key].replace(/</g, "&lt;")}`;
        el.hidden = false;
        input.setAttribute("aria-invalid", "true");
        input.setAttribute("aria-describedby", el.id);
      } else {
        el.hidden = true;
        input.removeAttribute("aria-invalid");
        input.removeAttribute("aria-describedby");
      }
    });
  };

  const validate = (d) => {
    const f = {};
    if (!d.name || d.name.trim().length < 2) f.name = "Tell us what to call you.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((d.email || "").trim())) f.email = "Enter a valid email address so we can reply.";
    if (!d.message || d.message.trim().length < 10) f.message = "Add a little more detail (at least 10 characters).";
    return f;
  };

  const showSent = (email) => {
    $("#contactBody").innerHTML = html`<div class="contact-sent" role="status" tabindex="-1" id="sent">
      <span class="ficon">${icon("mail-check")}</span>
      <div><h2 class="display h-3">Message sent.</h2><p class="muted">Thanks — we'll reply to <b>${email}</b>. If it's urgent, you can also email <a class="link" href="${mailto()}">${CONTACT_EMAIL}</a>.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px"><a class="btn btn-ink" href="/" data-link>Back to home</a><button class="btn btn-ghost" id="another" type="button">Send another</button></div></div>
    </div>`.v;
    $("#sent").focus();
    $("#another").addEventListener("click", () => renderContact({ root }));
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    alertBox.hidden = true;
    const fields = validate(data);
    setErrors(fields);
    if (Object.keys(fields).length) return $(`#${Object.keys(fields)[0]}`).focus();
    const restore = busy($("#submit"), "Sending…");
    try {
      await api("/api/contact", { method: "POST", body: data });
      showSent(data.email.trim());
    } catch (err) {
      restore();
      if (err.data?.fields) setErrors(err.data.fields);
      const body = encodeURIComponent(data.message || "");
      alertBox.innerHTML = `${icon("circle-alert").v}<span>${err.message.replace(/</g, "&lt;")} You can also <a class="link" href="${mailto("Website message")}&body=${body}">email us directly</a>.</span>`;
      alertBox.hidden = false;
    }
  });
  form.addEventListener("input", (e) => {
    if (e.target.getAttribute("aria-invalid")) {
      e.target.removeAttribute("aria-invalid");
      $(`#err-${e.target.id}`).hidden = true;
    }
  });
}
