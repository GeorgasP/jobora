import assert from "node:assert/strict";
import test from "node:test";
import { BOARDS } from "../extension/lib/sources.js";
import { pickOccupations } from "../extension/lib/esco.js";
import { euresSearchFor } from "../extension/lib/scanplan.js";
import { scoreJob } from "../extension/lib/matcher.js";
import { DEFAULT_PROFILE } from "../extension/lib/store.js";

const NURSE = "http://data.europa.eu/esco/occupation/8d3e8aaa-791b-4c75-a465-f3f827028f50";
const WAITER = "http://data.europa.eu/esco/occupation/d5db9d5c-a3c8-4d93-b2e2-2b6bb4a49e8c";

// What ESCO answered for these titles, shortened.
const ESCO_ANSWERS = {
  "Registered Nurse": [
    { title: "healthcare assistant", uri: "esco:healthcare-assistant" },
    { title: "nurse responsible for general care", uri: NURSE },
    { title: "specialist nurse", uri: "esco:specialist-nurse" },
    { title: "nurse assistant", uri: "esco:nurse-assistant" },
  ],
  Waiter: [
    { title: "waiter/waitress", uri: WAITER },
    { title: "head waiter/head waitress", uri: "esco:head-waiter" },
    { title: "sommelier", uri: "esco:sommelier" },
    { title: "cocktail bartender", uri: "esco:cocktail-bartender" },
  ],
  Physiotherapist: [
    { title: "physiotherapist", uri: "esco:physiotherapist" },
    { title: "animal physiotherapist", uri: "esco:animal-physiotherapist" },
    { title: "physiotherapy assistant", uri: "esco:physiotherapy-assistant" },
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
