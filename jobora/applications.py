"""
Which prepared application an application form belongs to.

The extension's rules (extension/lib/applications.js), held to the same cases
by tests/fixtures/application-matching.json. The form is rarely at the ad's
own address: Lever adds "/apply" and Ashby "/application"; Greenhouse moves
between boards.greenhouse.io and job-boards.greenhouse.io, and companies embed
it on their own sites with "?gh_jid="; and a job found on a board is often
applied for on the company's own site. The rules, strongest first:
  1. the ad's address, or the ad's address with more path after it;
  2. a job id both addresses share;
  3. the company's name in the form's address or page title;
  4. the only application still waiting to be sent.
Otherwise none: a guess would put one company's cover letter into another
company's form.
"""
from __future__ import annotations

import re
import unicodedata
import urllib.parse
from typing import Any, Sequence

from .places import fold

# A run of digits this long is an id, not a year, a count or a title number.
MIN_ID_DIGITS = 5
# A path segment that mixes letters with digits is an id when it is at least
# this long and has at least this many digits: Lever and Ashby UUIDs and
# Workable codes are; "software-engineer-2" is not.
MIN_MIXED_ID_LENGTH = 8
MIN_MIXED_ID_DIGITS = 3
_ID_DIGIT_RUN = re.compile(rf"[0-9]{{{MIN_ID_DIGITS},}}")
# Query parameters that carry a job id ("gh_jid", "jobId", "req"). Others,
# such as "utm_campaign=20241105", say nothing about the job.
_ID_PARAMETER = re.compile(r"id$|^id|job|req", re.I)
# Shorter company names ("HP", "EY") turn up inside unrelated addresses.
MIN_COMPANY_NAME_LENGTH = 4
# Legal forms left off the end of a company's name, so that
# "Thalassa S.A." is found at thalassa.bamboohr.com.
LEGAL_FORMS = frozenset({"sa", "ae", "ee", "oe", "ike", "inc", "llc", "ltd", "limited", "corp", "co",
                         "gmbh", "ag", "kg", "bv", "nv", "plc", "srl", "spa", "sas", "sarl", "sl", "oy", "ab",
                         "as", "aps"})
WAITING = "prepared"


def find_application(apps: Sequence[Any], page_url: str, page_title: str = "") -> Any | None:
    """
    apps: the stored applications, newest first, as dicts or sqlite3.Row
    objects with "url", "company" and "status". Returns one of them, or None.
    """
    candidates = [app for app in apps or [] if app]
    url = _parse(page_url)

    if url:
        page_address = _address(url)
        for app in candidates:
            address = _address(_parse(_field(app, "url")))
            if address and (page_address == address or page_address.startswith(f"{address}/")):
                return app

        page_ids = _job_ids(url)
        if page_ids:
            for app in candidates:
                if page_ids & _job_ids(_parse(_field(app, "url"))):
                    return app

    # The weaker signals only pick among applications not sent yet: an old,
    # sent application to the same company is a different job.
    waiting = [app for app in candidates if _field(app, "status") == WAITING]
    page_text = _squash(f"{url.hostname + url.path if url else ''} {page_title or ''}")
    for app in waiting:
        name = _company_key(_field(app, "company"))
        if name and name in page_text:
            return app

    return waiting[0] if len(waiting) == 1 else None


def _field(app: Any, key: str) -> Any:
    try:
        return app[key]
    except (KeyError, IndexError):
        return None


def _parse(text: Any) -> urllib.parse.SplitResult | None:
    try:
        url = urllib.parse.urlsplit(str(text or ""))
    except ValueError:
        return None
    return url if url.scheme in ("http", "https") and url.hostname else None


def _address(url: urllib.parse.SplitResult | None) -> str:
    """Host and path, without "www.", the query, the fragment or a final "/"."""
    if not url or url.path in ("", "/"):        # a whole site is not one ad
        return ""
    host = re.sub(r"^www\.", "", url.hostname or "")
    return f"{host}{url.path.rstrip('/')}".lower()


def _job_ids(url: urllib.parse.SplitResult | None) -> set[str]:
    ids: set[str] = set()
    if not url:
        return ids
    for segment in url.path.split("/"):
        _add_ids_in(segment, ids)
    for key, value in urllib.parse.parse_qsl(url.query):
        if _ID_PARAMETER.search(key):
            _add_ids_in(value, ids)
    return ids


def _add_ids_in(text: str, ids: set[str]) -> None:
    lower = text.lower()
    ids.update(_ID_DIGIT_RUN.findall(lower))
    digit_count = sum(ch in "0123456789" for ch in lower)
    if len(lower) >= MIN_MIXED_ID_LENGTH and re.search(r"[a-z]", lower) and digit_count >= MIN_MIXED_ID_DIGITS:
        ids.add(lower)


def _squash(text: str) -> str:
    """Letters and digits only, accents folded: "Kyma Hotels – Apply" → "kymahotelsapply"."""
    return "".join(ch for ch in fold(text) if unicodedata.category(ch)[0] in "LN")


def _company_key(name: Any) -> str:
    """The company's name as it would appear in an address, or "" when too short to tell."""
    words = [w for w in re.split(r"[^\w]+|_", fold(str(name or "")).replace(".", "")) if w]
    while len(words) > 1 and words[-1] in LEGAL_FORMS:
        words.pop()
    key = "".join(words)
    return key if len(key) >= MIN_COMPANY_NAME_LENGTH else ""
