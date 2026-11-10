"use strict";

const assert = require("node:assert/strict");
const {
  createCipheriv,
  createECDH,
  createHash,
  hkdfSync,
  randomBytes,
  randomUUID,
} = require("node:crypto");
const test = require("node:test");
const {
  OtpCryptoError,
  base64UrlDecode,
  base64UrlEncode,
  canonicalAad,
  createPrivateKey,
  decryptEnvelope,
  publicKeyFor,
} = require("../src/core/crypto");

test("decrypts an Android-compatible P-256 envelope", () => {
  const privateKey = createPrivateKey();
  const pairing = {
    pairingId: randomUUID(),
    protocolVersion: 1,
  };
  const payload = {
    code: "482917",
    source: "示例服务",
    purpose: "登录",
    receivedAt: "2026-07-27T10:30:00.000Z",
  };
  const envelope = encryptEnvelope(payload, pairing, publicKeyFor(privateKey));

  assert.deepEqual(decryptEnvelope(envelope, pairing, privateKey), payload);
});

test("rejects an envelope whose authenticated metadata was changed", () => {
  const privateKey = createPrivateKey();
  const pairing = { pairingId: randomUUID(), protocolVersion: 1 };
  const envelope = encryptEnvelope(
    {
      code: "123456",
      source: "示例",
      purpose: "登录",
      receivedAt: "2026-07-27T10:30:00.000Z",
    },
    pairing,
    publicKeyFor(privateKey),
  );

  assert.throws(
    () =>
      decryptEnvelope(
        { ...envelope, expiresAt: "2026-07-27T10:36:00.000Z" },
        pairing,
        privateKey,
      ),
    (error) =>
      error instanceof OtpCryptoError && error.code === "DECRYPTION_FAILED",
  );
});

function encryptEnvelope(payload, pairing, recipientPublicKey) {
  const ephemeral = createECDH("prime256v1");
  ephemeral.generateKeys();
  const messageId = randomUUID();
  const envelope = {
    messageId,
    pairingId: pairing.pairingId,
    protocolVersion: 1,
    receivedAt: payload.receivedAt,
    expiresAt: "2026-07-27T10:35:00.000Z",
    ephemeralPublicKey: base64UrlEncode(
      ephemeral.getPublicKey(undefined, "uncompressed"),
    ),
    nonce: "",
    ciphertext: "",
  };
  const secret = ephemeral.computeSecret(base64UrlDecode(recipientPublicKey));
  const salt = createHash("sha256").update(pairing.pairingId, "utf8").digest();
  const key = Buffer.from(
    hkdfSync(
      "sha256",
      secret,
      salt,
      Buffer.from(`otp-relay-message-v1:${messageId}`, "utf8"),
      32,
    ),
  );
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(canonicalAad(envelope));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  envelope.nonce = base64UrlEncode(nonce);
  envelope.ciphertext = base64UrlEncode(
    Buffer.concat([ciphertext, cipher.getAuthTag()]),
  );
  return envelope;
}
