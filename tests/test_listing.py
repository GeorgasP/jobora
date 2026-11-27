"""
What the Chrome Web Store listing says (store/listing.py): the addresses it
links to, and the version the store has published.

The dashboard refused to publish 1.2.0 with "Homepage URL is not reachable".
The homepage still pointed at the old name's GitHub Pages site, which has
answered 404 since the repository was renamed, and LISTING.md did not list a
homepage at all, so store/preflight.py had nothing to check. Its check of the
published version had also stopped working: the store page now shows the
label before the number.

These tests never touch the network: addresses are asked through a fake.

Run from the repository root:  python -m unittest discover -s tests
"""
import pathlib
import sys
import unittest
import urllib.error

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "store"))

import listing  # noqa: E402
from listing import BROKEN, FIELDS, MOVED, OK, UNCHECKED, check_url  # noqa: E402

LISTING = (ROOT / "store" / "LISTING.md").read_text(encoding="utf-8")

HOMEPAGE = "https://georgasp.github.io/jobora/"
OLD_HOMEPAGE = "https://georgasp.github.io/jobhunter/"
OLD_SUPPORT = "https://github.com/GeorgasP/jobhunter/issues"
SUPPORT = "https://github.com/GeorgasP/jobora/issues"

# The "Details" box of the published listing, as the store served it on 2026-11-27.
DETAILS = (
    '<h2 class="p9xg1">Details</h2></div><div class="im4wIf"><ul class="TKAMQe">'
    '<li class="MqICNe ecmXy"><div class="QDHp8e">Version</div><div class="nBZElf">1.0.0</div></li>'
    '<li class="MqICNe uBIrad"><div class="QDHp8e">Updated</div><div>September 23, 2026</div></li>'
)
# Google's own scripts on the same page say "Version" too.
PAGE_SCRIPT = r"<script>if(_.ac)return/(?:Version)[ \/]?(\S+)/.exec(c)</script>"


class FakeResponse:
    """What urllib.request.urlopen returns, reduced to what check_url reads."""

    def __init__(self, final_url):
        self.final_url = final_url

    def geturl(self):
        return self.final_url

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False


def answering_from(final_url):
    """An opener whose answer comes from final_url, after any redirect."""
    return lambda url, timeout: FakeResponse(final_url)


def failing_with(error):
    """An opener that raises error, as urlopen does for 404s and lost networks."""

    def open_url(url, timeout):
        raise error

    return open_url


class TheListingWritesEveryAddressDown(unittest.TestCase):
    def test_every_address_the_store_asks_for_is_in_listing_md(self):
        listed = listing.read_urls(LISTING)
        self.assertEqual(list(listed), list(FIELDS))
        for label, url in listed.items():
            self.assertTrue(url.startswith("https://"), f"{label}: {url}")

    def test_an_address_is_its_bold_label_and_the_code_block_under_it(self):
        text = (
            "**Category:** Productivity\n"
            "**Homepage URL:**\n```\nhttps://example.org/\n```\n\n"
            "**Name** (max 75)\n```\nJobora\n```\n"
        )
        self.assertEqual(listing.read_urls(text), {"Homepage URL": "https://example.org/"})


class AskingAnAddress(unittest.TestCase):
    def test_an_address_that_answers_itself_is_ok(self):
        self.assertEqual(check_url(HOMEPAGE, answering_from(HOMEPAGE)), (OK, HOMEPAGE))

    def test_an_address_that_answers_through_a_redirect_says_where_it_went(self):
        # github.com still redirects the old repository name; that can stop
        # the day someone creates a repository with the old name.
        self.assertEqual(check_url(OLD_SUPPORT, answering_from(SUPPORT)), (MOVED, SUPPORT))

    def test_a_404_is_broken(self):
        not_found = urllib.error.HTTPError(OLD_HOMEPAGE, 404, "Not Found", None, None)
        self.assertEqual(check_url(OLD_HOMEPAGE, failing_with(not_found)), (BROKEN, "HTTP 404"))

    def test_text_that_is_not_a_web_address_is_broken(self):
        # urlopen refuses it before any request is made.
        self.assertEqual(check_url("georgasp.github.io/jobora/").state, BROKEN)

    def test_no_answer_at_all_is_unchecked_not_broken(self):
        # Offline, DNS or a timeout says nothing about the address itself.
        for error in (urllib.error.URLError("offline"), TimeoutError("timed out")):
            with self.subTest(error=type(error).__name__):
                self.assertEqual(check_url(HOMEPAGE, failing_with(error)).state, UNCHECKED)


class ReadingThePublishedVersion(unittest.TestCase):
    def test_the_number_after_the_version_label(self):
        self.assertEqual(listing.published_version(PAGE_SCRIPT + DETAILS), "1.0.0")

    def test_a_page_without_a_version_gives_none(self):
        # Such as Google's consent page, served instead of the listing.
        page = PAGE_SCRIPT + "<h1>Before you continue to Google</h1><p>Version</p><p>Accept all</p>"
        self.assertIsNone(listing.published_version(page))


if __name__ == "__main__":
    unittest.main()
