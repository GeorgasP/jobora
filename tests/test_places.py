"""
The Python engine's location rules (jobora/places.py, jobora/matcher.py): the
same cases as tests/matcher.test.mjs, and a check that the place tables of
places.py and extension/lib/places.js have not drifted apart.

Run from the repository root:  python -m unittest discover -s tests
"""
import pathlib
import re
import sys
import unittest
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from jobora.matcher import score_job  # noqa: E402
from jobora.places import COUNTRIES  # noqa: E402
from jobora.profile import Preferences  # noqa: E402


def outcome(location, home="", remote=False, title="Barista", **preferences):
    """'match', or the reason the matcher gives for rejecting a fresh Barista ad."""
    job = {"title": title, "location": location, "description": "",
           "posted_at": datetime.now(timezone.utc).isoformat(), "remote": remote}
    score, reasons = score_job(job, Preferences(titles=["Barista"], **preferences), home=home)
    return reasons.get("rejected") or "match"


def rejected_for_location(result):
    return result.startswith("location outside your list")


class LocationRules(unittest.TestCase):
    def test_a_place_counts_only_as_a_whole_word(self):
        self.assertTrue(rejected_for_location(outcome("Madrid, es", title="Evergreen Barista", locations=["Greece"])))
        self.assertEqual(outcome("Athens, Greece", locations=["Greece"]), "match")

    def test_a_remote_job_limited_to_another_country_does_not_count_as_remote(self):
        for location in ["Remote - Canada", "US Only", "Remote - FL; Remote - GA", "Remote - Germany"]:
            with self.subTest(location=location):
                self.assertTrue(rejected_for_location(outcome(location, remote=True, locations=["Greece", "Remote"])))

    def test_a_remote_job_open_to_everyone_or_the_users_region_counts(self):
        for location in ["Remote", "Anywhere in the World", "Remote (Europe)", "Time zone: CET (+/- 3 hours)"]:
            with self.subTest(location=location):
                self.assertEqual(outcome(location, remote=True, locations=["Greece", "Remote"]), "match")

    def test_anywhere_within_one_country_is_not_anywhere(self):
        self.assertTrue(rejected_for_location(outcome("Anywhere in France", remote=True, locations=["Greece", "Remote"])))

    def test_the_users_address_decides_which_remote_jobs_are_open(self):
        home = "Spata, Attica, Greece"
        self.assertTrue(rejected_for_location(outcome("Remote - Canada", home, remote=True, locations=["Remote"])))
        self.assertEqual(outcome("Remote (Europe)", home, remote=True, locations=["Remote"]), "match")
        self.assertEqual(outcome("Remote - Canada", "", remote=True, locations=["Remote"]), "match")

    def test_a_region_matches_the_countries_inside_it(self):
        self.assertEqual(outcome("Berlin, Germany", locations=["EU"]), "match")
        self.assertTrue(rejected_for_location(outcome("Zürich, Switzerland", locations=["EU"])))
        self.assertEqual(outcome("Zürich, Switzerland", locations=["Europe"]), "match")

    def test_a_job_with_no_location_is_not_worldwide(self):
        self.assertIn("no location given", outcome("", locations=["Greece"]))

    def test_blocking_a_country_also_blocks_its_cities(self):
        result = outcome("New York, NY", locations=["Remote"], blocked_locations=["USA"], strict_location=False)
        self.assertEqual(result, "blocked location: USA")


class SamePlacesAsTheExtension(unittest.TestCase):
    """places.py copies the tables of places.js; a change to one must reach the other."""

    def test_every_country_has_the_same_label_code_and_spellings(self):
        source = (ROOT / "extension" / "lib" / "places.js").read_text(encoding="utf-8")
        table = source[source.index("const COUNTRIES = {"):source.index("\n};", source.index("const COUNTRIES = {"))]
        starts = list(re.finditer(r'^  "?([a-z][a-z ]*)"?: \{ label: "([^"]+)", code: "([A-Z]{2})"', table, re.M))
        self.assertEqual(len(starts), len(COUNTRIES))
        for i, match in enumerate(starts):
            key, label, code = match.groups()
            segment = table[match.end():starts[i + 1].start() if i + 1 < len(starts) else len(table)]
            # Spellings only: a "regions" list such as [...AFRICA, "mena"] names regions.
            spellings = re.sub(r"regions: (?:\[[^\]]*\]|\w+)", "", segment)
            js_terms = set(re.findall(r'"([^"]+)"', spellings))
            py = COUNTRIES[key]
            with self.subTest(country=key):
                self.assertEqual((py["label"], py["code"]), (label, code))
                self.assertEqual(set(py["names"]) | {t for city in py["cities"] for t in city}, js_terms)


if __name__ == "__main__":
    unittest.main()
