/*
 * The service worker end to end: a whole scan, as Chrome runs it, with the
 * Chrome APIs kept in memory and every job source answering from fixtures.
 * It covers what no other test reaches: settings migration, portal
 * permissions, the ESCO lookup, the EURES search, storing jobs and ranking.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const WAITER = "http://data.europa.eu/esco/occupation/d5db9d5c-a3c8-4d93-b2e2-2b6bb4a49e8c";
const PORTALS = ["https://europa.eu/*", "https://ec.europa.eu/*", "https://www.jobfind.gr/*", "https://www.xe.gr/*"];
const now = new Date().toISOString();

/* ── Chrome, in memory ─────────────────────────────────────── */
const storage = {
  // A user from before EURES and the Greek boards existed (schema 6).
  profile: {
    titles: ["Waiter"], locations: ["Greece", "Remote"], location: "Athens, Greece",
    boards: ["remotive", "psf", "ordino"], targets: [{ provider: "greenhouse", slug: "none", name: "None" }],
  },
  state: { schemaVersion: 6 },
};
const granted = new Set();
const messageListeners = [];
const pick = (keys) => {
  if (keys == null) return structuredClone(storage);
  const names = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
  return Object.fromEntries(names.filter((k) => k in storage).map((k) => [k, structuredClone(storage[k])]));
};
globalThis.chrome = {
  storage: { local: {
    get: async (keys) => pick(keys),
    set: async (patch) => { Object.assign(storage, structuredClone(patch)); },
    remove: async (key) => { delete storage[key]; },
  } },
  runtime: {
    getURL: (path) => new URL(`../extension/${path}`, import.meta.url).href,
    onMessage: { addListener: (listener) => messageListeners.push(listener) },
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
  },
  alarms: { create() {}, clear() {}, onAlarm: { addListener() {} } },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  notifications: { create() {} },
  tabs: { create() {} },
  permissions: { contains: async ({ origins }) => origins.every((origin) => granted.has(origin)) },
};

/* ── The network, from fixtures ────────────────────────────── */
const requests = [];
const json = (body) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const remotiveJob = (id, title, location) => ({
  id, company_name: "Taverna Thalassa", title, url: `https://remotive.com/jobs/${id}`,
  candidate_required_location: location, description: "<p>Serve our guests.</p>", publication_date: now,
});
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  requests.push({ url, body: options.body ? JSON.parse(options.body) : null });
  if (url.protocol === "file:") return new Response(readFileSync(fileURLToPath(url)));
  if (url.hostname === "open.er-api.com") return json({ result: "success", rates: { EUR: 1, USD: 1.1 } });
  if (url.hostname === "remotive.com") {
    return json({ jobs: [
      remotiveJob(1, "Waiter", "Worldwide"),
      remotiveJob(2, "Waiter", "USA Only"),          // remote, but not open to Greece
      remotiveJob(3, "Software Engineer", "Worldwide"),  // none of the user's titles
    ] });
  }
  if (url.hostname === "ec.europa.eu" && url.pathname.endsWith("/resource/occupation")) {
    return json({ preferredLabel: { en: "nurse responsible for general care", sv: "sjuksköterska, grundutbildad" } });
  }
  if (url.hostname === "jobsearch.api.jobtechdev.se") {
    return json({ hits: [{
      id: "31777351", headline: "Sjuksköterska", occupation: { label: "Sjuksköterska, grundutbildad" },
      employer: { name: "Västra Götalandsregionen" }, workplace_address: { municipality: "Mölndal" },
      publication_date: now, webpage_url: "https://arbetsformedlingen.se/platsbanken/annonser/31777351",
    }] });
  }
  if (url.hostname === "ec.europa.eu") {
    return json({ _embedded: { results: [{ title: "waiter/waitress", uri: WAITER }, { title: "sommelier", uri: "esco:x" }] } });
  }
  if (url.hostname === "europa.eu") {
    return json({ numberRecords: 1, jvs: [{
      id: "GR-1", title: "Σερβιτόρος", description: "", creationDate: Date.now(),
      locationMap: { GR: ["EL30"] }, jobCategoriesCodes: [WAITER], employer: { name: "Ταβέρνα" },
    }] });
  }
  return new Response("not found", { status: 404 });
};

await import("../extension/background.js");
const send = (message) => new Promise((resolve) => {
  const handled = messageListeners.some((listener) => listener(message, {}, resolve) === true);
  if (!handled) resolve(undefined);
});
const hits = (hostname) => requests.filter((r) => r.url.hostname === hostname);

test("an older profile gets the sources added since, once", async () => {
  await send({ type: "refreshBadge" });   // waits for the migration like every handler
  for (const board of ["eures", "jobfind", "xe", "jobtech", "nav", "overheid", "meesterbaan", "academictransfer"]) {
    assert.ok(storage.profile.boards.includes(board), board);
  }
  assert.equal(storage.state.schemaVersion, 10);
});

test("without the portals' permission, a scan leaves them and ESCO out", async () => {
  const result = await send({ type: "scan" });
  assert.equal(result.ok, true);
  assert.equal(hits("europa.eu").length + hits("ec.europa.eu").length + hits("www.xe.gr").length, 0);
  assert.ok(!result.sources.some((s) => ["eures", "jobfind", "xe"].includes(s.label)));
});

test("a scan keeps only jobs open to the user and matching their titles", async () => {
  const { matches } = await send({ type: "matches" });
  assert.deepEqual(matches.map((m) => `${m.title} | ${m.location}`), ["Waiter | Worldwide"]);
});

test("with permission, a scan asks ESCO once per title and EURES for the user's country", async () => {
  PORTALS.forEach((origin) => granted.add(origin));
  const result = await send({ type: "scan" });
  assert.equal(result.ok, true);
  assert.equal(hits("ec.europa.eu").length, 1);
  assert.deepEqual(storage.profile.titleOccupations, { Waiter: [WAITER] });
  const [eures] = hits("europa.eu");
  assert.deepEqual(eures.body.occupationUris, [WAITER]);
  assert.deepEqual(eures.body.locationCodes, ["gr"]);

  const { matches } = await send({ type: "matches" });
  assert.deepEqual(matches.map((m) => m.title).sort(), ["Waiter", "Σερβιτόρος"]);

  await send({ type: "scan" });   // the occupation is remembered, not looked up again
  assert.equal(hits("ec.europa.eu").length, 1);
});

test("a user in Sweden gets Platsbanken's jobs, searched in Swedish through ESCO", async () => {
  const NURSE = "http://data.europa.eu/esco/occupation/nurse";
  const saved = structuredClone(storage.profile);
  Object.assign(storage.profile, { titles: ["Nurse"], locations: ["Sweden"], titleOccupations: { Nurse: [NURSE] } });
  try {
    // Without Sweden's site allowed, Platsbanken is left out.
    await send({ type: "scan" });
    assert.equal(hits("jobsearch.api.jobtechdev.se").length, 0);

    granted.add("https://jobsearch.api.jobtechdev.se/*");
    const result = await send({ type: "scan" });
    assert.equal(result.ok, true);
    const [search] = hits("jobsearch.api.jobtechdev.se");
    assert.equal(search.url.searchParams.get("q"), "sjuksköterska");
    assert.deepEqual(storage.profile.occupationNames[NURSE].sv, ["sjuksköterska"], "the names are kept for the next scan");
    const { matches } = await send({ type: "matches" });
    assert.ok(matches.some((m) => m.title === "Sjuksköterska" && m.location === "Mölndal, Sweden"),
      JSON.stringify(matches.map((m) => `${m.title} | ${m.location}`)));
  } finally {
    granted.delete("https://jobsearch.api.jobtechdev.se/*");
    storage.profile = saved;
  }
});

test("the dashboard gets the best matches, and counts of all of them", async () => {
  const saved = storage.jobs;
  storage.jobs = Array.from({ length: 250 }, (_, n) => ({
    id: `many-${n}`, source: "remotive", company: `Taverna ${n}`, title: "Waiter", location: "Athens, Greece",
    description: "", url: `https://remotive.com/jobs/many-${n}`, postedAt: now, lastSeen: now,
    remote: n % 5 === 0, salaryMin: n % 10 === 0 ? 20000 : null, salaryMax: null, salaryCurrency: "EUR",
  }));
  try {
    const { matches, counts } = await send({ type: "matches" });
    assert.equal(matches.length, 200);
    assert.deepEqual(counts, { all: 250, remote: 50, today: 250, salary: 25 });
  } finally {
    storage.jobs = saved;
  }
});

/* ── The application form ──────────────────────────────────── */
const application = (id, url, company, status = "prepared") =>
  ({ id, jobId: id, url, company, title: "Waiter", status, coverLetter: `Dear ${company} hiring team,` });
const fillFor = (url, title = "") => send({ type: "prefill", url, title });

test("an application form gets the application it belongs to, not the latest one", async () => {
  storage.apps = [   // newest first, as the store keeps them
    application("latest", "https://jobs.lever.co/other/0a1b2c3d-4e5f-6789-abcd-ef0123456789", "Other Co"),
    application("lever", "https://jobs.lever.co/thalassa/8f3a2b1c-1234-4cde-9f00-123456789abc", "Thalassa"),
    application("greenhouse", "https://boards.greenhouse.io/kyma/jobs/4567890", "Kyma"),
  ];
  const lever = await fillFor("https://jobs.lever.co/thalassa/8f3a2b1c-1234-4cde-9f00-123456789abc/apply");
  assert.equal(lever.applicationId, "lever");
  assert.equal(lever.cover_letter, "Dear Thalassa hiring team,");
  assert.deepEqual(lever.job, { company: "Thalassa", title: "Waiter",
    url: "https://jobs.lever.co/thalassa/8f3a2b1c-1234-4cde-9f00-123456789abc" });
  // Greenhouse moves between hosts, and companies embed it with ?gh_jid=.
  assert.equal((await fillFor("https://job-boards.greenhouse.io/kyma/jobs/4567890?gh_src=abc")).applicationId, "greenhouse");
  assert.equal((await fillFor("https://kyma.example/careers?gh_jid=4567890")).applicationId, "greenhouse");
  // The company's own careers site, known by its name.
  assert.equal((await fillFor("https://careers.example/apply", "Thalassa | Careers")).applicationId, "lever");
});

test("a form no application matches gets the user's details but no cover letter", async () => {
  Object.assign(storage.profile, { name: "Maria Papadopoulou", email: "maria@example.test",
    linkedin: "https://www.linkedin.com/in/maria-example", github: "https://github.com/maria-example" });
  const data = await fillFor("https://elsewhere.example/careers/openings", "Join us");
  assert.equal(data.ok, true);
  assert.equal(data.applicationId, null);
  assert.equal(data.job, null);
  assert.equal(data.cover_letter, "");
  assert.ok(data.notice, "the user is told why the letter is missing");
  assert.equal(data.answers.first_name, "Maria");
  assert.equal(data.answers.email, "maria@example.test");
  // LinkedIn has its own field on every form; a website field gets the other link.
  assert.equal(data.answers.website, "https://github.com/maria-example");
});

test("with one application waiting to be sent, any form gets it", async () => {
  storage.apps = [
    application("waiting", "https://remotive.com/remote-jobs/hospitality/waiter-1234567", "Taverna"),
    application("done", "https://jobs.lever.co/old/11111111-2222-3333-4444-555555555555", "Old", "sent"),
  ];
  const data = await fillFor("https://apply.example/form/9");
  assert.equal(data.applicationId, "waiting");
  assert.equal(data.cover_letter, "Dear Taverna hiring team,");
});

test("the worker answers in the user's language, also before any scan", async () => {
  storage.profile.uiLanguage = "el";
  storage.apps = [];
  const data = await fillFor("https://apply.example/form/9");
  assert.equal(data.ok, false);
  assert.match(data.error, /^Δεν έχει ετοιμαστεί τίποτα/);
  const { texts } = await send({ type: "fillTexts" });
  assert.equal(texts.button, "🎯 Συμπλήρωση με Jobora");
  assert.match(texts.filled, /\{n\}/);
  const save = await send({ type: "saveTexts" });
  assert.equal(save.texts.button, "🎯 Αποθήκευση στο Jobora");
  assert.match(save.texts.contact, /\{email\}/);
});
