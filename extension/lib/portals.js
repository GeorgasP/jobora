/*
 * Job portals that need the user's permission before a scan may use them.
 *
 * When an update asks for new sites, Chrome turns the extension off until the
 * user accepts them, and most people never do. So the sources added after the
 * first store release ask for their sites inside the app instead: at the end
 * of onboarding, from the offer on the matches page, or in Settings.
 */

export const PORTAL_ORIGINS_BY_BOARD = {
  eures: ["https://europa.eu/*", "https://ec.europa.eu/*"],
  jobfind: ["https://www.jobfind.gr/*"],
  xe: ["https://www.xe.gr/*"],
};

export const PORTAL_ORIGINS = [...new Set(Object.values(PORTAL_ORIGINS_BY_BOARD).flat())];

/** Whether the user has allowed every portal's sites. */
// Async so that any failure (no permissions API, as in a test page) arrives as a
// rejected promise the caller can catch, never as an exception thrown on the spot.
export const portalsAllowed = async () => chrome.permissions.contains({ origins: PORTAL_ORIGINS });

/** The boards a scan may use: every board, minus the portals whose sites aren't allowed. */
export async function boardsWithPermission(boards = []) {
  const allowed = [];
  for (const board of boards) {
    const origins = PORTAL_ORIGINS_BY_BOARD[board];
    if (!origins || (await chrome.permissions.contains({ origins }))) allowed.push(board);
  }
  return allowed;
}
