import assert from "node:assert/strict";
import test from "node:test";
import { BOARDS } from "../extension/lib/sources.js";
import { pickOccupations } from "../extension/lib/esco.js";
import { euresSearchFor } from "../extension/lib/scanplan.js";
import { scoreJob } from "../extension/lib/matcher.js";
import { DEFAULT_PROFILE } from "../extension/lib/store.js";

const NURSE = "http://data.europa.eu/esco/occupation/8d3e8aaa-791b-4c75-a465-f3f827028f50";
const WAITER = "http://data.europa.eu/esco/occupation/d5db9d5c-a3c8-4d93-b2e2-2b6bb4a49e8c";

// What ESCO answered for these titles (2026-11-27), shortened. searchHit is
// one of the occupation's names that matched, or a sentence of its description.
const ESCO_ANSWERS = {
  "Registered Nurse": [
    { title: "healthcare assistant", searchHit: "Healthcare assistants work together in a team with registered nurses", uri: "esco:healthcare-assistant" },
    { title: "nurse responsible for general care", searchHit: "healthcare nurse", uri: NURSE },
    { title: "specialist nurse", searchHit: "vascular nurse", uri: "esco:specialist-nurse" },
    { title: "nurse assistant", searchHit: "nursing assistant", uri: "esco:nurse-assistant" },
    { title: "veterinary nurse", searchHit: "veterinary nursing specialist", uri: "esco:veterinary-nurse" },
  ],
  Waiter: [
    { title: "waiter/waitress", searchHit: "waiter", uri: WAITER },
    { title: "head waiter/head waitress", searchHit: "chief waiter", uri: "esco:head-waiter" },
    { title: "sommelier", searchHit: "wine waiter", uri: "esco:sommelier" },
    { title: "cocktail bartender", searchHit: "mixology waiter", uri: "esco:cocktail-bartender" },
  ],
  Physiotherapist: [
    // The matched name says "manager"; the occupation is the physiotherapist.
    { title: "physiotherapist", searchHit: "physiotherapist manager", uri: "esco:physiotherapist" },
    { title: "animal physiotherapist", searchHit: "veterinary physiotherapist", uri: "esco:animal-physiotherapist" },
    { title: "physiotherapy assistant", searchHit: "physiotherapist assistant", uri: "esco:physiotherapy-assistant" },
  ],
  Teacher: [
    { title: "politics lecturer", searchHit: "higher education politics teacher", uri: "esco:politics-lecturer" },
    { title: "secondary school teacher", searchHit: "history teacher", uri: "esco:secondary-teacher" },
    { title: "religious education teacher secondary school", searchHit: "RE teacher", uri: "esco:re-teacher" },
    { title: "mathematics teacher secondary school", searchHit: "teacher of maths in high school", uri: "esco:maths-teacher" },
    { title: "swimming teacher", searchHit: "baby swimming teacher", uri: "esco:swimming-teacher" },
  ],
  // With searchHit, the name ESCO matched: "software developer" is ESCO's
  // occupation for software engineers, and says so.
  "Software Engineer": [
    { title: "software developer", searchHit: "software engineer", uri: "esco:software-developer" },
    { title: "ICT application developer", searchHit: "application software engineer", uri: "esco:ict-application-developer" },
    { title: "satellite engineer", searchHit: "satellite software engineer", uri: "esco:satellite-engineer" },
    { title: "ICT usability tester", searchHit: "ICT usability testers ensure compliance with requirements and strive for optimal usability within the software engineering cycle phases", uri: "esco:usability-tester" },
    { title: "quality engineer", searchHit: "software quality assurance engineer", uri: "esco:quality-engineer" },
    { title: "mechatronics engineer", searchHit: "Mechatronics engineers design and develop intelligent systems, such as robotic devices", uri: "esco:mechatronics-engineer" },
  ],
};

/** Replaces fetch for one test and records every request. */
async function withFakeFetch(answer, run) {
  const requests = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, body: options.body ? JSON.parse(options.body) : null });
    return { ok: true, json: async () => answer };
  };
  try {
    return await run(requests);
  } finally {
    globalThis.fetch = realFetch;
  }
}

const nurseVacancy = {
  id: "NjExMmUz/OGQ=", title: "Verpleegkundigen - Tilburg", description: "<p>Zorg</p>",
  creationDate: 1795576410251, locationMap: { NL: ["NL415"] }, jobCategoriesCodes: [NURSE],
  employer: { name: "Uitzendbureau Worq.nl B.V." }, translations: { nl: { title: "Verpleegkundigen - Tilburg" } },
};

test("an ESCO occupation counts only when it is the job the user typed", () => {
  assert.deepEqual(pickOccupations("Registered Nurse", ESCO_ANSWERS["Registered Nurse"]),
    [NURSE, "esco:specialist-nurse"]);
  assert.deepEqual(pickOccupations("Waiter", ESCO_ANSWERS.Waiter), [WAITER, "esco:head-waiter"]);
  assert.deepEqual(pickOccupations("Physiotherapist", ESCO_ANSWERS.Physiotherapist), ["esco:physiotherapist"]);
  assert.deepEqual(pickOccupations("", ESCO_ANSWERS.Waiter), []);
});

test("the occupation ESCO matched by the exact title comes first, with one close relative", () => {
  // It used to be satellite, quality and mechatronics engineers: every
  // occupation named "… engineer", while software developer was dropped.
  assert.deepEqual(pickOccupations("Software Engineer", ESCO_ANSWERS["Software Engineer"]),
    ["esco:software-developer", "esco:ict-application-developer"]);
});

test("for a bare title, the occupation named with the fewest extra words comes first", () => {
  const picked = pickOccupations("Teacher", ESCO_ANSWERS.Teacher);
  assert.equal(picked[0], "esco:secondary-teacher");
  assert.ok(!picked.slice(0, 2).includes("esco:politics-lecturer"), picked.join(", "));
});

test("EURES is searched by occupation, one country at a time", async () => {
  await withFakeFetch({ numberRecords: 1, jvs: [nurseVacancy] }, async (requests) => {
    await BOARDS.eures("", { eures: { occupations: [NURSE], countries: ["nl", "be"] } });
    assert.deepEqual(requests.map((r) => r.body.locationCodes), [["nl"], ["be"]]);
    for (const { body } of requests) {
      assert.deepEqual(body.occupationUris, [NURSE]);
      assert.deepEqual(body.keywords, []);
      assert.equal(body.resultsPerPage, 50);
    }
  });
});

test("a EURES vacancy becomes a job with its country and occupation", async () => {
  await withFakeFetch({ numberRecords: 1, jvs: [nurseVacancy] }, async () => {
    const [job] = await BOARDS.eures("", { eures: { occupations: [NURSE], countries: ["nl"] } });
    assert.equal(job.title, "Verpleegkundigen - Tilburg");
    assert.equal(job.company, "Uitzendbureau Worq.nl B.V.");
    assert.equal(job.location, "Netherlands");
    assert.equal(job.country, "netherlands");
    assert.deepEqual(job.occupations, [NURSE]);
    assert.equal(job.description, "Zorg");
    assert.equal(job.postedAt, new Date(1795576410251).toISOString());
    assert.equal(job.url, "https://europa.eu/eures/portal/jv-se/jv-details/NjExMmUz%2FOGQ%3D?jvDisplayLanguage=en");
  });
});

test("a EURES vacancy is shown in English when EURES has a translation", async () => {
  const translated = { ...nurseVacancy, translations: { en: { title: "Nurses - Tilburg", description: "Care" } } };
  await withFakeFetch({ numberRecords: 1, jvs: [translated] }, async () => {
    const [job] = await BOARDS.eures("", { eures: { occupations: [NURSE], countries: ["nl"] } });
    assert.equal(job.title, "Nurses - Tilburg");
    assert.equal(job.description, "Care");
  });
});

test("without occupations EURES is not asked at all", async () => {
  await withFakeFetch({ jvs: [nurseVacancy] }, async (requests) => {
    assert.deepEqual(await BOARDS.eures("", {}), []);
    assert.equal(requests.length, 0);
  });
});

test("the EURES search follows where the user wants to work", () => {
  const titleOccupations = { "Registered Nurse": [NURSE] };
  assert.deepEqual(euresSearchFor({ titleOccupations, locations: ["Germany", "Switzerland"] }),
    { occupations: [NURSE], countries: ["de", "ch"] });
  assert.deepEqual(euresSearchFor({ titleOccupations, locations: ["EU"] }).countries, []);
  // "Remote" alone says nothing about a country, so the user's address decides.
  assert.deepEqual(
    euresSearchFor({ titleOccupations, locations: ["Remote"], location: "Limassol, Cyprus" }).countries, ["cy"]);
  // Nothing to ask EURES outside Europe, or for titles without an occupation.
  assert.equal(euresSearchFor({ titleOccupations, locations: ["USA"] }), null);
  assert.equal(euresSearchFor({ titleOccupations: { "Software Engineer": [] }, locations: ["Germany"] }), null);
});

test("a job ad in another language matches through its ESCO occupation", () => {
  const profile = {
    ...DEFAULT_PROFILE, titles: ["Registered Nurse"], locations: ["Netherlands"],
    titleOccupations: { "Registered Nurse": [NURSE] },
  };
  const job = {
    id: "eures:1", title: "Verpleegkundigen - Tilburg", location: "Netherlands", country: "netherlands",
    description: "", postedAt: new Date().toISOString(), occupations: [NURSE],
  };
  const matched = scoreJob(job, profile);
  assert.equal(matched.rejected, null);
  assert.ok(matched.score >= profile.minScore, `score ${matched.score}`);
  assert.ok(scoreJob({ ...job, occupations: [] }, profile).score < profile.minScore);
});
