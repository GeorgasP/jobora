import { ALL_PROFESSIONS } from "./professions.js";
import { countryLabel, placesIn } from "./places.js";
import { detectFormat, docText, rtfText, zipDocumentText } from "./documents.js";

/*
 * Reading the CV the user uploads, with no outside library, and guessing what
 * the onboarding needs from it.
 *
 * PDF is read here: the pages' content streams, decompressed with
 * DecompressionStream, and their Tj/TJ strings mapped to text through each
 * font's ToUnicode CMap. DOCX, ODT, RTF and the old .doc are read in
 * documents.js; TXT and MD are taken as they are.
 *
 * From the text we guess the name, e-mail, phone, home location, LinkedIn,
 * GitHub and likely job titles, so onboarding is almost automatic.
 */

export const MAX_CV_BYTES = 8 * 1024 * 1024;

const latin = new TextDecoder("latin1");

async function inflate(bytes, format) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ── PDF ──────────────────────────────────────────────────── */

/**
 * Two kinds of PDF text:
 *
 *  • Plain PDFs (the standard 14 fonts): the bytes inside the parentheses are
 *    the text, and are read as they are.
 *  • Most PDFs today (Word, Google Docs, Canva, Chrome, LaTeX) embed subsets
 *    of their fonts and number the glyphs they use, with one byte per glyph
 *    or two. A /ToUnicode CMap per font maps those numbers back to text;
 *    without it, the numbers read as junk.
 *
 * Both are read.
 */

const hexToText = (hex) => {
  let out = "";
  for (let i = 0; i + 3 < hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  return out;
};

/**
 * A font's ToUnicode CMap: { map: code → text, codeBytes }. Codes are as long
 * as the CMap's code space says: one byte in Word's and Canva's simple fonts,
 * two in the composite (Identity-H) fonts Chrome and Google Docs write.
 */
function parseCMap(text) {
  const map = new Map();

  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const e of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(parseInt(e[1], 16), hexToText(e[2]));
    }
  }

  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = block[1];
    // <lo> <hi> [ <u1> <u2> … ]
    for (const e of body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g)) {
      let code = parseInt(e[1], 16);
      for (const u of e[3].matchAll(/<([0-9A-Fa-f]+)>/g)) map.set(code++, hexToText(u[1]));
    }
    // <lo> <hi> <firstUnicode>
    for (const e of body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>(?!\s*\[)/g)) {
      const lo = parseInt(e[1], 16), hi = parseInt(e[2], 16), dst = parseInt(e[3], 16);
      for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, String.fromCodePoint(dst + (c - lo)));
    }
  }

  // The code space gives the codes' length; without one, the first code does.
  const space = /begincodespacerange\s*<([0-9A-Fa-f]+)>/.exec(text)
    || /beginbf(?:char|range)\s*<([0-9A-Fa-f]+)>/.exec(text);
  const codeBytes = space && space[1].length <= 2 ? 1 : 2;
  return { map, codeBytes };
}

/** An object's stream, decompressed when it is compressed; null when it has none. */
async function objectStream(bytes, raw, from, to) {
  const head = raw.indexOf("stream", from);
  if (head < 0 || head > to) return null;
  let start = head + 6;
  while (bytes[start] === 13 || bytes[start] === 10) start++;
  const end = raw.indexOf("endstream", start);
  if (end < 0 || end > to + 64) return null;

  let stop = end;
  while (stop > start && (bytes[stop - 1] === 10 || bytes[stop - 1] === 13)) stop--;
  const slice = bytes.subarray(start, stop);
  if (!slice.length) return null;

  for (const fmt of ["deflate", "deflate-raw"]) {
    try { return await inflate(slice, fmt); } catch { /* another filter */ }
  }
  return slice;                                   // not compressed
}

async function pdfText(bytes) {
  const raw = latin.decode(bytes);

  // 1. Every object: those written plainly in the file, and those packed into
  //    compressed object streams (PDF 1.5+), where Word and others keep fonts.
  const objects = new Map();
  for (const m of raw.matchAll(/(\d+)\s+0\s+obj\b/g)) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endobj", start);
    if (end > 0) objects.set(Number(m[1]), { start, end });
  }
  const packed = await objectsInObjectStreams(bytes, raw, objects);
  /** An object's dictionary text, wherever the object is stored. */
  const declaration = (num) => {
    if (packed.has(num)) return packed.get(num);
    const span = objects.get(num);
    if (!span) return "";
    const streamAt = raw.indexOf("stream", span.start);
    return raw.slice(span.start, streamAt > 0 && streamAt < span.end ? streamAt : span.end);
  };
  const allNumbers = [...new Set([...objects.keys(), ...packed.keys()])];

  // 2. The ToUnicode CMap of each font object
  const cmapCache = new Map();
  const cmapFor = async (fontObjNum) => {
    if (cmapCache.has(fontObjNum)) return cmapCache.get(fontObjNum);
    let map = null;
    const ref = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(declaration(fontObjNum));
    const target = ref && objects.get(Number(ref[1]));
    if (target) {
      const data = await objectStream(bytes, raw, target.start, target.end);
      if (data) map = parseCMap(latin.decode(data));
    }
    cmapCache.set(fontObjNum, map);
    return map;
  };

  // 3. Resource names → objects: fonts (/F1) and drawings (/Fm1, the form
  //    XObjects). A page or a form names its own, inline or by reference;
  //    the file-wide font map is the fallback for content that names fonts
  //    elsewhere, as a page inheriting its parent's resources does.
  const namesIn = (text, kind) => {
    const names = new Map();
    const inline = new RegExp(`/${kind}\\s*<<([\\s\\S]{0,4000}?)>>`).exec(text);
    const referenced = new RegExp(`/${kind}\\s+(\\d+)\\s+0\\s+R`).exec(text);
    const body = inline ? inline[1] : referenced ? declaration(Number(referenced[1])) : "";
    for (const e of body.matchAll(/\/([A-Za-z0-9_.#+-]+)\s+(\d+)\s+0\s+R/g)) names.set(e[1], Number(e[2]));
    return names;
  };
  const resourcesOf = (dictionary) => {
    const ref = /\/Resources\s+(\d+)\s+0\s+R/.exec(dictionary);
    const text = ref ? declaration(Number(ref[1])) : dictionary;
    return { fonts: namesIn(text, "Font"), xobjects: namesIn(text, "XObject") };
  };
  const fontByName = new Map();
  for (const num of allNumbers) for (const [name, ref] of namesIn(declaration(num), "Font")) fontByName.set(name, ref);

  // Turning a content stream's strings into text, through the font's CMap when it has one.
  // A code the map leaves out: one-byte fonts keep plain letters where ASCII
  // has them, while a two-byte glyph number means nothing on its own.
  const unmapped = (code, codeBytes) =>
    (codeBytes === 1 && code >= 32 && code < 127 ? String.fromCharCode(code) : "");
  const decodeWithMap = (bytes, cmap) => {
    let out = "";
    for (let i = 0; i + cmap.codeBytes <= bytes.length; i += cmap.codeBytes) {
      let code = 0;
      for (let b = 0; b < cmap.codeBytes; b++) code = (code << 8) | bytes.charCodeAt(i + b);
      out += cmap.map.get(code) ?? unmapped(code, cmap.codeBytes);
    }
    return out;
  };
  const unescapeLiteral = (s) => s
    .replace(/\\([()\\])/g, "$1")
    .replace(/\\n/g, "\n").replace(/\\r/g, "").replace(/\\t/g, " ")
    .replace(/\\(\d{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
  /** A hex string's bytes; an odd last digit counts as followed by 0. */
  const hexBytes = (hex) => {
    const digits = hex.replace(/\s+/g, "");
    let out = "";
    for (let i = 0; i < digits.length; i += 2) out += String.fromCharCode(parseInt(digits.slice(i, i + 2).padEnd(2, "0"), 16));
    return out;
  };

  const decodeText = (token, cmap) => {
    const bytes = token[0] === "(" ? unescapeLiteral(token.slice(1, -1)) : hexBytes(token.slice(1, -1));
    return cmap ? decodeWithMap(bytes, cmap) : bytes;
  };

  const decodeArray = (array, map) => {
    let out = "", adjustment = 0;
    const parts = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>|[-+]?(?:\d+\.\d*|\.\d+|\d+)(?![\d.])|%[^\r\n]*(?=\r|\n|$)/g;
    for (const part of array.matchAll(parts)) {
      const token = part[0];
      if (token[0] === "%") continue;
      if (token[0] !== "(" && token[0] !== "<") {
        adjustment += Number(token);
        continue;
      }
      const text = decodeText(token, map);
      if (!text) continue;
      // TJ offsets use thousandths of text space. A large negative offset
      // advances to the next word; small offsets only adjust letter kerning.
      if (out && adjustment <= -200 && !/\s$/.test(out) && !/^\s/.test(text)) out += " ";
      out += text;
      adjustment = 0;
    }
    return out;
  };

  const chunks = [];
  // The content-stream operators that matter for text, as one pattern.
  const TOKEN = new RegExp([
    /\/([A-Za-z0-9_.#-]+)\s+[\d.]+\s+Tf/,          // 1: font selection
    /<([0-9A-Fa-f\s]+)>/,                          // 2: hex string
    /\((?:\\.|[^\\()])*\)/,                        // literal string
    /((?:-?[\d.]+\s+){6})Tm/,                      // 3: text matrix
    /((?:-?[\d.]+\s+){2})T[dD]/,                   // 4: text displacement
    /\[((?:\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>|[-+]?(?:\d+\.\d*|\.\d+|\d+)(?![\d.])|\s|%[^\r\n]*(?=\r|\n|$))*)\]\s*TJ/, // 5: text array
    /\/([A-Za-z0-9_.#+-]+)\s+Do\b/,                 // 6: draw a form or an image
    /T\*|ET|BT/,
  ].map((r) => r.source).join("|"), "g");

  // A form drawn inside forms deeper than this is a loop, not a design.
  const MAX_FORM_DEPTH = 12;

  /**
   * The text of a form XObject. Designed CVs (Canva, InDesign, a browser's
   * "Save as PDF") draw their pages through forms, sometimes nested, and a
   * page whose content only says "/Fm1 Do" holds no text of its own. A form
   * uses its own fonts, or the page's when it names none.
   */
  const readForm = async (num, outer, drawing) => {
    if (num === undefined || drawing.has(num) || drawing.size >= MAX_FORM_DEPTH) return;
    const dictionary = declaration(num);
    if (!/\/Subtype\s*\/Form\b/.test(dictionary)) return;      // images hold no text
    const span = objects.get(num);
    const data = span && await objectStream(bytes, raw, span.start, span.end);
    if (!data) return;
    const own = resourcesOf(dictionary);
    chunks.push("\n");                                          // a form is a block of its own
    drawing.add(num);
    await readContent(data, {
      fonts: own.fonts.size ? own.fonts : outer.fonts,
      xobjects: own.xobjects.size ? own.xobjects : outer.xobjects,
    }, drawing);
    drawing.delete(num);
  };

  // Td/Tm do not always start a new line: Chrome also uses them to move within
  // a line. A new line is when the baseline (Y) changes.
  const readContent = async (data, resources, drawing = new Set()) => {
    const text = latin.decode(data);
    if (!/\bTj\b|\bTJ\b|\bTf\b|\bDo\b/.test(text)) return;
    let map = null;
    let lastY = null, lastX = null;

    // Cursor moves can stay within a word. Only a change of baseline creates
    // a newline; numeric word gaps inside TJ arrays are handled separately.
    const moved = (x, y) => {
      if (lastY !== null && Math.abs(y - lastY) > 2) chunks.push("\n");
      lastY = y; lastX = x;
    };

    for (const g of text.matchAll(TOKEN)) {
      const token = g[0];
      if (g[1] !== undefined) {                    // /F1 12 Tf
        map = await cmapFor(resources.fonts.get(g[1]) ?? fontByName.get(g[1]));
        continue;
      }
      if (g[6] !== undefined) {                    // /Fm1 Do
        await readForm(resources.xobjects.get(g[6]), resources, drawing);
        lastY = null;
        continue;
      }
      if (g[3] !== undefined) {                    // a b c d e f Tm
        const n = g[3].trim().split(/\s+/).map(Number);
        moved(n[4], n[5]);
        continue;
      }
      if (g[4] !== undefined) {                    // tx ty Td
        const n = g[4].trim().split(/\s+/).map(Number);
        moved((lastX ?? 0) + n[0], (lastY ?? 0) + n[1]);
        continue;
      }
      if (g[5] !== undefined) {                    // [(First)-260(Last)] TJ
        chunks.push(decodeArray(g[5], map));
        continue;
      }
      if (g[2] !== undefined || token[0] === "(") {
        chunks.push(decodeText(token, map));
        continue;
      }
      if (token === "T*") { chunks.push("\n"); lastY = null; }
      else if (token === "ET" || token === "BT") { lastX = null; }
    }
    chunks.push("\n");
  };

  // 4. Read the pages' content, page by page. Only those streams hold the
  //    text: reading every stream in the file as text also reads embedded
  //    font programs and images, which turn into thousands of junk characters.
  const pages = pagesInOrder(declaration, allNumbers);
  for (const page of pages) {
    const resources = resourcesOf(page.text);
    for (const ref of contentRefs(page.text, declaration)) {
      const span = objects.get(ref);
      const data = span && await objectStream(bytes, raw, span.start, span.end);
      if (data) await readContent(data, resources);
      if (chunks.length > 60000) break;
    }
  }
  // A file without a readable page tree: fall back to every stream that draws text.
  if (!pages.length) {
    for (const [, span] of objects) {
      const decl = raw.slice(span.start, Math.min(span.end, span.start + 400));
      if (/\/(Image|Font|FontFile|ToUnicode|XObject\s*<<)/.test(decl) && !/\/Contents/.test(decl)) {
        if (!/\/Length/.test(decl) || /\/Subtype\s*\/Image/.test(decl)) continue;
      }
      const data = await objectStream(bytes, raw, span.start, span.end);
      if (data) await readContent(data, { fonts: new Map(), xobjects: new Map() });
      if (chunks.length > 60000) break;
    }
  }

  return chunks.join("")
    // PDFs write "ﬁ" as one glyph; without normalising, "ﬁntech" never matches "fintech".
    .normalize("NFKC")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Objects packed into compressed object streams (/Type /ObjStm, PDF 1.5+),
 * as number → dictionary text. The stream starts with "number offset" pairs.
 */
async function objectsInObjectStreams(bytes, raw, objects) {
  const found = new Map();
  for (const [, span] of objects) {
    const head = raw.slice(span.start, Math.min(span.end, span.start + 300));
    if (!/\/Type\s*\/ObjStm/.test(head)) continue;
    const count = Number(/\/N\s+(\d+)/.exec(head)?.[1]);
    const first = Number(/\/First\s+(\d+)/.exec(head)?.[1]);
    const data = count && first && await objectStream(bytes, raw, span.start, span.end);
    if (!data) continue;
    const text = latin.decode(data);
    const index = text.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < count; i++) {
      const offset = index[2 * i + 1];
      const next = i + 1 < count ? index[2 * i + 3] : text.length - first;
      if (Number.isFinite(offset)) found.set(index[2 * i], text.slice(first + offset, first + next));
    }
  }
  return found;
}

/**
 * The page objects in reading order, from the catalog's page tree, as
 * { num, text }. Falls back to every page object in file order when the tree
 * can't be followed, and is empty for files with no pages at all.
 */
function pagesInOrder(declaration, numbers) {
  const pages = [];
  const seen = new Set();
  const visit = (num, depth = 0) => {
    if (seen.has(num) || depth > 50) return;
    seen.add(num);
    const text = declaration(num);
    if (/\/Type\s*\/Pages\b/.test(text)) {
      const kids = /\/Kids\s*\[([^\]]*)\]/.exec(text)?.[1] || "";
      for (const kid of kids.matchAll(/(\d+)\s+0\s+R/g)) visit(Number(kid[1]), depth + 1);
    } else if (/\/Type\s*\/Page\b/.test(text)) {
      pages.push({ num, text });
    }
  };
  const catalog = numbers.find((num) => /\/Type\s*\/Catalog\b/.test(declaration(num)));
  const root = catalog !== undefined && /\/Pages\s+(\d+)\s+0\s+R/.exec(declaration(catalog));
  if (root) visit(Number(root[1]));
  if (pages.length) return pages;
  return numbers
    .filter((num) => /\/Type\s*\/Page\b/.test(declaration(num)) && !/\/Type\s*\/Pages\b/.test(declaration(num)))
    .map((num) => ({ num, text: declaration(num) }));
}

/** The content stream objects of a page: /Contents N 0 R, an array, or a reference to an array. */
function contentRefs(page, declaration) {
  const single = /\/Contents\s+(\d+)\s+0\s+R/.exec(page);
  const array = /\/Contents\s*\[([^\]]*)\]/.exec(page);
  let list = array ? array[1] : "";
  if (!list && single) {
    const target = declaration(Number(single[1])).trim();
    list = target.startsWith("[") ? target : `${single[1]} 0 R`;
  }
  return [...list.matchAll(/(\d+)\s+0\s+R/g)].map((m) => Number(m[1]));
}


const toBase64 = (bytes) => {
  let bin = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(bin);
};

// The CV formats readCV understands, by extension, for the file picker and the
// type stored with the CV. The format itself is judged by the file's content.
export const CV_FORMATS = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
  txt: "text/plain",
  md: "text/markdown",
};

/** Text of plain-text files: UTF-8, or Windows-1253/1252 for older Greek and Western files. */
function plainText(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    const greek = new TextDecoder("windows-1253").decode(bytes);
    return /[Α-ω]/.test(greek) ? greek : new TextDecoder("windows-1252").decode(bytes);
  }
}

// Extensions that promise a document format. A file named like one but holding
// none of them is damaged or not what it says, and read as text it would be noise.
const DOCUMENT_EXTENSIONS = new Set(["pdf", "docx", "doc", "odt", "rtf"]);

/** The text of a CV file, whatever its format; "" when it holds no readable text. */
async function cvText(bytes, ext) {
  switch (detectFormat(bytes)) {
    case "pdf": return pdfText(bytes);
    case "zip": return zipDocumentText(bytes);
    case "rtf": return rtfText(latin.decode(bytes));
    case "ole": return docText(bytes);
    default: return DOCUMENT_EXTENSIONS.has(ext) ? "" : plainText(bytes);
  }
}

/**
 * Reads the CV the user uploaded. The file is always kept as it is, to attach
 * to applications; the text is what we could read out of it, "" if nothing
 * (a scanned PDF, an image, a password-protected document).
 */
export async function readCV(file) {
  if (file.size > MAX_CV_BYTES) throw new Error("File is larger than 8 MB");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = (file.name.split(".").pop() || "").toLowerCase();

  let text = "";
  try {
    text = await cvText(bytes, ext);
  } catch (e) {
    // The file is still kept and attached; only the text is missing. The
    // warning says why, for whoever looks at the extension's console.
    console.warn(`Jobora: could not read text from ${file.name} —`, e);
    text = "";
  }

  return {
    filename: file.name,
    mime: file.type || CV_FORMATS[ext] || "application/octet-stream",
    base64: toBase64(bytes),
    text: text.slice(0, 20000),
    size: file.size,
    addedAt: new Date().toISOString(),
  };
}

/* ── What we can guess from the text ─────────────────────── */
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]*[\w]/;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[\w\-%]+/i;
const GITHUB_RE = /(?:https?:\/\/)?(?:www\.)?github\.com\/[\w\-]+/i;


// The same vocabulary as the title suggestions: anything the app can suggest,
// it can also recognise inside a CV.
const COMMON_TITLES = ALL_PROFESSIONS;

const foldName = (s) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
const NAME_LABELS = new Set([
  "name", "full name", "first and last name", "ονομα", "ονοματεπωνυμο", "ονομα και επωνυμο",
  "nombre", "nombre completo", "nom", "nom complet", "nome", "nome completo",
  "vollstandiger name", "imie i nazwisko",
]);
const NAME_PARTICLES = new Set(["al", "bin", "da", "das", "de", "del", "della", "der", "di", "do", "dos", "du", "la", "le", "van", "von", "y"]);
// These describe CV sections, qualifications, organisations or prose. Occupations
// such as Baker and Cook are deliberately absent: they can also be surnames.
const NON_NAME_WORDS = new Set((
  "cv curriculum vitae resume training trained certification certifications certificate certified " +
  "education qualifications qualification experience employment professional profile personal details " +
  "summary objective skills interests hobbies language languages references contact information address " +
  "university college school academy institute company corporation ltd limited inc group services " +
  "bachelor bachelors master masters degree diploma course courses award awards work history " +
  "software engineering development management customer service sales marketing human resources " +
  "street road avenue city country phone telephone email linkedin github native fluent intermediate " +
  "excellent strong team player communication available upon request citizen citizenship nationality " +
  "authorization eligible permit the and with for of in at " +
  // Section headings ("About me", "Key achievements") in the app's languages.
  "about myself overview highlights achievements accomplishments projects competencies strengths " +
  "volunteering volunteer portfolio publications activities memberships tools technologies " +
  "βιογραφικο σημειωμα εκπαιδευση καταρτιση πιστοποιηση σεμιναριο σεμιναρια πτυχιο εμπειρια " +
  "επαγγελματικη δεξιοτητες γλωσσες συστασεις επικοινωνια στοιχεια διευθυνση τηλεφωνο " +
  "σχετικα προφιλ ικανοτητες δραστηριοτητες ενδιαφεροντα εθελοντισμος " +
  "uber mich berufserfahrung ausbildung kenntnisse sprachen lebenslauf " +
  "propos competences formation langues loisirs sobre experiencia formacion idiomas " +
  "esperienza competenze lingue doswiadczenie umiejetnosci jezyki formacao"
).split(/\s+/));
const PROFESSION_NAMES = new Set(COMMON_TITLES.map(foldName));
const NAME_WORD = /^[\p{L}\p{M}]+(?:['’.-][\p{L}\p{M}]+)*\.?$/u;

// Known titles of two or more words. A phrase that contains one is a role even
// with a qualifier in front: "Senior Data Analyst" contains "data analyst".
// One-word titles are left out on purpose: "Baker" or "Cook" may be a surname.
const MULTI_WORD_TITLES = [...PROFESSION_NAMES].filter((title) => title.includes(" "));

// Words that name a role and are not used as surnames, in the languages the app
// is translated into. They catch the job title under a name, which is
// capitalised and close to the contact details just like the name itself.
// Occupations that are also surnames (Baker, Cook, Nurse) stay out.
// Written folded, like foldName() returns them: lower case, no accents.
const ROLE_WORDS = new Set([
  // English
  "analyst", "manager", "engineer", "developer", "programmer", "consultant", "specialist",
  "coordinator", "administrator", "assistant", "director", "officer", "executive",
  "representative", "technician", "designer", "architect", "scientist", "researcher",
  "accountant", "advisor", "adviser", "recruiter", "supervisor", "receptionist",
  "intern", "trainee", "apprentice", "student", "graduate", "freelancer",
  // Greek
  "αναλυτης", "αναλυτρια", "μηχανικος", "προγραμματιστης", "προγραμματιστρια",
  "υπευθυνος", "υπευθυνη", "διευθυντης", "διευθυντρια", "συμβουλος", "βοηθος",
  "λογιστης", "λογιστρια", "υπαλληλος", "στελεχος", "συντονιστης", "συντονιστρια",
  "σχεδιαστης", "σχεδιαστρια", "φοιτητης", "φοιτητρια", "ασκουμενος", "ασκουμενη",
  // German
  "berater", "beraterin", "entwickler", "entwicklerin", "ingenieur", "ingenieurin",
  "sachbearbeiter", "sachbearbeiterin", "referent", "referentin", "assistentin",
  // Spanish, Portuguese, Italian
  "analista", "ingeniero", "ingeniera", "engenheiro", "engenheira", "ingegnere",
  "desarrollador", "desarrolladora", "desenvolvedor", "desenvolvedora", "sviluppatore",
  "gerente", "asesor", "asesora", "consultor", "consultora", "consulente",
  "coordinador", "coordinadora", "coordenador", "coordenadora", "responsabile",
  "asistente", "assistente", "estudiante", "estudante", "studente",
  // French
  "analyste", "developpeur", "developpeuse", "conseiller", "conseillere",
  "technicien", "technicienne", "comptable", "etudiant", "etudiante", "gestionnaire",
  // Polish
  "analityk", "inzynier", "programista", "programistka", "kierownik", "specjalista",
  "specjalistka", "konsultant", "konsultantka", "asystent", "asystentka", "ksiegowa",
]);

/** True when a phrase, given as folded words, reads as a job title rather than a person. */
function looksLikeJobTitle(foldedWords) {
  const phrase = foldedWords.join(" ");
  if (PROFESSION_NAMES.has(phrase)) return true;
  if (foldedWords.some((word) => ROLE_WORDS.has(word))) return true;
  return MULTI_WORD_TITLES.some((title) => ` ${phrase} `.includes(` ${title} `));
}

/**
 * True when every word is a place on its own ("Zurich Switzerland", "Athens
 * Greece"): an address line, not a person. A single place word inside a name
 * keeps it a name: "Sofia Andersson", "Athina Papadopoulou".
 */
const looksLikePlace = (foldedWords) => foldedWords.every((word) => {
  const found = placesIn(word);
  return found.countries.size || found.cities.size || found.regions.size;
});

// Evidence that a phrase is the applicant's name, in points. A label ("Name:")
// or a match with the e-mail or LinkedIn handle is strong evidence; layout
// clues (capitals, position, nearby contact details) are weak on their own.
const NAME_EVIDENCE = {
  labelled: 12,              // "Name: Dimitra Mousounaki"
  matchesHandle: 10,         // dimitra.mousounaki@… or linkedin.com/in/dmousounaki
  capitalised: 3,            // every word starts with a capital letter
  nearContact: 2,            // within NEAR_CONTACT_LINES of the e-mail, phone or LinkedIn
  joinedFromTwoLines: -0.5,  // first and last name drawn on separate lines
};
// The name sits at the top of a CV. The first line counts most and each line
// below it a little less, so a heading such as "ABOUT ME" halfway down the
// page can't tie with the name.
const POSITION_POINTS = [5, 4, 3, 2, 2, 2];   // lines 1 to 6
const LATER_LINE_POINTS = 1;                   // lines 7 to NEAR_TOP_LINES
const NEAR_TOP_LINES = 20;
const NEAR_CONTACT_LINES = 2;
const positionPoints = (index) => (index < POSITION_POINTS.length ? POSITION_POINTS[index]
  : index < NEAR_TOP_LINES ? LATER_LINE_POINTS : 0);
// The winner needs at least MIN_NAME_SCORE points and a lead of MIN_LEAD over
// the runner-up. Otherwise the name stays empty for the user to type: a wrong
// name on job applications is worse than an empty field.
const MIN_NAME_SCORE = 3;
const MIN_LEAD = 2;

function nameLabel(line) {
  const colon = line.search(/[:：]/);
  if (colon >= 0 && NAME_LABELS.has(foldName(line.slice(0, colon).trim()))) {
    return { labelled: true, value: line.slice(colon + 1).trim() };
  }
  return { labelled: NAME_LABELS.has(foldName(line)), value: "" };
}

/**
 * Picks the applicant's name from the CV text, or returns "" when unsure.
 *
 * Every line that could be a name (and every pair of one-word lines, for PDFs
 * that draw first and last name apart) becomes a candidate and collects the
 * points in NAME_EVIDENCE. Job titles, headings and qualifications are not
 * candidates at all, so they cannot tie with the real name.
 */
function guessName(text, contact) {
  const lines = text.normalize("NFKC").split(/\r\n?|\n/)
    .map((line) => line.replace(/^[#*•\s]+|[*\s]+$/g, "").replace(/\s+/g, " "));
  const aliases = [contact.email.split("@")[0], contact.linkedin.split("/").pop() || ""]
    .filter(Boolean).map((s) => foldName(s).replace(/[^\p{L}]/gu, ""));
  const contactLines = lines.map((line, i) =>
    [contact.email, contact.phone, contact.linkedin].some((s) => s && line.includes(s)) ? i : -1
  ).filter((i) => i >= 0);
  const candidates = new Map();

  const add = (value, index, labelled = false, joined = false) => {
    value = value.replace(/^(?:mr|mrs|ms|miss|dr|prof)\.?\s+/i, "").trim();
    if (value.length < 2 || value.length > 70) return;
    const words = value.split(/\s+/);
    if (words.length < (labelled ? 1 : 2) || words.length > 6 || !words.every((w) => NAME_WORD.test(w))) return;
    const folded = words.map(foldName);
    if (folded.some((w) => NON_NAME_WORDS.has(w)) || looksLikeJobTitle(folded) || looksLikePlace(folded)) return;
    const significant = folded.filter((w) => !NAME_PARTICLES.has(w)).map((w) => w.replace(/[^\p{L}]/gu, ""));
    if (!significant.length || (!labelled && significant.filter((w) => w.length > 1).length < 2)) return;

    const capitals = words.every((w, i) => NAME_PARTICLES.has(folded[i]) || /^\p{Lu}/u.test(w));
    const first = significant[0], last = significant.at(-1);
    const matchesAlias = significant.length >= 2 && last.length >= 3 && aliases.some((alias) =>
      alias.includes(last) && (alias.includes(first) || alias.startsWith(first[0])));
    let score = 0;
    if (labelled) score += NAME_EVIDENCE.labelled;
    if (matchesAlias) score += NAME_EVIDENCE.matchesHandle;
    if (capitals) score += NAME_EVIDENCE.capitalised;
    score += positionPoints(index);
    if (contactLines.some((i) => Math.abs(i - index) <= NEAR_CONTACT_LINES)) score += NAME_EVIDENCE.nearContact;
    if (joined) score += NAME_EVIDENCE.joinedFromTwoLines;
    const key = foldName(value);
    if (score > (candidates.get(key)?.score ?? -1)) candidates.set(key, { value, score });
  };

  for (let i = 0; i < lines.length; i++) {
    const label = nameLabel(lines[i]);
    if (label.labelled) {
      const value = label.value || lines[i + 1] || "";
      // A label may precede a first and last name on separate lines.
      const next = lines[i + (label.value ? 1 : 2)] || "";
      if (NAME_WORD.test(value) && NAME_WORD.test(next) &&
          !NON_NAME_WORDS.has(foldName(next)) && !PROFESSION_NAMES.has(foldName(next))) {
        add(`${value} ${next}`, i, true);
      } else {
        add(value, i, true);
      }
    } else {
      add(lines[i], i);
      // PDF generators sometimes draw a first and last name on separate lines.
      if (NAME_WORD.test(lines[i]) && NAME_WORD.test(lines[i + 1] || "") &&
          !PROFESSION_NAMES.has(foldName(lines[i])) && !PROFESSION_NAMES.has(foldName(lines[i + 1]))) {
        add(`${lines[i]} ${lines[i + 1]}`, i, false, true);
      }
    }
  }
  const [best, runnerUp] = [...candidates.values()].sort((a, b) => b.score - a.score);
  if (!best || best.score < MIN_NAME_SCORE) return "";
  if (runnerUp && best.score - runnerUp.score < MIN_LEAD) return "";
  return best.value;
}

// Where a job title appears says more than how often it appears. The headline
// under the name and the start of a line (where CVs put the role of each job)
// describe the person's own work; a title inside a sentence ("customers of
// brokers") usually describes someone else's.
const TITLE_WEIGHT = { headline: 3, lineStart: 2, elsewhere: 1 };
const HEADLINE_LINES = 5;
const MAX_TITLE_SUGGESTIONS = 5;

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Whole words only, so "Trader" does not match inside "MetaTrader", nor
// "Pilot" inside "Copilot". Longest first, so "Primary School Teacher" claims
// its words before "Teacher" can.
const TITLE_PATTERNS = [...COMMON_TITLES]
  .sort((a, b) => b.length - a.length)
  .map((title) => ({
    title,
    lowerCase: title.toLowerCase(),
    pattern: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(title)}(?![\\p{L}\\p{N}])`, "giu"),
  }));

/** The job titles a CV mentions, most telling first, at most MAX_TITLE_SUGGESTIONS. */
function suggestTitles(text) {
  const lowerText = text.toLowerCase();
  const lines = text.split(/\r\n?|\n/)
    .map((line) => line.replace(/^[\s#*•·–—-]+/, "").trim())
    .filter(Boolean);
  // Per line, the character ranges that a longer title has already claimed.
  const claimed = lines.map(() => []);
  const found = new Map();  // title → { title, score, firstLine }

  for (const { title, lowerCase, pattern } of TITLE_PATTERNS) {
    if (!lowerText.includes(lowerCase)) continue;  // cheap check before the regex
    lines.forEach((line, lineIndex) => {
      for (const match of line.matchAll(pattern)) {
        const start = match.index, end = start + match[0].length;
        if (claimed[lineIndex].some(([from, to]) => start < to && from < end)) continue;
        claimed[lineIndex].push([start, end]);

        const weight = lineIndex < HEADLINE_LINES ? TITLE_WEIGHT.headline
          : start === 0 ? TITLE_WEIGHT.lineStart
          : TITLE_WEIGHT.elsewhere;
        const entry = found.get(title) ?? { title, score: 0, firstLine: lineIndex };
        entry.score += weight;
        found.set(title, entry);
      }
    });
  }

  // Most points first; on a tie, the title that appears earlier in the CV.
  return [...found.values()]
    .sort((a, b) => b.score - a.score || a.firstLine - b.firstLine)
    .slice(0, MAX_TITLE_SUGGESTIONS)
    .map((entry) => entry.title);
}

// A phone number as CVs write it: an optional international prefix (+30,
// 0030, (+30)) and digit groups separated by spaces, dots, dashes or brackets,
// never across a line break. Every country groups digits differently
// (+41 79 123 45 67, +33 6 12 34 56 78, +44 7700 900123), so the pattern
// leaves the layout open and the digit count decides afterwards.
const PHONE_CANDIDATE = /(?<![\p{L}\p{N}+])\(?(?:\+|00)?\d[\d \t .()-]{5,}\d/gu;
const PHONE_DIGITS = { min: 8, max: 15 };  // 15 is the international (E.164) maximum
const PHONE_HEADER_LINES = 15;             // where CVs put contact details
// The words just before a number say what it is.
const PHONE_LABEL = /(?:^|[^\p{L}])(?:tel|phone|mobile|mob|cell|τηλ|κιν|telefon|celular|movil|cellulare|handy|gsm|whatsapp|telemovel)\p{L}*\.?[^\p{L}\p{N}]{0,4}$|[📞☎✆]\s*$/u;
const NOT_PHONE_LABEL = /(?:^|[^\p{L}])(?:vat|afm|αφμ|iban|amka|αμκα|tax|passport|postal|zip|fax|id)[^\p{L}\p{N}]{0,4}$/u;
// Years side by side ("2019-2024", "2018 2019") and dates ("01.02.2020") have
// phone-like digit counts.
const DATE_LIKE = /^(?:(?:(?:19|20)\d\d[\s./-]*){2,}|\d{1,2}[.-]\d{1,2}[.-]\d{2,4})$/;
// Points for each sign that a number is the applicant's phone. A number needs
// at least one of them: a bare number deep in the text is more likely an ID.
const PHONE_EVIDENCE = { labelled: 3, internationalPrefix: 2, inHeader: 1 };

/** Removes a bracket left open at the start, as in "(+30 694 123 4567". */
function balanceBrackets(value) {
  const opened = (value.match(/\(/g) || []).length;
  const closed = (value.match(/\)/g) || []).length;
  return opened > closed && value.startsWith("(") ? value.slice(1).trim() : value;
}

/** The applicant's phone number as the CV writes it, or "" when there is none. */
function findPhone(text) {
  let best = null;
  text.split(/\r\n?|\n/).forEach((line, lineIndex) => {
    for (const match of line.matchAll(PHONE_CANDIDATE)) {
      const value = match[0].trim();
      const digits = value.replace(/\D/g, "").replace(/^00/, "");
      if (digits.length < PHONE_DIGITS.min || digits.length > PHONE_DIGITS.max) continue;
      if (DATE_LIKE.test(value)) continue;

      const before = foldName(line.slice(Math.max(0, match.index - 25), match.index));
      if (NOT_PHONE_LABEL.test(before)) continue;

      let score = 0;
      if (PHONE_LABEL.test(before)) score += PHONE_EVIDENCE.labelled;
      if (/^\(?(?:\+|00)/.test(value)) score += PHONE_EVIDENCE.internationalPrefix;
      if (lineIndex < PHONE_HEADER_LINES) score += PHONE_EVIDENCE.inHeader;
      // Strictly greater: the first number wins a tie, and a number with no
      // evidence at all never wins.
      if (score > (best?.score ?? 0)) best = { score, value };
    }
  });
  return best ? balanceBrackets(best.value) : "";
}

// Contact details sit in the first lines of a CV; a city further down is
// usually where a past job was, not where the applicant lives.
const ADDRESS_HEADER_LINES = 12;
const ADDRESS_MAX_LENGTH = 60;

/**
 * Where the applicant lives, as the CV writes it ("Spata, Attica, Greece"),
 * and the English name of that country ("Greece"). The country decides which
 * remote jobs are open to the applicant.
 */
function findHomeLocation(text) {
  for (const line of text.split(/\r\n?|\n/).slice(0, ADDRESS_HEADER_LINES)) {
    for (const part of line.split(/[|·•]/)) {
      const segment = part.trim().replace(/[,;]+$/, "");
      // Skip e-mail addresses, links and phone numbers sharing the line.
      if (!segment || segment.length > ADDRESS_MAX_LENGTH || /@|https?:|www\.|\d{6,}/.test(segment)) continue;
      const [country] = placesIn(segment).countries;
      if (country) return { location: segment, country: countryLabel(country) };
    }
  }
  return { location: "", country: "" };
}

/** Guesses contact details, the applicant's name and likely job titles from the CV text. */
export function guessFromCV(text) {
  const out = {
    name: "", email: "", phone: "", location: "", country: "", linkedin: "", github: "", titles: [],
  };
  if (!text) return out;

  out.email = (text.match(EMAIL_RE) || [""])[0];
  out.phone = findPhone(text);
  Object.assign(out, findHomeLocation(text));
  out.linkedin = (text.match(LINKEDIN_RE) || [""])[0];
  out.github = (text.match(GITHUB_RE) || [""])[0];

  // PDF storage order can differ from the visible header. Compare plausible
  // names using labels and contact details, and reject qualifications.
  out.name = guessName(text, out);

  out.titles = suggestTitles(text);
  return out;
}

export { COMMON_TITLES };
