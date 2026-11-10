import { z } from "zod";

export const PROTOCOL_VERSION = 1;
export const PAIRING_TTL_MS = 5 * 60 * 1000;
export const MESSAGE_TTL_MS = 5 * 60 * 1000;
export const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
export const CLOCK_SKEW_MS = 10 * 60 * 1000;

const base64Url = z
  .string()
  .min(16)
  .max(4096)
  .regex(/^[A-Za-z0-9_-]+$/);

export const createPairingSchema = z.object({
  macDeviceId: z.string().min(8).max(128),
  macDeviceName: z.string().min(1).max(128),
  macPublicKey: base64Url.max(256),
  protocolVersion: z.literal(PROTOCOL_VERSION),
});

export const claimPairingSchema = z.object({
  claimSecret: base64Url.max(128),
  androidDeviceId: z.string().min(8).max(128),
  androidDeviceName: z.string().min(1).max(128),
  protocolVersion: z.literal(PROTOCOL_VERSION),
});

export const pairingDecisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
});

export const messageEnvelopeSchema = z.object({
  messageId: z.string().uuid(),
  pairingId: z.string().uuid(),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  receivedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  ephemeralPublicKey: base64Url.max(256),
  nonce: base64Url.refine(
    (value) => Buffer.from(value, "base64url").length === 12,
    "nonce must be exactly 12 bytes",
  ),
  ciphertext: base64Url.max(16 * 1024),
});

export const ackSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("displayed") }),
  z.object({
    status: z.literal("rejected"),
    reason: z.enum([
      "MESSAGE_EXPIRED",
      "PAIRING_MISMATCH",
      "PROTOCOL_UNSUPPORTED",
      "INVALID_ENVELOPE",
      "DECRYPTION_FAILED",
      "INVALID_PAYLOAD",
    ]),
  }),
]);

export type CreatePairingInput = z.infer<typeof createPairingSchema>;
export type ClaimPairingInput = z.infer<typeof claimPairingSchema>;
export type MessageEnvelope = z.infer<typeof messageEnvelopeSchema>;
export type AckInput = z.infer<typeof ackSchema>;

export type PairingStatus = "active" | "revoked";

export interface Pairing {
  pairingId: string;
  androidDeviceId: string;
  androidDeviceName: string;
  macDeviceId: string;
  macDeviceName: string;
  macPublicKey: string;
  protocolVersion: 1;
  status: PairingStatus;
  androidCredentialHash: string;
  androidCredentialFingerprint: string;
  macCredentialHash: string;
  macCredentialFingerprint: string;
  createdAt: string;
  revokedAt?: string;
}

export interface PairingSession {
  pairingSessionId: string;
  claimSecretHash: string;
  macSessionTokenHash: string;
  androidSessionTokenHash?: string;
  macDeviceId: string;
  macDeviceName: string;
  macPublicKey: string;
  protocolVersion: 1;
  status:
    | "waiting_for_android"
    | "waiting_for_mac_approval"
    | "approved"
    | "rejected";
  androidDeviceId?: string;
  androidDeviceName?: string;
  pairingId?: string;
  androidCredential?: string;
  macCredential?: string;
  macResultFetched: boolean;
  androidResultFetched: boolean;
  expiresAt: string;
}

export interface StoredMessage {
  envelope: MessageEnvelope;
  serverReceivedAt: string;
  serverExpiresAt: string;
}

export interface AckResult {
  messageId: string;
  status: "displayed" | "rejected";
  acknowledgedAt: string;
}

export interface ProtocolErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
  };
}
