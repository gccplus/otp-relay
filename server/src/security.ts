import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

export function newId(): string {
  return randomUUID();
}

export function newSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashSecret(secret: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(secret, salt, 32);
  return [
    "scrypt",
    "v1",
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export function fingerprintSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("base64url");
}

export function secretMatches(secret: string, expectedHash: string): boolean {
  const [algorithm, version, saltValue, digestValue] = expectedHash.split("$");
  if (
    algorithm !== "scrypt" ||
    version !== "v1" ||
    !saltValue ||
    !digestValue
  ) {
    return false;
  }
  const expected = Buffer.from(digestValue, "base64url");
  const actual = scryptSync(
    secret,
    Buffer.from(saltValue, "base64url"),
    expected.length,
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function parseBearer(
  authorization: string | string[] | undefined,
): string | undefined {
  if (typeof authorization !== "string") return undefined;
  const match = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(authorization);
  return match?.[1];
}
