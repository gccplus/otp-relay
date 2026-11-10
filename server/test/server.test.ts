import assert from "node:assert/strict";
import {
  createCipheriv,
  createDecipheriv,
  createECDH,
  createHash,
  hkdfSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const b64 = (length: number) => randomBytes(length).toString("base64url");

interface PairingResult {
  pairingId: string;
  androidCredential: string;
  macCredential: string;
}

async function createPairing(
  app: FastifyInstance,
  macPublicKey = b64(65),
  devices: {
    macDeviceId?: string;
    macDeviceName?: string;
    androidDeviceId?: string;
    androidDeviceName?: string;
  } = {},
): Promise<PairingResult> {
  const macDeviceId = devices.macDeviceId ?? "mac-device-0001";
  const macDeviceName = devices.macDeviceName ?? "Test Mac";
  const androidDeviceId = devices.androidDeviceId ?? "android-device-0001";
  const androidDeviceName = devices.androidDeviceName ?? "Samsung Test";
  const created = await app.inject({
    method: "POST",
    url: "/v1/pairing-sessions",
    payload: {
      macDeviceId,
      macDeviceName,
      macPublicKey,
      protocolVersion: 1,
    },
  });
  assert.equal(created.statusCode, 201);
  const session = created.json();

  const claimed = await app.inject({
    method: "POST",
    url: `/v1/pairing-sessions/${session.pairingSessionId}/claim`,
    payload: {
      claimSecret: session.claimSecret,
      androidDeviceId,
      androidDeviceName,
      protocolVersion: 1,
    },
  });
  assert.equal(claimed.statusCode, 200);
  const androidSessionToken = claimed.json().androidSessionToken;

  const approved = await app.inject({
    method: "POST",
    url: `/v1/pairing-sessions/${session.pairingSessionId}/decision`,
    headers: { authorization: `Bearer ${session.macSessionToken}` },
    payload: { decision: "approve" },
  });
  assert.equal(approved.statusCode, 200);

  const macResult = await app.inject({
    method: "GET",
    url: `/v1/pairing-sessions/${session.pairingSessionId}`,
    headers: { authorization: `Bearer ${session.macSessionToken}` },
  });
  const androidResult = await app.inject({
    method: "GET",
    url: `/v1/pairing-sessions/${session.pairingSessionId}`,
    headers: { authorization: `Bearer ${androidSessionToken}` },
  });
  assert.equal(macResult.json().status, "paired");
  assert.equal(androidResult.json().status, "paired");
  assert.equal(androidResult.json().macDeviceId, macDeviceId);
  assert.equal(androidResult.json().macDeviceName, macDeviceName);
  return {
    pairingId: macResult.json().pairingId,
    macCredential: macResult.json().deviceCredential,
    androidCredential: androidResult.json().deviceCredential,
  };
}

test("one Android device can deliver independently to multiple computers", async (t) => {
  const fixedNow = new Date("2026-07-27T10:30:00.000Z");
  const app = await buildApp({
    config: loadConfig({
      now: () => new Date(fixedNow),
      logLevel: "silent",
    }),
  });
  t.after(() => app.close());

  const androidDeviceId = "android-multi-device";
  const first = await createPairing(app, b64(65), {
    androidDeviceId,
    macDeviceId: "mac-multi-device-1",
    macDeviceName: "Office Mac",
  });
  const duplicateComputer = await app.inject({
    method: "POST",
    url: "/v1/pairing-sessions",
    payload: {
      macDeviceId: "mac-multi-device-1",
      macDeviceName: "Office Mac",
      macPublicKey: b64(65),
      protocolVersion: 1,
    },
  });
  assert.equal(duplicateComputer.statusCode, 409);
  assert.equal(duplicateComputer.json().error.code, "PAIRING_CONFLICT");

  const second = await createPairing(app, b64(65), {
    androidDeviceId,
    macDeviceId: "windows-multi-device-2",
    macDeviceName: "Home Windows",
  });

  for (const pairing of [first, second]) {
    const upload = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: { authorization: `Bearer ${pairing.androidCredential}` },
      payload: {
        messageId: randomUUID(),
        pairingId: pairing.pairingId,
        protocolVersion: 1,
        receivedAt: fixedNow.toISOString(),
        expiresAt: new Date(fixedNow.getTime() + 300_000).toISOString(),
        ephemeralPublicKey: b64(65),
        nonce: b64(12),
        ciphertext: b64(80),
      },
    });
    assert.equal(upload.statusCode, 201);
  }

  const revoked = await app.inject({
    method: "DELETE",
    url: "/v1/pairing",
    headers: { authorization: `Bearer ${first.androidCredential}` },
  });
  assert.equal(revoked.statusCode, 200);

  const secondStillActive = await app.inject({
    method: "POST",
    url: "/v1/messages",
    headers: { authorization: `Bearer ${second.androidCredential}` },
    payload: {
      messageId: randomUUID(),
      pairingId: second.pairingId,
      protocolVersion: 1,
      receivedAt: fixedNow.toISOString(),
      expiresAt: new Date(fixedNow.getTime() + 300_000).toISOString(),
      ephemeralPublicKey: b64(65),
      nonce: b64(12),
      ciphertext: b64(80),
    },
  });
  assert.equal(secondStillActive.statusCode, 201);
});

test("pairing, encrypted envelope delivery, ACK and revoke", async (t) => {
  const fixedNow = new Date("2026-07-27T10:30:00.000Z");
  const app = await buildApp({
    config: loadConfig({
      now: () => new Date(fixedNow),
      logLevel: "silent",
    }),
  });
  t.after(() => app.close());

  const pairing = await createPairing(app);
  const messageId = randomUUID();
  const envelope = {
    messageId,
    pairingId: pairing.pairingId,
    protocolVersion: 1,
    receivedAt: fixedNow.toISOString(),
    expiresAt: new Date(fixedNow.getTime() + 300_000).toISOString(),
    ephemeralPublicKey: b64(65),
    nonce: b64(12),
    ciphertext: b64(80),
  };

  const uploaded = await app.inject({
    method: "POST",
    url: "/v1/messages",
    headers: { authorization: `Bearer ${pairing.androidCredential}` },
    payload: envelope,
  });
  assert.equal(uploaded.statusCode, 201);
  assert.equal(uploaded.json().status, "received");

  const duplicate = await app.inject({
    method: "POST",
    url: "/v1/messages",
    headers: { authorization: `Bearer ${pairing.androidCredential}` },
    payload: envelope,
  });
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.json().status, "duplicate");

  const acked = await app.inject({
    method: "POST",
    url: `/v1/messages/${messageId}/ack`,
    headers: { authorization: `Bearer ${pairing.macCredential}` },
    payload: { status: "displayed" },
  });
  assert.equal(acked.statusCode, 200);
  assert.equal(acked.json().status, "displayed");

  const repeatedAck = await app.inject({
    method: "POST",
    url: `/v1/messages/${messageId}/ack`,
    headers: { authorization: `Bearer ${pairing.macCredential}` },
    payload: { status: "displayed" },
  });
  assert.equal(repeatedAck.statusCode, 200);

  const revoked = await app.inject({
    method: "DELETE",
    url: "/v1/pairing",
    headers: { authorization: `Bearer ${pairing.macCredential}` },
  });
  assert.equal(revoked.statusCode, 200);

  const rejectedAfterRevoke = await app.inject({
    method: "POST",
    url: "/v1/messages",
    headers: { authorization: `Bearer ${pairing.androidCredential}` },
    payload: { ...envelope, messageId: randomUUID() },
  });
  assert.equal(rejectedAfterRevoke.statusCode, 401);
  assert.equal(rejectedAfterRevoke.json().error.code, "PAIRING_REVOKED");

  const repeatedRevoke = await app.inject({
    method: "DELETE",
    url: "/v1/pairing",
    headers: { authorization: `Bearer ${pairing.androidCredential}` },
  });
  assert.equal(repeatedRevoke.statusCode, 200);
  assert.equal(repeatedRevoke.json().status, "revoked");

  const unknownCredential = await app.inject({
    method: "POST",
    url: "/v1/messages",
    headers: { authorization: `Bearer ${b64(32)}` },
    payload: { ...envelope, messageId: randomUUID() },
  });
  assert.equal(unknownCredential.statusCode, 401);
  assert.equal(unknownCredential.json().error.code, "UNAUTHORIZED");
});

test("invalid claim and expired message are rejected", async (t) => {
  const fixedNow = new Date("2026-07-27T10:30:00.000Z");
  const app = await buildApp({
    config: loadConfig({
      now: () => new Date(fixedNow),
      logLevel: "silent",
    }),
  });
  t.after(() => app.close());

  const created = await app.inject({
    method: "POST",
    url: "/v1/pairing-sessions",
    payload: {
      macDeviceId: "mac-device-invalid",
      macDeviceName: "Test Mac",
      macPublicKey: b64(65),
      protocolVersion: 1,
    },
  });
  const session = created.json();
  const badClaim = await app.inject({
    method: "POST",
    url: `/v1/pairing-sessions/${session.pairingSessionId}/claim`,
    payload: {
      claimSecret: b64(32),
      androidDeviceId: "android-invalid",
      androidDeviceName: "Samsung Test",
      protocolVersion: 1,
    },
  });
  assert.equal(badClaim.statusCode, 403);

  const pairing = await createPairing(app);
  const expired = await app.inject({
    method: "POST",
    url: "/v1/messages",
    headers: { authorization: `Bearer ${pairing.androidCredential}` },
    payload: {
      messageId: randomUUID(),
      pairingId: pairing.pairingId,
      protocolVersion: 1,
      receivedAt: new Date(fixedNow.getTime() - 301_000).toISOString(),
      expiresAt: new Date(fixedNow.getTime() - 1_000).toISOString(),
      ephemeralPublicKey: b64(65),
      nonce: b64(12),
      ciphertext: b64(80),
    },
  });
  assert.equal(expired.statusCode, 410);
});

test("empty JSON body is reported as a client error", async (t) => {
  const app = await buildApp({
    config: loadConfig({ logLevel: "silent" }),
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/pairing-sessions",
    headers: { "content-type": "application/json" },
    payload: "",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "INVALID_REQUEST");
});

test(
  "Mac stream receives pending and real-time envelopes",
  { skip: process.env.OTP_SOCKET_TEST !== "1" },
  async (t) => {
  const fixedNow = new Date("2026-07-27T10:30:00.000Z");
  const app = await buildApp({
    config: loadConfig({
      now: () => new Date(fixedNow),
      logLevel: "silent",
    }),
  });
  t.after(() => app.close());
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert(address && typeof address === "object");

  const macKey = createECDH("prime256v1");
  const macPublicKey = macKey.generateKeys();
  const pairing = await createPairing(
    app,
    macPublicKey.toString("base64url"),
  );
  const received = new Promise<Record<string, unknown>>((resolve, reject) => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${address.port}/v1/mac/stream`,
      { headers: { authorization: `Bearer ${pairing.macCredential}` } },
    );
    t.after(() => socket.close());
    socket.once("error", reject);
    socket.once("message", (data) => {
      resolve(JSON.parse(data.toString()));
    });
    socket.once("open", async () => {
      const envelope = encryptEnvelope({
        pairingId: pairing.pairingId,
        macPublicKey,
        receivedAt: fixedNow,
        payload: {
          code: "482917",
          source: "示例服务",
          purpose: "登录",
          receivedAt: fixedNow.toISOString(),
        },
      });
      const upload = await app.inject({
        method: "POST",
        url: "/v1/messages",
        headers: { authorization: `Bearer ${pairing.androidCredential}` },
        payload: envelope,
      });
      assert.equal(upload.statusCode, 201);
    });
  });

  const event = await received;
  assert.equal(event.event, "message.available");
  assert.equal(
    (event.data as Record<string, unknown>).pairingId,
    pairing.pairingId,
  );
  const payload = decryptEnvelope(
    event.data as ReturnType<typeof encryptEnvelope>,
    macKey,
  );
  assert.deepEqual(payload, {
    code: "482917",
    source: "示例服务",
    purpose: "登录",
    receivedAt: fixedNow.toISOString(),
  });
  },
);

function encryptEnvelope({
  pairingId,
  macPublicKey,
  receivedAt,
  payload,
}: {
  pairingId: string;
  macPublicKey: Buffer;
  receivedAt: Date;
  payload: Record<string, string>;
}) {
  const messageId = randomUUID();
  const expiresAt = new Date(receivedAt.getTime() + 300_000).toISOString();
  const ephemeral = createECDH("prime256v1");
  const ephemeralPublicKey = ephemeral.generateKeys();
  const sharedSecret = ephemeral.computeSecret(macPublicKey);
  const salt = createHash("sha256").update(pairingId, "utf8").digest();
  const info = Buffer.from(`otp-relay-message-v1:${messageId}`, "utf8");
  const key = Buffer.from(hkdfSync("sha256", sharedSecret, salt, info, 32));
  const nonce = randomBytes(12);
  const aad = Buffer.from(`1\n${messageId}\n${pairingId}\n${expiresAt}`);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    messageId,
    pairingId,
    protocolVersion: 1 as const,
    receivedAt: receivedAt.toISOString(),
    expiresAt,
    ephemeralPublicKey: ephemeralPublicKey.toString("base64url"),
    nonce: nonce.toString("base64url"),
    ciphertext: encrypted.toString("base64url"),
  };
}

function decryptEnvelope(
  envelope: ReturnType<typeof encryptEnvelope>,
  macKey: ReturnType<typeof createECDH>,
): Record<string, string> {
  const sharedSecret = macKey.computeSecret(
    Buffer.from(envelope.ephemeralPublicKey, "base64url"),
  );
  const key = Buffer.from(
    hkdfSync(
      "sha256",
      sharedSecret,
      createHash("sha256").update(envelope.pairingId, "utf8").digest(),
      Buffer.from(`otp-relay-message-v1:${envelope.messageId}`, "utf8"),
      32,
    ),
  );
  const encrypted = Buffer.from(envelope.ciphertext, "base64url");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.nonce, "base64url"),
  );
  decipher.setAAD(
    Buffer.from(
      `1\n${envelope.messageId}\n${envelope.pairingId}\n${envelope.expiresAt}`,
    ),
  );
  decipher.setAuthTag(encrypted.subarray(-16));
  return JSON.parse(
    Buffer.concat([
      decipher.update(encrypted.subarray(0, -16)),
      decipher.final(),
    ]).toString("utf8"),
  );
}
