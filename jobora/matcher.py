"""
Scoring: πόσο ταιριάζει ένα job στο profile σου (0-100).

Ο τίτλος μετράει πολύ περισσότερο από το description — εκεί κρύβονται τα
false positives ("κάπου στη σελίδα γράφει customer success" ≠ CS ρόλος).
Ό,τι κόβεται, κόβεται με λόγο που φαίνεται στο dashboard.
"""
from __future__ import annotations

import re
from functools import lru_cache
from datetime import datetime, timezone

from .places import fold, places_in, regions_of, regions_overlap, resolve_place
from .profile import Preferences

# βάρη ανά κατηγορία — άθροισμα 100
W_TITLE, W_LOCATION, W_INDUSTRY, W_LANGUAGE, W_FRESHNESS, W_SALARY = 40, 25, 10, 10, 10, 5

SENIOR_MARKERS = ("senior", "sr.", "lead", "principal", "staff", "head of",
                  "director", "vp ", "vice president", "chief", "manager iii")
ENTRY_MARKERS = ("junior", "jr.", "entry", "graduate", "trainee", "intern",
                 "apprentice", "associate")

# Words that say an ad asks for a language: the language's own names, never a
# country or city (the location counts those already). "*" = any ending.
LANGUAGE_WORDS = {
    "el": ("greek", "hellenic", "ελληνικ*"),
    "es": ("spanish", "español", "espanol", "castellano"),
    "de": ("german", "deutsch", "deutschkenntnisse"),
    "fr": ("french", "français", "francais", "francophone"),
    "it": ("italian", "italiano"),
    "pt": ("portuguese", "português", "portugues"),
    "nl": ("dutch", "nederlands", "nederlandstalig*"),
    "pl": ("polish", "polski", "polsku"),
}
# One whole-word pattern per language, so "deutsch" doesn't match "Deutschland".
LANGUAGE_PATTERNS = {
    language: re.compile(r"(?<!\w)(?:" + "|".join(
        re.escape(word[:-1]) + r"\w*" if word.endswith("*") else re.escape(word) for word in words) + r")(?!\w)")
    for language, words in LANGUAGE_WORDS.items()
}


# ── Where a job is, and whether the user wants to work there ──
# The same rules as extension/lib/matcher.js, on the same place data.


def _job_places(job: dict):
    """The places a job names: in its location and source country, and (names only) in its title."""
    where = places_in(job.get("location") or "") | places_in(job.get("country") or "")
    return where, places_in(job.get("title") or "", True)


@lru_cache(maxsize=64)
def _user_places(locations: tuple, blocked: tuple, home: str) -> dict:
    """
    What the user's locations mean: the places they want, the ones they
    blocked, and where they are. Where they are is the countries they named
    plus the country of their own address; it decides which remote jobs are open.
    """
    def resolve(typed):
        places = []
        for place in map(resolve_place, typed):
            if not place["label"]:
                continue
            if place["kind"] == "text":
                place = {**place, "pattern": re.compile(r"(?<!\w)" + re.escape(place["text"]) + r"(?!\w)")}
            places.append(place)
        return places

    wanted = resolve(locations)
    home_countries = {p["country"] for p in wanted if p.get("country")} | set(places_in(home).countries)
    return {
        "wanted": wanted,
        "blocked": resolve(blocked),
        "home_countries": home_countries,
        "home_regions": [region for country in home_countries for region in regions_of(country)],
        "wanted_regions": [p["region"] for p in wanted if p["kind"] == "region"],
    }


def _is_remote_job(job: dict, where) -> bool:
    return bool(job.get("remote")) or where.remote


def _in_region(region: str, places) -> bool:
    return (any(regions_overlap(r, region) for r in places.regions)
            or any(region in regions_of(country) for country in places.countries))


def _open_to_user(where, user: dict) -> bool:
    """
    Whether a remote job is open to the user. One that names no place, or says
    worldwide, is open to everyone; one that names places ("Remote - Canada",
    "Remote (Europe)") only to people in them. If we don't know where the user
    is, we can't tell, so it counts as open.
    """
    if where.global_ or (not where.countries and not where.regions):
        return True
    if not user["home_countries"] and not user["wanted_regions"]:
        return True
    if where.countries & user["home_countries"]:
        return True
    mine = user["home_regions"] + user["wanted_regions"]
    if any(regions_overlap(r, m) for r in where.regions for m in mine):
        return True
    # The user wants a whole region ("EU") and the job is limited to a country in it.
    return any(region in regions_of(country) for country in where.countries for region in user["wanted_regions"])


def _in_place(place: dict, job: dict, where, in_title, user: dict) -> bool:
    """Whether a job is in one place the user typed."""
    kind = place["kind"]
    if kind == "remote":
        return _is_remote_job(job, where) and _open_to_user(where, user)
    if kind == "city":
        return place["city"] in where.cities or place["city"] in in_title.cities
    if kind == "country":
        return place["country"] in where.countries or place["country"] in in_title.countries
    if kind == "region":
        return _in_region(place["region"], where) or _in_region(place["region"], in_title)
    # A place the places module doesn't know, such as a small town: its words must appear.
    return bool(place["pattern"].search(fold(f"{job.get('location') or ''} {job.get('title') or ''}")))


def _norm(s: str | None) -> str:
    return (s or "").lower()


def _age_days(posted_at: str | None) -> float | None:
    if not posted_at:
        return None
    try:
        dt = datetime.fromisoformat(posted_at)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - dt).total_seconds() / 86400


def _phrase_in(phrase: str, text: str) -> bool:
    """Word-boundary match ώστε το 'BD' να μην πιάνει το 'BDD'."""
    return re.search(r"(?<!\w)" + re.escape(phrase.lower()) + r"(?!\w)", text) is not None


def score_job(job: dict, prefs: Preferences, home: str = "") -> tuple[int, dict]:
    """Returns (score 0-100, reasons); 0 means "don't show it". `home` is the user's own address (Profile.location)."""
    title = _norm(job.get("title"))
    location = _norm(job.get("location"))
    description = _norm(job.get("description"))[:6000]
    haystack = f"{title} {location} {description}"

    reasons: dict[str, object] = {}

    # ─── Hard filters ───────────────────────────────────────────
    for kw in prefs.exclude_keywords:
        if _phrase_in(kw, title) or _phrase_in(kw, description[:1500]):
            return 0, {"rejected": f"excluded keyword: {kw}"}

    for kw in prefs.must_have:
        if not _phrase_in(kw, haystack):
            return 0, {"rejected": f"missing must-have: {kw}"}

    if prefs.remote_only and not (job.get("remote") or "remote" in haystack):
        return 0, {"rejected": "not remote"}

    # ─── Location ───────────────────────────────────────────────
    # The same rules for every country: "Remote - US only" is not for someone
    # in Brazil, as "Remote - LATAM" is not for someone in Japan.
    where, in_title = _job_places(job)
    user = _user_places(tuple(prefs.locations), tuple(prefs.blocked_locations), home or "")
    geo_hits = [p["label"] for p in user["wanted"] if _in_place(p, job, where, in_title, user)]
    # Only the ad itself can say it is open everywhere; an ad with no location says nothing.
    globally_open = where.global_

    blocked_hit = next((p["label"] for p in user["blocked"]
                        if (_is_remote_job(job, where) if p["kind"] == "remote"
                            else _in_place(p, job, where, in_title, user))), None)
    if blocked_hit and not geo_hits:
        return 0, {"rejected": f"blocked location: {blocked_hit}"}

    if prefs.strict_location and user["wanted"] and not geo_hits and not globally_open:
        return 0, {"rejected": f"location outside your list: {job.get('location') or 'no location given'}"}

    age = _age_days(job.get("posted_at"))
    if age is not None and prefs.max_age_days and age > prefs.max_age_days:
        return 0, {"rejected": f"stale posting ({int(age)} days old)"}

    score = 0.0

    # ─── Title (το βαρύτερο σήμα) ───────────────────────────────
    title_hits = [t for t in prefs.titles if _phrase_in(t, title)]
    desc_hits = [t for t in prefs.titles if t not in title_hits and _phrase_in(t, description)]
    if title_hits:
        score += W_TITLE
        reasons["title_match"] = title_hits
    elif desc_hits:
        score += W_TITLE * 0.35
        reasons["title_match_in_description"] = desc_hits
    elif prefs.titles:
        # A job that matches none of the user's titles, in its title or its
        # text, is not a match however many other points it collects:
        # location, language, industry and freshness alone reach the minimum.
        return 0, {"rejected": "none of your job titles"}

    # ─── Location ───────────────────────────────────────────────
    if geo_hits:
        score += W_LOCATION
        reasons["location_match"] = sorted(set(geo_hits))
    elif globally_open or not prefs.locations:
        score += W_LOCATION * 0.7
        if globally_open:
            reasons["location_match"] = ["Worldwide"]

    # ─── Industry ───────────────────────────────────────────────
    industry_hits = [i for i in prefs.industries if _phrase_in(i, haystack)]
    if industry_hits:
        score += W_INDUSTRY
        reasons["industry_match"] = industry_hits

    # ─── Γλώσσα ως πλεονέκτημα (π.χ. "Greek speaker required") ──
    lang_hits = []
    for lang in prefs.languages:
        pattern = LANGUAGE_PATTERNS.get(lang)
        if pattern and pattern.search(haystack):
            lang_hits.append(lang)
    if lang_hits:
        score += W_LANGUAGE
        reasons["language_signal"] = lang_hits

    # ─── Φρεσκάδα ───────────────────────────────────────────────
    if age is None:
        score += W_FRESHNESS * 0.5
    else:
        window = max(prefs.max_age_days or 45, 1)
        score += W_FRESHNESS * max(0.0, 1 - age / window)
        reasons["posted_days_ago"] = int(age)

    # ─── Μισθός ─────────────────────────────────────────────────
    smax, smin = job.get("salary_max"), job.get("salary_min")
    if prefs.salary_min and (smin or smax):
        best = smax or smin
        if best >= prefs.salary_min:
            score += W_SALARY
            reasons["salary_ok"] = f"{smin or '?'}–{smax or '?'}"
        else:
            score -= W_SALARY * 2
            reasons["salary_low"] = f"{smin or '?'}–{smax or '?'}"

    # ─── Seniority fit ──────────────────────────────────────────
    is_senior = any(m in title for m in SENIOR_MARKERS)
    is_entry = any(m in title for m in ENTRY_MARKERS)
    if prefs.experience_level == "entry" and is_senior:
        score -= 25
        reasons["seniority_penalty"] = "senior role"
    elif prefs.experience_level == "senior" and is_entry:
        score -= 20
        reasons["seniority_penalty"] = "entry-level role"
    elif prefs.experience_level == "mid" and is_senior and any(
        m in title for m in ("director", "vp ", "chief", "head of")
    ):
        score -= 15
        reasons["seniority_penalty"] = "leadership role"

    final = int(max(0, min(100, round(score))))
    return final, reasons


def explain(reasons: dict) -> str:
    """One-line summary for CLI/dashboard."""
    if "rejected" in reasons:
        return f"✗ {reasons['rejected']}"
    bits = []
    if reasons.get("title_match"):
        bits.append("title: " + ", ".join(reasons["title_match"]))
    elif reasons.get("title_match_in_description"):
        bits.append("title (in text): " + ", ".join(reasons["title_match_in_description"]))
    if reasons.get("location_match"):
        bits.append("location: " + ", ".join(reasons["location_match"]))
    if reasons.get("industry_match"):
        bits.append("industry: " + ", ".join(reasons["industry_match"]))
    if reasons.get("language_signal"):
        bits.append("language: " + ", ".join(reasons["language_signal"]))
    if reasons.get("salary_ok"):
        bits.append(f"salary: {reasons['salary_ok']}")
    if reasons.get("seniority_penalty"):
        bits.append(f"⚠ {reasons['seniority_penalty']}")
    if reasons.get("posted_days_ago") is not None:
        bits.append(f"{reasons['posted_days_ago']}d ago")
    return " · ".join(bits) or "general match"
