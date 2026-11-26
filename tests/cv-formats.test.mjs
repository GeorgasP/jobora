import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { guessFromCV, readCV } from "../extension/lib/cv.js";
import { detectFormat, rtfText } from "../extension/lib/documents.js";

// The same synthetic CV, saved by Microsoft Word in each format it writes
// (personal metadata removed). Name, e-mail and phone sit in the page header,
// as many Word CV templates put them; there is also a table and a text box.
const WORD_FILES = ["word-cv.docx", "word-cv.pdf", "word-cv.doc", "word-cv.rtf", "word-cv.odt"];
const fixture = (name, as = name) => new File([readFileSync(new URL(`./fixtures/${name}`, import.meta.url))], as);
const UNREADABLE = /[\u0000-\u0008\u000e-\u001f�]/;

for (const name of WORD_FILES) {
  test(`a Word CV saved as ${name.split(".").pop().toUpperCase()} gives its contact details`, async () => {
    const cv = await readCV(fixture(name));
    assert.ok(!UNREADABLE.test(cv.text), "the text has unreadable characters");
    assert.ok(cv.text.length < 700, `${cv.text.length} characters: more than the CV holds, so something else was read too`);
    const found = guessFromCV(cv.text);
    assert.equal(found.name, "Maria Papadopoulou");
    assert.equal(found.email, "maria.papadopoulou@example.com");
    assert.equal(found.phone, "+30 694 123 4567");
    assert.equal(found.country, "Greece");
    assert.ok(found.titles.includes("Waitress"), `titles: ${found.titles}`);
    assert.match(cv.text, /Nationality Greek/, "a table row should read as one line");
    assert.match(cv.text, /Available from May/, "the text box is missing");
  });
}

test("a file is read by what it contains, not by its name", async () => {
  const docxNamedDoc = await readCV(fixture("word-cv.docx", "cv.doc"));
  assert.equal(guessFromCV(docxNamedDoc.text).name, "Maria Papadopoulou");
  assert.equal(detectFormat(new TextEncoder().encode("{\\rtf1 hello}")), "rtf");
  assert.equal(detectFormat(new TextEncoder().encode("Maria Papadopoulou")), "text");
});

test("RTF text is decoded in its own code page, and \\u characters replace their fallback", () => {
  // Greek in Windows-1253 bytes, then a \u character with a one-character fallback.
  const rtf = "{\\rtf1\\ansi\\ansicpg1253{\\fonttbl{\\f0 Arial;}}\\f0 \\'cc\\'e1\\'f1\\'df\\'e1\\par \\u966?\\u945?\\par}";
  assert.equal(rtfText(rtf), "Μαρία\nφα");
});

test("RTF settings, fonts and field codes are not read as text", () => {
  const rtf = "{\\rtf1{\\fonttbl{\\f0 Calibri;}}{\\*\\generator Word}" +
    "{\\field{\\*\\fldinst HYPERLINK \"mailto:a@b.test\"}{\\fldrslt a@b.test}}\\par Waitress}";
  assert.equal(rtfText(rtf), "a@b.test\nWaitress");
});
