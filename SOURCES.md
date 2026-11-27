# Job sources by country

Where Jobora finds jobs, and what every other country would need. Checked on
2026-11-27; keep it current when a source is added or changes.

## The rules

- Only sources their owners publish for reuse: public APIs, feeds, open data,
  or pages their robots.txt allows. Never a site that blocks automated
  requests, and never anything behind a login. LinkedIn, Indeed, Glassdoor,
  StepStone and most commercial boards offer no API and forbid scraping, so
  they are out.
- A country's own sources run only for users who can work in that country,
  and are asked in the country's language: ESCO names each occupation in 28
  languages, with alternative names (`occupationNames` in
  `extension/lib/esco.js`). An ad counts when its title names one of them
  (`namesOccupation` in `extension/lib/sources.js`, with the rules and their
  tests in `tests/national.test.mjs`).
- Sites added after the first store release are optional permissions, asked
  inside the app (`extension/lib/portals.js`), and only for the user's
  countries.

## Covered

| Where | Source | What it brings | Access |
|---|---|---|---|
| Worldwide | Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, Workday, Teamtailor, Breezy | Jobs at the companies in `companies.js`, any country | Public job board APIs |
| Worldwide, remote | Remotive, RemoteOK, Jobicy, Himalayas, WorkingNomads, We Work Remotely, Landing.jobs, Cryptocurrency Jobs, DevITjobs | Remote jobs, mostly tech | Public APIs and feeds |
| EU, EEA, Switzerland (31 countries) | EURES | Every industry, from the national employment services, by ESCO occupation | Public search, optional permission. Down on 2026-11-27 (the Commission's "service unavailable" page); scans go on without it |
| Sweden | Arbetsförmedlingen, Platsbanken | Every job advertised in Sweden | JobTech JobSearch API: open, CC0, no key |
| Norway | NAV, arbeidsplassen.no | Most jobs advertised in Norway | Job vacancy feed, with the public token NAV publishes |
| Netherlands | Werken bij de Overheid (Werken voor Nederland included) | The public sector: about 1,400 jobs, from lawyers and nurses to IT and warehouse staff | Vacancy sitemap and ad pages, allowed by robots.txt |
| Netherlands | Meesterbaan | Teaching jobs at every level: about 2,300 | Vacancy sitemap and ad pages, allowed by robots.txt |
| Netherlands | AcademicTransfer | Universities and research institutes: about 700 | Vacancy sitemap and ad pages (schema.org JobPosting), allowed by robots.txt |
| Greece | jobfind.gr, xe.gr, skywalker.gr, ordino.gr, psf.org.gr | Every industry | RSS, sitemaps, pages allowed by robots.txt |
| 19 countries | Adzuna | Every industry | The user's own free key, in Settings |

## Possible next, without a server

| Country | Source | Status |
|---|---|---|
| Belgium (Wallonia) | Le Forem, open data on ODWB (`offres-d-emploi-forem`) | Official open data (CC BY-SA). Dataset found; the API was rate-limited during the check |
| Poland | Centralna Baza Ofert Pracy (CBOP) | An official JSON API is reported; endpoint and terms to confirm |
| Czechia | MPSV vacancy register | Official open data; published as a whole-register file, size to check |
| Canada | Job Bank | Open data, but monthly files only: not fresh enough |
| Finland | Työmarkkinatori | Only the site's own search endpoint; not an official API, so not used |
| Germany | Bundesagentur für Arbeit | No official API, and its site endpoint refuses scripts (HTTP 403). Covered through EURES |
| Netherlands | UWV, werk.nl | No API ("Werk.nl beschikt helaas niet over een API van alle vacatures", data.overheid.nl), and its sitemap lists no ads. Covered through EURES |
| Netherlands | Werken voor Nederland's CSO Vacature-API | Listed in the government's API register; its server answered 503 on 2026-11-27. The sitemap source above covers the same ads |
| Singapore | MyCareersFuture; Careers@Gov | MyCareersFuture's API is the site's own, not documented for reuse; Careers@Gov publishes government jobs |

## Needs a Jobora server

These would cover most of the world, but cannot run from a browser extension
alone:

| Source | Coverage | Why it needs a server |
|---|---|---|
| Careerjet | 90+ countries, every industry | Free partner API, but each key is tied to declared fixed IP addresses ("dynamic IP addresses … are not supported"), and every call carries the end user's IP |
| Jooble | 70+ countries, including the Gulf, South and Southeast Asia | Key on request; the free tier is reported at about 500 requests per key in total, so it needs one shared key on a server and a partner agreement |
| USAJOBS | US federal jobs | Free key, but the key holder's e-mail must be sent as the User-Agent, which a browser does not let a page set |
| France Travail | Every job in France | Free registration, but OAuth with a client secret, which cannot be shipped inside an extension |

## No public access found

Japan (Hello Work), South Korea (Worknet; data.go.kr still to check), India
(National Career Service), the Philippines (PhilJobNet), Latin America (SINE,
Portal del Empleo, Bolsa Nacional de Empleo, Servicio Público de Empleo;
Computrabajo, Bumeran), the Middle East (Bayt, GulfTalent, Jadarat), Africa
(SAYouth, ESSA, Jobberman), Australia (Workforce Australia), New Zealand.
For these, the route is a worldwide source behind a server (above).
