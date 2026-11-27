import assert from "node:assert/strict";
import test from "node:test";
import { findApplication } from "../extension/lib/applications.js";

const application = (id, url, company = "Acme", status = "prepared") => ({ id, url, company, status });
const found = (apps, url, title = "") => findApplication(apps, { url, title })?.id ?? null;

test("the ad's own page, or a page under it, is that ad's application", () => {
  const apps = [application("other", "https://apply.workable.com/acme/j/9C8B7A6D5E/"),
    application("ashby", "https://jobs.ashbyhq.com/kyma/3f2e1d0c-1111-4abc-8def-222233334444")];
  assert.equal(found(apps, "https://jobs.ashbyhq.com/kyma/3f2e1d0c-1111-4abc-8def-222233334444/application"), "ashby");
  assert.equal(found(apps, "https://apply.workable.com/acme/j/9C8B7A6D5E/apply/"), "other");
  assert.equal(found(apps, "https://www.apply.workable.com/acme/j/9C8B7A6D5E#form"), "other");
});

test("a shared job id links the ad and the form across sites", () => {
  const apps = [application("a", "https://boards.greenhouse.io/acme/jobs/4567890"),
    application("b", "https://jobs.smartrecruiters.com/Kyma/744000012345678-chef")];
  assert.equal(found(apps, "https://acme.example/careers/?gh_jid=4567890"), "a");
  assert.equal(found(apps, "https://careers.kyma.example/job/744000012345678"), "b");
});

test("generic words and campaign numbers link nothing", () => {
  const apps = [application("a", "https://one.example/careers", "One", "sent"),
    application("b", "https://two.example/jobs/apply", "Two", "sent")];
  assert.equal(found([apps[0]], "https://three.example/careers"), null);
  assert.equal(found([apps[1]], "https://three.example/apply"), null);
  assert.equal(found([application("c", "https://four.example/job/20241105", "Four", "sent")],
    "https://three.example/form?utm_campaign=20241105"), null);
  // A path segment with a single digit is a title, not an id.
  assert.equal(found([application("d", "https://five.example/software-engineer-2", "Five", "sent")],
    "https://six.example/software-engineer-2"), null);
});

test("the company's own site is known by the company's name", () => {
  const apps = [application("a", "https://remotive.com/remote-jobs/x-1234567", "Taverna Thalassa S.A."),
    application("b", "https://remotive.com/remote-jobs/y-7654321", "Kyma Hotels")];
  assert.equal(found(apps, "https://tavernathalassa.bamboohr.com/careers/12"), "a");
  assert.equal(found(apps, "https://jobs.example/form", "Kyma Hotels – Apply"), "b");
  // Names too short to tell anything apart are not used.
  assert.equal(found([application("c", "https://x.example/1", "HP", "sent")], "https://shop.example/hp"), null);
});

test("with no link, only an application still waiting to be sent is used", () => {
  const waiting = application("waiting", "https://remotive.com/remote-jobs/x-1234567", "Taverna");
  const sent = application("sent", "https://remotive.com/remote-jobs/y-7654321", "Kyma", "sent");
  assert.equal(found([sent, waiting], "https://apply.example/form"), "waiting");
  assert.equal(found([sent], "https://apply.example/form"), null);
  // Two waiting and no link: a guess would put one company's letter in another's form.
  assert.equal(found([waiting, { ...waiting, id: "second", company: "Other" }], "https://apply.example/form"), null);
});

test("a page that matches several applications gets the newest", () => {
  const apps = [application("new", "https://jobs.lever.co/acme/8f3a2b1c-1234-4cde-9f00-123456789abc"),
    application("old", "https://jobs.lever.co/acme/8f3a2b1c-1234-4cde-9f00-123456789abc", "Acme", "sent")];
  assert.equal(found(apps, "https://jobs.lever.co/acme/8f3a2b1c-1234-4cde-9f00-123456789abc/apply"), "new");
});

test("broken addresses do not throw", () => {
  const apps = [application("a", "not a url"), application("b", "")];
  assert.equal(found(apps, "https://apply.example/form"), null);
  assert.equal(found(apps, ""), null);
});
