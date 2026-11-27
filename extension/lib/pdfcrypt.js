/*
 * Opening encrypted PDFs that need no password to read.
 *
 * CV builders often protect their PDFs against editing: the file is
 * encrypted, but with an empty "user" password, so every reader opens it,
 * while an owner password guards editing. The PDF's standard security
 * handler (ISO 32000) derives the key from the empty password and the file's
 * ID; this module does that and decrypts streams. A PDF that does need a
 * password to open stays closed, and is reported as locked.
 *
 * Covered: RC4 (revisions 2 to 4), AES-128 (revision 4) and AES-256
 * (revisions 5 and 6). WebCrypto does SHA and AES; it has no MD5 or RC4,
 * which are written out here.
 */

// Every password is padded to 32 bytes with these (ISO 32000-1, 7.6.3.3).
const PASSWORD_PADDING = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a]);
const AES_SALT = [0x73, 0x41, 0x6c, 0x54];               // "sAlT", appended to AES-128 object keys
const LEGACY_KEY_ROUNDS = 50;                            // revision 3 and later re-hash the key 50 times
const USER_CHECK_ROUNDS = 19;                            // and encrypt the user check 19 more times
const HARDENED_MIN_ROUNDS = 64;                          // revision 6 hashes at least 64 rounds
const AES_BLOCK = 16;
const EMPTY = new Uint8Array(0);

/** The answer for a PDF that needs a password, or a security handler other than the standard one. */
export const LOCKED = Object.freeze({ locked: true });

/**
 * How to read an encrypted PDF's streams: null when the file is not
 * encrypted, LOCKED when it cannot be opened without a password, or
 * { decrypt(data, objectNumber) } returning the decrypted bytes.
 *
 * raw: the file as latin1 text. plainObject(n): object n's dictionary text,
 * for objects stored plainly in the file, as the encryption dictionary is.
 */
export async function pdfDecryption(raw, plainObject) {
  const ref = /\/Encrypt\s+(\d+)\s+0\s+R/.exec(raw);
  if (!ref) return null;
  const dict = plainObject(Number(ref[1]));
  if (!/\/Filter\s*\/Standard\b/.test(dict)) return LOCKED;

  const number = (name, fallback) => Number(new RegExp(`/${name}\\s+(-?\\d+)`).exec(dict)?.[1] ?? fallback);
  const version = number("V", 0);
  const revision = number("R", 2);
  const method = /\/CFM\s*\/(\w+)/.exec(dict)?.[1] || (version >= 4 ? "AESV2" : "V2");
  const owner = stringValue(dict, "O");
  const user = stringValue(dict, "U");
  if (!owner || !user) return LOCKED;

  let fileKey;
  if (revision >= 5) {
    fileKey = await aes256FileKey(revision, user, stringValue(dict, "UE"));
  } else {
    const id = idOf(raw);
    // The key length is in bits at the top level; a crypt filter's /Length is in bytes.
    const bits = [...dict.matchAll(/\/Length\s+(\d+)/g)].map((m) => Number(m[1])).find((n) => n >= 40) ?? 40;
    const keyBytes = revision === 2 ? 5 : version >= 4 ? 16 : Math.min(16, bits / 8);
    fileKey = legacyFileKey({
      owner, id, revision, keyBytes,
      permissions: number("P", 0),
      encryptMetadata: !/\/EncryptMetadata\s+false/.test(dict),
    });
    if (!opensWithoutPassword(fileKey, user, id, revision)) fileKey = null;
  }
  if (!fileKey) return LOCKED;

  const plainStreams = /\/StmF\s*\/Identity\b/.test(dict);
  return {
    locked: false,
    async decrypt(data, objectNumber) {
      if (plainStreams) return data;
      if (method === "AESV3") return aesDecrypt(fileKey, data.subarray(0, AES_BLOCK), data.subarray(AES_BLOCK));
      const aes = method === "AESV2";
      const key = objectKey(fileKey, objectNumber, aes);
      return aes ? aesDecrypt(key, data.subarray(0, AES_BLOCK), data.subarray(AES_BLOCK)) : rc4(key, data);
    },
  };
}

/* ── Revisions 2 to 4: MD5 and RC4 ─────────────────────────── */

function legacyFileKey({ owner, id, revision, keyBytes, permissions, encryptMetadata }) {
  const unencryptedMetadata = revision >= 4 && !encryptMetadata ? [0xff, 0xff, 0xff, 0xff] : [];
  let hash = md5(concat(PASSWORD_PADDING, owner.subarray(0, 32), int32le(permissions), id, unencryptedMetadata));
  if (revision >= 3) for (let i = 0; i < LEGACY_KEY_ROUNDS; i++) hash = md5(hash.subarray(0, keyBytes));
  return hash.subarray(0, keyBytes);
}

/** Whether the empty user password opens the file: the /U check of algorithms 4 and 5. */
function opensWithoutPassword(fileKey, user, id, revision) {
  if (revision === 2) return equal(rc4(fileKey, PASSWORD_PADDING), user.subarray(0, 32));
  let check = rc4(fileKey, md5(concat(PASSWORD_PADDING, id)));
  for (let i = 1; i <= USER_CHECK_ROUNDS; i++) check = rc4(fileKey.map((byte) => byte ^ i), check);
  return equal(check, user.subarray(0, 16));
}

function objectKey(fileKey, objectNumber, aes) {
  const numberBytes = [objectNumber & 0xff, (objectNumber >> 8) & 0xff, (objectNumber >> 16) & 0xff, 0, 0];
  return md5(concat(fileKey, numberBytes, aes ? AES_SALT : [])).subarray(0, Math.min(fileKey.length + 5, 16));
}

/* ── Revisions 5 and 6: SHA-2 and AES-256 ──────────────────── */

async function aes256FileKey(revision, user, userKey) {
  if (!userKey || user.length < 48) return null;
  const hash = (salt) => (revision === 5 ? sha("SHA-256", salt) : hardenedHash(EMPTY, salt));
  if (!equal(await hash(user.subarray(32, 40)), user.subarray(0, 32))) return null;   // needs a password
  const intermediate = await hash(user.subarray(40, 48));
  return aesDecryptBlocks(intermediate, new Uint8Array(AES_BLOCK), userKey.subarray(0, 32));
}

/** Algorithm 2.B of ISO 32000-2, for the user password (no owner key mixed in). */
async function hardenedHash(password, salt) {
  let k = await sha("SHA-256", concat(password, salt));
  let e = EMPTY;
  for (let round = 0; round < HARDENED_MIN_ROUNDS || e[e.length - 1] > round - 32; round++) {
    const block = concat(password, k);
    const repeated = new Uint8Array(block.length * 64);
    for (let i = 0; i < 64; i++) repeated.set(block, i * block.length);
    e = await aesEncryptBlocks(k.subarray(0, 16), k.subarray(16, 32), repeated);
    const remainder = e.subarray(0, 16).reduce((sum, byte) => sum + byte, 0) % 3;
    k = await sha(["SHA-256", "SHA-384", "SHA-512"][remainder], e);
  }
  return k.subarray(0, 32);
}

/* ── Strings in the encryption dictionary ──────────────────── */

/** The bytes of the string value of /name in a dictionary, literal or hex; null if absent. */
function stringValue(text, name) {
  const match = new RegExp(`/${name}(?![A-Za-z0-9])\\s*(?=[(<](?!<))`).exec(text);
  return match ? stringAt(text, match.index + match[0].length) : null;
}

/** The first string of the file identifier, /ID [<…> <…>], from the trailer. */
function idOf(raw) {
  const match = /\/ID\s*\[\s*(?=[(<])/.exec(raw);
  return match ? stringAt(raw, match.index + match[0].length) : EMPTY;
}

const ESCAPES = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };

/** The bytes of the PDF string starting at text[at]: "(literal)" or "<hex>". */
export function stringAt(text, at) {
  if (text[at] === "<") {
    const digits = text.slice(at + 1, text.indexOf(">", at)).replace(/\s+/g, "");
    const out = new Uint8Array(Math.ceil(digits.length / 2));
    for (let i = 0; i < out.length; i++) out[i] = parseInt(digits.slice(2 * i, 2 * i + 2).padEnd(2, "0"), 16);
    return out;
  }
  const out = [];
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    const char = text[i];
    if (char === "\\") {
      const next = text[++i];
      if (next in ESCAPES) out.push(ESCAPES[next]);
      else if (/[0-7]/.test(next)) {
        let octal = next;
        while (octal.length < 3 && /[0-7]/.test(text[i + 1])) octal += text[++i];
        out.push(parseInt(octal, 8) & 0xff);
      } else if (next === "\r") {
        if (text[i + 1] === "\n") i++;                 // a backslash before a line break joins lines
      } else if (next !== "\n") {
        out.push(next.charCodeAt(0));
      }
      continue;
    }
    if (char === "(" && depth++ === 0) continue;       // the opening parenthesis
    if (char === ")" && --depth === 0) break;          // the closing one
    if (char === "\r") {                               // a line break in a string reads as LF
      out.push(10);
      if (text[i + 1] === "\n") i++;
      continue;
    }
    out.push(char.charCodeAt(0));
  }
  return Uint8Array.from(out);
}

/* ── Building blocks ───────────────────────────────────────── */

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

const equal = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);

function int32le(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setInt32(0, value, true);
  return out;
}

export function rc4(key, data) {
  const s = Uint8Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = new Uint8Array(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
    out[n] = data[n] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

// MD5 (RFC 1321): the per-round shifts, and the sine-derived constants.
const MD5_SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const MD5_CONSTANTS = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export function md5(bytes) {
  // Pad with 0x80, zeros, and the length in bits, to a multiple of 64 bytes.
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = bytes.length * 8;
  view.setUint32(padded.length - 8, bits >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bits / 2 ** 32), true);

  const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = Array.from({ length: 16 }, (_, i) => view.getUint32(offset + 4 * i, true));
    let [a, b, c, d] = state;
    for (let i = 0; i < 64; i++) {
      const round = i >> 4;
      const f = round === 0 ? (b & c) | (~b & d) : round === 1 ? (d & b) | (~d & c)
        : round === 2 ? b ^ c ^ d : c ^ (b | ~d);
      const g = round === 0 ? i : round === 1 ? (5 * i + 1) % 16 : round === 2 ? (3 * i + 5) % 16 : (7 * i) % 16;
      const shift = MD5_SHIFTS[round * 4 + (i % 4)];
      const sum = (a + f + MD5_CONSTANTS[i] + words[g]) >>> 0;
      [a, d, c] = [d, c, b];
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
  }
  const out = new Uint8Array(16);
  state.forEach((word, i) => new DataView(out.buffer).setUint32(4 * i, word, true));
  return out;
}

const subtle = () => globalThis.crypto.subtle;
const sha = async (algorithm, data) => new Uint8Array(await subtle().digest(algorithm, data));
const aesKey = (key, usage) => subtle().importKey("raw", key, "AES-CBC", false, [usage]);

/** AES-CBC with the PKCS#7 padding PDF streams carry. */
async function aesDecrypt(key, iv, data) {
  return new Uint8Array(await subtle().decrypt({ name: "AES-CBC", iv }, await aesKey(key, "decrypt"), data));
}

/** AES-CBC over whole blocks, without padding: WebCrypto's padding block is dropped. */
async function aesEncryptBlocks(key, iv, data) {
  const out = new Uint8Array(await subtle().encrypt({ name: "AES-CBC", iv }, await aesKey(key, "encrypt"), data));
  return out.subarray(0, data.length);
}

/**
 * AES-CBC decryption of whole blocks, without padding. WebCrypto insists on
 * padding, so one more block is added that decrypts to a full padding block.
 */
async function aesDecryptBlocks(key, iv, data) {
  const last = data.subarray(data.length - AES_BLOCK);
  const padding = await aesEncryptBlocks(key, last, new Uint8Array(AES_BLOCK).fill(AES_BLOCK));
  return aesDecrypt(key, iv, concat(data, padding));
}
