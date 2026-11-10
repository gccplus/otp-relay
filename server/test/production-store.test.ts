import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { runMigrations } from "../src/migrate.js";
import { PostgresRedisStore } from "../src/production-store.js";
import type { Pairing, StoredMessage } from "../src/protocol.js";
import {
  fingerprintSecret,
  hashSecret,
  newSecret,
} from "../src/security.js";

const databaseUrl = process.env.OTP_TEST_DATABASE_URL;
const redisUrl = process.env.OTP_TEST_REDIS_URL;
const enabled = Boolean(databaseUrl && redisUrl);

test(
  "PostgreSQL pairings and Redis TTL messages survive store reconnect",
  { skip: !enabled },
  async () => {
    assert(databaseUrl);
    assert(redisUrl);
    await runMigrations(databaseUrl);
    const androidCredential = newSecret();
    const macCredential = newSecret();
    const pairing: Pairing = {
      pairingId: randomUUID(),
      androidDeviceId: `android-${randomUUID()}`,
      androidDeviceName: "Integration Android",
      macDeviceId: `mac-${randomUUID()}`,
      macDeviceName: "Integration Mac",
      macPublicKey: Buffer.alloc(65, 1).toString("base64url"),
      protocolVersion: 1,
      status: "active",
      androidCredentialHash: hashSecret(androidCredential),
      androidCredentialFingerprint: fingerprintSecret(androidCredential),
      macCredentialHash: hashSecret(macCredential),
      macCredentialFingerprint: fingerprintSecret(macCredential),
      createdAt: new Date().toISOString(),
    };

    const first = await PostgresRedisStore.connect(databaseUrl, redisUrl);
    await first.putPairing(pairing);
    const expiresAt = new Date(Date.now() + 300_000).toISOString();
    const message: StoredMessage = {
      envelope: {
        messageId: randomUUID(),
        pairingId: pairing.pairingId,
        protocolVersion: 1,
        receivedAt: new Date().toISOString(),
        expiresAt,
        ephemeralPublicKey: Buffer.alloc(65, 2).toString("base64url"),
        nonce: Buffer.alloc(12, 3).toString("base64url"),
        ciphertext: Buffer.alloc(80, 4).toString("base64url"),
      },
      serverReceivedAt: new Date().toISOString(),
      serverExpiresAt: expiresAt,
    };
    assert.equal(await first.putMessage(message), "created");
    await first.close();

    const second = await PostgresRedisStore.connect(databaseUrl, redisUrl);
    try {
      assert.equal(
        (await second.authenticate(androidCredential, "android"))?.pairingId,
        pairing.pairingId,
      );
      assert.equal(
        (await second.listMessages(pairing.pairingId, new Date())).length,
        1,
      );
      await second.acknowledge(
        {
          messageId: message.envelope.messageId,
          status: "displayed",
          acknowledgedAt: new Date().toISOString(),
        },
        new Date(),
        600_000,
      );
      assert.equal(
        (await second.listMessages(pairing.pairingId, new Date())).length,
        0,
      );
      await second.revokePairing(pairing.pairingId, new Date());
      assert.equal(
        await second.authenticate(androidCredential, "android"),
        undefined,
      );
      assert.equal(
        (
          await second.findPairingByCredential(
            androidCredential,
            "android",
          )
        )?.status,
        "revoked",
      );
    } finally {
      await second.close();
    }
  },
);
