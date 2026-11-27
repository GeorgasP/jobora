/*
 * Which prepared application an application form belongs to.
 *
 * The form is rarely at the ad's own address. Lever adds "/apply" and Ashby
 * "/application"; Greenhouse moves between boards.greenhouse.io and
 * job-boards.greenhouse.io, and companies embed it on their own sites with
 * "?gh_jid="; and a job found on a board is often applied for on the
 * company's own site. The rules, strongest first:
 *   1. the ad's address, or the ad's address with more path after it;
 *   2. a job id both addresses share;
 *   3. the company's name in the form's address or page title;
 *   4. the only application still waiting to be sent.
 * Otherwise none: a guess would put one company's cover letter into another
 * company's form, and mark the wrong application as sent.
 */
import { fold } from "./places.js";

// A run of digits this long is an id, not a year, a count or a title number.
const MIN_ID_DIGITS = 5;
// A path segment that mixes letters with digits is an id when it is at least
// this long and has at least this many digits: Lever and Ashby UUIDs and
// Workable codes are; "software-engineer-2" is not.
const MIN_MIXED_ID_LENGTH = 8;
const MIN_MIXED_ID_DIGITS = 3;
const ID_DIGIT_RUN = new RegExp(`\\d{${MIN_ID_DIGITS},}`, "g");
// Query parameters that carry a job id ("gh_jid", "jobId", "req"). Others,
// such as "utm_campaign=20241105", say nothing about the job.
const ID_PARAMETER = /id$|^id|job|req/i;
// Shorter company names ("HP", "EY") turn up inside unrelated addresses.
const MIN_COMPANY_NAME_LENGTH = 4;
// Legal forms left off the end of a company's name, so that
// "Thalassa S.A." is found at thalassa.bamboohr.com.
const LEGAL_FORMS = new Set(["sa", "ae", "ee", "oe", "ike", "inc", "llc", "ltd", "limited", "corp", "co",
  "gmbh", "ag", "kg", "bv", "nv", "plc", "srl", "spa", "sas", "sarl", "sl", "oy", "ab", "as", "aps"]);

/**
 * @param {object[]} apps   the stored applications, newest first
 * @param {{url?: string, title?: string}} page   the form's address and page title
 * @returns {object|null}   the application, or null when none can be told apart
 */
export function findApplication(apps, page) {
  const candidates = (apps || []).filter((app) => app && typeof app === "object");
  const pageUrl = parseUrl(page?.url);

  if (pageUrl) {
    const pageAddress = addressOf(pageUrl);
    const sameAd = candidates.find((app) => {
      const address = addressOf(parseUrl(app.url));
      return address && (pageAddress === address || pageAddress.startsWith(`${address}/`));
    });
    if (sameAd) return sameAd;

    const pageIds = jobIds(pageUrl);
    const sameId = pageIds.size
      ? candidates.find((app) => [...jobIds(parseUrl(app.url))].some((id) => pageIds.has(id)))
      : null;
    if (sameId) return sameId;
  }

  // The weaker signals only pick among applications not sent yet: an old,
  // sent application to the same company is a different job.
  const waiting = candidates.filter((app) => app.status === "prepared");
  const pageText = squash(`${pageUrl ? pageUrl.hostname + pageUrl.pathname : ""} ${page?.title || ""}`);
  const sameCompany = waiting.find((app) => {
    const name = companyKey(app.company);
    return name && pageText.includes(name);
  });
  if (sameCompany) return sameCompany;

  return waiting.length === 1 ? waiting[0] : null;
}

function parseUrl(text) {
  try {
    const url = new URL(String(text || ""));
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

/** Host and path, without "www.", the query, the fragment or a final "/". */
function addressOf(url) {
  if (!url || url.pathname === "/") return "";      // a whole site is not one ad
  return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}`.toLowerCase();
}

function jobIds(url) {
  const ids = new Set();
  if (!url) return ids;
  for (const segment of url.pathname.split("/")) addIdsIn(segment, ids);
  for (const [key, value] of url.searchParams) {
    if (ID_PARAMETER.test(key)) addIdsIn(value, ids);
  }
  return ids;
}

function addIdsIn(text, ids) {
  const lower = String(text).toLowerCase();
  for (const digits of lower.match(ID_DIGIT_RUN) || []) ids.add(digits);
  const digitCount = (lower.match(/\d/g) || []).length;
  if (lower.length >= MIN_MIXED_ID_LENGTH && /[a-z]/.test(lower) && digitCount >= MIN_MIXED_ID_DIGITS) {
    ids.add(lower);
  }
}

/** Letters and digits only, accents folded: "Kyma Hotels – Apply" → "kymahotelsapply". */
const squash = (text) => fold(text).replace(/[^\p{L}\p{N}]+/gu, "");

/** The company's name as it would appear in an address, or "" when too short to tell. */
function companyKey(name) {
  const words = fold(name).replace(/\./g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  while (words.length > 1 && LEGAL_FORMS.has(words[words.length - 1])) words.pop();
  const key = words.join("");
  return key.length >= MIN_COMPANY_NAME_LENGTH ? key : "";
}
