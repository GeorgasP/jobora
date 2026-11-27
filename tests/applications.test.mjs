// Which prepared application an application form belongs to. The cases live in
// tests/fixtures/application-matching.json, so that the Python engine is held
// to the same answers (tests/test_applications.py).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { findApplication } from "../extension/lib/applications.js";

const { groups } = JSON.parse(readFileSync(new URL("./fixtures/application-matching.json", import.meta.url), "utf8"));

for (const { rule, apps, pages } of groups) {
  test(rule, () => {
    for (const page of pages) {
      const found = findApplication(apps, { url: page.url, title: page.title || "" });
      assert.equal(found ? found.id : null, page.expected, `${page.url} ${page.title || ""}`);
    }
  });
}

test("no applications, or none given, is none", () => {
  assert.equal(findApplication([], { url: "https://apply.example/form" }), null);
  assert.equal(findApplication(undefined, undefined), null);
});
