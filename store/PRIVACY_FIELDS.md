# Chrome Web Store — καρτέλα Privacy

Αντιγραφή κατευθείαν στα πεδία της κονσόλας. Κάθε πεδίο έχει όριο 1.000
χαρακτήρες· ο αριθμός δίπλα στον τίτλο είναι το πραγματικό μήκος.

> **Remote code: No.** Όλος ο κώδικας είναι μέσα στο πακέτο. Καμία ετικέτα
> script προς εξωτερικό αρχείο, κανένα eval().

## Single purpose description  (466/1000)

```
Jobora has one purpose: to help a person find job openings that match their profile, and complete the application forms for those openings. Every feature serves that purpose. It searches public job listings, scores them against the profile, drafts a cover letter, fills in the application form, and tracks the resulting applications. The extension does not browse, advertise, analyse the user's activity, or do anything unrelated to applying for a job.
```

## storage justification  (310/1000)

```
Stores the user's profile, CV file, search preferences, the job listings retrieved from public sources, and the history of their applications on their own device. The extension has no server and no account, so chrome.storage.local is the only place this data exists. None of it is transmitted to the developer.
```

## unlimitedStorage justification  (366/1000)

```
A single search retrieves several thousand public job listings, and the user's CV file is stored alongside them. Together these routinely exceed the default quota. Without this permission the extension would have to discard listings between searches, and would keep re-reporting the same jobs as new. Nothing is uploaded anywhere. The data stays on the user's device.
```

## alarms justification  (298/1000)

```
Runs the background job search twice a day so the user receives new matching openings without having to open the extension and search manually. This is the feature that makes the extension useful at all: job postings are filled quickly, and a search that only runs when remembered arrives too late.
```

## notifications justification  (294/1000)

```
Tells the user when a background search has found new job openings that match their profile, so they can act on a posting while it is still open. The notification contains only the number of matches and the title and company of the first one. It can be switched off in the extension's settings.
```

## scripting justification  (401/1000)

```
Injects the form-filling script into a job application page when the user clicks "Fill with Jobora", for career sites that are not covered by the declared content scripts. The script runs only in response to that explicit click, writes the user's own details into the form's fields, and never submits the form. It is not injected on page load and does not run anywhere the user has not asked it to.
```

## activeTab justification  (306/1000)

```
When the user clicks "Fill the current page" in the extension's popup, the form filler needs access to the tab the user is looking at, at that moment, on that click. activeTab grants exactly that and nothing wider: no access to other tabs, no access before the click, and no access after the tab is closed.
```

## Host permission justification  (974/1000)

```
The extension fetches public job listings and must reach the sites that publish them.

Job boards and applicant tracking systems (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, Workday, Teamtailor, Breezy, Remotive, Arbeitnow, RemoteOK, Jobicy, Himalayas, WorkingNomads, We Work Remotely, Cryptocurrency Jobs, Landing.jobs, DevITjobs, psf.org.gr, skywalker.gr, ordino.gr): read-only requests for public postings. No user data is sent.

europa.eu, ec.europa.eu: EURES, the EU job portal, searched by the occupation codes (from ESCO) of the user's job titles and the countries they chose. No CV or contact details are sent.

api.adzuna.com, api.anthropic.com: optional, only with the user's own key (Anthropic drafts cover letters).

open.er-api.com: daily exchange rates, no parameters, to compare salaries across currencies.

Content scripts run on job application pages only, to show the "Fill with Jobora" button and fill the form when the user clicks it.
```

