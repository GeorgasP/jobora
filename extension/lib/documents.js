/*
 * Text out of office documents, with no outside library: DOCX and ODT (zip
 * archives of XML), RTF, and the old binary Word .doc. PDF lives in cv.js.
 *
 * Contact details often sit in a page header in Word CV templates, so headers
 * and footers are read too, and headers come first: the reader that guesses
 * the applicant's name looks at the top of the text.
 */

const utf8 = new TextDecoder("utf-8");

/* ── Telling formats apart ─────────────────────────────────── */

const startsWith = (bytes, signature) => signature.every((byte, i) => bytes[i] === byte);
const PDF = [0x25, 0x50, 0x44, 0x46];                                // %PDF
const ZIP = [0x50, 0x4b, 0x03, 0x04];                                // PK..
const RTF = [0x7b, 0x5c, 0x72, 0x74, 0x66];                          // {\rtf
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];        // compound file (.doc)

/**
 * What a file really is, judged by its first bytes, so a CV saved with the
 * wrong extension (an RTF named .doc, a DOCX named .doc) is still read.
 * Returns "pdf", "zip", "rtf", "ole" or "text".
 */
export function detectFormat(bytes) {
  if (startsWith(bytes, PDF)) return "pdf";
  if (startsWith(bytes, ZIP)) return "zip";
  if (startsWith(bytes, RTF)) return "rtf";
  if (startsWith(bytes, OLE)) return "ole";
  return "text";
}

/* ── Zip (DOCX, ODT) ───────────────────────────────────────── */

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * The files inside a zip archive, read through its central directory: the
 * one place that always holds every file's size. Some programs leave the
 * sizes out of the per-file headers, and reading those alone breaks.
 * Returns name → async function giving the file's bytes.
 */
export function zipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = new Map();
  // The end-of-directory record is in the last 64 KB (its comment can be that long).
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) return entries;

  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  for (let n = 0; n < count && at + 46 <= bytes.length; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = utf8.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    entries.set(name, async () => {
      const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(dataStart, dataStart + size);
      return method === 8 ? inflateRaw(data) : data;
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodeXml = (text) => text
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
  .replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => XML_ENTITIES[name]);

const tidy = (text) => text
  .replace(/[ \t ]+/g, " ")
  .replace(/ *\n */g, "\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

/** Text of one WordprocessingML part (document, header or footer). */
function wordXmlText(xml) {
  return decodeXml(xml
    // A text box is stored twice: as a drawing and as an old-style fallback.
    .replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, "")
    .replace(/<w:(?:br|cr)\b[^>]*\/>/g, "\n")
    .replace(/<w:tab\b[^>]*\/>/g, " ")
    // A table row stays one line ("Nationality Greek"): a cell's last
    // paragraph ends with a space, the row with a line break.
    .replace(/<\/w:p>(\s*<\/w:tc>)/g, " $1")
    .replace(/<\/w:(?:p|tr)>/g, "\n")
    .replace(/<\/w:tc>/g, " ")
    .replace(/<[^>]+>/g, ""));
}

/** DOCX: headers, then the document, then footers. */
async function docxText(entries) {
  const names = [...entries.keys()];
  const parts = [
    ...names.filter((n) => /^word\/header\d*\.xml$/.test(n)).sort(),
    "word/document.xml",
    ...names.filter((n) => /^word\/footer\d*\.xml$/.test(n)).sort(),
  ].filter((name) => entries.has(name));
  const texts = [];
  for (const name of parts) texts.push(wordXmlText(utf8.decode(await entries.get(name)())));
  return tidy(texts.join("\n"));
}

/** Text of an OpenDocument XML fragment. */
function odfXmlText(xml) {
  return decodeXml(xml
    .replace(/<text:line-break\s*\/>/g, "\n")
    .replace(/<text:tab\s*\/>/g, " ")
    .replace(/<text:s(?:\s+text:c="(\d+)")?\s*\/>/g, (_, n) => " ".repeat(Number(n || 1)))
    // A table row stays one line, as in DOCX.
    .replace(/<\/text:p>(\s*<\/table:table-cell>)/g, " $1")
    .replace(/<\/text:(?:p|h)>/g, "\n")
    .replace(/<\/table:table-cell>/g, " ")
    .replace(/<\/table:table-row>/g, "\n")
    .replace(/<[^>]+>/g, ""));
}

/** ODT (LibreOffice, Word's "OpenDocument"): page headers (in styles.xml), content, footers. */
async function odtText(entries) {
  const styles = entries.has("styles.xml") ? utf8.decode(await entries.get("styles.xml")()) : "";
  const content = entries.has("content.xml") ? utf8.decode(await entries.get("content.xml")()) : "";
  const pageParts = (tag) => [...styles.matchAll(new RegExp(`<style:${tag}\\b[^>]*>([\\s\\S]*?)</style:${tag}>`, "g"))]
    .map((m) => odfXmlText(m[1]));
  const body = (/<office:text\b[^>]*>([\s\S]*)<\/office:text>/.exec(content) || [, content])[1];
  return tidy([...pageParts("header"), odfXmlText(body), ...pageParts("footer")].join("\n"));
}

/** A DOCX or ODT, whichever the archive turns out to be; "" for other zips. */
export async function zipDocumentText(bytes) {
  const entries = zipEntries(bytes);
  if (entries.has("word/document.xml")) return docxText(entries);
  if (entries.has("content.xml")) return odtText(entries);
  return "";
}

/* ── RTF ───────────────────────────────────────────────────── */

// Groups that hold settings or pictures, not text. Headers and footers are
// not among them: they are where templates put contact details. A shape's
// properties ("sp") are skipped but its text box ("shptxt") is read; the
// shape's fallback copy ("shprslt") would only repeat that text.
const RTF_SKIPPED = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "themedata",
  "colorschememapping", "datastore", "latentstyles", "listtable", "listoverridetable", "rsidtbl",
  "generator", "xmlnstbl", "mmathPr", "revtbl", "pgdsctbl", "fldinst", "nonshppict", "sp", "shprslt"]);
// "{\*\name …}" groups are skipped unless the reader knows them; these hold text.
const RTF_KEPT_DESTINATIONS = new Set(["shpinst"]);
const RTF_BREAKS = { par: "\n", line: "\n", row: "\n", sect: "\n", page: "\n", tab: " ", cell: " " };

/** Plain text of an RTF document, decoding \'hh bytes in the document's code page and \uN characters. */
export function rtfText(source) {
  const codePage = /\\ansicpg(\d+)/.exec(source)?.[1] || "1252";
  let bytesDecoder;
  try { bytesDecoder = new TextDecoder(`windows-${codePage}`); } catch { bytesDecoder = new TextDecoder("windows-1252"); }

  let out = "";
  let pendingBytes = [];
  const flushBytes = () => {
    if (pendingBytes.length) out += bytesDecoder.decode(new Uint8Array(pendingBytes));
    pendingBytes = [];
  };
  const emit = (text) => { flushBytes(); out += text; };

  const stack = [];
  let group = { skip: false, ignorable: false, uc: 1 };
  let skipFallback = 0;     // characters to drop after a \uN
  const controlWord = /\\([a-z]+)(-?\d+)? ?|\\'([0-9a-f]{2})|\\([^a-z])|([{}])|([^\\{}\r\n]+)|[\r\n]+/giy;

  for (let m; (m = controlWord.exec(source)) !== null;) {
    const [, word, param, hex, symbol, brace, text] = m;
    if (brace === "{") { stack.push(group); group = { ...group }; continue; }
    if (brace === "}") { flushBytes(); group = stack.pop() || group; continue; }
    if (group.skip) continue;

    if (skipFallback > 0 && (hex || text)) {
      // The fallback for a \u character is a \'hh or plain characters; drop exactly uc of them.
      if (hex) { skipFallback--; continue; }
      const dropped = Math.min(skipFallback, text.length);
      skipFallback -= dropped;
      if (dropped < text.length) emit(text.slice(dropped));
      continue;
    }
    if (word) {
      if (group.ignorable) {
        group.ignorable = false;
        if (!RTF_KEPT_DESTINATIONS.has(word)) { group.skip = true; continue; }
      }
      if (RTF_SKIPPED.has(word)) { group.skip = true; continue; }
      if (word === "uc") { group.uc = Number(param || 1); continue; }
      if (word === "u") {
        let code = Number(param);
        if (code < 0) code += 65536;
        emit(String.fromCharCode(code));
        skipFallback = group.uc;
        continue;
      }
      if (RTF_BREAKS[word]) emit(RTF_BREAKS[word]);
      continue;
    }
    if (symbol === "*") { group.ignorable = true; continue; }   // "{\*\name": decided by the name that follows
    if (symbol === "~") { emit(" "); continue; }
    if (symbol === "_") { emit("-"); continue; }
    if (symbol && "\\{}".includes(symbol)) { emit(symbol); continue; }
    if (hex) { pendingBytes.push(parseInt(hex, 16)); continue; }
    if (text) emit(text);
  }
  flushBytes();
  return tidy(out);
}

/* ── Binary Word (.doc, Word 97–2003) ──────────────────────── */

const END_OF_CHAIN = 0xfffffffe;

/**
 * The streams inside a Microsoft compound file (the container of .doc), by
 * name. Small streams live in the "mini stream", in 64-byte sectors.
 */
function compoundFileStreams(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sectorSize = 1 << view.getUint16(30, true);
  const miniSectorSize = 1 << view.getUint16(32, true);
  const miniCutoff = view.getUint32(56, true);
  const sectorAt = (sector) => (sector + 1) * sectorSize;

  // The sector allocation table, from the sector list in the header and in any extra list sectors.
  const fatSectors = [];
  for (let i = 0; i < 109; i++) {
    const sector = view.getUint32(76 + 4 * i, true);
    if (sector >= END_OF_CHAIN) break;
    fatSectors.push(sector);
  }
  for (let extra = view.getUint32(68, true), guard = 0; extra < END_OF_CHAIN && guard < 1000; guard++) {
    const perSector = sectorSize / 4 - 1;
    for (let i = 0; i < perSector; i++) {
      const sector = view.getUint32(sectorAt(extra) + 4 * i, true);
      if (sector < END_OF_CHAIN) fatSectors.push(sector);
    }
    extra = view.getUint32(sectorAt(extra) + 4 * perSector, true);
  }
  const fat = [];
  for (const sector of fatSectors) {
    for (let i = 0; i < sectorSize / 4; i++) fat.push(view.getUint32(sectorAt(sector) + 4 * i, true));
  }

  const readChain = (start, table, read, unit, size) => {
    const parts = [];
    for (let sector = start, guard = 0; sector < END_OF_CHAIN && guard < table.length; guard++) {
      parts.push(read(sector));
      sector = table[sector];
    }
    const out = new Uint8Array(parts.length * unit);
    parts.forEach((part, i) => out.set(part, i * unit));
    return size === undefined ? out : out.subarray(0, size);
  };
  const readSectors = (start, size) =>
    readChain(start, fat, (s) => bytes.subarray(sectorAt(s), sectorAt(s) + sectorSize), sectorSize, size);

  const directory = readSectors(view.getUint32(48, true));
  const dirView = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  const entries = [];
  for (let at = 0; at + 128 <= directory.length; at += 128) {
    const nameLength = dirView.getUint16(at + 64, true);
    const name = new TextDecoder("utf-16le").decode(directory.subarray(at, at + Math.max(0, nameLength - 2)));
    entries.push({ name, type: directory[at + 66], start: dirView.getUint32(at + 116, true), size: dirView.getUint32(at + 120, true) });
  }

  const root = entries[0];
  const miniStream = root ? readSectors(root.start, root.size) : new Uint8Array();
  const miniFatBytes = readSectors(view.getUint32(60, true));
  const miniFatView = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength);
  const miniFat = Array.from({ length: miniFatBytes.length / 4 }, (_, i) => miniFatView.getUint32(4 * i, true));
  const readMini = (start, size) => readChain(start, miniFat,
    (s) => miniStream.subarray(s * miniSectorSize, (s + 1) * miniSectorSize), miniSectorSize, size);

  const streams = new Map();
  for (const entry of entries) {
    if (entry.type !== 2) continue;   // 2 = stream
    streams.set(entry.name, entry.size < miniCutoff ? readMini(entry.start, entry.size) : readSectors(entry.start, entry.size));
  }
  return streams;
}

/**
 * Word's own characters, made plain: paragraph and cell marks become breaks,
 * and a field keeps its result but not its code (HYPERLINK "mailto:…").
 */
function plainWordCharacters(text) {
  let out = "";
  const fields = [];   // for each open field: true while still in its code
  for (const ch of text) {
    if (ch === "\u0013") { fields.push(true); continue; }
    if (ch === "\u0014") { if (fields.length) fields[fields.length - 1] = false; continue; }
    if (ch === "\u0015") { fields.pop(); continue; }
    if (fields.includes(true)) continue;
    if (ch === "\r" || ch === "\u000b" || ch === "\u000c") out += "\n";
    else if (ch === "\u0007" || ch === "\t") out += " ";
    else if (ch === "\u001e") out += "-";
    else if (ch >= " " || ch === "\n") out += ch;
  }
  return out;
}

/**
 * Text of a Word 97–2003 .doc: the text is stored in pieces (one byte per
 * character, Windows-1252, or two, UTF-16), listed in the "piece table" kept
 * in the table stream. The header text comes after the body in the file; it
 * is moved to the top, where contact details belong.
 */
export function docText(bytes) {
  const streams = compoundFileStreams(bytes);
  const wordDocument = streams.get("WordDocument");
  if (!wordDocument || wordDocument.length < 0x1aa) return "";
  const fib = new DataView(wordDocument.buffer, wordDocument.byteOffset, wordDocument.byteLength);
  if (fib.getUint16(0, true) !== 0xa5ec) return "";
  const flags = fib.getUint16(0x0a, true);
  if (flags & 0x0100) return "";   // encrypted: needs the password
  const table = streams.get(flags & 0x0200 ? "1Table" : "0Table");
  const clxStart = fib.getUint32(0x01a2, true);
  const clxLength = fib.getUint32(0x01a6, true);
  if (!table || !clxLength || clxStart + clxLength > table.length) return "";

  const tableView = new DataView(table.buffer, table.byteOffset, table.byteLength);
  let at = clxStart;
  while (at < clxStart + clxLength && table[at] === 0x01) at += 3 + tableView.getUint16(at + 1, true);  // formatting, not text
  if (table[at] !== 0x02) return "";
  const pieceCount = (tableView.getUint32(at + 1, true) - 4) / 12;
  const cpsAt = at + 5;
  const piecesAt = cpsAt + 4 * (pieceCount + 1);
  const cp1252 = new TextDecoder("windows-1252");
  const utf16 = new TextDecoder("utf-16le");

  let text = "";
  for (let i = 0; i < pieceCount; i++) {
    const length = tableView.getUint32(cpsAt + 4 * (i + 1), true) - tableView.getUint32(cpsAt + 4 * i, true);
    const fc = tableView.getUint32(piecesAt + 8 * i + 2, true);
    const oneByte = (fc & 0x40000000) !== 0;
    const offset = oneByte ? (fc & 0x3fffffff) / 2 : fc & 0x3fffffff;
    text += oneByte
      ? cp1252.decode(wordDocument.subarray(offset, offset + length))
      : utf16.decode(wordDocument.subarray(offset, offset + 2 * length));
  }

  const bodyLength = fib.getUint32(0x4c, true);
  const footnotesLength = fib.getUint32(0x50, true);
  const headersLength = fib.getUint32(0x54, true);
  const headersStart = bodyLength + footnotesLength;
  const headers = text.slice(headersStart, headersStart + headersLength);
  const rest = text.slice(0, headersStart) + text.slice(headersStart + headersLength);
  return tidy(plainWordCharacters(`${headers}\n${rest}`));
}
