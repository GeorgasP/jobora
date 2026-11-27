import * as store from "./lib/store.js";
import { readCV, guessFromCV } from "./lib/cv.js";
import { ALL_INDUSTRIES, pickCompanies } from "./lib/companies.js";
import { buildVocabulary } from "./lib/suggest.js";
import { createTagField } from "./lib/tagfield.js";
import { initI18n, loadLanguage, applyTranslations, t, LANGUAGES } from "./lib/i18n.js";
import { portalOriginsFor } from "./lib/portals.js";
import { countriesOf } from "./lib/scanplan.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let guess = { titles: [] };

/* ── Γλώσσα: μαντεύεται από τον browser, αλλάζει με ένα κλικ ── */
async function setupLanguage() {
  const profile = await store.getProfile();
  const active = await initI18n(profile.uiLanguage);
  if (!profile.uiLanguage) await store.saveProfile({ uiLanguage: active });

  const select = document.getElementById("uiLanguage");
  select.innerHTML = LANGUAGES.map((l) =>
    `<option value="${l.code}" ${l.code === active ? "selected" : ""}>${esc(l.name)}</option>`).join("");
  select.onchange = async () => {
    await loadLanguage(select.value);
    await store.saveProfile({ uiLanguage: select.value });
    applyTranslations();
    showSuggestions();
  };
}
await setupLanguage();

function step(n) {
  $$(".step").forEach((s, i) => s.classList.toggle("on", i === n - 1));
  $$(".progress li").forEach((item, i) => {
    const complete = i < n - 1;
    item.classList.toggle("complete", complete);
    item.classList.toggle("current", i === n - 1);
    if (i === n - 1) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
    item.querySelector(".step-number").textContent = complete ? "✓" : String(i + 1);
    item.querySelector(".progress-status").hidden = !complete;
  });
  $(`#s${n} h2`).focus({ preventScroll: true });
  scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
}

/* ── Tag inputs με προτάσεις ──────────────────────────────── */
// Στο onboarding δεν έχει κατέβει τίποτα ακόμα, οπότε το λεξιλόγιο είναι οι
// σπόροι· μετά το πρώτο scan οι προτάσεις βγαίνουν από αληθινές αγγελίες.
let vocab = buildVocabulary([]);
store.getJobs().then((jobs) => { if (jobs.length) vocab = buildVocabulary(jobs); });

// Μόλις διαλέξει κλάδους στο βήμα 3, οι προτάσεις τίτλων ξαναχτίζονται ώστε
// να βγαίνουν πρώτα τα επαγγέλματα εκείνου του κλάδου.
function refreshVocabForIndustries() {
  const industries = $$("#industries .pick.on").map((p) => p.dataset.i);
  store.getJobs().then((jobs) => { vocab = buildVocabulary(jobs, { industries }); });
}

const fields = {
  titles: createTagField(document.querySelector('[data-tags="titles"]'),
                         { values: [], vocabulary: () => vocab.titles }),
  locations: createTagField(document.querySelector('[data-tags="locations"]'),
                            { values: ["Remote"], vocabulary: () => vocab.locations }),
};
const tagValues = (n) => fields[n].values;

/* ── Step 1: CV ───────────────────────────────────────────── */
const drop = $("#drop");
drop.onclick = () => $("#file").click();
["dragenter", "dragover"].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));
$("#file").onchange = (e) => handleFile(e.target.files[0]);

async function handleFile(file) {
  if (!file) return;
  $("#next1").disabled = true;
  $("#found").innerHTML = "";
  drop.innerHTML = `<div class="ic">⏳</div><b>${esc(t("onboarding.reading", { file: file.name }))}</b>`
    + `<span>${esc(t("onboarding.readingWait"))}</span>`;
  try {
    const cv = await readCV(file);
    await store.saveCV(cv);
    guess = guessFromCV(cv.text);

    const sub = cv.text
      ? t("settings.cv.read", { kb: Math.round(cv.size / 1024), chars: cv.text.length.toLocaleString() })
      : t("settings.cv.unreadable", { kb: Math.round(cv.size / 1024) });
    drop.innerHTML = `<div class="ic">✅</div><b>${esc(cv.filename)}</b><span>${esc(sub)}</span>`;

    // Each detail read from the CV, editable: [profile field, input type, autocomplete].
    // Email, phone and location always show, to be filled in when the CV lacks
    // them; the location decides which remote jobs are open to the user.
    const rows = [
      ["email", "email", "email"],
      ["phone", "tel", "tel"],
      ["location", "text", "address-level2"],
      ["linkedin", "url", "url"],
      ["github", "url", "url"],
    ].filter(([key]) => ["email", "phone", "location"].includes(key) || guess[key]);
    // Only these input types have a format to check, and an error message for it.
    const checked = (type) => type === "email" || type === "url";

    $("#found").innerHTML = `<div class="found"><div data-i18n="onboarding.foundTitle" style="font-size:12px;color:var(--fg-3);text-transform:uppercase;
           letter-spacing:.7px;font-weight:600;margin-bottom:8px">${esc(t("onboarding.foundTitle"))}</div>
         <p class="found-help" data-i18n="onboarding.foundHelp">${esc(t("onboarding.foundHelp"))}</p>
         <div class="row"><label for="cv-name" data-i18n="onboarding.found.name">${esc(t("onboarding.found.name"))}</label>
           <input id="cv-name" class="txt" type="text" autocomplete="name" value="${esc(guess.name)}"
             data-i18n-ph="settings.name" placeholder="${esc(t("settings.name"))}"></div>
         ${rows.map(([key, type, autocomplete]) => `<div class="row">
           <label for="cv-${key}" ${key === "github" ? "" : `data-i18n="onboarding.found.${key}"`}>${key === "github" ? "GitHub" : esc(t(`onboarding.found.${key}`))}</label>
           <div class="contact-field">
             <input id="cv-${key}" class="txt" type="${type}" autocomplete="${autocomplete}" value="${esc(guess[key])}"
               ${checked(type) ? `aria-describedby="cv-${key}-error"` : ""}>
             ${checked(type) ? `<p id="cv-${key}-error" class="field-error" data-i18n="onboarding.invalid.${type}" hidden>${esc(t(`onboarding.invalid.${type}`))}</p>` : ""}
           </div></div>`).join("")}
         ${!guess.name && !rows.some(([key]) => guess[key]) ? `<div class="row"><span data-i18n="onboarding.foundNothing">${esc(t("onboarding.foundNothing"))}</span></div>` : ""}</div>`;

    await store.saveProfile({
      name: guess.name || "", email: guess.email || "", phone: guess.phone || "",
      location: guess.location || "", linkedin: guess.linkedin || "", github: guess.github || "",
    });
    // Where the user lives decides which remote jobs are open to them, so the
    // locations start from their country instead of "Remote" alone, unless
    // they have already chosen something else.
    const locations = tagValues("locations");
    if (guess.country && locations.length === 1 && locations[0] === "Remote") {
      fields.locations.values = [guess.country, "Remote"];
    }
    $("#next1").disabled = false;
  } catch (err) {
    drop.innerHTML = `<div class="ic">⚠️</div><b>${esc(t("onboarding.readFail"))}</b><span>${esc(err.message)}</span>`;
  }
}

function validateContactField(input) {
  input.value = input.value.trim();
  if (input.type === "url" && /^(?:(?:www|[a-z]{2,3})\.)?(?:linkedin\.com|github\.com)\//i.test(input.value)) {
    input.value = `https://${input.value}`;
  }
  const valid = input.validity.valid &&
    (!input.value || input.type !== "url" || /^https?:\/\//i.test(input.value));
  input.setAttribute("aria-invalid", String(!valid));
  $(`#${input.id}-error`).hidden = valid;
  return valid;
}

$("#found").addEventListener("input", ({ target }) => {
  if (target.getAttribute("aria-invalid") !== "true") return;
  target.removeAttribute("aria-invalid");
  $(`#${target.id}-error`).hidden = true;
});

async function continueFromCV() {
  const invalid = $$('#found input[type="email"], #found input[type="url"]')
    .filter((input) => !validateContactField(input));
  if (invalid.length) {
    invalid[0].focus();
    return;
  }
  const corrections = {};
  for (const key of ["name", "email", "phone", "location", "linkedin", "github"]) {
    const input = $(`#cv-${key}`);
    if (input) corrections[key] = guess[key] = input.value.trim();
  }
  if (Object.keys(corrections).length) await store.saveProfile(corrections);
  showSuggestions();
  step(2);
}
$("#next1").onclick = continueFromCV;
$("#skip1").onclick = continueFromCV;

function showSuggestions() {
  if (!guess.titles?.length) return;
  $("#sug").innerHTML = `<span style="font-size:12.5px;color:var(--fg-3);align-self:center">${esc(t("onboarding.fromCV"))}</span>` +
    guess.titles.map((title) => `<button data-t="${esc(title)}">+ ${esc(title)}</button>`).join("");
  $$("#sug button").forEach((b) => b.onclick = () => {
    const v = tagValues("titles");
    if (!v.includes(b.dataset.t)) fields.titles.values = [...v, b.dataset.t];
    b.remove();
  });
}

/* ── Step 2 ───────────────────────────────────────────────── */
$$("[data-tog]").forEach((el) => el.onclick = () => el.classList.toggle("on"));
$("#back2").onclick = () => step(1);
$("#next2").onclick = () => {
  if (!tagValues("titles").length) {
    document.querySelector('[data-tags="titles"] input').focus();
    return;
  }
  step(3);
};

/* ── Step 3 ───────────────────────────────────────────────── */
const INDUSTRY_LABELS = { ai: "AI", hr: "HR", saas: "SaaS", fintech: "Fintech" };
const industryLabel = (i) => INDUSTRY_LABELS[i] ?? i.charAt(0).toUpperCase() + i.slice(1);
$("#industries").innerHTML = ALL_INDUSTRIES.map((i) =>
  `<button class="pick" data-i="${i}">${esc(industryLabel(i))}</button>`).join("");
$$("#industries .pick").forEach((p) => p.onclick = () => {
  p.classList.toggle("on");
  refreshVocabForIndustries();
});
$("#back3").onclick = () => step(2);

$("#finish").onclick = async () => {
  // First, while the click still counts as the user's: Chrome only shows its
  // permission question during one. Saying no just leaves the portals out.
  // The question names the shared portals and the national employment
  // services of the countries chosen, never every country's.
  const locations = tagValues("locations").length ? tagValues("locations") : ["Remote"];
  const origins = portalOriginsFor(countriesOf({ locations, location: guess.location || "" }));
  await chrome.permissions.request({ origins }).catch(() => false);
  const industries = $$("#industries .pick.on").map((p) => p.dataset.i);
  await store.saveProfile({
    titles: tagValues("titles"),
    locations,
    industries,
    targets: pickCompanies(industries),
    remoteOnly: $('[data-tog="remoteOnly"]').classList.contains("on"),
    strictLocation: $('[data-tog="strictLocation"]').classList.contains("on"),
    languages: [navigator.language.slice(0, 2)],
  });

  step(4);
  const res = await chrome.runtime.sendMessage({ type: "scan" });

  if (res?.ok) {
    $("#done-h").textContent = res.matches ? t("onboarding.done", { n: res.matches }) : t("onboarding.doneNone");
    $("#done-p").textContent = res.matches
      ? t("onboarding.doneLead", { seen: res.seen.toLocaleString(), seconds: res.seconds })
      : t("onboarding.doneLeadNone");
  } else {
    $("#done-h").textContent = t("onboarding.failed");
    $("#done-p").textContent = res?.error || t("onboarding.failedLead");
  }
  $("#open-app").style.display = "inline-flex";
  $("#open-app").onclick = () => location.href = "app.html";
};
