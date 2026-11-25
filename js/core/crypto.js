// Criptografia do Painel (funciona no navegador e no Node 20+, sem dependências).
// Chave: PBKDF2-SHA256 a partir da chave de acesso + sal do config.json → AES-256-GCM.
// Arquivo cifrado: "PD1" + flag (1 = JSON comprimido com gzip, 0 = bytes) + IV (12 bytes) + texto cifrado.
const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();
const MAGIC = [0x50, 0x44, 0x31]; // "PD1"
export const KDF_ITERATIONS = 300000;

export function b64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof Buffer !== "undefined") return Buffer.from(u8).toString("base64");
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(str) {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(str, "base64"));
  const bin = atob(str.replace(/\s/g, ""));
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
export function randomBytes(n) { return globalThis.crypto.getRandomValues(new Uint8Array(n)); }
export function randomId(n = 16) {
  const a = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(n), (x) => a[x % a.length]).join("");
}

export async function deriveKey(passphrase, saltB64, iterations = KDF_ITERATIONS) {
  const base = await subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey({ name: "PBKDF2", salt: unb64(saltB64), iterations, hash: "SHA-256" }, base,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}
const gzip = (b) => pipe(b, new CompressionStream("gzip"));
const gunzip = (b) => pipe(b, new DecompressionStream("gzip"));

async function seal(key, plain, flag) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  const out = new Uint8Array(4 + 12 + ct.length);
  out.set(MAGIC, 0); out[3] = flag; out.set(iv, 4); out.set(ct, 16);
  return out;
}
async function open(key, data) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (u8[0] !== MAGIC[0] || u8[1] !== MAGIC[1] || u8[2] !== MAGIC[2]) throw new Error("Arquivo não reconhecido.");
  const plain = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: u8.subarray(4, 16) }, key, u8.subarray(16)));
  return { flag: u8[3], plain };
}

export async function encryptJSON(key, value) { return seal(key, await gzip(enc.encode(JSON.stringify(value))), 1); }
export async function encryptBytes(key, bytes) { return seal(key, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), 0); }
export async function decrypt(key, data) {
  const { flag, plain } = await open(key, data);
  return flag === 1 ? JSON.parse(dec.decode(await gunzip(plain))) : plain;
}
export async function encryptText(key, text) { return b64(await seal(key, enc.encode(text), 0)); }
export async function decryptText(key, b64text) { const { plain } = await open(key, unb64(b64text)); return dec.decode(plain); }

// Senhas das pessoas (PBKDF2 com sal próprio). Verificação feita no navegador.
export async function hashPassword(password, saltB64 = b64(randomBytes(16)), iterations = 100000) {
  const base = await subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle.deriveBits({ name: "PBKDF2", salt: unb64(saltB64), iterations, hash: "SHA-256" }, base, 256);
  return { s: saltB64, h: b64(new Uint8Array(bits)), i: iterations };
}
export async function verifyPassword(password, rec) {
  if (!rec) return false;
  const x = await hashPassword(password, rec.s, rec.i);
  return x.h === rec.h;
}
