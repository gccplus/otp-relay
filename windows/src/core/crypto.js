"use strict";

const {
  createDecipheriv,
  createECDH,
  createHash,
  hkdfSync,
} = require("node:crypto");

const PROTOCOL_VERSION = 1;

class OtpCryptoError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "OtpCryptoError";
    this.code = code;
  }
}

function createPrivateKey() {
  const key = createECDH("prime256v1");
  key.generateKeys();
  return base64UrlEncode(key.getPrivateKey());
}

function publicKeyFor(privateKey) {
  const key = keyAgreement(privateKey);
  return base64UrlEncode(key.getPublicKey(undefined, "uncompressed"));
}

function decryptEnvelope(envelope, pairing, privateKey) {
  validateEnvelopeIdentity(envelope, pairing);

  let ephemeralPublicKey;
  let nonce;
  let encrypted;
  try {
    ephemeralPublicKey = base64UrlDecode(envelope.ephemeralPublicKey);
    nonce = base64UrlDecode(envelope.nonce);
    encrypted = base64UrlDecode(envelope.ciphertext);
  } catch {
    throw new OtpCryptoError("INVALID_ENVELOPE");
  }

  if (
    ephemeralPublicKey.length !== 65 ||
    ephemeralPublicKey[0] !== 4 ||
    nonce.length !== 12 ||
    encrypted.length < 16
  ) {
    throw new OtpCryptoError("INVALID_ENVELOPE");
  }

  let sharedSecret;
  try {
    sharedSecret = keyAgreement(privateKey).computeSecret(ephemeralPublicKey);
  } catch {
    throw new OtpCryptoError("INVALID_ENVELOPE");
  }

  const salt = createHash("sha256").update(pairing.pairingId, "utf8").digest();
  const info = Buffer.from(`otp-relay-message-v1:${envelope.messageId}`, "utf8");
  const key = Buffer.from(
    hkdfSync("sha256", sharedSecret, salt, info, 32),
  );
  const ciphertext = encrypted.subarray(0, encrypted.length - 16);
  const tag = encrypted.subarray(encrypted.length - 16);

  let plaintext;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(canonicalAad(envelope));
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
  } catch {
    throw new OtpCryptoError("DECRYPTION_FAILED");
  }

  let payload;
  try {
    payload = JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new OtpCryptoError("INVALID_PAYLOAD");
  }
  if (
    !payload ||
    typeof payload.code !== "string" ||
    typeof payload.source !== "string" ||
    typeof payload.purpose !== "string" ||
    typeof payload.receivedAt !== "string"
  ) {
    throw new OtpCryptoError("INVALID_PAYLOAD");
  }
  return payload;
}

function validateEnvelopeIdentity(envelope, pairing) {
  if (!envelope || envelope.protocolVersion !== PROTOCOL_VERSION) {
    throw new OtpCryptoError("PROTOCOL_UNSUPPORTED");
  }
  if (!pairing || envelope.pairingId !== pairing.pairingId) {
    throw new OtpCryptoError("PAIRING_MISMATCH");
  }
  const requiredStrings = [
    "messageId",
    "pairingId",
    "receivedAt",
    "expiresAt",
    "ephemeralPublicKey",
    "nonce",
    "ciphertext",
  ];
  if (requiredStrings.some((key) => typeof envelope[key] !== "string")) {
    throw new OtpCryptoError("INVALID_ENVELOPE");
  }
}

function canonicalAad(envelope) {
  return Buffer.from(
    `${envelope.protocolVersion}\n${envelope.messageId}\n${envelope.pairingId}\n${envelope.expiresAt}`,
    "utf8",
  );
}

function keyAgreement(privateKey) {
  const raw = base64UrlDecode(privateKey);
  if (raw.length !== 32) throw new OtpCryptoError("INVALID_ENVELOPE");
  const key = createECDH("prime256v1");
  key.setPrivateKey(raw);
  return key;
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new TypeError("Invalid Base64URL value");
  }
  return Buffer.from(value, "base64url");
}

module.exports = {
  OtpCryptoError,
  PROTOCOL_VERSION,
  base64UrlDecode,
  base64UrlEncode,
  canonicalAad,
  createPrivateKey,
  decryptEnvelope,
  publicKeyFor,
};
