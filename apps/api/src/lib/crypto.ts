import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32, saltBytes: 16 } as const;

/** Random id from [A-Za-z0-9], unbiased (rejection sampling over randomBytes). */
export function randomId(length = 10): string {
  const limit = 256 - (256 % ID_ALPHABET.length); // 248
  let out = "";
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      if (b < limit) out += ID_ALPHABET[b % ID_ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/** 32 random bytes, base64url, no padding. Used for claim-link secrets and claim tokens. */
export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Constant-time comparison of two hex digests. Unequal lengths are simply unequal. */
export function safeEqualHex(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, "hex");
  const b = Buffer.from(bHex, "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/** Constant-time string comparison: hash both sides first so buffers are equal length. */
export function safeEqualString(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

export function verifySecret(secret: string, storedSha256Hex: string): boolean {
  return safeEqualHex(sha256Hex(secret), storedSha256Hex);
}

/** 6 digits, zero-padded. */
export function generatePin(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function scryptKey(pin: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(pin, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/** Format: scrypt$<saltHex>$<hashHex> */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(SCRYPT.saltBytes);
  const key = await scryptKey(pin, salt);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const key = await scryptKey(pin, Buffer.from(saltHex, "hex"));
  const expected = Buffer.from(hashHex, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}
