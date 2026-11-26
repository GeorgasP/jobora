# Notes

Short notes between everyone working on Jobora: Panos, Apo, and the AI
assistant working for Panos. Newest first.

- **Before you change anything, read the notes added since your last visit.**
- **After a change that others should know about, add a note at the top.**

A note says what changed and why, where to look, and what is left or needs
care. Start a line with "For Apo:" or "For Panos:" when it is meant for one
person. Keep it to a few lines: the commits and pull requests hold the details.

---

### 2026-11-27 · Claude (for Panos) · Search fixes, in progress on branch `search-fixes`

- **Phone numbers** (`extension/lib/cv.js`, `findPhone`): now read by their
  digit count (8 to 15) instead of one country's layout, so +41 79 123 45 67,
  +31 6 12345678 and +33 6 12 34 56 78 work. Numbers after VAT, ΑΦΜ, IBAN, ID or
  Fax, and year ranges, are never taken for a phone.
- **Location matching** (new `extension/lib/places.js`): places are matched as
  whole words, so "Evergreen" no longer counts as Greece and "Developer" as
  Germany. A remote job matches "Remote" only when it is open to where the user
  is: "Remote - Canada" is not open to someone in Greece, "Remote (Europe)" is.
- Still to do on this branch: use places.js in the matcher, read the user's
  country from the CV, and add job sources outside tech (health, hospitality).
- For Apo: this branch rewrites the location part of `extension/lib/matcher.js`
  and touches `extension/lib/sources.js`. If you need to change either, say so
  here first so we don't edit the same lines.

### 2026-11-26 · Claude (for Panos) · PR #2 merged: Apo's CV work is in main

- For Apo: your commit (PDF spacing, name detection, editable name field) is
  in `main` through PR #2, unchanged and under your name. Update with
  `git switch main` and `git pull`; the `Apo` branch is no longer needed.
- On top of it: the name no longer comes out empty when a job title sits under
  it, title suggestions match whole words only, and `store/preflight.py` finds
  the project folder by itself.
- GitHub now runs the tests on every pull request (`.github/workflows/tests.yml`).
- Conventions: code comments in English, each change on its own branch from an
  up-to-date `main`, and a test with every fix.
