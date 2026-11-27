/*
 * ESCO: the European Commission's list of occupations, the same in every EU
 * language.
 *
 * EURES tags each vacancy with an ESCO occupation, whatever language the ad is
 * written in. Turning the user's job titles into ESCO occupations lets a scan
 * ask EURES for exactly those jobs, and lets the matcher recognise a Dutch
 * "Verpleegkundige" as the nurse the user is looking for.
 */
import { fold } from "./places.js";

const ESCO_SEARCH = "https://ec.europa.eu/esco/api/search";
const ESCO_OCCUPATION = "https://ec.europa.eu/esco/api/resource/occupation";
const RESULTS_TO_CONSIDER = 8;
const OCCUPATIONS_PER_TITLE = 3;

// Words that turn an ESCO occupation into a different job from the one the
// user typed, unless the user typed them too: a "nurse assistant" is not a
// nurse, and an "animal physiotherapist" is not what a physiotherapist wants.
const ROLE_CHANGERS = new Set(["assistant", "aide", "helper", "apprentice", "trainee", "intern",
  "teacher", "instructor", "manager", "supervisor", "director", "animal"]);

const wordsOf = (text) => fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * The ESCO occupations that are the job the user typed: those whose name
 * contains the title's main word (its last one, "nurse" in "Registered
 * Nurse") and no word that turns it into another job. ESCO's own ranking is
 * not enough: its first answer for "Registered Nurse" is "healthcare assistant".
 */
export function pickOccupations(title, results = []) {
  const typed = wordsOf(title);
  const mainWord = typed.at(-1);
  if (!mainWord) return [];
  return results
    .filter(({ title: name }) => {
      const named = wordsOf(name);
      return named.includes(mainWord) && !named.some((word) => ROLE_CHANGERS.has(word) && !typed.includes(word));
    })
    .slice(0, OCCUPATIONS_PER_TITLE)
    .map(({ uri }) => uri);
}

/**
 * Looks a job title up in ESCO and returns the URIs of the occupations it
 * names. Greek titles are looked up in Greek, everything else in English.
 * `getJSON` is the caller's fetch helper.
 */
export async function lookUpOccupations(title, getJSON) {
  const language = /\p{Script=Greek}/u.test(title) ? "el" : "en";
  const params = new URLSearchParams({
    language, type: "occupation", text: title, limit: String(RESULTS_TO_CONSIDER),
  });
  const found = await getJSON(`${ESCO_SEARCH}?${params}`);
  return pickOccupations(title, found?._embedded?.results || []);
}

/**
 * An occupation's name in every language ESCO has (28), as
 * { sv: "sjuksköterska", no: "sykepleier", … }: national job portals are
 * searched in their own language. One answer holds all the languages. A
 * qualifier after a comma or in brackets is dropped, since ads say
 * "sjuksköterska", not "sjuksköterska, grundutbildad".
 */
export async function occupationNames(uri, getJSON) {
  const found = await getJSON(`${ESCO_OCCUPATION}?${new URLSearchParams({ uri, language: "en" })}`);
  const names = {};
  for (const [language, label] of Object.entries(found?.preferredLabel || {})) {
    const name = String(label).split(/[,(]/)[0].trim();
    if (name) names[language] = name;
  }
  return names;
}
