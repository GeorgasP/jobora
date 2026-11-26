import { ALL_PROFESSIONS } from "./professions.js";

/*
 * CV upload + parsing, χωρίς καμία εξωτερική βιβλιοθήκη.
 *
 * PDF  : αποσυμπίεση των FlateDecode streams με DecompressionStream και
 *        εξαγωγή των Tj/TJ strings.
 * DOCX : το .docx είναι zip — διαβάζουμε το word/document.xml απευθείας.
 * TXT/MD: ό,τι βλέπεις.
 *
 * Από το κείμενο βγάζουμε όνομα, email, τηλέφωνο, LinkedIn και πιθανούς
 * τίτλους θέσεων, ώστε το onboarding να είναι σχεδόν αυτόματο.
 */

export const MAX_CV_BYTES = 8 * 1024 * 1024;

const dec = new TextDecoder("utf-8", { fatal: false });
const latin = new TextDecoder("latin1");

async function inflate(bytes, format) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ── PDF ──────────────────────────────────────────────────── */

/**
 * Δύο κόσμοι σε ένα format:
 *
 *  • Απλά PDF (base-14 γραμματοσειρές): τα bytes μέσα στις παρενθέσεις ΕΙΝΑΙ
 *    το κείμενο. Το διαβάζεις κατευθείαν.
 *  • Σύγχρονα PDF (Word, Google Docs, LaTeX, Chrome): ενσωματώνουν υποσύνολα
 *    γραμματοσειρών με Identity encoding — τα bytes είναι αριθμοί glyph, όχι
 *    γράμματα. Η αντιστοίχιση σε κείμενο ζει σε ένα /ToUnicode CMap ανά
 *    γραμματοσειρά. Χωρίς αυτό, βγάζεις σκουπίδια.
 *
 * Διαβάζουμε και τα δύο.
 */

const hexToText = (hex) => {
  let out = "";
  for (let i = 0; i + 3 < hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  return out;
};

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
  return map;
}

/** Αποσυμπιέζει το stream ενός αντικειμένου, αν έχει. */
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
    try { return await inflate(slice, fmt); } catch { /* άλλο filter */ }
  }
  return slice;                                   // ασυμπίεστο
}

async function pdfText(bytes) {
  const raw = latin.decode(bytes);

  // 1. Ευρετήριο αντικειμένων
  const objects = new Map();
  for (const m of raw.matchAll(/(\d+)\s+0\s+obj\b/g)) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endobj", start);
    if (end > 0) objects.set(Number(m[1]), { start, end });
  }

  // 2. CMaps ανά αντικείμενο-γραμματοσειράς
  const cmapCache = new Map();
  const cmapFor = async (fontObjNum) => {
    if (cmapCache.has(fontObjNum)) return cmapCache.get(fontObjNum);
    let map = null;
    const font = objects.get(fontObjNum);
    if (font) {
      const decl = raw.slice(font.start, font.end);
      const ref = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(decl);
      const target = ref && objects.get(Number(ref[1]));
      if (target) {
        const data = await objectStream(bytes, raw, target.start, target.end);
        if (data) map = parseCMap(latin.decode(data));
      }
    }
    cmapCache.set(fontObjNum, map);
    return map;
  };

  // 3. Όνομα πόρου (/F1) → αντικείμενο γραμματοσειράς, από κάθε /Font << … >>
  const fontByName = new Map();
  for (const block of raw.matchAll(/\/Font\s*<<([\s\S]{0,4000}?)>>/g)) {
    for (const e of block[1].matchAll(/\/([A-Za-z0-9_.#-]+)\s+(\d+)\s+0\s+R/g)) {
      fontByName.set(e[1], Number(e[2]));
    }
  }

  // 4. Τα content streams, με ενεργή γραμματοσειρά ανά σημείο
  const decodeWithMap = (codes, map) => {
    let out = "";
    for (let i = 0; i + 1 < codes.length; i += 2) {
      const code = (codes.charCodeAt(i) << 8) | codes.charCodeAt(i + 1);
      out += map.get(code) ?? "";
    }
    return out;
  };
  const unescapeLiteral = (s) => s
    .replace(/\\([()\\])/g, "$1")
    .replace(/\\n/g, "\n").replace(/\\r/g, "").replace(/\\t/g, " ")
    .replace(/\\(\d{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));

  const decodeText = (token, map) => {
    if (token[0] === "(") {
      const body = unescapeLiteral(token.slice(1, -1));
      return map ? decodeWithMap(body, map) : body;
    }
    const hex = token.slice(1, -1).replace(/\s+/g, "");
    let out = "";
    const width = map ? 4 : 2;
    for (let i = 0; i + width <= hex.length; i += width) {
      const code = parseInt(hex.slice(i, i + width), 16);
      out += map ? map.get(code) ?? "" : String.fromCharCode(code);
    }
    return out;
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
  // Τα Tm/Td δεν σημαίνουν πάντα νέα γραμμή — ο Chrome τα χρησιμοποιεί και για
  // μετακίνηση μέσα στην ίδια γραμμή. Κοιτάμε αν άλλαξε το Y.
  const TOKEN = new RegExp([
    /\/([A-Za-z0-9_.#-]+)\s+[\d.]+\s+Tf/,          // 1: επιλογή γραμματοσειράς
    /<([0-9A-Fa-f\s]+)>/,                          // 2: hex string
    /\((?:\\.|[^\\()])*\)/,                        // literal string
    /((?:-?[\d.]+\s+){6})Tm/,                      // 3: text matrix
    /((?:-?[\d.]+\s+){2})T[dD]/,                   // 4: text displacement
    /\[((?:\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>|[-+]?(?:\d+\.\d*|\.\d+|\d+)(?![\d.])|\s|%[^\r\n]*(?=\r|\n|$))*)\]\s*TJ/, // 5: text array
    /T\*|ET|BT/,
  ].map((r) => r.source).join("|"), "g");

  for (const [, span] of objects) {
    const decl = raw.slice(span.start, Math.min(span.end, span.start + 400));
    if (/\/(Image|Font|FontFile|ToUnicode|XObject\s*<<)/.test(decl) && !/\/Contents/.test(decl)) {
      if (!/\/Length/.test(decl) || /\/Subtype\s*\/Image/.test(decl)) continue;
    }
    const data = await objectStream(bytes, raw, span.start, span.end);
    if (!data) continue;
    const text = latin.decode(data);
    if (!/\bTj\b|\bTJ\b|\bTf\b/.test(text)) continue;

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
        map = await cmapFor(fontByName.get(g[1]));
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
    if (chunks.length > 60000) break;
  }

  return chunks.join("")
    // Τα PDF γράφουν «ﬁ» ως ένα glyph — χωρίς κανονικοποίηση, το «ﬁntech»
    // δεν ταιριάζει ποτέ με αναζήτηση για «fintech».
    .normalize("NFKC")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ── DOCX (zip → word/document.xml) ───────────────────────── */
async function docxText(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const SIG = 0x04034b50;

  for (let i = 0; i < bytes.length - 4; i++) {
    if (view.getUint32(i, true) !== SIG) continue;
    const method = view.getUint16(i + 8, true);
    const compSize = view.getUint32(i + 18, true);
    const nameLen = view.getUint16(i + 26, true);
    const extraLen = view.getUint16(i + 28, true);
    const nameStart = i + 30;
    const name = dec.decode(bytes.subarray(nameStart, nameStart + nameLen));
    if (name !== "word/document.xml") continue;

    const dataStart = nameStart + nameLen + extraLen;
    const data = bytes.subarray(dataStart, dataStart + (compSize || bytes.length - dataStart));
    const xmlBytes = method === 0 ? data : await inflate(data, "deflate-raw");
    const xml = dec.decode(xmlBytes);
    return xml
      .replace(/<\/w:p>/g, "\n")
      .replace(/<w:tab[^>]*\/>/g, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }
  return "";
}

const toBase64 = (bytes) => {
  let bin = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(bin);
};

/** Διαβάζει το αρχείο που ανέβασε ο χρήστης. */
export async function readCV(file) {
  if (file.size > MAX_CV_BYTES) throw new Error("File is larger than 8 MB");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = (file.name.split(".").pop() || "").toLowerCase();

  let text = "";
  try {
    if (ext === "pdf") text = await pdfText(bytes);
    else if (ext === "docx") text = await docxText(bytes);
    else text = dec.decode(bytes);
  } catch (e) {
    text = "";
  }

  return {
    filename: file.name,
    mime: file.type || (ext === "pdf" ? "application/pdf" : "application/octet-stream"),
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
  "βιογραφικο σημειωμα εκπαιδευση καταρτιση πιστοποιηση σεμιναριο σεμιναρια πτυχιο εμπειρια " +
  "επαγγελματικη δεξιοτητες γλωσσες συστασεις επικοινωνια στοιχεια διευθυνση τηλεφωνο"
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

// Evidence that a phrase is the applicant's name, in points. A label ("Name:")
// or a match with the e-mail or LinkedIn handle is strong evidence; layout
// clues (capitals, position, nearby contact details) are weak on their own.
const NAME_EVIDENCE = {
  labelled: 12,              // "Name: Dimitra Mousounaki"
  matchesHandle: 10,         // dimitra.mousounaki@… or linkedin.com/in/dmousounaki
  capitalised: 3,            // every word starts with a capital letter
  firstLine: 3,
  nearTop: 2,                // within NEAR_TOP_LINES lines, but not the first one
  nearContact: 2,            // within NEAR_CONTACT_LINES of the e-mail, phone or LinkedIn
  joinedFromTwoLines: -0.5,  // first and last name drawn on separate lines
};
const NEAR_TOP_LINES = 20;
const NEAR_CONTACT_LINES = 2;
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
    if (folded.some((w) => NON_NAME_WORDS.has(w)) || looksLikeJobTitle(folded)) return;
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
    if (index === 0) score += NAME_EVIDENCE.firstLine;
    else if (index < NEAR_TOP_LINES) score += NAME_EVIDENCE.nearTop;
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

/** Guesses contact details, the applicant's name and likely job titles from the CV text. */
export function guessFromCV(text) {
  const out = { name: "", email: "", phone: "", linkedin: "", github: "", titles: [] };
  if (!text) return out;

  out.email = (text.match(EMAIL_RE) || [""])[0];
  out.phone = findPhone(text);
  out.linkedin = (text.match(LINKEDIN_RE) || [""])[0];
  out.github = (text.match(GITHUB_RE) || [""])[0];

  // PDF storage order can differ from the visible header. Compare plausible
  // names using labels and contact details, and reject qualifications.
  out.name = guessName(text, out);

  out.titles = suggestTitles(text);
  return out;
}

export { COMMON_TITLES };
