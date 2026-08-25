import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

/**
 * Нууц үгийг scrypt-ээр хэшлэнэ. Гадны сан шаардахгүй — Node-ийн built-in.
 * Үр дүнгийн формат: `scrypt$<давс>$<хэш>`
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(
    password.normalize("NFKC"),
    salt,
    KEY_LENGTH,
  )) as Buffer;
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/** Нууц үг тохирч байгаа эсэх. Цагийн халдлагаас хамгаалсан харьцуулалт. */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, "hex");
  const derived = (await scryptAsync(
    password.normalize("NFKC"),
    Buffer.from(saltHex, "hex"),
    expected.length,
  )) as Buffer;

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
