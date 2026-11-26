import assert from "node:assert/strict";
import test from "node:test";
import { scoreJob } from "../extension/lib/matcher.js";
import { DEFAULT_PROFILE } from "../extension/lib/store.js";

// Every job here is a fresh "Barista" ad and every profile looks for a barista,
// so the only thing that decides the outcome is the location.
const profile = (patch) => ({ ...DEFAULT_PROFILE, titles: ["Barista"], ...patch });
const job = (location, extra = {}) => ({
  id: location, title: "Barista", location, description: "", postedAt: new Date().toISOString(), ...extra,
});
const remoteJob = (location) => job(location, { remote: true });
const outcome = (jobItem, user) => scoreJob(jobItem, user).kind || "match";

test("a place counts only as a whole word", () => {
  const greece = profile({ locations: ["Greece"] });
  assert.equal(outcome(job("Madrid, es", { title: "Evergreen Barista" }), greece), "location");
  assert.equal(outcome(job("Toronto, Canada", { title: "Barista Program Lead" }), greece), "location");
  assert.equal(outcome(job("Athens, Greece"), greece), "match");
});

test("a remote job limited to another country does not count as remote", () => {
  const user = profile({ locations: ["Greece", "Remote"] });
  for (const location of ["Remote - Canada", "Remote - US", "US Only", "Remote - FL; Remote - GA",
    "Canada - Remote (ON, AB, BC, or NS Only)", "Remote - Germany"]) {
    assert.equal(outcome(remoteJob(location), user), "location", location);
  }
});

test("a remote job open to everyone, or to the user's region, counts as remote", () => {
  const user = profile({ locations: ["Greece", "Remote"] });
  for (const location of ["Remote", "Anywhere in the World", "Worldwide", "Remote (Europe)",
    "Remote (EMEA)", "Time zone: CET (+/- 3 hours)"]) {
    assert.equal(outcome(remoteJob(location), user), "match", location);
  }
});

test("anywhere within one country is not anywhere in the world", () => {
  assert.equal(outcome(remoteJob("Anywhere in France"), profile({ locations: ["Greece", "Remote"] })), "location");
});

test("the user's own address decides which remote jobs are open to them", () => {
  const inGreece = profile({ locations: ["Remote"], location: "Spata, Attica, Greece" });
  assert.equal(outcome(remoteJob("Remote - Canada"), inGreece), "location");
  assert.equal(outcome(remoteJob("Remote (Europe)"), inGreece), "match");
  // Without an address we cannot tell, so a limited remote job still shows.
  assert.equal(outcome(remoteJob("Remote - Canada"), profile({ locations: ["Remote"], location: "" })), "match");
});

test("a region matches the countries inside it", () => {
  assert.equal(outcome(job("Berlin, Germany"), profile({ locations: ["EU"] })), "match");
  assert.equal(outcome(job("Zürich, Switzerland"), profile({ locations: ["EU"] })), "location");
  assert.equal(outcome(job("Zürich, Switzerland"), profile({ locations: ["Europe"] })), "match");
});

test("cities match with or without accents, and in any Greek case", () => {
  assert.equal(outcome(job("Zürich, Switzerland"), profile({ locations: ["Zurich"] })), "match");
  const greekBoardAd = job("Ελλάδα", { country: "greece", title: "Ζητείται barista, περιοχή Αθήνας" });
  assert.equal(outcome(greekBoardAd, profile({ locations: ["Αθήνα"] })), "match");
  assert.equal(outcome(greekBoardAd, profile({ locations: ["Greece"] })), "match");
});

test("two-letter country codes count in capitals or as the last part of a location", () => {
  assert.equal(outcome(job("Berlin, DE"), profile({ locations: ["Germany"] })), "match");
  assert.equal(outcome(job("Madrid, es"), profile({ locations: ["Spain"] })), "match");
  assert.equal(outcome(job("Rio de Janeiro, Brazil"), profile({ locations: ["Germany"] })), "location");
});

test("a job with no location is not treated as worldwide", () => {
  const result = scoreJob(job(""), profile({ locations: ["Greece"] }));
  assert.equal(result.kind, "location");
  assert.match(result.rejected, /no location given/);
});

test("blocking a country also blocks its cities", () => {
  const user = profile({ locations: ["Remote"], blockedLocations: ["USA"], strictLocation: false });
  assert.equal(outcome(job("New York, NY"), user), "blocked");
  assert.equal(outcome(job("Athens, Greece"), user), "match");
});
