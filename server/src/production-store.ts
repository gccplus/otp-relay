import { Pool, type QueryResultRow } from "pg";
import { createClient, type RedisClientType } from "redis";
import type {
  AckResult,
  Pairing,
  PairingSession,
  StoredMessage,
} from "./protocol.js";
import { fingerprintSecret, secretMatches } from "./security.js";
import {
  StoreConflictError,
  type RelayStore,
} from "./store.js";

type RedisClient = RedisClientType;

interface PairingRow extends QueryResultRow {
  pairing_id: string;
  android_device_id: string;
  android_device_name: string;
  mac_device_id: string;
  mac_device_name: string;
  mac_public_key: string;
  protocol_version: number;
  status: "active" | "revoked";
  android_credential_hash: string;
  android_credential_fingerprint: string;
  mac_credential_hash: string;
  mac_credential_fingerprint: string;
  created_at: Date;
  revoked_at: Date | null;
}

export class PostgresRedisStore implements RelayStore {
  private constructor(
    private readonly pool: Pool,
    private readonly redis: RedisClient,
  ) {}

  static async connect(
    databaseUrl: string,
    redisUrl: string,
  ): Promise<PostgresRedisStore> {
    const pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    const redis = createClient({ url: redisUrl });
    redis.on("error", () => {
      // Individual operations surface errors to Fastify. This listener prevents
      // the Redis client from treating an emitted error as unhandled.
    });
    await Promise.all([pool.query("SELECT 1"), redis.connect()]);
    return new PostgresRedisStore(pool, redis);
  }

  async putSession(session: PairingSession): Promise<void> {
    const ttl = Date.parse(session.expiresAt) - Date.now();
    if (ttl <= 0) {
      await this.deleteSession(session.pairingSessionId);
      return;
    }
    await this.redis.set(sessionKey(session.pairingSessionId), JSON.stringify(session), {
      PX: ttl,
    });
  }

  async getSession(
    id: string,
    now: Date,
  ): Promise<PairingSession | undefined> {
    const raw = await this.redis.get(sessionKey(id));
    if (!raw) return undefined;
    const session = JSON.parse(raw) as PairingSession;
    if (Date.parse(session.expiresAt) <= now.getTime()) {
      await this.deleteSession(id);
      return undefined;
    }
    return session;
  }

  async deleteSession(id: string): Promise<void> {
    await this.redis.del(sessionKey(id));
  }

  async putPairing(pairing: Pairing): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO pairings (
          pairing_id,
          android_device_id,
          android_device_name,
          mac_device_id,
          mac_device_name,
          mac_public_key,
          protocol_version,
          status,
          android_credential_hash,
          android_credential_fingerprint,
          mac_credential_hash,
          mac_credential_fingerprint,
          created_at,
          revoked_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
        )`,
        [
          pairing.pairingId,
          pairing.androidDeviceId,
          pairing.androidDeviceName,
          pairing.macDeviceId,
          pairing.macDeviceName,
          pairing.macPublicKey,
          pairing.protocolVersion,
          pairing.status,
          pairing.androidCredentialHash,
          pairing.androidCredentialFingerprint,
          pairing.macCredentialHash,
          pairing.macCredentialFingerprint,
          pairing.createdAt,
          pairing.revokedAt ?? null,
        ],
      );
    } catch (error) {
      if (postgresErrorCode(error) === "23505") {
        throw new StoreConflictError("A device already has an active pairing");
      }
      throw error;
    }
  }

  async getPairing(id: string): Promise<Pairing | undefined> {
    const result = await this.pool.query<PairingRow>(
      "SELECT * FROM pairings WHERE pairing_id = $1",
      [id],
    );
    return result.rows[0] ? pairingFromRow(result.rows[0]) : undefined;
  }

  async findActivePairingForDevice(
    deviceId: string,
    role: "android" | "mac",
  ): Promise<Pairing | undefined> {
    const deviceColumn =
      role === "android" ? "android_device_id" : "mac_device_id";
    const result = await this.pool.query<PairingRow>(
      `SELECT * FROM pairings
       WHERE status = 'active'
         AND ${deviceColumn} = $1
       LIMIT 1`,
      [deviceId],
    );
    return result.rows[0] ? pairingFromRow(result.rows[0]) : undefined;
  }

  async authenticate(
    credential: string,
    role: "android" | "mac",
  ): Promise<Pairing | undefined> {
    const pairing = await this.findPairingByCredential(credential, role);
    return pairing?.status === "active" ? pairing : undefined;
  }

  async findPairingByCredential(
    credential: string,
    role: "android" | "mac",
  ): Promise<Pairing | undefined> {
    const fingerprintColumn =
      role === "android"
        ? "android_credential_fingerprint"
        : "mac_credential_fingerprint";
    const result = await this.pool.query<PairingRow>(
      `SELECT * FROM pairings
       WHERE ${fingerprintColumn} = $1
       LIMIT 1`,
      [fingerprintSecret(credential)],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const expectedHash =
      role === "android"
        ? row.android_credential_hash
        : row.mac_credential_hash;
    return secretMatches(credential, expectedHash)
      ? pairingFromRow(row)
      : undefined;
  }

  async revokePairing(
    pairingId: string,
    now: Date,
  ): Promise<Pairing | undefined> {
    const result = await this.pool.query<PairingRow>(
      `UPDATE pairings
       SET status = 'revoked', revoked_at = $2
       WHERE pairing_id = $1
       RETURNING *`,
      [pairingId, now.toISOString()],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const index = messageIndexKey(pairingId);
    const messageIds = await this.redis.zRange(index, 0, -1);
    if (messageIds.length > 0) {
      await this.redis.del(messageIds.map(messageKey));
    }
    await this.redis.del(index);
    return pairingFromRow(row);
  }

  async putMessage(
    message: StoredMessage,
  ): Promise<"created" | "duplicate"> {
    const ttl = Date.parse(message.serverExpiresAt) - Date.now();
    if (ttl <= 0) return "duplicate";
    if (await this.redis.exists(ackKey(message.envelope.messageId))) {
      return "duplicate";
    }
    const created = await this.redis.set(
      messageKey(message.envelope.messageId),
      JSON.stringify(message),
      { PX: ttl, NX: true },
    );
    if (created !== "OK") return "duplicate";
    const index = messageIndexKey(message.envelope.pairingId);
    await this.redis
      .multi()
      .zAdd(index, {
        score: Date.parse(message.serverExpiresAt),
        value: message.envelope.messageId,
      })
      .pExpire(index, ttl + 60_000)
      .exec();
    return "created";
  }

  async getMessage(
    id: string,
    now: Date,
  ): Promise<StoredMessage | undefined> {
    const raw = await this.redis.get(messageKey(id));
    if (!raw) return undefined;
    const message = JSON.parse(raw) as StoredMessage;
    if (Date.parse(message.serverExpiresAt) <= now.getTime()) {
      await this.redis.del(messageKey(id));
      await this.redis.zRem(
        messageIndexKey(message.envelope.pairingId),
        id,
      );
      return undefined;
    }
    return message;
  }

  async listMessages(
    pairingId: string,
    now: Date,
  ): Promise<StoredMessage[]> {
    const index = messageIndexKey(pairingId);
    await this.redis.zRemRangeByScore(index, "-inf", now.getTime());
    const ids = await this.redis.zRangeByScore(index, now.getTime(), "+inf");
    if (ids.length === 0) return [];
    const values = await this.redis.mGet(ids.map(messageKey));
    const messages = values.flatMap((raw) =>
      raw ? [JSON.parse(raw) as StoredMessage] : [],
    );
    return messages.sort(
      (a, b) =>
        Date.parse(a.serverReceivedAt) - Date.parse(b.serverReceivedAt),
    );
  }

  async acknowledge(
    result: AckResult,
    now: Date,
    idempotencyTtlMs: number,
  ): Promise<AckResult> {
    const existing = await this.getAcknowledgement(
      result.messageId,
      now,
    );
    if (existing) return existing;
    const message = await this.getMessage(result.messageId, now);
    const transaction = this.redis
      .multi()
      .set(ackKey(result.messageId), JSON.stringify(result), {
        PX: idempotencyTtlMs,
      })
      .del(messageKey(result.messageId));
    if (message) {
      transaction.zRem(
        messageIndexKey(message.envelope.pairingId),
        result.messageId,
      );
    }
    await transaction.exec();
    return result;
  }

  async getAcknowledgement(
    id: string,
    _now: Date,
  ): Promise<AckResult | undefined> {
    const raw = await this.redis.get(ackKey(id));
    return raw ? (JSON.parse(raw) as AckResult) : undefined;
  }

  async cleanup(_now: Date): Promise<void> {
    // Pairing sessions, messages and acknowledgements are all Redis TTL keys.
  }

  async health(): Promise<void> {
    await Promise.all([this.pool.query("SELECT 1"), this.redis.ping()]);
  }

  async close(): Promise<void> {
    await Promise.all([
      this.pool.end(),
      this.redis.isOpen ? this.redis.quit() : Promise.resolve(),
    ]);
  }
}

function sessionKey(id: string): string {
  return `otp:pairing-session:${id}`;
}

function messageKey(id: string): string {
  return `otp:message:${id}`;
}

function messageIndexKey(pairingId: string): string {
  return `otp:pairing-messages:${pairingId}`;
}

function ackKey(id: string): string {
  return `otp:ack:${id}`;
}

function pairingFromRow(row: PairingRow): Pairing {
  if (row.protocol_version !== 1) {
    throw new Error(`Unsupported persisted protocol version: ${row.protocol_version}`);
  }
  return {
    pairingId: row.pairing_id,
    androidDeviceId: row.android_device_id,
    androidDeviceName: row.android_device_name,
    macDeviceId: row.mac_device_id,
    macDeviceName: row.mac_device_name,
    macPublicKey: row.mac_public_key,
    protocolVersion: 1,
    status: row.status,
    androidCredentialHash: row.android_credential_hash,
    androidCredentialFingerprint: row.android_credential_fingerprint,
    macCredentialHash: row.mac_credential_hash,
    macCredentialFingerprint: row.mac_credential_fingerprint,
    createdAt: row.created_at.toISOString(),
    ...(row.revoked_at
      ? { revokedAt: row.revoked_at.toISOString() }
      : {}),
  };
}

function postgresErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}
