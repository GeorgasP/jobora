// Builds small synthetic PDFs for the CV reader's tests: no private CVs and no
// downloaded libraries. Objects are numbered from 1 in the order given.
import { createCipheriv, createHash, randomBytes } from "node:crypto";
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

/* ── Encryption, written with Node's crypto, independently of the reader's ── */

const PASSWORD_PADDING = Buffer.from("28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A", "hex");
const PERMISSIONS = -1044;                       // print and copy allowed, as CV builders leave them
const md5 = (...parts) => createHash("md5").update(Buffer.concat(parts.map((part) => Buffer.from(part)))).digest();
const hex = (bytes) => Buffer.from(bytes).toString("hex").toUpperCase();
const padded = (password) => Buffer.concat([Buffer.from(password, "latin1"), PASSWORD_PADDING]).subarray(0, 32);

/** RC4, which OpenSSL 3 leaves out of Node's default build; tested against a published vector. */
export function rc4(key, data) {
  const s = [...Array(256).keys()];
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) % 256;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) % 256;
    j = (j + s[i]) % 256;
    [s[i], s[j]] = [s[j], s[i]];
    out[n] = data[n] ^ s[(s[i] + s[j]) % 256];
  }
  return out;
}

/** A PDF literal string holding binary bytes, escaped as PDF writers do. */
const literal = (bytes) => `(${[...bytes].map((byte) => {
  const char = String.fromCharCode(byte);
  if ("\\()".includes(char)) return `\\${char}`;
  return byte === 13 ? "\\r" : byte === 10 ? "\\n" : char;
}).join("")})`;

/** ISO 32000-2 algorithm 2.B for the user password (revision 6). */
function hardenedHash(password, salt) {
  let k = createHash("sha256").update(Buffer.concat([password, salt])).digest();
  let e = Buffer.alloc(0);
  for (let round = 0; round < 64 || e[e.length - 1] > round - 32; round++) {
    const repeated = Buffer.concat(Array(64).fill(Buffer.concat([password, k])));
    const cipher = createCipheriv("aes-128-cbc", k.subarray(0, 16), k.subarray(16, 32)).setAutoPadding(false);
    e = Buffer.concat([cipher.update(repeated), cipher.final()]);
    const remainder = [...e.subarray(0, 16)].reduce((sum, byte) => sum + byte, 0) % 3;
    k = createHash(["sha256", "sha384", "sha512"][remainder]).update(e).digest();
  }
  return k.subarray(0, 32);
}

/** The encryption dictionary and a stream encrypter, for RC4 (revision 3), AESV2 (4) or AESV3 (6). */
function securityHandler(method, userPassword, id) {
  if (method === "AESV3") {
    const fileKey = randomBytes(32);
    const password = Buffer.from(userPassword, "utf8");
    const validationSalt = randomBytes(8);
    const keySalt = randomBytes(8);
    const user = Buffer.concat([hardenedHash(password, validationSalt), validationSalt, keySalt]);
    const wrap = createCipheriv("aes-256-cbc", hardenedHash(password, keySalt), Buffer.alloc(16)).setAutoPadding(false);
    const userKey = Buffer.concat([wrap.update(fileKey), wrap.final()]);
    return {
      dictionary: `<< /Filter /Standard /V 5 /R 6 /Length 256 /CF << /StdCF << /AuthEvent /DocOpen /CFM /AESV3 /Length 32 >> >> `
        + `/StmF /StdCF /StrF /StdCF /O <${hex(randomBytes(48))}> /U <${hex(user)}> /OE <${hex(randomBytes(32))}> `
        + `/UE <${hex(userKey)}> /P ${PERMISSIONS} /Perms <${hex(randomBytes(16))}> >>`,
      encrypt: (data) => {
        const iv = randomBytes(16);
        const cipher = createCipheriv("aes-256-cbc", fileKey, iv);
        return Buffer.concat([iv, cipher.update(data), cipher.final()]);
      },
    };
  }
  const aes = method === "AESV2";
  const owner = randomBytes(32);
  const permissions = Buffer.alloc(4);
  permissions.writeInt32LE(PERMISSIONS);
  let hash = md5(padded(userPassword), owner, permissions, id);
  for (let i = 0; i < 50; i++) hash = md5(hash.subarray(0, 16));
  const fileKey = hash.subarray(0, 16);
  let check = rc4(fileKey, md5(PASSWORD_PADDING, id));
  for (let i = 1; i <= 19; i++) check = rc4(fileKey.map((byte) => byte ^ i), check);
  const filter = aes ? "/CF << /StdCF << /AuthEvent /DocOpen /CFM /AESV2 /Length 16 >> >> /StmF /StdCF /StrF /StdCF " : "";
  return {
    // Literal strings with raw binary, as many writers store /O and /U.
    dictionary: `<< /Filter /Standard /V ${aes ? 4 : 2} /R ${aes ? 4 : 3} /Length 128 ${filter}`
      + `/O ${literal(owner)} /U ${literal(Buffer.concat([check, randomBytes(16)]))} /P ${PERMISSIONS} >>`,
    encrypt: (data, objectNumber) => {
      const numberBytes = [objectNumber & 255, (objectNumber >> 8) & 255, (objectNumber >> 16) & 255, 0, 0];
      const key = md5(fileKey, numberBytes, aes ? Buffer.from("sAlT") : []).subarray(0, 16);
      if (!aes) return rc4(key, data);
      const iv = randomBytes(16);
      const cipher = createCipheriv("aes-128-cbc", key, iv);
      return Buffer.concat([iv, cipher.update(data), cipher.final()]);
    },
  };
}

/**
 * The PDF encrypted as CV builders do it: with an empty user password, so
 * it opens without one, unless userPassword is given. Stream objects are
 * given as { stream, dictionary } and are compressed, then encrypted.
 */
export function encryptedPdfFile(objects, method, { userPassword = "" } = {}) {
  const id = randomBytes(16);
  const handler = securityHandler(method, userPassword, id);
  const bodies = objects.map((object, i) => {
    if (typeof object === "string") return object;
    const data = handler.encrypt(deflateSync(Buffer.from(object.stream, "latin1")), i + 1);
    return `<< ${object.dictionary || ""} /Length ${data.length} /Filter /FlateDecode >>\nstream\n${data.toString("latin1")}\nendstream`;
  });
  bodies.push(handler.dictionary);
  return pdfFile(bodies, { trailer: `/Encrypt ${bodies.length} 0 R /ID [<${hex(id)}> <${hex(id)}>]` });
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
