// PDFs as CV builders and word processors write them. Each case is a way a
// real CV came out (nearly) empty: the details must still be found.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";
import { guessFromCV, readCV } from "../extension/lib/cv.js";
import { md5, rc4 as readerRc4 } from "../extension/lib/pdfcrypt.js";
import { encryptedPdfFile, pdfFile, rc4, stream, toUnicode } from "./helpers/pdf.mjs";

const LINES = ["Maria Papadopoulou", "maria@example.test", "+30 690 000 0000", "Athens, Greece"];
const PAGE = "/Type /Page /Parent 2 0 R /MediaBox [0 0 595 842]";
const CATALOG = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"];

function assertFindsMaria(text) {
  for (const line of LINES) assert.ok(text.includes(line), `"${line}" missing from: ${JSON.stringify(text)}`);
  const found = guessFromCV(text);
  assert.equal(found.name, "Maria Papadopoulou");
  assert.equal(found.email, "maria@example.test");
  assert.equal(found.phone, "+30 690 000 0000");
}

// Word, Canva and most PDF libraries number a subset font's letters 1, 2, 3…
// with one byte each, and map them to letters in a ToUnicode CMap.
for (const shape of ["hex", "literal"]) {
  for (const compressed of [false, true]) {
    test(`a simple font with one-byte codes and a ToUnicode map (${shape}${compressed ? ", compressed" : ""})`, async () => {
      const characters = [...new Set(LINES.join(""))];
      const codes = new Map(characters.map((char, i) => [i + 1, char]));
      const codeOf = (char) => characters.indexOf(char) + 1;
      const shown = (line) => (shape === "hex"
        ? `<${[...line].map((char) => codeOf(char).toString(16).padStart(2, "0")).join("")}>`
        : `(${[...line].map((char) => String.fromCharCode(codeOf(char))).join("")})`);
      const content = LINES.map((line, i) => `BT /F1 11 Tf 1 0 0 1 50 ${780 - 16 * i} Tm ${shown(line)} Tj ET`).join("\n");
      const cv = await readCV(pdfFile([
        ...CATALOG,
        `<< ${PAGE} /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
        stream(content, { compressed }),
        `<< /Type /Font /Subtype /TrueType /BaseFont /ABCDEF+Calibri /FirstChar 1 /LastChar ${characters.length} /ToUnicode 6 0 R >>`,
        stream(toUnicode(codes, 1), { compressed }),
      ]));
      assertFindsMaria(cv.text);
    });
  }
}

// A font numbers its glyphs 0x80 to 0x9F like any others. Read through a
// Windows-1252 decoder, which TextDecoder("latin1") is, those bytes turn into
// "€", "’" and the like, and the letters they stand for are lost.
for (const bytes of [1, 2]) {
  test(`font codes with bytes 0x80 to 0x9F, ${bytes} byte${bytes === 1 ? "" : "s"} each, in literal strings`, async () => {
    const characters = [...new Set(LINES.join(""))];
    const FIRST_CODE = 0x80;
    const codes = new Map(characters.map((char, i) => [FIRST_CODE + i, char]));
    const literalOf = (line) => `(${[...line].map((char) => {
      const code = FIRST_CODE + characters.indexOf(char);
      return bytes === 1 ? String.fromCharCode(code) : String.fromCharCode(code >> 8, code & 0xff);
    }).join("")})`;
    const font = bytes === 1
      ? `<< /Type /Font /Subtype /TrueType /BaseFont /ABCDEF+Calibri /ToUnicode 6 0 R >>`
      : `<< /Type /Font /Subtype /Type0 /BaseFont /ABCDEF+Calibri /Encoding /Identity-H /ToUnicode 6 0 R >>`;
    const cv = await readCV(pdfFile([
      ...CATALOG,
      `<< ${PAGE} /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
      stream(LINES.map((line, i) => `BT /F1 11 Tf 1 0 0 1 50 ${780 - 16 * i} Tm ${literalOf(line)} Tj ET`).join("\n")),
      font,
      stream(toUnicode(codes, bytes)),
    ]));
    assertFindsMaria(cv.text);
  });
}

// Designed CVs (Canva, InDesign, a browser's "Save as PDF") draw the page
// through form XObjects, sometimes nested, each with fonts of its own.
for (const compressed of [false, true]) {
  test(`text inside form XObjects, nested and with their own fonts${compressed ? " (compressed)" : ""}`, async () => {
    const page = `<< ${PAGE} /Resources << /Font << /F1 7 0 R >> /XObject << /Fm1 4 0 R >> >> /Contents 5 0 R >>`;
    const outerForm = stream(
      `BT /F1 20 Tf 1 0 0 1 50 780 Tm (${LINES[0]}) Tj ET\nq 1 0 0 1 0 -16 cm /Fm2 Do Q`,
      { compressed, dictionary: "/Type /XObject /Subtype /Form /BBox [0 0 595 842] /Resources << /Font << /F1 6 0 R >> /XObject << /Fm2 8 0 R >> >>" });
    const innerForm = stream(
      LINES.slice(1).map((line, i) => `BT /F2 11 Tf 1 0 0 1 50 ${764 - 16 * i} Tm (${line}) Tj ET`).join("\n"),
      { compressed, dictionary: "/Type /XObject /Subtype /Form /BBox [0 0 595 842] /Resources << /Font << /F2 6 0 R >> >>" });
    // The page's own /F1 is another font, whose two-byte map would garble the
    // forms' text if their fonts were looked up on the page instead.
    const pageFont = "<< /Type /Font /Subtype /Type0 /BaseFont /Other /Encoding /Identity-H /ToUnicode 9 0 R >>";
    const cv = await readCV(pdfFile([
      ...CATALOG, page, outerForm,
      stream("q /Fm1 Do Q", { compressed }),
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      pageFont, innerForm,
      stream(toUnicode(new Map([[0x4d61, "X"]]), 2), { compressed }),
    ]));
    assertFindsMaria(cv.text);
  });
}

/* ── Encrypted PDFs ──────────────────────────────────────── */

/** Maria's CV with a one-byte font, its streams as { stream } for encryptedPdfFile. */
function mariaObjects() {
  const characters = [...new Set(LINES.join(""))];
  const hexOf = (line) => [...line].map((char) => (characters.indexOf(char) + 1).toString(16).padStart(2, "0")).join("");
  return [
    ...CATALOG,
    `<< ${PAGE} /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    { stream: LINES.map((line, i) => `BT /F1 11 Tf 1 0 0 1 50 ${780 - 16 * i} Tm <${hexOf(line)}> Tj ET`).join("\n") },
    `<< /Type /Font /Subtype /TrueType /BaseFont /ABCDEF+Calibri /FirstChar 1 /LastChar ${characters.length} /ToUnicode 6 0 R >>`,
    { stream: toUnicode(new Map(characters.map((char, i) => [i + 1, char])), 1) },
  ];
}

test("the reader's MD5 and RC4 agree with Node's and with RC4's published vector", () => {
  for (const length of [0, 1, 55, 56, 63, 64, 65, 1000]) {
    const data = randomBytes(length);
    assert.equal(Buffer.from(md5(data)).toString("hex"), createHash("md5").update(data).digest("hex"), `${length} bytes`);
  }
  for (const cipher of [readerRc4, rc4]) {
    assert.equal(Buffer.from(cipher(Buffer.from("Key"), Buffer.from("Plaintext"))).toString("hex"), "bbf316e8d940af0ad3");
  }
});

// CV builders protect their PDFs against editing: encrypted, with an empty
// password to open them.
for (const method of ["RC4", "AESV2", "AESV3"]) {
  test(`an encrypted PDF that opens without a password (${method})`, async () => {
    assertFindsMaria((await readCV(encryptedPdfFile(mariaObjects(), method))).text);
  });

  test(`a PDF that needs a password to open gives no text, not junk (${method})`, async () => {
    const cv = await readCV(encryptedPdfFile(mariaObjects(), method, { userPassword: "secret" }));
    assert.equal(cv.text, "");
  });
}

test("a form that draws itself does not hang the reader", async () => {
  const form = stream("BT /F1 11 Tf (Maria Papadopoulou) Tj ET /Fm1 Do",
    { dictionary: "/Type /XObject /Subtype /Form /BBox [0 0 595 842] /Resources << /Font << /F1 6 0 R >> /XObject << /Fm1 4 0 R >> >>" });
  const cv = await readCV(pdfFile([
    ...CATALOG,
    `<< ${PAGE} /Resources << /XObject << /Fm1 4 0 R >> >> /Contents 5 0 R >>`,
    form, stream("/Fm1 Do"),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]));
  assert.match(cv.text, /^Maria Papadopoulou/);
});
