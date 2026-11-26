# Notes

Short notes between everyone working on Jobora: Panos, Apo, and the AI
assistant working for Panos. Newest first.

- **Before you change anything, read the notes added since your last visit.**
- **After a change that others should know about, add a note at the top.**

A note says what changed and why, where to look, and what is left or needs
care. Start a line with "For Apo:" or "For Panos:" when it is meant for one
person. Keep it to a few lines: the commits and pull requests hold the details.

---

### 2026-11-27 (later) · Claude (for Panos) · Portal permissions and CV formats

- EURES/ESCO, jobfind.gr and xe.gr are now optional permissions
  (`extension/lib/portals.js`): asked at the end of onboarding, offered once
  above the matches, and switchable in Settings. Required permissions are again
  exactly those of 1.1.0, so updating does not turn the extension off.
- CVs in more formats (`extension/lib/documents.js`, `cv.js`): DOCX with page
  headers (where Word templates put contact details), ODT, RTF and the old
  .doc; the format is judged by the file's bytes. PDFs: only page content is
  read (no more junk from embedded fonts), and compressed object streams work.
  Name detection now weighs position line by line, so "ABOUT ME" can't tie.
- Still to do: the Python engine's location matching; a 1.2.0 package; tests
  with real Word files (the generated ones still hold Office metadata).

### 2026-11-27 · Claude (for Panos) · Search fixes on branch `search-fixes`, ready for review

Each item is its own commit. Numbers are from real job data, before → after.

- **Phone numbers** (`extension/lib/cv.js`, `findPhone`): read by their digit
  count (8 to 15), not one country's layout, so +41 79 123 45 67, +31 6 12345678
  and +33 6 12 34 56 78 work (10 of 17 formats → 17 of 17). Numbers after VAT,
  ΑΦΜ, IBAN, ID or Fax, and year ranges, are never taken for a phone.
- **Locations** (new `extension/lib/places.js`, used by `matcher.js`): places
  are whole words with regions, so "Evergreen" is no longer Greece. "Remote"
  counts only when the job is open to where the user is: matches in North
  America for a customer service profile in Greece went 11 of 23 → 0. A job
  with no location is no longer treated as worldwide.
- **Where the user lives** (`cv.js`, `onboarding.js`, `app.js`): read from the
  CV header; onboarding starts "Where you can work" from that country plus
  Remote; a new CV in Settings offers its job titles one click each.
- **EURES** (new `extension/lib/esco.js` and `scanplan.js`, `sources.js`): the
  EU job portal, searched by ESCO occupation so every industry is covered in
  any language. Nurse in Germany/Switzerland 1 → 126 matches, waiter in Cyprus
  0 → 76, chef/waiter in the Netherlands/Belgium 0 → 122.
- **Greek sources**: jobfind.gr (RSS) and xe.gr (job sitemap), both allowed by
  their robots.txt. In Greece: waiter/bartender/chef 0 → 312, driver 0 → 582,
  nurse 1 → 87. Alias matching now ignores accents.
- **Tests**: 67 Node tests (`node --test "tests/*.test.mjs"`, also run by GitHub
  on every pull request) and two browser checks (`tests/*.browser.html`, see
  `extension/README.md`).

Needs care:
- Correction (later the same day): skywalker.gr and the Workday boards block
  requests from Node.js only; from a real browser they answer normally, so
  they work in the extension. Node-based measurements undercount them.
- `jobora/matcher.py` (the Python engine) still matches locations the old way.
- xe.gr titles and areas come from each ad's address; for some ads the "area"
  is the employer's name.
- `store/dist` still holds the 1.1.0 zip without the new files. Releasing this
  needs a version bump and `python store/package.py`; the new host permissions
  (europa.eu, ec.europa.eu, jobfind.gr, xe.gr) make Chrome ask existing users to
  accept them.
- For Apo: this branch changes `matcher.js`, `sources.js`, `cv.js`,
  `onboarding.js` and `app.js`. Please pull before you edit them.

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
