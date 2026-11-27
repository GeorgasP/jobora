/*
 * Job portals that need the user's permission before a scan may use them.
 *
 * When an update asks for new sites, Chrome turns the extension off until the
 * user accepts them, and most people never do. So the sources added after the
 * first store release ask for their sites inside the app instead: at the end
 * of onboarding, from the offer on the matches page, or in Settings.
 *
 * Two kinds: portals every user is offered (EURES for Europe, and the Greek
 * boards), and a country's own public employment service, offered only to
 * users who can work in that country, so nobody is asked for sites they will
 * never use.
 */

// A country's public employment service, by the country's key in places.js.
// `language` is the ESCO language its ads are searched in (see esco.js).
export const NATIONAL_PORTALS = {
  sweden: { board: "jobtech", language: "sv", origins: ["https://jobsearch.api.jobtechdev.se/*"] },
  norway: { board: "nav", language: "no", origins: ["https://pam-stilling-feed.nav.no/*"] },
};

const SHARED_PORTAL_ORIGINS = {
  eures: ["https://europa.eu/*", "https://ec.europa.eu/*"],
  jobfind: ["https://www.jobfind.gr/*"],
  xe: ["https://www.xe.gr/*"],
};

export const PORTAL_ORIGINS_BY_BOARD = {
  ...SHARED_PORTAL_ORIGINS,
  ...Object.fromEntries(Object.values(NATIONAL_PORTALS).map(({ board, origins }) => [board, origins])),
};

/** Every portal's sites, to give them all back when the user turns the portals off. */
export const PORTAL_ORIGINS = [...new Set(Object.values(PORTAL_ORIGINS_BY_BOARD).flat())];

/**
 * The sites to ask a user for: the shared portals', and the national
 * services' of the countries they can work in (country keys, from
 * scanplan.js's countriesOf).
 */
export function portalOriginsFor(countries = []) {
  const national = countries.flatMap((country) => NATIONAL_PORTALS[country]?.origins || []);
  return [...new Set([...Object.values(SHARED_PORTAL_ORIGINS).flat(), ...national])];
}

/** Whether the user has allowed the given portal sites (all of them, by default). */
// Async so that any failure (no permissions API, as in a test page) arrives as a
// rejected promise the caller can catch, never as an exception thrown on the spot.
export const portalsAllowed = async (origins = PORTAL_ORIGINS) => chrome.permissions.contains({ origins });

/** The boards a scan may use: every board, minus the portals whose sites aren't allowed. */
export async function boardsWithPermission(boards = []) {
  const allowed = [];
  for (const board of boards) {
    const origins = PORTAL_ORIGINS_BY_BOARD[board];
    if (!origins || (await chrome.permissions.contains({ origins }))) allowed.push(board);
  }
  return allowed;
}
