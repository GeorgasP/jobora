/*
 * What a scan asks the sources that search on the user's behalf (EURES, and
 * the national employment services): which occupations, and where. Kept out
 * of background.js so it can be tested without a browser.
 */
import { countryCode, placesIn, regionsOf, resolvePlace } from "./places.js";
import { NATIONAL_PORTALS } from "./portals.js";

// EURES covers the EU, the EEA and Switzerland.
const inEures = (country) => regionsOf(country).includes("eu") || country === "switzerland";
const EUROPE_WIDE = new Set(["eu", "europe", "emea"]);

const occupationsOf = (profile) => [...new Set(Object.values(profile.titleOccupations || {}).flat())];

/**
 * The countries a user can work in, by their keys in places.js: the ones
 * they named, or a city of. "Remote", or no country at all, says nothing
 * about where, so then the user's own address counts.
 */
export function countriesOf(profile) {
  const wanted = (profile.locations || []).map(resolvePlace);
  const countries = new Set(wanted.map((place) => place.country).filter(Boolean));
  if (!countries.size || wanted.some((place) => place.kind === "remote")) {
    for (const country of placesIn(profile.location || "").countries) countries.add(country);
  }
  return [...countries];
}

/**
 * The EURES search for a profile: the ESCO occupations of its job titles and
 * the lower-case codes of the countries to search, or null when EURES has
 * nothing for this user (no title with an occupation, or no place in Europe).
 * `countries: []` means all of Europe, for users who chose "EU" or "Europe".
 */
export function euresSearchFor(profile) {
  const occupations = occupationsOf(profile);
  if (!occupations.length) return null;

  const wanted = (profile.locations || []).map(resolvePlace);
  if (wanted.some((place) => place.kind === "region" && EUROPE_WIDE.has(place.region))) {
    return { occupations, countries: [] };
  }
  const codes = countriesOf(profile).filter(inEures).map((country) => countryCode(country).toLowerCase());
  return codes.length ? { occupations, countries: codes } : null;
}

/** Whether a national employment service among the allowed boards has something to do for this user. */
export const needsNationalPortals = (profile, boards = []) =>
  countriesOf(profile).some((country) => NATIONAL_PORTALS[country] && boards.includes(NATIONAL_PORTALS[country].board));

/**
 * What a scan asks each national employment service: for every country the
 * user can work in that has one, the user's occupations named in that
 * country's language (from ESCO, profile.occupationNames), as
 * { sweden: [{ occupation, name: "sjuksköterska" }], … }. Occupations ESCO
 * has no name for in that language are left out.
 */
export function nationalSearchFor(profile) {
  const occupations = occupationsOf(profile);
  const plan = {};
  for (const country of countriesOf(profile)) {
    const portal = NATIONAL_PORTALS[country];
    if (!portal) continue;
    const terms = occupations
      .map((occupation) => ({ occupation, name: profile.occupationNames?.[occupation]?.[portal.language] }))
      .filter((term) => term.name);
    if (terms.length) plan[country] = terms;
  }
  return plan;
}
