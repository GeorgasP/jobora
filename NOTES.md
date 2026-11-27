# Notes

Short notes between everyone working on Jobora: Panos, Apo, and the AI
assistant working for Panos. Newest first.

- **Before you change anything, read the notes added since your last visit.**
- **After a change that others should know about, add a note at the top.**

A note says what changed and why, where to look, and what is left or needs
care. Start a line with "For Apo:" or "For Panos:" when it is meant for one
person. Keep it to a few lines: the commits and pull requests hold the details.

---

### 2026-11-27 · Claude (for Panos and Apo) · The store's addresses, and its published version

- The store refused to publish 1.2.0: "Homepage URL is not reachable". Since
  the rename, `georgasp.github.io/jobhunter/` answers 404 (github.com redirects
  a renamed repository, GitHub Pages does not), and the homepage had been set
  in the dashboard by hand, written down nowhere here.
- `store/LISTING.md` now lists all three addresses (homepage, support, privacy
  policy), and `python store/preflight.py` opens each one: an address that
  fails blocks the submission, one that redirects gets a warning with the
  address to use instead (`store/listing.py`, `tests/test_listing.py`).
- preflight's check that our version is above the published one did not work:
  its pattern held two backspace characters where `\b` was meant, and the
  store page shows the label before the number. It reads "1.0.0" now.
- For Panos: in the dashboard, Store listing → Additional fields: Homepage
  `https://georgasp.github.io/jobora/`, Support
  `https://github.com/GeorgasP/jobora/issues`; Privacy tab: privacy policy
  `https://georgasp.github.io/jobora/privacy.html`.
- For Apo: preflight warns that `onboarding.continue` is no longer used since
  "Improve onboarding navigation buttons". Remove it from the locales, or use
  it again.

### 2026-11-27 · Claude (for Panos and Apo) · Dutch sources, and the right ESCO occupations

- For Apo: three Dutch sources, for users who can work in the Netherlands:
  Werken bij de Overheid (the public sector, about 1,400 jobs), Meesterbaan
  (teaching, about 2,300) and AcademicTransfer (universities, about 700). Each
  scan reads their sitemaps, keeps the ads whose titles match the user's
  occupations, and reads only those pages (40 per site at most). UWV
  (werk.nl) has no API; its jobs come through EURES.
- Fixed in `esco.js`: "Software Engineer" was looked up as satellite, quality
  and mechatronics engineers, and "software developer" was dropped. ESCO
  says which of an occupation's names matched (`searchHit`); that now counts.
  This changes EURES searches too: developers get developer jobs.
- Ads in Dutch, Swedish and Norwegian are matched on ESCO's names with their
  alternatives, by stem, compound head, or the role a Dutch title starts with
  ("Docent wiskunde"), but never by a generic role ("Teamleider", "Medewerker").
- Live, a software engineer in the Netherlands: 6 public-sector jobs (MIVD,
  Koninklijke Bibliotheek) and 9 at universities (AMOLF, TU Delft).

### 2026-11-27 (late night) · Claude (for Panos and Apo) · National employment services

- New `SOURCES.md`: every source by country, what each other country would
  need, and why some are closed. Please keep it current.
- Sweden (Arbetsförmedlingen, open JobTech API) and Norway (NAV's feed, with
  its public token) are new sources, in `extension/lib/sources.js` as
  `jobtech` and `nav`. They run only for users who can work in that country,
  searched in the country's language: ESCO names every occupation in 28
  languages, looked up once and kept in `profile.occupationNames`.
- Adding another country: an entry in `NATIONAL_PORTALS`
  (`extension/lib/portals.js`), its board in `sources.js`, its site in the
  manifest's optional permissions, and the privacy texts (`store/`).
- The permission question now names only the user's own countries' sites
  (`portalOriginsFor`), so a Greek user is never asked for Norway's.
- EURES was down on 2026-11-27 (European Commission "service unavailable");
  scans go on without it.
- For Panos: most of the world (Asia, the Americas, Africa) has no open job
  API; Careerjet and Jooble would cover it, but only from a server. See the
  end of `SOURCES.md`.

### 2026-11-27 (night) · Claude (for Panos and Apo) · PDFs that read as empty

- For Apo: your `ApoCVeng.pdf` gave 17 characters. Without the file I fixed
  the four ways a real PDF loses its text in `extension/lib/cv.js`; once this
  is on `main`, please try it again, and if it still fails, send Panos the PDF.
  - One-byte font codes with a ToUnicode map (Word, Canva) were read as two
    bytes each, so nearly every letter vanished.
  - Text inside form XObjects (Canva, InDesign, "Save as PDF") was never read.
  - `TextDecoder("latin1")` is Windows-1252: it turned bytes 0x80-0x9F into
    "€", "’", which broke font codes in that range. PDFs are now read as bytes.
  - Encrypted PDFs that open without a password, as CV builders make them,
    are decrypted (new `extension/lib/pdfcrypt.js`: RC4, AES-128, AES-256);
    ones that need a password give no text instead of junk.
- Tests: `tests/cv-pdf.test.mjs`, with a PDF builder that encrypts with Node's
  own crypto (`tests/helpers/pdf.mjs`); every case fails on the old reader.

### 2026-11-27 (evening) · Claude (for Panos and Apo) · Matching, autofill, cover letters

- For Apo: all of this is on branch `search-fixes` (pull request #3), not on
  `main` until #3 is merged. The Netherlands case (other countries, thousands
  of unrelated matches) is fixed there, not on `main`.
- A match needs one of the user's job titles, in the job's title or text
  (`matcher.js`, `jobora/matcher.py`): location, language, industry and
  freshness alone reached the minimum score. Netherlands, developer: 110 of
  141 matches were unrelated, now 0 of 9. A language counts only when the ad
  names it ("Dutch", "Nederlands"), not because the job is in the Netherlands.
- The Python engine matches locations like the extension (`jobora/places.py`,
  generated from `places.js`; `tests/test_places.py` fails if they drift).
- Autofill (`content/prefill.js`, `content/button.js`, new
  `lib/applications.js`): the form gets its own application (Lever "/apply",
  Greenhouse on another host, the company's own site), and no cover letter
  when it cannot tell; it used to take the latest, another company's letter.
  Submit marks the application sent even after clicking fields first. Job
  text in the report box is text, not HTML. The CV never goes into a cover
  letter upload; "Company name", "Ethnicity", "Open source…" stay empty. The
  button and report box speak the user's language.
- The worker loads the user's language before every message (a fresh worker
  answered with keys like "fill.nothingPrepared").
- Letters without a key: a template in every language Settings offers (Dutch
  and Polish added); others came out in English. The Python template no
  longer claims "customer-facing experience" for everyone.
- "Save to Jobora" on social sites speaks the user's language (it was Greek
  only) and finds job posts in nine languages (English and Greek only).
- For Apo: `python -m jobora serve` used to copy an old form filler
  (`jobora/static/prefill.js`, now deleted) over `extension/content/prefill.js`
  on every start, undoing later fixes. If you ran it, check `git status` for
  that file. The dashboard now serves the extension's script itself.
- Python engine: `status`, `matches` and `history` crashed on a new machine
  (no tables); the history in `data/jobhunter.db`, left behind by the rename
  in September, is taken over as `data/jobora.db`. Forms filled from the
  dashboard are matched to applications like the extension does, both checked
  against `tests/fixtures/application-matching.json`.
- Tests: 108 Node, 22 Python, 5 browser pages (see `extension/README.md`),
  one of them a whole scan through the service worker.
- 1.2.0 is packaged (`python store/package.py`, preflight 0 errors); it goes
  to the store once pull request #3 is merged.

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
