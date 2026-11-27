// A country's own job sources: which a user gets, how their ads are
// recognised as the user's occupation, and each source against recorded
// answers: Sweden's JobTech, Norway's NAV, and the Dutch sites.
import assert from "node:assert/strict";
import test from "node:test";
import { occupationNames } from "../extension/lib/esco.js";
import { NATIONAL_PORTALS, portalOriginsFor } from "../extension/lib/portals.js";
import { countriesOf, nationalLanguages, nationalSearchFor, needsNationalPortals } from "../extension/lib/scanplan.js";
import { BOARDS, namesOccupation } from "../extension/lib/sources.js";

const NURSE = "http://data.europa.eu/esco/occupation/8d3e8aaa-791b-4c75-a465-f3f827028f50";
const TEACHER = "http://data.europa.eu/esco/occupation/5efb2c08-ba3a-4659-a2e4-1883f54e77b6";
const DRIVER = "http://data.europa.eu/esco/occupation/lorry-driver";
const profile = (patch) => ({
  titles: ["Nurse"], titleOccupations: { Nurse: [NURSE] },
  occupationNames: { [NURSE]: { en: ["nurse responsible for general care"], sv: ["sjuksköterska"], no: ["sykepleier"] } },
  locations: [], location: "", ...patch,
});

/* ── Which sources a user gets ────────────────────────────── */

test("a user gets the sources of the countries they named, or live in when they chose Remote", () => {
  assert.deepEqual(countriesOf(profile({ locations: ["Sweden", "Remote"], location: "Bergen, Norway" })).sort(),
    ["norway", "sweden"]);
  assert.deepEqual(countriesOf(profile({ locations: ["Göteborg"] })), ["sweden"]);
  assert.deepEqual(nationalSearchFor(profile({ locations: ["Sweden"] })),
    { sweden: [{ occupation: NURSE, names: ["sjuksköterska", "nurse responsible for general care"] }] });
  assert.deepEqual(nationalSearchFor(profile({ locations: ["Remote"], location: "Oslo, Norway" })),
    { norway: [{ occupation: NURSE, names: ["sykepleier", "nurse responsible for general care"] }] });
  assert.deepEqual(nationalSearchFor(profile({ locations: ["Greece"] })), {});
  assert.deepEqual(nationalLanguages(profile({ locations: ["Amsterdam", "Sweden"] })).sort(), ["en", "nl", "sv"]);
});

test("an occupation is searched in English when ESCO has no name in the country's language, and skipped without any", () => {
  const plan = nationalSearchFor(profile({
    locations: ["Sweden"], titleOccupations: { Nurse: [NURSE], Driver: [DRIVER], Other: ["esco:none"] },
    occupationNames: { [NURSE]: { sv: "sjuksköterska" }, [DRIVER]: { en: ["lorry driver"], sv: [] } },
  }));
  // A name kept as a plain string, as before names became lists, still counts.
  assert.deepEqual(plan, { sweden: [
    { occupation: NURSE, names: ["sjuksköterska"] },
    { occupation: DRIVER, names: ["lorry driver"] },
  ] });
});

test("a source runs only when its board is allowed", () => {
  const swede = profile({ locations: ["Sweden"] });
  assert.equal(needsNationalPortals(swede, ["eures", "jobtech"]), true);
  assert.equal(needsNationalPortals(swede, ["eures"]), false);
  assert.equal(needsNationalPortals(profile({ locations: ["Greece"] }), ["jobtech", "nav"]), false);
  assert.equal(needsNationalPortals(profile({ locations: ["Utrecht"] }), ["meesterbaan"]), true);
});

test("a user is asked only for the sites of their own countries' sources", () => {
  const greek = portalOriginsFor(["greece"]);
  assert.ok(greek.includes("https://europa.eu/*") && greek.includes("https://www.xe.gr/*"));
  for (const { origins } of NATIONAL_PORTALS) {
    for (const origin of origins) assert.ok(!greek.includes(origin), origin);
  }
  const dutch = portalOriginsFor(["netherlands"]);
  for (const site of ["https://www.werkenbijdeoverheid.nl/*", "https://www.meesterbaan.nl/*", "https://www.academictransfer.com/*"]) {
    assert.ok(dutch.includes(site), site);
  }
  assert.ok(!dutch.includes("https://jobsearch.api.jobtechdev.se/*"));
});

/* ── Recognising the occupation in an ad's title ─────────── */

test("an ad names the occupation, compounds and plurals included", () => {
  assert.equal(namesOccupation("Specialistsjuksköterska till IVA", "sjuksköterska"), true);
  assert.equal(namesOccupation("Röntgen-, operations- och sjuksköterskor", "sjuksköterska"), true);
  assert.equal(namesOccupation("Intensivsykepleier, 100 % stilling", "sykepleier"), true);
  // A plain "sjåfør" may be the lorry driver the user wants.
  assert.equal(namesOccupation("Sjåfør og montør", "lastebilsjåfør"), true);
  // An assistant nurse is another job.
  assert.equal(namesOccupation("Undersköterska till hemtjänsten", "sjuksköterska"), false);
  assert.equal(namesOccupation("Kokk søkes", "kokk"), true);
  assert.equal(namesOccupation("Software ontwikkelaar Java", "softwareontwikkelaar"), true);
  assert.equal(namesOccupation("Verpleegkundig specialist GGZ", "verpleegkundige"), true);
});

test("a Dutch title is recognised by the role its name starts with, but not by a word for any employee", () => {
  const teacher = ["leerkracht voortgezet onderwijs", "docent secundair onderwijs", "leraar secundair onderwijs"];
  assert.equal(namesOccupation("Docent wiskunde", teacher), true);
  assert.equal(namesOccupation("Leraar bewegingsonderwijs (0,4 fte)", teacher), true);
  assert.equal(namesOccupation("Adviseur onderwijs", teacher), false);
  assert.equal(namesOccupation("Medewerker financiële administratie", ["medewerker klantenservice"]), false);
  assert.equal(namesOccupation("Medewerker klantenservice", ["medewerker klantenservice"]), true);
  // A nurse manager is not every team leader or assistant.
  const nurseManager = ["leidinggevend verpleegkundige", "teamleider verpleegkunde", "assistent verpleegkundige"];
  assert.equal(namesOccupation("Teamleider beveiliging", nurseManager), false);
  assert.equal(namesOccupation("Managementassistent bestuursbureau", nurseManager), false);
  assert.equal(namesOccupation("Teamleider verpleegkunde, afdeling chirurgie", nurseManager), true);
});

test("a name inside a longer word is not that word: a programme is not a programmer", () => {
  const developer = ["softwareontwikkelaar", "software developer", "programmer"];
  assert.equal(namesOccupation("Programmamanager Onderwijshuisvesting", developer), false);
  assert.equal(namesOccupation("Managementondersteuner Nationaal Programma Leefbaarheid", developer), false);
  assert.equal(namesOccupation("Senior Software Developer", developer), true);
  assert.equal(namesOccupation("Ontwikkelaar Java", developer), true);       // the head of "softwareontwikkelaar"
});

/* ── The sources, against recorded answers ───────────────── */

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
  }, () => BOARDS.jobtech("", { national: { sweden: [{ occupation: NURSE, names: ["sjuksköterska", "nurse"] }] } }));

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
  }, () => BOARDS.nav("", { national: { norway: [{ occupation: NURSE, names: ["sykepleier"] }] } }));

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
  () => BOARDS.nav("", { national: { norway: [{ occupation: NURSE, names: ["sykepleier"] }] } }));
  assert.deepEqual(jobs, []);
});

/* ── The Netherlands ──────────────────────────────────────── */

const TODAY = new Date().toISOString();
const sitemap = (urls) => `<?xml version="1.0" encoding="UTF-8"?><urlset>${urls.map(([loc, lastmod = TODAY]) =>
  `<url><loc>${loc}</loc><lastmod>${lastmod}</lastmod></url>`).join("")}</urlset>`;
const page = (head, body = "") => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
// ESCO's Dutch names for a secondary school teacher, as its API gives them.
const TEACHER_NAMES = { occupation: TEACHER,
  names: ["leerkracht voortgezet onderwijs", "leraar secundair onderwijs", "docent secundair onderwijs"] };
const NURSE_NAMES = { occupation: NURSE, names: ["verpleegkundige", "nurse responsible for general care"] };

/** Runs a Dutch board against recorded pages; returns its jobs and the addresses it read. */
async function dutchBoard(board, pages, terms) {
  const read = [];
  const jobs = await withFetch(async (url) => {
    read.push(String(url));
    return pages[url] ? new Response(pages[url]) : new Response("not found", { status: 404 });
  }, () => BOARDS[board]("", { national: { netherlands: terms }, maxAgeDays: 60 }));
  return { jobs, read };
}

test("Werken bij de Overheid: ads are found in the sitemap by title, and only theirs are read", async () => {
  const base = "https://www.werkenbijdeoverheid.nl/vacatures/";
  const { jobs, read } = await dutchBoard("overheid", {
    "https://www.werkenbijdeoverheid.nl/sitemap-vacatures.xml": sitemap([
      [`${base}verpleegkundige-penitentiaire-inrichting-DJI-2026-5097`],
      [`${base}magazijnmedewerker-DJI-2026-3049`],
      [`${base}verpleegkundige-oud-DJI-2023-1018`, "2023-01-05T10:00:00Z"],        // older than the user looks back
    ]),
    [`${base}verpleegkundige-penitentiaire-inrichting-DJI-2026-5097`]: page(
      '<meta property="og:title" content="Verpleegkundige penitentiaire inrichting &#8226; Dienst Justitiële Inrichtingen | Werken bij de Overheid">'),
  }, [NURSE_NAMES]);
  assert.deepEqual(jobs.map((j) => `${j.title} | ${j.company} | ${j.location}`),
    ["Verpleegkundige penitentiaire inrichting | Dienst Justitiële Inrichtingen | Netherlands"]);
  assert.equal(jobs[0].source, "overheid");
  assert.equal(jobs[0].country, "netherlands");
  assert.deepEqual(jobs[0].occupations, [NURSE]);
  assert.equal(read.length, 2, "the sitemap and the one matching ad");
});

test("Meesterbaan: a teacher's ads come with the school and the town", async () => {
  const ad = "https://www.meesterbaan.nl/vacature/372441/leraar-bewegingsonderwijs-04-fte";
  const { jobs } = await dutchBoard("meesterbaan", {
    "https://www.meesterbaan.nl/SitemapVacatures.xml": sitemap([[ad], ["https://www.meesterbaan.nl/vacature/372450/conciërge"]]),
    [ad]: page('<meta content="Vacature Leraar bewegingsonderwijs (0,4 fte) - Meza College - Ede" property="og:title">'),
  }, [TEACHER_NAMES]);
  assert.deepEqual(jobs.map((j) => `${j.title} | ${j.company} | ${j.location}`),
    ["Leraar bewegingsonderwijs (0,4 fte) | Meza College | Ede, Netherlands"]);
});

test("AcademicTransfer: the English page of an ad is read, with its JobPosting's place and salary", async () => {
  const english = "https://www.academictransfer.com/en/jobs/361517/nurse-researcher/";
  const posting = {
    "@context": "https://schema.org", "@type": "WebPage", mainEntity: {
      "@type": "JobPosting", title: "Nurse researcher", datePosted: "2026-11-20",
      hiringOrganization: { "@type": "Organization", name: "Erasmus MC" },
      jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Rotterdam" } },
      baseSalary: { "@type": "MonetaryAmount", currency: "EUR", value: { "@type": "QuantitativeValue", minValue: 3381, maxValue: 4560, unitText: "MONTH" } },
      description: "<p>Research on nursing care.</p>",
    },
  };
  const { jobs, read } = await dutchBoard("academictransfer", {
    "https://www.academictransfer.com/sitemap-vacancies.xml": sitemap([
      ["https://www.academictransfer.com/nl/jobs/361517/onderzoeker-verpleegkunde/"], [english]]),
    [english]: page(`<script type="application/ld+json">${JSON.stringify(posting)}</script>`),
  }, [NURSE_NAMES, { occupation: "esco:researcher", names: ["nurse researcher", "onderzoeker"] }]);
  assert.deepEqual(jobs.map((j) => `${j.title} | ${j.company} | ${j.location}`), ["Nurse researcher | Erasmus MC | Rotterdam, Netherlands"]);
  assert.deepEqual([jobs[0].salaryMin, jobs[0].salaryMax, jobs[0].salaryCurrency, jobs[0].salaryPeriod], [3381, 4560, "EUR", "month"]);
  assert.equal(jobs[0].postedAt, new Date("2026-11-20").toISOString());
  assert.ok(!read.some((url) => url.includes("/nl/jobs/")), "one page per ad, the English one");
});

test("AcademicTransfer: an institute abroad keeps its own country", async () => {
  const ad = "https://www.academictransfer.com/en/jobs/361900/nurse-scientist/";
  const posting = { "@type": "JobPosting", title: "Nurse scientist", hiringOrganization: { name: "IWH" },
    jobLocation: { address: { addressLocality: "Halle an der Saale", addressCountry: "DE" } } };
  const { jobs } = await dutchBoard("academictransfer", {
    "https://www.academictransfer.com/sitemap-vacancies.xml": sitemap([[ad]]),
    [ad]: page(`<script type="application/ld+json">${JSON.stringify(posting)}</script>`),
  }, [{ occupation: "esco:scientist", names: ["nurse scientist"] }]);
  assert.deepEqual(jobs.map((j) => `${j.location} | ${j.country}`), ["Halle an der Saale, Germany | germany"]);
});

test("a Dutch site that cannot be read leaves the sitemap's title", async () => {
  const ad = "https://www.werkenbijdeoverheid.nl/vacatures/verpleegkundige-DJI-2026-0001";
  const { jobs } = await dutchBoard("overheid", {
    "https://www.werkenbijdeoverheid.nl/sitemap-vacatures.xml": sitemap([[ad]]),
  }, [NURSE_NAMES]);
  assert.deepEqual(jobs.map((j) => `${j.title} | ${j.location}`), ["Verpleegkundige | Netherlands"]);
});

test("ESCO names an occupation in the asked languages, preferred first, without qualifiers", async () => {
  let asked;
  const names = await occupationNames(NURSE, async (url) => {
    asked = new URL(url);
    return {
      preferredLabel: { en: "nurse responsible for general care", sv: "sjuksköterska, grundutbildad", nl: "verpleegkundige", de: "Pflegefachkraft" },
      alternativeLabel: { nl: ["verpleegkundige algemene zorg", "verpleegkundige"], sv: [] },
    };
  }, ["sv", "nl", "en", "fi"]);
  assert.equal(asked.searchParams.get("uri"), NURSE);
  assert.deepEqual(names, {
    sv: ["sjuksköterska"], nl: ["verpleegkundige", "verpleegkundige algemene zorg"],
    en: ["nurse responsible for general care"], fi: [],
  });
});
