"""
The Python engine's scoring rules beyond location (jobora/matcher.py): the
same cases as the extension's tests in tests/matcher.test.mjs.

Run from the repository root:  python -m unittest discover -s tests
"""
import pathlib
import sys
import unittest
from datetime import datetime, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from jobora.matcher import score_job  # noqa: E402
from jobora.profile import Preferences  # noqa: E402


def score(title, location, description="", **preferences):
    job = {"title": title, "location": location, "description": description,
           "posted_at": datetime.now(timezone.utc).isoformat()}
    return score_job(job, Preferences(**preferences))


class TitlesAndLanguages(unittest.TestCase):
    def test_a_job_matching_none_of_the_titles_is_not_a_match(self):
        # Apo's case: in the Netherlands, Dutch browser, tech industry, looking for a developer job.
        prefs = dict(titles=["Software Engineer"], locations=["Netherlands"], languages=["nl"], industries=["tech"])
        value, reasons = score("Dutch speaking Support Specialist", "Amsterdam, Netherlands",
                               "Join our tech team. Fluent Dutch required.", **prefs)
        self.assertEqual((value, reasons.get("rejected")), (0, "none of your job titles"))
        self.assertGreater(score("Software Engineer", "Amsterdam, Netherlands", **prefs)[0], 0)
        self.assertGreater(score("Backend Developer", "Amsterdam, Netherlands",
                                 "As a software engineer you will…", **prefs)[0], 0)

    def test_a_language_counts_only_when_the_ad_names_it(self):
        dutch = dict(titles=["Barista"], locations=["Netherlands"], languages=["nl"])
        self.assertNotIn("language_signal", score("Barista", "Amsterdam, Netherlands", **dutch)[1])
        self.assertEqual(score("Barista", "Amsterdam, Netherlands", "Fluent Dutch required", **dutch)[1]
                         .get("language_signal"), ["nl"])
        german = dict(titles=["Barista"], locations=["Germany"], languages=["de"])
        self.assertNotIn("language_signal", score("Barista", "Berlin, Germany", "Our office in Deutschland", **german)[1])
        self.assertEqual(score("Barista", "Berlin, Germany", "Fließend Deutsch", **german)[1]
                         .get("language_signal"), ["de"])
        greek = dict(titles=["Barista"], locations=["Greece"], languages=["el"])
        self.assertEqual(score("Barista", "Αθήνα", "Άριστη γνώση ελληνικών", **greek)[1].get("language_signal"), ["el"])


if __name__ == "__main__":
    unittest.main()
