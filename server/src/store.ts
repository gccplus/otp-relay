import type {
  AckResult,
  Pairing,
  PairingSession,
  StoredMessage,
} from "./protocol.js";
import { hashSecret, secretMatches } from "./security.js";

export type MaybePromise<T> = T | Promise<T>;

export interface RelayStore {
  putSession(session: PairingSession): MaybePromise<void>;
  getSession(id: string, now: Date): MaybePromise<PairingSession | undefined>;
  deleteSession(id: string): MaybePromise<void>;
  putPairing(pairing: Pairing): MaybePromise<void>;
  getPairing(id: string): MaybePromise<Pairing | undefined>;
  findActivePairingForDevice(
    deviceId: string,
    role: "android" | "mac",
  ): MaybePromise<Pairing | undefined>;
  findPairingByCredential(
    credential: string,
    role: "android" | "mac",
  ): MaybePromise<Pairing | undefined>;
  authenticate(
    credential: string,
    role: "android" | "mac",
  ): MaybePromise<Pairing | undefined>;
  revokePairing(pairingId: string, now: Date): MaybePromise<Pairing | undefined>;
  putMessage(message: StoredMessage): MaybePromise<"created" | "duplicate">;
  getMessage(id: string, now: Date): MaybePromise<StoredMessage | undefined>;
  listMessages(pairingId: string, now: Date): MaybePromise<StoredMessage[]>;
  acknowledge(
    result: AckResult,
    now: Date,
    idempotencyTtlMs: number,
  ): MaybePromise<AckResult>;
  getAcknowledgement(id: string, now: Date): MaybePromise<AckResult | undefined>;
  cleanup(now: Date): MaybePromise<void>;
  health(): MaybePromise<void>;
  close(): MaybePromise<void>;
}

export class StoreConflictError extends Error {}

export class InMemoryStore implements RelayStore {
  private readonly sessions = new Map<string, PairingSession>();
  private readonly pairings = new Map<string, Pairing>();
  private readonly messages = new Map<string, StoredMessage>();
  private readonly acknowledgements = new Map<
    string,
    AckResult & { expiresAt: number }
  >();

  putSession(session: PairingSession): void {
    this.sessions.set(session.pairingSessionId, session);
  }

  getSession(id: string, now: Date): PairingSession | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (Date.parse(session.expiresAt) <= now.getTime()) {
      this.sessions.delete(id);
      return undefined;
    }
    return session;
  }

  deleteSession(id: string): void {
    this.sessions.delete(id);
  }

  putPairing(pairing: Pairing): void {
    this.pairings.set(pairing.pairingId, pairing);
  }

  getPairing(id: string): Pairing | undefined {
    return this.pairings.get(id);
  }

  findActivePairingForDevice(
    deviceId: string,
    role: "android" | "mac",
  ): Pairing | undefined {
    const field = role === "android" ? "androidDeviceId" : "macDeviceId";
    return [...this.pairings.values()].find(
      (pairing) =>
        pairing.status === "active" &&
        pairing[field] === deviceId,
    );
  }

  authenticate(
    credential: string,
    role: "android" | "mac",
  ): Pairing | undefined {
    const pairing = this.findPairingByCredential(credential, role);
    return pairing?.status === "active" ? pairing : undefined;
  }

  findPairingByCredential(
    credential: string,
    role: "android" | "mac",
  ): Pairing | undefined {
    const field =
      role === "android" ? "androidCredentialHash" : "macCredentialHash";
    return [...this.pairings.values()].find(
      (pairing) => secretMatches(credential, pairing[field]),
    );
  }

  revokePairing(pairingId: string, now: Date): Pairing | undefined {
    const pairing = this.pairings.get(pairingId);
    if (!pairing || pairing.status === "revoked") return pairing;
    pairing.status = "revoked";
    pairing.revokedAt = now.toISOString();
    for (const [messageId, message] of this.messages) {
      if (message.envelope.pairingId === pairingId) {
        this.messages.delete(messageId);
      }
    }
    return pairing;
  }

  putMessage(message: StoredMessage): "created" | "duplicate" {
    if (
      this.messages.has(message.envelope.messageId) ||
      this.acknowledgements.has(message.envelope.messageId)
    ) {
      return "duplicate";
    }
    this.messages.set(message.envelope.messageId, message);
    return "created";
  }

  getMessage(id: string, now: Date): StoredMessage | undefined {
    const message = this.messages.get(id);
    if (!message) return undefined;
    if (Date.parse(message.serverExpiresAt) <= now.getTime()) {
      this.messages.delete(id);
      return undefined;
    }
    return message;
  }

  listMessages(pairingId: string, now: Date): StoredMessage[] {
    this.cleanup(now);
    return [...this.messages.values()]
      .filter((message) => message.envelope.pairingId === pairingId)
      .sort(
        (a, b) =>
          Date.parse(a.serverReceivedAt) - Date.parse(b.serverReceivedAt),
      );
  }

  acknowledge(
    result: AckResult,
    now: Date,
    idempotencyTtlMs: number,
  ): AckResult {
    const existing = this.acknowledgements.get(result.messageId);
    if (existing && existing.expiresAt > now.getTime()) return existing;
    this.messages.delete(result.messageId);
    this.acknowledgements.set(result.messageId, {
      ...result,
      expiresAt: now.getTime() + idempotencyTtlMs,
    });
    return result;
  }

  getAcknowledgement(id: string, now: Date): AckResult | undefined {
    const result = this.acknowledgements.get(id);
    if (!result) return undefined;
    if (result.expiresAt <= now.getTime()) {
      this.acknowledgements.delete(id);
      return undefined;
    }
    return result;
  }

  cleanup(now: Date): void {
    for (const [id, session] of this.sessions) {
      if (Date.parse(session.expiresAt) <= now.getTime()) {
        this.sessions.delete(id);
      }
    }
    for (const [id, message] of this.messages) {
      if (Date.parse(message.serverExpiresAt) <= now.getTime()) {
        this.messages.delete(id);
      }
    }
    for (const [id, result] of this.acknowledgements) {
      if (result.expiresAt <= now.getTime()) {
        this.acknowledgements.delete(id);
      }
    }
  }

  static credentialHash(credential: string): string {
    return hashSecret(credential);
  }

  health(): void {}

  close(): void {}
}
