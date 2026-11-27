// Builds small synthetic PDFs for the CV reader's tests: no private CVs and no
// downloaded libraries. Objects are numbered from 1 in the order given.
import { deflateSync } from "node:zlib";

/** A stream object: its dictionary entries, then the data, Flate-compressed if asked. */
export function stream(source, { dictionary = "", compressed = false } = {}) {
  const data = compressed ? deflateSync(Buffer.from(source, "latin1")) : Buffer.from(source, "latin1");
  const filter = compressed ? " /Filter /FlateDecode" : "";
  return `<< ${dictionary} /Length ${data.length}${filter} >>\nstream\n${data.toString("latin1")}\nendstream`;
}

/** A complete PDF file from object bodies, with a cross-reference table and a trailer. */
export function pdfFile(objects, { trailer = "", name = "synthetic-cv.pdf" } = {}) {
  let source = "%PDF-1.7\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(source.length);
    source += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = source.length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailer} >>\nstartxref\n${xref}\n%%EOF`;
  return new File([Buffer.from(source, "latin1")], name, { type: "application/pdf" });
}

/** A ToUnicode CMap for the given code → character pairs, with codes `bytes` long. */
export function toUnicode(codes, bytes) {
  const hex = (n, length) => n.toString(16).padStart(length, "0").toUpperCase();
  const limit = hex(bytes === 1 ? 0xff : 0xffff, bytes * 2);
  return [
    "/CIDInit /ProcSet findresource begin 12 dict begin begincmap",
    `1 begincodespacerange <${hex(0, bytes * 2)}> <${limit}> endcodespacerange`,
    `${codes.size} beginbfchar`,
    ...[...codes].map(([code, char]) => `<${hex(code, bytes * 2)}> <${hex(char.codePointAt(0), 4)}>`),
    "endbfchar endcmap CMapName currentdict /CMap defineresource pop end end",
  ].join("\n");
}
