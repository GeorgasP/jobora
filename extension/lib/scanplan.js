/*
 * What a scan asks the sources that search on the user's behalf (today EURES):
 * which occupations, and where. Kept out of background.js so it can be tested
 * without a browser.
 */
import { countryCode, placesIn, regionsOf, resolvePlace } from "./places.js";

// EURES covers the EU, the EEA and Switzerland.
const inEures = (country) => regionsOf(country).includes("eu") || country === "switzerland";
const EUROPE_WIDE = new Set(["eu", "europe", "emea"]);

/**
 * The EURES search for a profile: the ESCO occupations of its job titles and
 * the lower-case codes of the countries to search, or null when EURES has
 * nothing for this user (no title with an occupation, or no place in Europe).
 * `countries: []` means all of Europe, for users who chose "EU" or "Europe".
 */
export function euresSearchFor(profile) {
  const occupations = [...new Set(Object.values(profile.titleOccupations || {}).flat())];
  if (!occupations.length) return null;

  const wanted = (profile.locations || []).map(resolvePlace);
  if (wanted.some((place) => place.kind === "region" && EUROPE_WIDE.has(place.region))) {
    return { occupations, countries: [] };
  }

  const countries = new Set(wanted.map((place) => place.country).filter(Boolean));
  // "Remote", or a place too small to know, says nothing about the country:
  // the user's own address does.
  if (!countries.size || wanted.some((place) => place.kind === "remote")) {
    for (const country of placesIn(profile.location || "").countries) countries.add(country);
  }
  const codes = [...countries].filter(inEures).map((country) => countryCode(country).toLowerCase());
  return codes.length ? { occupations, countries: codes } : null;
}
