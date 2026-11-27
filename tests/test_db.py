"""
The Python engine's database (jobora/db.py): every command works on a new
machine, and a data folder from before the rename to Jobora keeps its history.

Run from the repository root:  python -m unittest discover -s tests
"""
import pathlib
import sqlite3
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from jobora import db  # noqa: E402


class Database(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        data = pathlib.Path(folder.name)
        self.current, self.legacy = data / "jobora.db", data / "jobhunter.db"
        for name, value in (("DB_PATH", self.current), ("LEGACY_DB_PATH", self.legacy), ("ensure_dirs", lambda: None)):
            patcher = mock.patch.object(db, name, value, create=True)
            patcher.start()
            self.addCleanup(patcher.stop)

    def database_at(self, path, user_name):
        conn = sqlite3.connect(path)
        conn.executescript(db.SCHEMA)
        conn.execute("INSERT INTO users (email, name, created_at) VALUES ('local@jobora', ?, '2026-08-10')",
                     (user_name,))
        conn.commit()
        conn.close()

    def user_names(self):
        with db.connect() as conn:
            return [row["name"] for row in conn.execute("SELECT name FROM users")]

    def test_any_command_can_be_the_first_on_a_new_machine(self):
        # "status" or "matches" before "init" or "run" found no tables at all.
        with db.connect() as conn:
            user_id = db.get_or_create_user(conn, "local@jobora", "Maria")
        self.assertEqual(user_id, 1)

    def test_a_database_from_before_the_rename_is_taken_over(self):
        self.database_at(self.legacy, "Maria")
        self.assertEqual(self.user_names(), ["Maria"])
        self.assertFalse(self.legacy.exists(), "the old file stays behind and confuses the next look")

    def test_an_empty_file_left_by_a_failed_command_does_not_hide_the_old_database(self):
        self.current.touch()
        self.database_at(self.legacy, "Maria")
        self.assertEqual(self.user_names(), ["Maria"])

    def test_a_database_in_use_is_never_replaced(self):
        self.database_at(self.current, "Current")
        self.database_at(self.legacy, "Old")
        self.assertEqual(self.user_names(), ["Current"])
        self.assertTrue(self.legacy.exists())


if __name__ == "__main__":
    unittest.main()
