# Working in this repository

- Read `NOTES.md` before making any change, above all the notes from Apo.
  After a change that others should know about, add a note at the top of
  `NOTES.md`: what changed and why, where to look, what is left.
- Write code a person can maintain and fix: clear names, named constants
  instead of bare numbers, small functions, comments that explain why.
  Comments are in English.
- Every bug fix comes with a test that fails before the fix. Run all tests with
  `node --test "tests/*.test.mjs"` and `python -m unittest discover -s tests`
  (GitHub runs both on every pull request).
- Start each change on its own branch from an up-to-date `main`, and merge it
  through a pull request.
- Before every push: `git fetch --all`, look at what Apo has pushed since (on
  `main` and on his branches) and which files it touches, merge it into your
  branch, and run all the tests again. Never push over work you haven't seen.
- The Python engine in `jobora/` uses the standard library only.
