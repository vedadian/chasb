import crypto from "node:crypto";
import { randomBytes } from "./random.js";

// ============================================================
// HASHING
// ============================================================

export const hash = (
  data: string | Buffer,
  algorithm: string = "sha256",
): string => crypto.createHash(algorithm).update(data).digest("hex");

export const hashBuffer = (
  data: string | Buffer,
  algorithm: string = "sha256",
): Buffer => crypto.createHash(algorithm).update(data).digest();

// ============================================================
// HMAC
// ============================================================

export const hmac = (
  data: string | Buffer,
  secret: string | Buffer,
  algorithm: string = "sha256",
): string => crypto.createHmac(algorithm, secret).update(data).digest("hex");

export const timingSafeEqual = (a: Buffer, b: Buffer): boolean => {
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
};

// ============================================================
// PASSWORD HASHING
// ============================================================

const scrypt = (password: string, salt: Buffer, length: number) =>
  new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, length, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });

export const hashPassword = async (
  password: string,
  salt: Buffer = randomBytes(16),
): Promise<{ salt: string; hash: string }> => {
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;

  return {
    salt: salt.toString("hex"),
    hash: derivedKey.toString("hex"),
  };
};

export const verifyPassword = async (
  password: string,
  salt: string,
  expectedHash: string,
): Promise<boolean> => {
  const derivedKey = (await scrypt(
    password,
    Buffer.from(salt, "hex"),
    64,
  )) as Buffer;

  const expected = Buffer.from(expectedHash, "hex");

  return (
    derivedKey.length === expected.length &&
    crypto.timingSafeEqual(derivedKey, expected)
  );
};

// ============================================================
// KEY DERIVATION
// ============================================================

export const deriveKey = (
  password: string,
  salt: Buffer,
  length = 32,
): Buffer => crypto.scryptSync(password, salt, length);

export const deriveKeyAsync = async (
  password: string,
  salt: Buffer,
  length = 32,
): Promise<Buffer> => (await scrypt(password, salt, length)) as Buffer;

// ============================================================
// ENCRYPTION / DECRYPTION
// ============================================================

const ENCRYPTION_ALGORITHM = "aes-256-gcm";

export interface EncryptedData {
  iv: string;
  data: string;
  authTag: string;
}

export const encrypt = (data: string | Buffer, key: Buffer): EncryptedData => {
  if (key.length !== 32) {
    throw new Error("Encryption key must be 32 bytes");
  }

  const iv = randomBytes(12);

  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);

  return {
    iv: iv.toString("hex"),
    data: encrypted.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
  };
};

export const decrypt = (encrypted: EncryptedData, key: Buffer): Buffer => {
  if (key.length !== 32) {
    throw new Error("Encryption key must be 32 bytes");
  }

  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGORITHM,
    key,
    Buffer.from(encrypted.iv, "hex"),
  );

  decipher.setAuthTag(Buffer.from(encrypted.authTag, "hex"));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.data, "hex")),
    decipher.final(),
  ]);
};

// ============================================================
// DIGITAL SIGNATURES
// ============================================================

export const sign = (
  data: string | Buffer,
  privateKey: crypto.KeyLike,
): string =>
  crypto.sign("sha256", Buffer.from(data), privateKey).toString("base64");

export const verify = (
  data: string | Buffer,
  signature: string,
  publicKey: crypto.KeyLike,
): boolean =>
  crypto.verify(
    "sha256",
    Buffer.from(data),
    publicKey,
    Buffer.from(signature, "base64"),
  );
