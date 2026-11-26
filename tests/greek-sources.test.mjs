import assert from "node:assert/strict";
import test from "node:test";
import { BOARDS } from "../extension/lib/sources.js";
import { scoreJob } from "../extension/lib/matcher.js";
import { DEFAULT_PROFILE } from "../extension/lib/store.js";

/** Replaces fetch for one test with a fixed text answer. */
async function withFakeFetch(text, run) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, text: async () => text });
  try {
    return await run();
  } finally {
    globalThis.fetch = realFetch;
  }
}

const today = new Date().toISOString();

const JOBFIND_RSS = `<?xml version="1.0"?><rss><channel>
<item><title>Αποθηκάριος - Οδηγός (Βοτανικός) - ΑΘΗΝΑ - ΑΤΤΙΚΗ</title>
<link>https://www.jobfind.gr/JobAd/View/GR/Theseis_Ergasias/24E8F706-7F0C</link>
<description><![CDATA[ Η&nbsp;TECH C.G. αναζητά <b>Αποθηκάριο</b> ]]></description>
<region><![CDATA[ΑΘΗΝΑ - ΑΤΤΙΚΗ]]></region>
<guid>https://www.jobfind.gr/JobAd/View/GR/Theseis_Ergasias/24E8F706-7F0C</guid>
<pubDate>Thu, 26 Nov 2026 23:12:58 GMT</pubDate></item>
<item><title>Πωλήτρια σε κατάστημα ένδυσης - ΘΕΣΣΑΛΟΝΙΚΗ</title>
<link>https://www.jobfind.gr/JobAd/View/GR/Theseis_Ergasias/72E6FBDB-A272</link>
<description><![CDATA[ Ζητείται πωλήτρια ]]></description><region><![CDATA[ΘΕΣΣΑΛΟΝΙΚΗ]]></region>
<pubDate>Thu, 26 Nov 2026 20:00:00 GMT</pubDate></item>
</channel></rss>`;

const xeUrl = (category, slug, id) =>
  `https://www.xe.gr/${encodeURIComponent("εργασία")}/${encodeURIComponent("θέση-εργασίας")}/` +
  `${encodeURIComponent(category)}/${encodeURIComponent(slug)}-${id}`;
const XE_SITEMAP = `<?xml version="1.0"?><urlset>
<url><loc>${xeUrl("σερβιτόροι", "σερβιτοροσ--καφε-μπαρ-ο-γιαννησ--αθήνα-ψυρρή", "576c58f6-5aa2-45e1-891e-9d8c04b4c23f")}</loc><lastmod>${today}</lastmod></url>
<url><loc>${xeUrl("τεχνικοί-ανελκυστήρων", "τεχνικός-ανελκυστήρων-atelevators-αθήνα-πλατεία-αττικής", "7aaa83c0-839e-40d7-9438-f3aaeb4a9958")}</loc><lastmod>${today}</lastmod></url>
<url><loc>${xeUrl("λογιστές", "λογιστησ--αθήνα", "2973adfe-f920-45e8-a1b5-a43c16456b6e")}</loc><lastmod>2020-01-01T00:00:00Z</lastmod></url>
</urlset>`;

test("jobfind.gr ads keep the job title apart from the region", async () => {
  const jobs = await withFakeFetch(JOBFIND_RSS, () => BOARDS.jobfind());
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].title, "Αποθηκάριος - Οδηγός (Βοτανικός)");
  assert.equal(jobs[0].location, "ΑΘΗΝΑ - ΑΤΤΙΚΗ");
  assert.equal(jobs[0].country, "greece");
  assert.equal(jobs[0].description, "Η TECH C.G. αναζητά Αποθηκάριο");
  assert.equal(jobs[0].postedAt, new Date("Thu, 26 Nov 2026 23:12:58 GMT").toISOString());
  assert.equal(jobs[1].title, "Πωλήτρια σε κατάστημα ένδυσης");
});

test("xe.gr ads are read from their address, and old ones are skipped", async () => {
  const jobs = await withFakeFetch(XE_SITEMAP, () => BOARDS.xe("", { maxAgeDays: 60 }));
  assert.equal(jobs.length, 2, "the 2020 ad is older than the limit");
  const [waiter, technician] = jobs;
  assert.equal(waiter.title, "Σερβιτοροσ");
  assert.equal(waiter.location, "Αθήνα ψυρρή");
  assert.equal(waiter.description, "Σερβιτόροι");
  assert.equal(waiter.country, "greece");
  assert.equal(waiter.id, "xe:576c58f6-5aa2-45e1-891e-9d8c04b4c23f");
  // Without "--" the employer and area stay in the title, which still names the job.
  assert.equal(technician.title, "Τεχνικός ανελκυστήρων atelevators αθήνα πλατεία αττικής");
  assert.equal(technician.location, "Ελλάδα");
});

test("an English job title matches a Greek ad written without accents", async () => {
  const [waiter] = await withFakeFetch(XE_SITEMAP, () => BOARDS.xe("", { maxAgeDays: 60 }));
  const profile = { ...DEFAULT_PROFILE, titles: ["Waiter"], locations: ["Greece"] };
  const result = scoreJob(waiter, profile);
  assert.equal(result.rejected, null);
  assert.ok(result.score >= profile.minScore, `score ${result.score}`);
  assert.equal(scoreJob(waiter, { ...profile, locations: ["Αθήνα"] }).rejected, null, "the area in the address counts");
});
