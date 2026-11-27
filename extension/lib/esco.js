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
  "teacher", "instructor", "manager", "supervisor", "director", "animal", "veterinary"]);

const wordsOf = (text) => fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// ESCO says which of an occupation's names matched (searchHit). A hit longer
// than this is a sentence from the description, which says little.
const MAX_HIT_WORDS = 6;
// When ESCO matched the exact title, it is the job; one close relative may join it.
const OCCUPATIONS_FOR_EXACT_TITLE = 2;

/**
 * The ESCO occupations that are the job the user typed. ESCO's ranking alone
 * is not enough (its first answer for "Registered Nurse" is "healthcare
 * assistant"), so each answer is judged by its own name and by the name ESCO
 * matched (searchHit): "software developer" is ESCO's occupation for software
 * engineers, found through its other name "software engineer". An occupation
 * counts when one of those names contains the title's main word (its last:
 * "nurse" in "Registered Nurse") and its own name has no word that makes it
 * another job. First come exact names, then those sharing more of the
 * title's words, then those with fewer words beyond it, then ESCO's order.
 */
export function pickOccupations(title, results = []) {
  const typed = wordsOf(title);
  const mainWord = typed.at(-1);
  if (!mainWord) return [];
  const extraWords = (words) => words.filter((word) => !typed.includes(word)).length;
  const candidates = results.map(({ title: name, searchHit, uri }, rank) => {
    const named = wordsOf(name);
    const hit = wordsOf(searchHit || "");
    // A hit longer than a name is a sentence from the description: it says little.
    const names = hit.length && hit.length <= MAX_HIT_WORDS ? [named, hit] : [named];
    const naming = names.filter((words) => words.includes(mainWord));
    return {
      uri, rank, named, naming,
      exact: names.some((words) => words.join(" ") === typed.join(" ")),
      shared: Math.max(0, ...naming.map((words) => typed.filter((word) => words.includes(word)).length)),
      extra: Math.min(Infinity, ...naming.map(extraWords)),
    };
  }).filter(({ naming, named }) => naming.length && !named.some((word) => ROLE_CHANGERS.has(word) && !typed.includes(word)));
  candidates.sort((a, b) => b.exact - a.exact || b.shared - a.shared || a.extra - b.extra || a.rank - b.rank);
  const limit = candidates[0]?.exact ? OCCUPATIONS_FOR_EXACT_TITLE : OCCUPATIONS_PER_TITLE;
  return candidates.slice(0, limit).map(({ uri }) => uri);
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

// Alternative names kept per language: enough for the ways ads put it.
const NAMES_PER_LANGUAGE = 8;

/**
 * An occupation's names in the given languages, its preferred name first and
 * then ESCO's alternatives, as { sv: ["sjuksköterska"], nl: ["leerkracht
 * voortgezet onderwijs", "docent secundair onderwijs", …] }: a country's own
 * job sites are searched in its language. One answer holds all 28 of
 * ESCO's languages; a language ESCO lacks is kept as [], so it is not asked
 * again. A qualifier after a comma or in brackets is dropped, since ads say
 * "sjuksköterska", not "sjuksköterska, grundutbildad".
 */
export async function occupationNames(uri, getJSON, languages) {
  const found = await getJSON(`${ESCO_OCCUPATION}?${new URLSearchParams({ uri, language: "en" })}`);
  const names = {};
  for (const language of languages) {
    const labels = [...[].concat(found?.preferredLabel?.[language] || []), ...[].concat(found?.alternativeLabel?.[language] || [])];
    const cleaned = labels.map((label) => String(label).split(/[,(]/)[0].trim()).filter(Boolean);
    names[language] = [...new Set(cleaned)].slice(0, NAMES_PER_LANGUAGE);
  }
  return names;
}
