"""
Cover letters from the Python engine (jobora/letters.py), the same promises
as the extension's tests in tests/letters.test.mjs.

Run from the repository root:  python -m unittest discover -s tests
"""
import json
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from jobora import letters  # noqa: E402
from jobora.config import Settings  # noqa: E402
from jobora.profile import Profile  # noqa: E402

JOB = {"company": "Taverna Thalassa", "title": "Waiter", "location": "Athens, Greece",
       "description": "Serve our guests."}
ACHIEVEMENT = "Served up to 120 covers a night in a busy seaside restaurant in Piraeus"


class FakeResponse:
    """What urllib.request.urlopen returns, holding a Messages API answer."""

    def __init__(self, text):
        self.body = json.dumps({"content": [{"type": "text", "text": text}]}).encode("utf-8")

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *exception):
        return False


class Letters(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.cv = pathlib.Path(folder.name) / "cv.md"
        self.cv.write_text(f"# Maria Papadopoulou\n\n- {ACHIEVEMENT}\n", encoding="utf-8")

    def profile(self, language):
        return Profile(name="Maria Papadopoulou", email="maria@example.test",
                       default_language=language, cv={language: str(self.cv)})

    def test_claude_is_asked_for_each_language_the_extension_writes(self):
        for language, name in {"el": "Greek", "pt": "Portuguese", "nl": "Dutch", "pl": "Polish"}.items():
            with mock.patch("urllib.request.urlopen", return_value=FakeResponse("A letter")) as urlopen:
                text, model = letters.generate(JOB, self.profile(language), Settings(anthropic_api_key="test-key"))
            request = urlopen.call_args.args[0]
            prompt = json.loads(request.data)["messages"][0]["content"]
            self.assertIn(f"Write a cover letter in {name}.", prompt)
            self.assertEqual(request.full_url, "https://api.anthropic.com/v1/messages")
            self.assertEqual((text, model), ("A letter", Settings().claude_model))

    def test_without_a_key_the_template_quotes_the_cv_and_claims_nothing_else(self):
        for language in ("en", "el"):
            text, model = letters.generate(JOB, self.profile(language), Settings())
            self.assertEqual(model, "template")
            self.assertIn(f"• {ACHIEVEMENT}", text)
            self.assertIn("Taverna Thalassa", text)
            # The template knows nothing about the user beyond the CV: it must
            # not tell a developer's future employer they worked with customers.
            self.assertNotIn("customer", text.lower(), language)
            self.assertNotIn("πελατ", text.lower(), language)
            self.assertTrue(text.rstrip().endswith("maria@example.test"), text)

    def test_the_template_sentences_are_the_extensions(self):
        extension = (pathlib.Path(__file__).resolve().parent.parent / "extension" / "lib" / "letters.js").read_text(
            encoding="utf-8")
        for language, sentences in letters._TEMPLATES.items():
            for part, sentence in sentences.items():
                as_javascript = sentence.replace("{company}", "${company}").replace("{title}", "${title}")
                self.assertIn(as_javascript, extension, f"{language}.{part} differs from extension/lib/letters.js")


if __name__ == "__main__":
    unittest.main()
