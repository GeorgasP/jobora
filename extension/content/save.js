/*
 * "Save to Jobora": for job ads that no API offers.
 *
 * Many jobs are only ever posted: in a Facebook group, a Reddit thread, a
 * page's post. No scan reaches them and no API returns them.
 *
 * This script neither searches nor sends anything by itself. It shows a
 * button when the page you are reading looks like a job ad, and only when
 * you press it does it read the text and pass it to the extension: the
 * difference between taking a note of something you see and crawling a site.
 */
(function () {
  "use strict";
  if (window.__joboraSave) return;
  window.__joboraSave = true;

  // Shown until the service worker answers with the user's language.
  const DEFAULT_TEXTS = {
    button: "🎯 Save to Jobora", heading: "Save this job ad", title: "Title", company: "Company or page",
    location: "Location", text: "Text", cancel: "Cancel", save: "Save", contact: "Contact: {email}",
    saved: "Saved. You'll find it in Matches.", notSaved: "Not saved: {error}", unknownError: "unknown error",
  };
  const BUTTON_ID = "__jobora_save_btn";
  const PANEL_ID = "__jobora_save_panel";
  const POST_MIN_LENGTH = 120;      // shorter blocks are comments or captions
  const POST_MAX_LENGTH = 6000;     // longer ones are a whole feed
  const SELECTION_MIN_LENGTH = 80;  // a selection this long is the post the user means
  const RECHECK_MS = 900;           // social feeds change constantly; look again after a pause
  const SAVED_CLOSE_MS = 1400;

  // What a post says when it offers a job, in Jobora's languages and Dutch.
  // Whole words and phrases, so "vacature" is not found inside other words.
  const HIRING_WORDS = [
    // English
    "hiring", "we are looking for", "we're looking for", "job opening", "vacancy", "vacancies",
    "apply now", "job offer", "now hiring", "join our team", "position available",
    "send your cv", "send cv", "recruiting",
    // Greek
    "ζητείται", "ζητούνται", "αναζητούμε", "αναζητείται", "θέση εργασίας",
    "θέσεις εργασίας", "προσλαμβάνουμε", "αποστολή βιογραφικών", "βιογραφικό",
    "ζητάμε", "προσφέρεται εργασία",
    // German
    "wir suchen", "stellenangebot", "stellenanzeige", "jetzt bewerben", "wir stellen ein", "gesucht",
    // Spanish
    "se busca", "buscamos", "oferta de empleo", "oferta de trabajo", "vacante", "estamos contratando", "envía tu cv",
    // French
    "nous recrutons", "on recrute", "offre d'emploi", "poste à pourvoir", "nous recherchons", "envoyez votre cv",
    // Italian
    "cerchiamo", "cercasi", "offerta di lavoro", "stiamo assumendo", "posizione aperta", "invia il tuo cv",
    // Portuguese
    "estamos a contratar", "estamos contratando", "procuramos", "oferta de emprego", "envia o teu cv", "envie o seu cv",
    // Dutch
    "vacature", "wij zoeken", "we zoeken", "solliciteer", "kom ons team versterken",
    // Polish
    "zatrudnimy", "szukamy", "oferta pracy", "praca od zaraz", "dołącz do naszego zespołu", "wyślij cv",
  ];
  const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const HIRING = new RegExp(`(?<![\\p{L}\\p{N}])(?:${HIRING_WORDS.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])`, "u");
  const offersAJob = (text) => HIRING.test(text.toLowerCase());

  let texts = DEFAULT_TEXTS;
  const fillIn = (template, values) =>
    Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), template);

  function ask(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (reply) => {
        void chrome.runtime.lastError;      // a worker being updated answers nothing
        resolve(reply);
      });
    });
  }

  // Typographic apostrophes ("we’re") read as plain ones, as the word list has them.
  const textOf = (el) => (el?.innerText || "").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();

  /** The likeliest job ad on the page: the smallest block that offers a job. */
  function findPosting() {
    const selection = String(window.getSelection() || "").trim();
    if (selection.length > SELECTION_MIN_LENGTH) return { text: selection, node: null };

    const candidates = [...document.querySelectorAll(
      "article, [role=article], [data-testid=post_message], .userContent, " +
      ".feed-shared-update-v2, .Post, .usertext-body, main, section")];
    let best = null;
    for (const el of candidates) {
      const text = textOf(el);
      if (text.length < POST_MIN_LENGTH || text.length > POST_MAX_LENGTH || !offersAJob(text)) continue;
      if (!best || text.length < best.text.length) best = { text, node: el };
    }
    return best;
  }

  function guess(text) {
    const lines = text.split(/[\n·|]|(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    const fits = (line) => line.length >= 8 && line.length <= 110;
    // The role is in the line that says they are looking for someone, not in
    // the first one, which is usually the name of the page that posted it.
    const title = lines.find((line) => fits(line) && offersAJob(line)) || lines.find(fits) || lines[0] || "";
    // An address that ends a sentence must not keep the sentence's full stop.
    const email = ((text.match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/) || [])[0] || "").replace(/\.+$/, "");
    const clean = title
      // Posts start with a timestamp ("3 hours", "2h", "πριν 5 λεπτά") that is
      // no part of the title. \w misses Greek; \p{L} with the u flag does not.
      .replace(/^(πριν\s+)?\d+\s*(ώρ\p{L}*|λεπτ\p{L}*|ημέρ\p{L}*|h|hr|hrs|min|days?)\s*/iu, "")
      .replace(/^[-–—:·,\s]+/, "")
      .replace(/[.,;:!]+$/, "")
      .trim();
    return { title: clean.slice(0, 120), email };
  }

  let panel = null;

  function close() {
    panel?.remove();
    panel = null;
  }

  function openForm(found) {
    close();
    const g = guess(found.text);
    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.attachShadow({ mode: "open" }).innerHTML = `
      <style>
        :host { all: initial; }
        .box {
          position: fixed; z-index: 2147483647; right: 18px; bottom: 74px;
          width: 330px; padding: 16px 16px 14px;
          background: #101827; color: #f1f5f9;
          border: 1px solid #344863; border-radius: 12px;
          box-shadow: 0 12px 40px -12px rgba(0,0,0,.7);
          font: 13.5px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        b { display: block; margin-bottom: 10px; font-size: 14px; }
        label { display: block; margin-top: 9px; font-size: 11.5px;
                letter-spacing: .4px; text-transform: uppercase; color: #899bb2; }
        input, textarea {
          width: 100%; margin-top: 4px; padding: 7px 9px;
          background: #0c1526; color: #f1f5f9;
          border: 1px solid #344863; border-radius: 7px;
          font: inherit; box-sizing: border-box;
        }
        textarea { height: 62px; resize: vertical; }
        .row { display: flex; gap: 8px; margin-top: 13px; }
        button {
          flex: 1; padding: 8px 10px; border: 1px solid #344863; border-radius: 8px;
          background: #162033; color: #f1f5f9; font: inherit; cursor: pointer;
        }
        button.primary { background: #2563eb; border-color: #2563eb; color: #fff; font-weight: 600; }
        .hint { margin-top: 9px; font-size: 11.5px; color: #899bb2; }
      </style>
      <div class="box">
        <b></b>
        <label for="t" data-text="title"></label><input id="t">
        <label for="c" data-text="company"></label><input id="c">
        <label for="l" data-text="location"></label><input id="l">
        <label for="d" data-text="text"></label><textarea id="d"></textarea>
        <div class="row">
          <button id="cancel" data-text="cancel"></button>
          <button id="save" class="primary" data-text="save"></button>
        </div>
        <div class="hint" id="hint"></div>
      </div>`;
    document.documentElement.appendChild(panel);

    const $ = (selector) => panel.shadowRoot.querySelector(selector);
    $("b").textContent = texts.heading;
    panel.shadowRoot.querySelectorAll("[data-text]").forEach((el) => { el.textContent = texts[el.dataset.text]; });
    $("#t").value = g.title;
    $("#c").value = document.title.split(/[|\-–]/)[0].trim().slice(0, 60);
    $("#d").value = found.text.slice(0, 1500);
    $("#hint").textContent = g.email ? fillIn(texts.contact, { email: g.email }) : "";

    $("#cancel").onclick = close;
    $("#save").onclick = async () => {
      $("#save").disabled = true;
      const reply = await ask({
        type: "saveJob",
        job: {
          title: $("#t").value.trim(),
          company: $("#c").value.trim(),
          location: $("#l").value.trim(),
          description: $("#d").value.trim(),
          url: location.href,
          contactEmail: g.email,
        },
      });
      if (!panel) return;                              // closed while saving
      $("#hint").textContent = reply?.ok
        ? texts.saved
        : fillIn(texts.notSaved, { error: reply?.error || texts.unknownError });
      if (reply?.ok) setTimeout(close, SAVED_CLOSE_MS);
      else $("#save").disabled = false;
    };
  }

  function mountTrigger() {
    const found = findPosting();
    if (!found || document.getElementById(BUTTON_ID)) return;

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = texts.button;
    button.style.cssText = [
      "position:fixed", "z-index:2147483646", "right:18px", "bottom:18px",
      "padding:10px 14px", "border:0", "border-radius:10px",
      "background:#2563eb", "color:#fff", "font:600 13px/1 system-ui,sans-serif",
      "box-shadow:0 6px 22px -6px rgba(0,0,0,.6)", "cursor:pointer",
    ].join(";");
    button.onclick = () => openForm(findPosting() || found);
    document.documentElement.appendChild(button);
  }

  ask({ type: "saveTexts" }).then((reply) => {
    if (reply && reply.ok) texts = { ...DEFAULT_TEXTS, ...reply.texts };
    const button = document.getElementById(BUTTON_ID);
    if (button) button.textContent = texts.button;
  });

  // Social sites load content all the time; look again when something
  // changes, but with a pause, so the page is not slowed down.
  let timer = null;
  const recheck = () => {
    clearTimeout(timer);
    timer = setTimeout(mountTrigger, RECHECK_MS);
  };
  recheck();
  new MutationObserver(recheck).observe(document.documentElement, { childList: true, subtree: true });
})();
