/*
 * The quick filters above the matches: what "Remote", "Today" and "With
 * salary" keep. The dashboard filters the matches it shows with them, and the
 * service worker counts all matches with the same ones, so a count and the
 * list under it always agree.
 */

// "Today" reaches back this far, so a job posted last evening still counts.
const TODAY_HOURS = 36;
const HOUR_MS = 3600 * 1000;

export const MATCH_FILTERS = {
  all: () => true,
  remote: (match) => Boolean(match.remote),
  today: (match, now = Date.now()) => Boolean(match.postedAt) && Date.parse(match.postedAt) > now - TODAY_HOURS * HOUR_MS,
  salary: (match) => Boolean(match.salaryMin || match.salaryMax),
};

/** How many matches each quick filter keeps: { all, remote, today, salary }. */
export function countMatches(matches, now = Date.now()) {
  return Object.fromEntries(Object.entries(MATCH_FILTERS)
    .map(([name, keeps]) => [name, matches.filter((match) => keeps(match, now)).length]));
}
