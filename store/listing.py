# -*- coding: utf-8 -*-
"""
What the Chrome Web Store listing says, checked by store/preflight.py before
every submission: the web addresses it links to, read from store/LISTING.md,
and the version the store has published.

The dashboard reports both kinds of problem only at the very end:
- It will not publish while one of the addresses is unreachable ("Homepage
  URL is not reachable"). That is how we found out that
  georgasp.github.io/jobhunter/ had answered 404 ever since the repository was
  renamed: GitHub redirects a renamed repository's github.com pages, but not
  its GitHub Pages site, and the homepage field still pointed there. Nothing
  in the repository listed that address, so nothing checked it.
- It refuses a package whose version is not above the published one, and says
  so only after the upload.
"""
import http.client
import re
import urllib.error
import urllib.request
from typing import NamedTuple

# ── The addresses ────────────────────────────────────────────────────

# The dashboard's own labels, so each address in LISTING.md is easy to find on screen.
FIELDS = ("Homepage URL", "Support URL", "Privacy policy URL")

# An address in LISTING.md: its label in bold, then the address alone in a code block.
FIELD_PATTERN = re.compile(r"^\*\*(?P<label>[^*\n]+):\*\*[^\n]*\n```\n(?P<url>\S+)\n```", re.M)

TIMEOUT_SECONDS = 15

# What asking an address can find.
OK = "ok"                # it answers at this very address
MOVED = "moved"          # it answers only through a redirect, which can stop at any time
BROKEN = "broken"        # the server answers with an error such as 404, or it is no web address
UNCHECKED = "unchecked"  # nothing answers (offline, DNS, timeout), so the address may be fine


class Check(NamedTuple):
    state: str
    detail: str  # where the address ends up when MOVED, otherwise what happened


def read_urls(listing_text):
    """{label: address} for each of FIELDS that LISTING.md fills in, in the order of FIELDS."""
    found = {match["label"]: match["url"] for match in FIELD_PATTERN.finditer(listing_text)}
    return {label: found[label] for label in FIELDS if label in found}


def check_url(url, open_url=urllib.request.urlopen):
    """Asks the address once and says what happened. Tests pass their own open_url."""
    try:
        with open_url(url, timeout=TIMEOUT_SECONDS) as response:
            final_url = response.geturl()
    # HTTPError comes first: it is also an OSError, but it means the server
    # did answer, and said no.
    except urllib.error.HTTPError as error:
        return Check(BROKEN, f"HTTP {error.code}")
    except ValueError:
        return Check(BROKEN, "not a web address")
    except (OSError, http.client.HTTPException) as error:
        return Check(UNCHECKED, type(error).__name__)
    if final_url != url:
        return Check(MOVED, final_url)
    return Check(OK, url)


# ── The published version ────────────────────────────────────────────

# The store page's "Details" box, asked for in English: a "Version" label, then
# the number in the next element (<div>Version</div><div>1.0.0</div>).
VERSION_LABEL = "Version"
VERSION_NUMBER = re.compile(r"\d+(?:\.\d+){0,3}")
TEXT_BETWEEN_TAGS = re.compile(r">([^<]+)<")


def published_version(page_html):
    """The version the store page shows, or None when it shows none.

    Reads only the text between tags, so a renamed CSS class does not break
    it, and the page's own scripts, which say "Version" too, are passed over.
    """
    texts = [text.strip() for text in TEXT_BETWEEN_TAGS.findall(page_html) if text.strip()]
    for label, value in zip(texts, texts[1:]):
        if label == VERSION_LABEL and VERSION_NUMBER.fullmatch(value):
            return value
    return None
