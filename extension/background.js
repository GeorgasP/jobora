/*
 * Service worker — η «μηχανή» του Jobora.
 *
 * • Καθημερινό αυτόματο scan (chrome.alarms) με ειδοποίηση για νέα matches
 * • Badge με τον αριθμό των matches
 * • API μηνυμάτων για το UI και για το content script (autofill)
 */
import * as store from "./lib/store.js";
import { fetchAll, getJSON } from "./lib/sources.js";
import { lookUpOccupations, occupationNames } from "./lib/esco.js";
import { euresSearchFor, nationalSearchFor, needsNationalPortals } from "./lib/scanplan.js";
import { boardsWithPermission } from "./lib/portals.js";
import { rankJobs } from "./lib/matcher.js";
import { generateLetter } from "./lib/letters.js";
import { findApplication } from "./lib/applications.js";
import { countMatches } from "./lib/filters.js";
import { pickCompanies } from "./lib/companies.js";
import { refreshRates } from "./lib/fx.js";
import { initI18n, t } from "./lib/i18n.js";

const ALARM = "jobora-daily";
// How many of the best matches go to the dashboard; it shows at most 100 at a time.
const MATCHES_SENT = 200;
// Το προηγούμενο όνομα του προϊόντος ζει ακόμη σε ένα χρονόμετρο που έφτιαξε
// μια παλιότερη εγκατάσταση. Δεν ταιριάζει πια με κανέναν ακροατή, οπότε θα
// χτυπούσε για πάντα χωρίς να κάνει τίποτα. Το σβήνουμε μία φορά.
chrome.alarms.clear("jobhunter-daily");
let scanning = false;

/* ── Μεταφορά ρυθμίσεων σε ενημερώσεις ────────────────────────
 * Το αποθηκευμένο profile υπερισχύει των προεπιλογών. Χωρίς αυτό, όποιος
 * έχει ήδη εγκαταστήσει το extension δεν θα έβλεπε ποτέ τις νέες πηγές —
 * θα αναρωτιόταν γιατί οι άλλοι βρίσκουν περισσότερες αγγελίες.
 * Οι πηγές που έχει ξε-τσεκάρει ο ίδιος δεν επιστρέφουν ποτέ.
 */
const MIGRATIONS = [
  { version: 2, boards: ["themuse", "weworkremotely", "landingjobs", "cryptojobs"] },
  { version: 3, boards: ["devitjobs", "adzuna"] },
  { version: 4, boards: ["psf"] },
  { version: 5, boards: ["skywalker"] },
  { version: 6, boards: ["ordino"] },
  { version: 7, boards: ["eures"] },
  { version: 8, boards: ["jobfind", "xe"] },
  { version: 9, boards: ["jobtech", "nav"] },
];
const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

async function migrate() {
  const state = await store.getState();
  const from = state.schemaVersion || 1;
  if (from >= SCHEMA_VERSION) return null;

  const profile = await store.getProfile();
  const boards = [...profile.boards];
  const added = [];
  for (const step of MIGRATIONS) {
    if (step.version <= from) continue;
    for (const b of step.boards || []) {
      if (!boards.includes(b)) { boards.push(b); added.push(b); }
    }
  }
  if (added.length) await store.saveProfile({ boards });
  await store.saveState({ schemaVersion: SCHEMA_VERSION });
  return added;
}

/* Κρατάμε την υπόσχεση, δεν την πετάμε. Ο service worker ξυπνάει τη στιγμή που
   πατάς «Αναζήτηση» — αν η σάρωση διαβάσει το profile πριν προλάβει να γραφτεί
   η μεταφορά, τρέχει με τις παλιές πηγές και δεν βρίσκει τίποτα. Έχει ξανασυμβεί:
   είναι ακριβώς η πρώτη σάρωση μετά από ενημέρωση, δηλαδή η μόνη που κοιτάς. */
const migrated = migrate()
  .then((added) => {
    if (added?.length) console.info(`Jobora: added new job boards — ${added.join(", ")}`);
  })
  .catch((e) => console.warn("Jobora: migration failed —", e));

/* ── Lifecycle ────────────────────────────────────────────── */
chrome.runtime.onInstalled.addListener(async (details) => {
  chrome.alarms.create(ALARM, { periodInMinutes: 60 * 12, delayInMinutes: 3 });
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
  }
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: 60 * 12, delayInMinutes: 3 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM) return;
  const profile = await store.getProfile();
  if (!profile.autoScan || !(await store.isOnboarded())) return;
  await runScan({ silent: true });
});

/* ── Badge ────────────────────────────────────────────────── */
async function refreshBadge() {
  const matches = await currentMatches();
  const n = matches.length;
  await chrome.action.setBadgeText({ text: n ? String(Math.min(n, 999)) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#5b8cff" });
  return n;
}

/* ── Matches ──────────────────────────────────────────────── */
async function currentMatches(tally = null) {
  await migrated;
  await refreshRates();
  const [profile, jobs, apps, state] = await Promise.all([
    store.getProfile(), store.getJobs(), store.getApps(), store.getState(),
  ]);
  return rankJobs(jobs, profile, {
    dismissed: state.dismissed || [],
    appliedIds: apps.map((a) => a.jobId),
    tally,
  });
}

/* ── Scan ─────────────────────────────────────────────────── */

/**
 * Adds the ESCO occupations of the user's job titles to the profile (see
 * esco.js). Each title is looked up once and the answer kept, even when it is
 * "no occupation"; a lookup that fails is not kept, so the next scan retries.
 */
async function withTitleOccupations(profile) {
  const known = profile.titleOccupations || {};
  const titleOccupations = {};
  for (const title of profile.titles || []) {
    if (known[title]) {
      titleOccupations[title] = known[title];
      continue;
    }
    try {
      titleOccupations[title] = await lookUpOccupations(title, getJSON);
    } catch (e) {
      console.warn(`Jobora: ESCO lookup failed for "${title}" —`, e);
    }
  }
  await store.saveProfile({ titleOccupations });
  return { ...profile, titleOccupations };
}

/**
 * Adds the names of the user's occupations in ESCO's languages, which the
 * national portals are searched in (see esco.js). One lookup per
 * occupation, kept; a lookup that fails is retried on the next scan.
 */
async function withOccupationNames(profile) {
  const names = { ...(profile.occupationNames || {}) };
  let found = false;
  for (const occupation of new Set(Object.values(profile.titleOccupations || {}).flat())) {
    if (names[occupation]) continue;
    try {
      names[occupation] = await occupationNames(occupation, getJSON);
      found = true;
    } catch (e) {
      console.warn(`Jobora: ESCO names failed for ${occupation} —`, e);
    }
  }
  if (found) await store.saveProfile({ occupationNames: names });
  return { ...profile, occupationNames: names };
}

async function runScan({ silent = false } = {}) {
  if (scanning) return { ok: false, error: t("error.scanRunning") };
  scanning = true;
  const started = Date.now();

  try {
    await migrated;
    const stored = await store.getProfile();
    // Portals whose sites the user hasn't allowed are left out (see lib/portals.js).
    const boards = await boardsWithPermission(stored.boards);
    // ESCO names the user's titles for EURES and for the national portals, and
    // lives on a site EURES's permission covers.
    const escoAllowed = boards.includes("eures");
    let profile = escoAllowed ? await withTitleOccupations(stored) : stored;
    const national = escoAllowed && needsNationalPortals(profile, boards);
    if (national) profile = await withOccupationNames(profile);
    const targets = profile.targets?.length ? profile.targets : pickCompanies(profile.industries);
    const sources = [];

    const jobs = await fetchAll(targets, boards, "", (label, count, error) => {
      sources.push({ label, count, error });
    }, {
      maxAgeDays: profile.maxAgeDays,
      adzuna: {
        appId: profile.adzunaAppId,
        appKey: profile.adzunaKey,
        countries: profile.adzunaCountries,
      },
      eures: euresSearchFor(profile),
      national: national ? nationalSearchFor(profile) : {},
    });

    const { added, total } = await store.mergeJobs(jobs);
    const tally = new Map();
    const matches = await currentMatches(tally);

    const history = (await store.getState()).history || [];
    history.push({ at: new Date().toISOString(), seen: jobs.length, added, matches: matches.length });

    await store.saveState({
      lastScan: new Date().toISOString(),
      lastSources: sources,
      history: history.slice(-30),
    });

    await refreshBadge();

    if (!silent || added > 0) {
      const profileNow = await store.getProfile();
      await initI18n(profileNow.uiLanguage);
      if (profileNow.notify && matches.length) {
        chrome.notifications.create({
          type: "basic",
          iconUrl: chrome.runtime.getURL("icons/128.png"),
          title: t("notify.title", { n: matches.length }),
          message: added
            ? t("notify.body", { added, company: matches[0].company, title: matches[0].title })
            : t("notify.bodyNoNew", { company: matches[0].company, title: matches[0].title }),
          priority: 1,
        });
      }
    }

    // Χωρίς ευρήματα, ο πιο συχνός λόγος απόρριψης είναι πιο χρήσιμος από
    // οποιονδήποτε αριθμό: σχεδόν πάντα δείχνει ποιο φίλτρο φταίει.
    const [topReject] = [...tally.entries()].sort((a, b) => b[1] - a[1]);

    return {
      ok: true, seen: jobs.length, added, total,
      matches: matches.length, sources,
      why: matches.length || !topReject ? null : { kind: topReject[0], count: topReject[1] },
      seconds: Math.round((Date.now() - started) / 1000),
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  } finally {
    scanning = false;
  }
}

/* ── Apply ────────────────────────────────────────────────── */
async function applyToJob(jobId, method = "assisted") {
  const [profile, cv, jobs] = await Promise.all([
    store.getProfile(), store.getCV(), store.getJobs(),
  ]);
  const jobItem = jobs.find((j) => j.id === jobId);
  if (!jobItem) return { ok: false, error: t("error.jobNotFound") };

  let letter = { text: "", model: null };
  if (method !== "manual") letter = await generateLetter(jobItem, profile, cv);

  const app = await store.addApp({
    jobId, company: jobItem.company, title: jobItem.title, url: jobItem.url,
    location: jobItem.location, source: jobItem.source,
    method, status: "prepared", preparedAt: new Date().toISOString(),
    coverLetter: letter.text, letterModel: letter.model,
  });
  if (!app) return { ok: false, error: t("error.alreadyApplied") };

  await refreshBadge();
  return { ok: true, app, letterModel: letter.model, letterError: letter.error || null };
}

/* ── What the application page gets ───────────────────────── */

// The texts the content scripts show: "fill" on application pages, "save"
// on social sites. They run on other people's sites, where the extension's
// translations cannot be loaded, so the worker sends them in the user's language.
const PAGE_TEXT_KEYS = {
  fill: ["button", "filling", "noFields", "noResponse", "filled", "cvAttached",
    "required", "check", "leftForYou", "cvUpload", "noMatch"],
  save: ["button", "heading", "title", "company", "location", "text", "cancel", "save",
    "contact", "saved", "notSaved", "unknownError"],
};
const pageTexts = (group) => Object.fromEntries(PAGE_TEXT_KEYS[group].map((key) => [key, t(`${group}.${key}`)]));

/**
 * The answers for the form at `page` ({url, title}), and the application it
 * belongs to (see applications.js). When no prepared application can be told
 * apart, the form still gets the user's details and CV, but no cover letter:
 * each letter is written to one company.
 */
async function prefillFor(page) {
  const [profile, cv, apps] = await Promise.all([
    store.getProfile(), store.getCV(), store.getApps(),
  ]);
  if (!apps.length) {
    return { ok: false, error: t("fill.nothingPrepared") };
  }

  const app = findApplication(apps, page);
  const [firstName = "", ...otherNames] = (profile.name || "").trim().split(/\s+/);
  return {
    ok: true,
    applicationId: app ? app.id : null,
    job: app ? { company: app.company, title: app.title, url: app.url } : null,
    answers: {
      full_name: profile.name,
      first_name: firstName,
      last_name: otherNames.join(" "),
      email: profile.email,
      phone: profile.phone,
      location: profile.location,
      linkedin: profile.linkedin,
      github: profile.github,
      // Nearly every form has a LinkedIn field of its own, so a website
      // field gets the other link first. The form fills each link only once.
      website: profile.github || profile.linkedin,
      work_authorization: profile.workAuthorization,
      notice_period: profile.noticePeriod,
      salary_expectation: profile.salaryMin ? String(profile.salaryMin) : "",
      how_did_you_hear: "Company careers page",
    },
    cover_letter: app ? app.coverLetter || "" : "",
    notice: app ? "" : t("fill.noMatch"),
    cv: cv ? { filename: cv.filename, mime: cv.mime, base64: cv.base64 } : null,
    texts: pageTexts("fill"),
  };
}

/* ── Message API ──────────────────────────────────────────── */
const HANDLERS = {
  scan: () => runScan({ silent: false }),
  // The best matches for the dashboard to show, and counts of all of them:
  // counting only the ones sent made every count stop at that number.
  matches: async () => {
    const all = await currentMatches();
    return { ok: true, matches: all.slice(0, MATCHES_SENT), counts: countMatches(all) };
  },
  apply: (msg) => applyToJob(msg.jobId, msg.method),
  prefill: (msg) => prefillFor({ url: msg.url, title: msg.title }),
  fillTexts: async () => ({ ok: true, texts: pageTexts("fill") }),
  saveTexts: async () => ({ ok: true, texts: pageTexts("save") }),
  dismiss: async (msg) => { await store.dismissJob(msg.jobId); await refreshBadge(); return { ok: true }; },
  refreshBadge: async () => ({ ok: true, count: await refreshBadge() }),
  /* Αγγελία που είδε ο χρήστης κάπου χωρίς API και θέλησε να κρατήσει.
     Μπαίνει στην ίδια λίστα με τις υπόλοιπες και βαθμολογείται κανονικά. */
  saveJob: async (msg) => {
    const j = msg.job || {};
    if (!j.title || !j.url) return { ok: false, error: "missing title or url" };
    const id = `saved:${j.url}|${j.title}`.slice(0, 120);
    const { added } = await store.mergeJobs([{
      id, source: "saved",
      company: (j.company || "—").trim(),
      title: j.title.trim(),
      location: (j.location || "").trim(),
      description: [j.description, j.contactEmail && `
${j.contactEmail}`]
        .filter(Boolean).join(""),
      url: j.url,
      postedAt: new Date().toISOString(),
      remote: /remote|εξ αποστάσεως/i.test(`${j.title} ${j.location}`),
      salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: "year",
      lastSeen: new Date().toISOString(),
    }]);
    await refreshBadge();
    return { ok: true, added };
  },

  markSent: async (msg) => {
    await store.updateApp(msg.applicationId, { status: "sent", sentAt: new Date().toISOString() },
                          "Submitted from the application page");
    return { ok: true };
  },
};

/*
 * Before any message: the settings migration, and the user's language. Chrome
 * stops the worker whenever it is idle, and the language used to load only
 * after a scan, so a fresh worker answered with bare keys such as
 * "fill.nothingPrepared". Loading it per message also follows a language the
 * user has just changed.
 */
async function prepare() {
  await migrated;
  await initI18n((await store.getProfile()).uiLanguage);
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  const handler = HANDLERS[msg?.type];
  if (!handler) return false;
  prepare()
    .then(() => handler(msg))
    .then(respond)
    .catch((e) => respond({ ok: false, error: String(e.message || e) }));
  return true;                                   // async
});
