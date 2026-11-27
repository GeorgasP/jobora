/*
 * The floating "Fill with Jobora" button on application pages.
 * Everything it shows and fills comes from the service worker; nothing goes to a server.
 */
(function () {
  "use strict";
  if (window.__joboraButton) return;
  window.__joboraButton = true;

  const BUTTON_ID = "__jobora_btn";
  // Shown until the service worker answers with the user's language.
  const DEFAULT_TEXTS = {
    button: "🎯 Fill with Jobora",
    filling: "Filling…",
    noFields: "Jobora did not recognise any fields on this page.",
    noResponse: "no response",
  };
  // A control with one of these words sends the application...
  const SUBMIT_WORDS = /submit|send|apply|υποβολ|αποστολ|absenden|bewerb|envoyer|postuler|soumettre|enviar|postular|invia|candid|wyślij|aplikuj|submeter/i;
  // ...unless it signs in or imports a profile: "Apply with LinkedIn".
  const NOT_SUBMIT_WORDS = /\bwith\b|linkedin|indeed|google|sign ?in|log ?in|upload|attach/i;
  const CONTROLS = "button, input[type=submit], input[type=button], [role=button]";
  // Single-page applications render their forms late; look again after these.
  const MOUNT_RETRIES_MS = [1500, 4000];

  let texts = DEFAULT_TEXTS;
  // The application the last fill was for. Submitting marks it sent, once.
  let pendingApplication = null;

  const looksLikeForm = (root = document) => Boolean(root.querySelector("input[type=file]"))
    || root.querySelectorAll("input[type=text], input[type=email], textarea").length >= 3;

  function ask(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (reply) => {
        void chrome.runtime.lastError;      // a worker being updated answers nothing
        resolve(reply);
      });
    });
  }

  async function fill(button) {
    button.disabled = true;
    button.textContent = texts.filling;
    const data = await ask({ type: "prefill", url: location.href, title: document.title });
    button.disabled = false;
    button.textContent = texts.button;
    if (!data || !data.ok) {
      alert(`Jobora: ${(data && data.error) || texts.noResponse}`);
      return;
    }
    const report = window.__joboraFill(data);
    if (!report.filled && !report.cv) {
      alert(texts.noFields);
      return;
    }
    pendingApplication = data.applicationId || null;
  }

  function markSent() {
    if (!pendingApplication) return;
    ask({ type: "markSent", applicationId: pendingApplication });
    pendingApplication = null;
  }

  function sendsTheApplication(control) {
    if (!control || control.id === BUTTON_ID) return false;
    const label = `${control.value || ""} ${control.textContent || ""} ${control.getAttribute("aria-label") || ""}`;
    return SUBMIT_WORDS.test(label) && !NOT_SUBMIT_WORDS.test(label);
  }

  // Listening from the start and to every click: people check a few fields
  // before pressing Submit, and a listener that lasted one click never saw it.
  document.addEventListener("click", (event) => {
    if (sendsTheApplication(event.target.closest?.(CONTROLS))) markSent();
  }, true);
  // Enter in a field sends a form without any click. Only the application
  // form counts, not a search box elsewhere on the page.
  document.addEventListener("submit", (event) => {
    if (looksLikeForm(event.target)) markSent();
  }, true);

  function makeButton() {
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = texts.button;
    button.style.cssText = [
      "position:fixed", "z-index:2147483646", "right:18px", "bottom:18px",
      "background:linear-gradient(135deg,#5b8cff,#7c5cff)", "color:#fff", "border:none",
      "border-radius:10px", "padding:11px 16px", "cursor:pointer",
      "font:600 14px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif",
      "box-shadow:0 6px 22px rgba(91,140,255,.4)",
    ].join(";");
    button.addEventListener("click", () => fill(button));
    return button;
  }

  function mount() {
    if (document.getElementById(BUTTON_ID) || !looksLikeForm()) return;
    document.body.appendChild(makeButton());
  }

  ask({ type: "fillTexts" }).then((reply) => {
    if (reply && reply.ok) texts = { ...DEFAULT_TEXTS, ...reply.texts };
    const button = document.getElementById(BUTTON_ID);
    if (button && !button.disabled) button.textContent = texts.button;
  });
  mount();
  new MutationObserver(mount).observe(document.documentElement, { childList: true, subtree: true });
  MOUNT_RETRIES_MS.forEach((ms) => setTimeout(mount, ms));
})();
