# 🎯 Jobora — browser extension

Job hunting that runs by itself. Upload your CV once; from then on it searches
twice a day, ranks what fits you, and fills in the application forms.

**Nothing to install beyond the extension.** No Python, no account, no server.
Your CV, your profile and every application stay in your browser.

---

## Install (2 minutes)

1. Open `chrome://extensions` — or `edge://extensions`, or `brave://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and select this `extension` folder
4. Setup opens automatically: drop in your CV, confirm your job titles, done

The first search starts immediately and takes about half a minute.

---

## What happens next

```
   ┌────────────┐   twice a day    ┌──────────┐   your filters  ┌──────────┐
   │ job boards │ ───────────────► │  scoring │ ──────────────► │  matches │
   │  + career  │  ~2,000 postings │  0-100   │                 │  ranked  │
   │   pages    │                  └──────────┘                 └────┬─────┘
   └────────────┘                                                     │
                       ┌──────────┐   you press submit   ┌───────────▼──────┐
                       │ pipeline │ ◄─────────────────── │  form filled in  │
                       │ tracking │                      │  + CV attached   │
                       └──────────┘                      └──────────────────┘
```

- **Searches on its own.** Twice a day in the background, with a notification
  when new roles match. The toolbar icon shows how many are waiting.
- **Explains every score.** 0-100 from job title (40), location (25), industry
  (10), language (10), freshness (10) and salary (5). Roles outside the regions
  you can work in are dropped, and it says so.
- **Writes the cover letter.** From a template, or from Claude if you add your
  own Anthropic API key in Settings.
- **Fills the form.** Open a posting and press *Fill with Jobora*: name,
  email, phone, location, LinkedIn, salary, notice period, the cover letter —
  and your CV attached as a real file.
- **Tracks everything.** A pipeline board from Prepared through Sent, Interview
  and Offer. Drag cards between stages.

It never presses Submit. Dropdowns about work authorization or relocation are
left untouched and flagged — a wrong answer there costs more than the three
seconds it takes you to pick.

---

## Where the jobs come from

Public, documented, free APIs only:

**Job boards** — Remotive, Arbeitnow, RemoteOK, Jobicy, Himalayas, WorkingNomads.

**Company career pages** — any employer on Greenhouse, Lever, Ashby, Workable,
SmartRecruiters or Recruitee. Pick industries in Settings and a matching set is
tracked for you.

No LinkedIn or Indeed automation: their terms forbid it and it gets accounts
banned.

---

## Settings worth knowing

| Setting | What it does |
|---|---|
| **Job titles** | The strongest signal — 40 of the 100 points |
| **Where you can work** | Countries, cities, or `Remote` / `Worldwide`. Understands `EU`, `EMEA`, `APAC`, `LATAM`, `US`, `UK`, `ANZ`, `UAE` |
| **Hide jobs outside my locations** | Drops “Remote — US only” style postings |
| **Regions you cannot work in** | Explicit blocklist for work-authorization reasons |
| **Industries** | Chooses which company career pages get watched |
| **Anthropic API key** | Optional. Claude writes each letter from your CV and the job description |
| **Minimum score** | How picky the matches list is. Default 55 |

---

## Privacy

Everything lives in `chrome.storage.local` on this machine. The extension talks
to exactly two kinds of host: the public job APIs listed above, and
`api.anthropic.com` — only if you supply your own key. There is no Jobora
server and no account.

---

## Layout

```
manifest.json          permissions and content-script targets
background.js          the engine: scheduled scans, badge, notifications, messages
lib/sources.js         9 company-board providers (ATS) + 17 job boards
lib/portals.js         the job portals that need the user's permission first
lib/esco.js            ESCO occupations, so EURES finds every industry in any language
lib/scanplan.js        what a scan asks EURES: which occupations, which countries
lib/matcher.js         0-100 scoring: titles, location, language, salary, freshness
lib/places.js          countries, cities and regions, as whole words
lib/cv.js              reads a CV and pulls out name, contact details, home and titles
lib/documents.js       text out of DOCX, ODT, RTF and old .doc files
lib/letters.js         cover letters: a template in nine languages, or Claude
lib/applications.js    which prepared application an application form belongs to
lib/companies.js       company library by industry
lib/professions.js     job titles by industry
lib/suggest.js         vocabulary for the job title and location fields
lib/tagfield.js        the tag fields with suggestions
lib/fx.js              currency conversion, for comparing salaries
lib/i18n.js            the eight interface languages
lib/store.js           storage layer
app.html/js/css        dashboard: matches, pipeline, settings
onboarding.html/js     first-run setup
popup.html/js          toolbar popup
content/prefill.js     the form filler
content/button.js      the “Fill with Jobora” button on application pages
content/save.js        "Save to Jobora" for ads on social sites, when switched on
```

Regression tests for CV reading and job matching (Node.js 22 or newer, from
the repository root):

```sh
node --test "tests/*.test.mjs"
```

GitHub runs the same command on every pull request and every push to `main`
(`.github/workflows/tests.yml`), and shows the result on the pull request.

For the checks that need a real browser, serve the repository locally with
`python -m http.server 8765 --bind 127.0.0.1`, then open:

- `http://127.0.0.1:8765/tests/onboarding.browser.html`: CV upload, name
  editing, styling, and the address and country read from the CV.
- `http://127.0.0.1:8765/tests/settings.browser.html`: what a new CV does in
  Settings (fills an empty location, offers its job titles).
- `http://127.0.0.1:8765/tests/dashboard.browser.html`: the dashboard and its
  scan states in every language.
- `http://127.0.0.1:8765/tests/autofill.browser.html`: "Fill with Jobora" on
  sample Greenhouse, Lever and Workable forms.
- `http://127.0.0.1:8765/tests/save.browser.html`: "Save to Jobora" on a job
  post, as on a social site.
- `http://127.0.0.1:8765/tests/popup.browser.html`: the toolbar popup.

Each page reports PASS or FAIL and uses synthetic CVs and simulated extension
storage.

The Python engine's tests: `python -m unittest discover -s tests`.

There is also a Python version in `../jobora/` for power users: same engine,
plus SMTP email applications and IMAP tracking of company replies — things a
browser extension cannot do.
