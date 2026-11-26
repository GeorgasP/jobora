import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { getProfile, saveProfile } from "../extension/lib/store.js";

let storage;
beforeEach(() => {
  storage = { profile: { name: "Test User", salaryMin: 45000 } };
  globalThis.chrome = { storage: { local: {
    get: async key => ({ [key]: structuredClone(storage[key]) }),
    set: async patch => Object.assign(storage, structuredClone(patch)),
  } } };
});

test("invalid saved salary preferences are treated as no minimum", async () => {
  for (const salaryMin of [-3, -1000, 45000.5, Infinity, NaN, "45000", Number.MAX_SAFE_INTEGER + 1]) {
    storage.profile.salaryMin = salaryMin;
    const profile = await getProfile();
    assert.equal(profile.salaryMin, null, String(salaryMin));
    assert.equal(profile.name, "Test User");
  }
});

test("profile storage only saves positive whole salaries or no minimum", async () => {
  for (const salaryMin of [60000, 1, 0, null, -3, 60000.5, Infinity]) {
    const profile = await saveProfile({ salaryMin });
    const expected = salaryMin === 60000 || salaryMin === 1 ? salaryMin : null;
    assert.equal(profile.salaryMin, expected);
    assert.equal(storage.profile.salaryMin, expected);
    assert.equal(storage.profile.name, "Test User");
  }
});

test("saving another preference clears a legacy negative salary", async () => {
  storage.profile.salaryMin = -3;
  await saveProfile({ remoteOnly: true });
  assert.equal(storage.profile.salaryMin, null);
  assert.equal(storage.profile.remoteOnly, true);
});
