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
  for (const board of ["eures", "jobfind", "xe"]) assert.ok(storage.profile.boards.includes(board), board);
  assert.equal(storage.state.schemaVersion, 8);
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
