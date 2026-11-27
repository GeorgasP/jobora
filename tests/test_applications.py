"""
Which prepared application an application form belongs to, in the Python
engine (jobora/applications.py): the same cases as the extension's, read from
tests/fixtures/application-matching.json. And the dashboard's bookmarklet
fills forms with the extension's own script, not a copy of it.

Run from the repository root:  python -m unittest discover -s tests
"""
import json
import pathlib
import sys
import unittest
import urllib.parse
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from jobora.applications import find_application  # noqa: E402

CASES = json.loads((ROOT / "tests" / "fixtures" / "application-matching.json").read_text(encoding="utf-8"))


class SameAnswersAsTheExtension(unittest.TestCase):
    def test_every_case(self):
        for group in CASES["groups"]:
            for page in group["pages"]:
                with self.subTest(rule=group["rule"], url=page["url"]):
                    found = find_application(group["apps"], page["url"], page.get("title", ""))
                    self.assertEqual(found["id"] if found else None, page["expected"])

    def test_no_applications_is_none(self):
        self.assertIsNone(find_application([], "https://apply.example/form"))


class Dashboard(unittest.TestCase):
    FILLER = ROOT / "extension" / "content" / "prefill.js"

    def test_the_bookmarklet_runs_the_extensions_form_filler(self):
        from jobora.server import _bookmarklet
        script = urllib.parse.unquote(_bookmarklet("test-token", 8765)[len("javascript:"):])
        self.assertIn(self.FILLER.read_text(encoding="utf-8"), script)
        # The page's title helps tell which application the form is for.
        self.assertIn("document.title", script)

    def test_starting_the_dashboard_leaves_the_extension_alone(self):
        # It used to copy an old filler over the extension's on every start.
        from jobora import server
        from jobora.config import Settings
        from jobora.profile import Profile

        before = self.FILLER.read_bytes()
        self.addCleanup(self.FILLER.write_bytes, before)   # put it back, should the test fail

        class Started(Exception):
            pass

        def no_server(*args, **kwargs):
            raise Started

        with mock.patch.object(server, "ThreadingHTTPServer", no_server), \
                mock.patch.object(server.db, "init_db"), mock.patch.object(Settings, "ensure_token"):
            with self.assertRaises(Started):
                server.serve(Profile(), Settings(), port=0, open_browser=False)
        self.assertEqual(self.FILLER.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
