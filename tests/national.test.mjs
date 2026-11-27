// National employment services: which countries' services a user gets, how
// their ads are recognised as the user's occupation, and the two services
// read so far (Sweden's JobTech and Norway's NAV), against recorded answers.
import assert from "node:assert/strict";
import test from "node:test";
import { occupationNames } from "../extension/lib/esco.js";
import { NATIONAL_PORTALS, portalOriginsFor } from "../extension/lib/portals.js";
import { countriesOf, nationalSearchFor, needsNationalPortals } from "../extension/lib/scanplan.js";
import { BOARDS, namesOccupation } from "../extension/lib/sources.js";

const NURSE = "http://data.europa.eu/esco/occupation/8d3e8aaa-791b-4c75-a465-f3f827028f50";
const DRIVER = "http://data.europa.eu/esco/occupation/lorry-driver";
const profile = (patch) => ({
  titles: ["Nurse"], titleOccupations: { Nurse: [NURSE] },
  occupationNames: { [NURSE]: { en: "nurse", sv: "sjuksköterska", no: "sykepleier" } },
  locations: [], location: "", ...patch,
});

/* ── Which services a user gets ───────────────────────────── */

test("a user gets the services of the countries they named, or live in when they chose Remote", () => {
  assert.deepEqual(countriesOf(profile({ locations: ["Sweden", "Remote"], location: "Bergen, Norway" })).sort(),
    ["norway", "sweden"]);
  assert.deepEqual(countriesOf(profile({ locations: ["Göteborg"] })), ["sweden"]);
  assert.deepEqual(nationalSearchFor(profile({ locations: ["Sweden"] })),
    { sweden: [{ occupation: NURSE, name: "sjuksköterska" }] });
  assert.deepEqual(nationalSearchFor(profile({ locations: ["Remote"], location: "Oslo, Norway" })),
    { norway: [{ occupation: NURSE, name: "sykepleier" }] });
  assert.deepEqual(nationalSearchFor(profile({ locations: ["Greece"] })), {});
});

test("an occupation ESCO has no name for in the country's language is left out", () => {
  const plan = nationalSearchFor(profile({
    locations: ["Sweden"], titleOccupations: { Nurse: [NURSE], Driver: [DRIVER] },
    occupationNames: { [NURSE]: { sv: "sjuksköterska" }, [DRIVER]: { en: "lorry driver" } },
  }));
  assert.deepEqual(plan, { sweden: [{ occupation: NURSE, name: "sjuksköterska" }] });
});

test("a service runs only when its board is allowed", () => {
  const swede = profile({ locations: ["Sweden"] });
  assert.equal(needsNationalPortals(swede, ["eures", "jobtech"]), true);
  assert.equal(needsNationalPortals(swede, ["eures"]), false);
  assert.equal(needsNationalPortals(profile({ locations: ["Greece"] }), ["jobtech", "nav"]), false);
});

test("a user is asked only for the sites of their own countries' services", () => {
  const greek = portalOriginsFor(["greece"]);
  assert.ok(greek.includes("https://europa.eu/*") && greek.includes("https://www.xe.gr/*"));
  for (const { origins } of Object.values(NATIONAL_PORTALS)) {
    for (const origin of origins) assert.ok(!greek.includes(origin), origin);
  }
  const swede = portalOriginsFor(["sweden"]);
  assert.ok(swede.includes("https://jobsearch.api.jobtechdev.se/*"));
  assert.ok(!swede.includes("https://pam-stilling-feed.nav.no/*"));
});

/* ── Recognising the occupation in an ad's title ─────────── */

test("an ad names the occupation, compounds included", () => {
  assert.equal(namesOccupation("Specialistsjuksköterska till IVA", "sjuksköterska"), true);
  assert.equal(namesOccupation("Intensivsykepleier, 100 % stilling", "sykepleier"), true);
  // A plain "sjåfør" may be the lorry driver the user wants.
  assert.equal(namesOccupation("Sjåfør og montør", "lastebilsjåfør"), true);
  // An assistant nurse is another job.
  assert.equal(namesOccupation("Undersköterska till hemtjänsten", "sjuksköterska"), false);
  assert.equal(namesOccupation("Kokk søkes", "kokk"), true);
});

/* ── The services, against recorded answers ───────────────── */

const withFetch = async (handler, run) => {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try { return await run(); } finally { globalThis.fetch = original; }
};
const json = (body, status = 200) => new Response(status === 304 ? null : JSON.stringify(body), { status });

test("Sweden: Platsbanken is searched in Swedish, and only ads for the occupation are kept", async () => {
  const searches = [];
  const ad = (id, headline, occupation, municipality) => ({
    id, headline, occupation: { label: occupation }, employer: { name: "Västra Götalandsregionen" },
    workplace_address: { municipality }, publication_date: "2026-11-25T13:26:22",
    webpage_url: `https://arbetsformedlingen.se/platsbanken/annonser/${id}`, description: { text: "Välkommen till oss." },
  });
  const jobs = await withFetch(async (url) => {
    searches.push(new URL(url));
    return json({ total: { value: 3 }, hits: [
      ad("1", "Sjuksköterska", "Sjuksköterska, grundutbildad", "Mölndal"),
      ad("2", "Specialistsjuksköterska till IVA", "Specialistsjuksköterska, intensivvård", "Lund"),
      ad("3", "Undersköterska", "Undersköterska, hemtjänst", "Lomma"),     // mentions nurses in its text only
    ] });
  }, () => BOARDS.jobtech("", { national: { sweden: [{ occupation: NURSE, name: "sjuksköterska" }] } }));

  assert.equal(searches.length, 1);
  assert.equal(searches[0].hostname, "jobsearch.api.jobtechdev.se");
  assert.equal(searches[0].searchParams.get("q"), "sjuksköterska");
  assert.deepEqual(jobs.map((j) => `${j.title} | ${j.location}`),
    ["Sjuksköterska | Mölndal, Sweden", "Specialistsjuksköterska till IVA | Lund, Sweden"]);
  assert.deepEqual(jobs[0].occupations, [NURSE]);
  assert.equal(jobs[0].country, "sweden");
  assert.equal(jobs[0].url, "https://arbetsformedlingen.se/platsbanken/annonser/1");
});

test("Sweden: nothing to search, nothing asked", async () => {
  let asked = false;
  const jobs = await withFetch(async () => { asked = true; return json({}); }, () => BOARDS.jobtech("", {}));
  assert.deepEqual(jobs, []);
  assert.equal(asked, false);
});

test("Norway: the feed's recent changes are read with NAV's public token, keeping active ads for the occupation", async () => {
  const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwdWJsaWMifQ.c2lnbmF0dXJl";
  const requests = [];
  const entry = (uuid, title, status, sistEndret = "2026-11-26T10:00:00+01:00") =>
    ({ id: uuid, _feed_entry: { uuid, title, status, businessName: "OSLO UNIVERSITETSSYKEHUS HF", municipal: "OSLO", sistEndret } });
  const pages = {
    "/api/v1/feed": { items: [entry("a", "Sykepleier", "ACTIVE"), entry("b", "Intensivsykepleier", "ACTIVE"),
      entry("c", "Lagermedarbeider", "ACTIVE")], next_url: "/api/v1/feed/page-2" },
    // A later page holds a newer state of ad b: it was filled.
    "/api/v1/feed/page-2": { items: [entry("b", "Intensivsykepleier", "INACTIVE")], next_url: "/api/v1/feed/page-3" },
    "/api/v1/feed/page-3": { items: [], next_url: "/api/v1/feed/page-3" },
  };
  const jobs = await withFetch(async (url, options = {}) => {
    const { pathname } = new URL(url);
    requests.push({ pathname, headers: options.headers || {} });
    if (pathname === "/api/publicToken") return new Response(`Current public token for Nav Job Vacancy Feed:\n${TOKEN}\n`);
    return json(pages[pathname]);
  }, () => BOARDS.nav("", { national: { norway: [{ occupation: NURSE, name: "sykepleier" }] } }));

  assert.deepEqual(jobs.map((j) => `${j.title} | ${j.company} | ${j.location}`),
    ["Sykepleier | Oslo Universitetssykehus Hf | Oslo, Norway"]);
  assert.equal(jobs[0].url, "https://arbeidsplassen.nav.no/stillinger/stilling/a");
  assert.deepEqual(jobs[0].occupations, [NURSE]);
  const feed = requests.filter((r) => r.pathname.startsWith("/api/v1/feed"));
  assert.equal(feed[0].headers.authorization, `Bearer ${TOKEN}`);
  assert.ok(feed[0].headers["if-modified-since"], "the first page starts at a date");
  assert.ok(!feed[1].headers["if-modified-since"], "the pages after it follow from there");
});

test("Norway: no changes since then is an empty answer, not an error", async () => {
  const jobs = await withFetch(async (url) => (new URL(url).pathname === "/api/publicToken"
    ? new Response("token:\naaa.bbb.ccc") : json(null, 304)),
  () => BOARDS.nav("", { national: { norway: [{ occupation: NURSE, name: "sykepleier" }] } }));
  assert.deepEqual(jobs, []);
});

test("ESCO names an occupation in every language, without qualifiers", async () => {
  let asked;
  const names = await occupationNames(NURSE, async (url) => {
    asked = new URL(url);
    return { preferredLabel: { en: "nurse responsible for general care", sv: "sjuksköterska, grundutbildad",
      no: "sykepleier", de: "Pflegefachkraft (allgemeine Pflege)" } };
  });
  assert.equal(asked.searchParams.get("uri"), NURSE);
  assert.deepEqual(names, { en: "nurse responsible for general care", sv: "sjuksköterska", no: "sykepleier",
    de: "Pflegefachkraft" });
});
