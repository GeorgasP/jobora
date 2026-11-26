import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { guessFromCV, readCV } from "../extension/lib/cv.js";

test("a qualification before the actual name is not used as the name", () => {
  assert.equal(guessFromCV("BARISTA TRAINING Starbucks\nDimitra Mousounaki").name, "Dimitra Mousounaki");
});

test("the name can appear beyond the first twelve extracted lines", () => {
  const text = ["BARISTA TRAINING Starbucks", "European Union Citizen", ...Array(30).fill("Work experience"), "Dimitra Mousounaki"].join("\n");
  assert.equal(guessFromCV(text).name, "Dimitra Mousounaki");
});

test("qualifications, headings and job titles alone do not produce a name", () => {
  for (const text of [
    "BARISTA TRAINING Starbucks", "Registered Nurse", "Senior Software Engineer",
    "Customer Service\nProfessional Skills\nBachelor Degree", "Barista\nStarbucks", "",
  ]) assert.equal(guessFromCV(text).name, "", text);
});

test("names retain Unicode, accents, hyphens, apostrophes and particles", () => {
  for (const name of ["Δήμητρα Μουσουνάκη", "José de la Cruz", "Anne-Marie O’Neill", "DIMITRA MOUSOUNAKI", "John J. Smith"]) {
    assert.equal(guessFromCV(name).name, name);
  }
});

test("occupations that are also surnames remain valid names", () => {
  for (const name of ["Jane Baker", "James Cook", "Alex Carpenter"]) assert.equal(guessFromCV(name).name, name);
});

test("first and last names drawn on separate lines can be joined", () => {
  assert.equal(guessFromCV("BARISTA TRAINING Starbucks\nDIMITRA\nMOUSOUNAKI").name, "DIMITRA MOUSOUNAKI");
  assert.equal(guessFromCV("Full name:\nDimitra\nMousounaki").name, "Dimitra Mousounaki");
  assert.equal(guessFromCV("Full name: Dimitra\nMousounaki").name, "Dimitra Mousounaki");
  assert.equal(guessFromCV("Dimitra\nMousounaki\nAmsterdam\ndimitra.mousounaki@example.test").name, "Dimitra Mousounaki");
});

test("explicit name labels outrank an unrelated person elsewhere in the text", () => {
  assert.equal(guessFromCV("Alex Johnson\nFull name: Dimitra Mousounaki").name, "Dimitra Mousounaki");
  assert.equal(guessFromCV("Ονοματεπώνυμο: Δήμητρα Μουσουνάκη").name, "Δήμητρα Μουσουνάκη");
  assert.equal(guessFromCV("Name: Prince").name, "Prince");
});

test("contact details distinguish the applicant from another named person", () => {
  const found = guessFromCV("Alex Johnson\nDimitra Mousounaki\ndimitra.mousounaki@example.test\n+31 612345678\nlinkedin.com/in/dimitra-mousounaki\ngithub.com/dimitra-test");
  assert.equal(found.name, "Dimitra Mousounaki");
  assert.equal(found.email, "dimitra.mousounaki@example.test");
  assert.equal(found.phone, "+31 612345678");
  assert.equal(found.linkedin, "linkedin.com/in/dimitra-mousounaki");
  assert.equal(found.github, "github.com/dimitra-test");
  assert.equal(guessFromCV("dimitra mousounaki\ndimitra.mousounaki@example.test").name, "dimitra mousounaki");
});

test("similarly plausible people are left for the user to resolve", () => {
  assert.equal(guessFromCV("Alex Johnson\nSam Wilson").name, "");
});

test("the job title under a name does not hide the name", () => {
  for (const [header, name] of [
    ["Maria Papadopoulou\nSenior Data Analyst\nmaria@example.test", "Maria Papadopoulou"],
    ["Maria Papadopoulou\nProject Coordinator\nmaria@example.test", "Maria Papadopoulou"],
    ["Μαρία Παπαδοπούλου\nΑναλύτρια Δεδομένων\nmaria@example.test", "Μαρία Παπαδοπούλου"],
    ["Lukas Meier\nBackend Developer\nlukas@example.test", "Lukas Meier"],
    ["Lukas Meier\nZurich, Switzerland\nlukas@example.test", "Lukas Meier"],
  ]) assert.equal(guessFromCV(header).name, name, header);
});

test("a surname that is also an occupation is not taken for a job title", () => {
  assert.equal(guessFromCV("Paul Nurse\nResearch Scientist\npaul@example.test").name, "Paul Nurse");
});

test("job title suggestions still work independently of name extraction", () => {
  const found = guessFromCV("Dimitra Mousounaki\nBarista\nBarista\nRegistered Nurse");
  assert.equal(found.name, "Dimitra Mousounaki");
  assert.ok(found.titles.includes("Barista"));
  assert.ok(found.titles.includes("Registered Nurse"));
});

// Synthetic, self-contained PDFs: no private CVs or downloaded dependencies.
function pdfFile(streams, cmap = "", compressed = false, { composite = false, encoding = "" } = {}) {
  const streamObject = (source) => {
    const data = compressed ? deflateSync(Buffer.from(source, "latin1")) : Buffer.from(source, "latin1");
    return `<< /Length ${data.length}${compressed ? " /Filter /FlateDecode" : ""} >>\nstream\n${data.toString("latin1")}\nendstream`;
  };
  const contentRefs = streams.map((_, i) => `${6 + i} 0 R`).join(" ");
  const descendant = 6 + streams.length;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents [${contentRefs}] >>`,
    composite
      ? `<< /Type /Font /Subtype /Type0 /BaseFont /Synthetic /Encoding ${encoding ? `${descendant + 1} 0 R` : "/Identity-H"} /DescendantFonts [${descendant} 0 R] /ToUnicode 5 0 R >>`
      : `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding ${cmap ? "/ToUnicode 5 0 R" : ""} >>`,
    cmap ? streamObject(cmap) : "<< >>",
    ...streams.map(streamObject),
  ];
  if (composite) {
    objects.push("<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Synthetic /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 500 >>");
    if (encoding) objects.push(streamObject(encoding));
  }
  return pdfObjects(objects);
}

function pdfObjects(objects) {
  let source = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(source.length);
    source += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = source.length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new File([Buffer.from(source, "latin1")], "synthetic-cv.pdf", { type: "application/pdf" });
}

function encodedPDF(text, { literal = false, compressed = false, array = false } = {}) {
  const codes = new Map([...new Set(text)].map((c, i) => [c, (0x100 + i).toString(16).padStart(4, "0")]));
  const cmap = "begincmap\n" + codes.size + " beginbfchar\n" +
    [...codes].map(([c, code]) => "<" + code + "> <" + c.charCodeAt(0).toString(16).padStart(4, "0") + ">").join("\n") +
    "\nendbfchar\nendcmap";
  const hex = (s) => [...s].map((c) => codes.get(c)).join("");
  const shown = array
    ? "[" + text.split(" ").map((word) => "<" + hex(word) + ">").join("-260") + "] TJ"
    : literal ? "(" + Buffer.from(hex(text), "hex").toString("latin1") + ") Tj" : "<" + hex(text) + "> Tj";
  return pdfFile(["BT /F1 24 Tf 1 0 0 1 40 750 Tm " + shown + " ET"], cmap, compressed, { composite: true });
}

test("independent PDF content streams keep their text separated", async () => {
  const file = pdfFile([
    "BT /F1 12 Tf 1 0 0 1 40 650 Tm (BARISTA TRAINING Starbucks) Tj ET",
    "BT /F1 24 Tf 1 0 0 1 40 750 Tm (Dimitra Mousounaki) Tj ET",
  ]);
  const cv = await readCV(file);
  assert.equal(cv.text, "BARISTA TRAINING Starbucks\nDimitra Mousounaki");
  assert.equal(guessFromCV(cv.text).name, "Dimitra Mousounaki");
  assert.deepEqual(Buffer.from(cv.base64, "base64"), Buffer.from(await file.arrayBuffer()));
});

test("plain PDF fonts retain Windows-1252 letters and punctuation", async () => {
  const cv = await readCV(pdfFile(["BT /F1 24 Tf (\x8Aime O\x92Neill) Tj ET"]));
  assert.equal(cv.text, "Šime O’Neill");
  assert.equal(guessFromCV(cv.text).name, "Šime O’Neill");
  const repeatedLetters = await readCV(pdfFile(["BT /F1 24 Tf (Matt Sutton) Tj ET"]));
  assert.equal(repeatedLetters.text, "Matt Sutton");
});

for (const options of [
  {}, { literal: true }, { compressed: true }, { array: true },
]) {
  test(`PDF Unicode glyph mappings: ${JSON.stringify(options)}`, async () => {
    const name = "Δήμητρα Μουσουνάκη";
    const cv = await readCV(encodedPDF(name, options));
    assert.equal(cv.text, name);
    assert.equal(guessFromCV(cv.text).name, name);
  });
}

test("PDF CMap ranges support both sequential and explicit Unicode values", async () => {
  const cmap = "begincmap\n2 beginbfrange\n<0080> <0082> <0041>\n<0083> <0085> [<0020> <0044> <0045>]\nendbfrange\nendcmap";
  const cv = await readCV(pdfFile(["BT /F1 24 Tf <008000810082008300840085> Tj ET"], cmap));
  assert.equal(cv.text, "ABC DE");
});

test("PDF word spacing preserves a full name and kerning does not break email addresses", async () => {
  const cv = await readCV(pdfFile([
    "BT /F1 24 Tf 1 0 0 1 40 750 Tm [(Di) -10 (mitra) -300 (Mousounaki)] TJ ET\n" +
    "BT /F1 12 Tf 1 0 0 1 40 710 Tm [(dimitra.) 5 (mousounaki) 5 (@example.test)] TJ ET",
  ]));
  assert.match(cv.text, /Dimitra Mousounaki/);
  const found = guessFromCV(cv.text);
  assert.equal(found.name, "Dimitra Mousounaki");
  assert.equal(found.email, "dimitra.mousounaki@example.test");
});

test("a PDF parsing failure preserves the original attachment", async () => {
  const file = new File(["not a PDF"], "unreadable.pdf", { type: "application/pdf" });
  const cv = await readCV(file);
  assert.equal(cv.text, "");
  assert.equal(Buffer.from(cv.base64, "base64").toString(), "not a PDF");
});

test("text and Markdown uploads use the same corrected name detection", async () => {
  for (const filename of ["synthetic-cv.txt", "synthetic-cv.md"]) {
    const cv = await readCV(new File(["BARISTA TRAINING Starbucks\n# Dimitra Mousounaki"], filename));
    assert.equal(guessFromCV(cv.text).name, "Dimitra Mousounaki");
  }
});


const spacedNames = [
  ["[(Dimitra)-260(Mousounaki )]", "Dimitra Mousounaki"],
  ["[(Mou)-20(sounaki)]", "Mousounaki"],
  ["[(Dimitra)0(Mousounaki)]", "DimitraMousounaki"],
  ["[(Dimitra)+260(Mousounaki)]", "DimitraMousounaki"],
  ["[(Dimitra )-260(Mousounaki)]", "Dimitra Mousounaki"],
  ["[(Dimitra)-260( Mousounaki)]", "Dimitra Mousounaki"],
  ["[-260(Dimitra)-260(Mousounaki)-260]", "Dimitra Mousounaki"],
  ["[(Dimitra)-260()-20(Mousounaki)]", "Dimitra Mousounaki"],
  ["[(Dimitra)-260<>-20(Mousounaki)]", "Dimitra Mousounaki"],
  ["[(Dimitra)-130 -130(Mousounaki)]", "Dimitra Mousounaki"],
  ["[(Dimitra)% ] (WRONG) -5000\n-260(Mousounaki)]", "Dimitra Mousounaki"],
  ["[(Dimitra)% ]TJ (WRONG) -5000\n-260(Mousounaki)]", "Dimitra Mousounaki"],
  ["[(Bracket])-260(Test)]", "Bracket] Test"],
  ["[(Anne\\(Marie\\))-260(Smith)]", "Anne(Marie) Smith"],
];
for (const [array, expected] of spacedNames) {
  test("custom PDF TJ spacing: " + array, async () => {
    // Mirror the original CV header: the font size is scaled by its text matrix.
    const file = pdfFile([
      "BT 15.960205 0 0 -15.960205 14.171875 29.941406 Tm /F1 1 Tf " + array + " TJ ET",
    ]);
    const cv = await readCV(file);
    assert.equal(cv.text, expected);
  });
}

test("the original CV's spacing pattern produces a name instead of a qualification", async () => {
  const file = pdfFile([
    "BT /F1 16 Tf 1 0 0 1 40 750 Tm [(Dimitra)-260(Mousounaki )] TJ " +
    "1 0 0 1 40 700 Tm (BARISTA TRAINING Starbucks) Tj ET",
  ], "", true);
  const cv = await readCV(file);
  assert.equal(guessFromCV(cv.text).name, "Dimitra Mousounaki");
  assert.deepEqual(Buffer.from(cv.base64, "base64"), Buffer.from(await file.arrayBuffer()));
});

test("graphics arrays with precise numbers do not interfere with text extraction", async () => {
  const cv = await readCV(pdfFile([
    "[1234567890123456789012345678901234567890 0.1234567890123456789] 0 d\n" +
    "BT /F1 16 Tf [(Dimitra)-260(Mousounaki)] TJ ET",
  ]));
  assert.equal(cv.text, "Dimitra Mousounaki");
});
