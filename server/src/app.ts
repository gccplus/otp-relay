import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyRequest,
} from "fastify";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import { ZodError } from "zod";
import type { AppConfig } from "./config.js";
import { ApiError, errors } from "./errors.js";
import {
  ackSchema,
  claimPairingSchema,
  CLOCK_SKEW_MS,
  createPairingSchema,
  IDEMPOTENCY_TTL_MS,
  MESSAGE_TTL_MS,
  messageEnvelopeSchema,
  pairingDecisionSchema,
  PAIRING_TTL_MS,
  PROTOCOL_VERSION,
  type Pairing,
  type PairingSession,
} from "./protocol.js";
import { RealtimeHub } from "./realtime.js";
import {
  fingerprintSecret,
  hashSecret,
  newId,
  newSecret,
  parseBearer,
  secretMatches,
} from "./security.js";
import {
  InMemoryStore,
  StoreConflictError,
  type RelayStore,
} from "./store.js";

interface Dependencies {
  config: AppConfig;
  store?: RelayStore;
  realtime?: RealtimeHub;
}

function credentialFrom(request: FastifyRequest): string {
  const credential = parseBearer(request.headers.authorization);
  if (!credential) throw errors.unauthorized();
  return credential;
}

async function authenticate(
  request: FastifyRequest,
  store: RelayStore,
  role: "android" | "mac",
): Promise<Pairing> {
  const pairing = await store.findPairingByCredential(
    credentialFrom(request),
    role,
  );
  if (!pairing) throw errors.unauthorized();
  if (pairing.status === "revoked") throw errors.pairingRevoked();
  return pairing;
}

export async function buildApp({
  config,
  store = new InMemoryStore(),
  realtime = new RealtimeHub(),
}: Dependencies): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: config.trustProxy,
    logController: new LogController({ disableRequestLogging: true }),
    logger: {
      level: config.logLevel,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.body.claimSecret",
          "req.body.ciphertext",
          "req.body.nonce",
          "req.body.ephemeralPublicKey",
          "res.headers.authorization",
        ],
        censor: "[REDACTED]",
      },
    },
    bodyLimit: 16 * 1024,
    requestIdHeader: false,
  });
  await app.register(websocket);
  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: "1 minute",
    allowList: (request) =>
      request.url === "/healthz" || request.url === "/readyz",
  });
  app.addHook("onClose", async () => {
    realtime.close();
    await store.close();
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : undefined;
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
        },
      });
    }
    if (error instanceof StoreConflictError) {
      return reply.status(409).send({
        error: {
          code: "PAIRING_CONFLICT",
          message: "One of the devices already has an active pairing",
          requestId: request.id,
        },
      });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: "INVALID_REQUEST",
          message: "Request body or parameters are invalid",
          requestId: request.id,
        },
      });
    }
    if (
      statusCode !== undefined &&
      statusCode >= 400 &&
      statusCode < 500
    ) {
      return reply.status(statusCode).send({
        error: {
          code: "INVALID_REQUEST",
          message: "Request body or parameters are invalid",
          requestId: request.id,
        },
      });
    }
    request.log.error({ err: error }, "request failed");
    return reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "The server could not process the request",
        requestId: request.id,
      },
    });
  });

  app.get("/healthz", async () => ({ status: "ok", protocolVersion: 1 }));
  app.get("/readyz", async () => {
    await store.health();
    return { status: "ready", protocolVersion: 1 };
  });

  app.post(
    "/v1/pairing-sessions",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
    const input = createPairingSchema.parse(request.body);
    if (await store.findActivePairingForDevice(input.macDeviceId, "mac")) {
      throw errors.pairingConflict();
    }
    const now = config.now();
    const claimSecret = newSecret();
    const macSessionToken = newSecret();
    const session: PairingSession = {
      pairingSessionId: newId(),
      claimSecretHash: hashSecret(claimSecret),
      macSessionTokenHash: hashSecret(macSessionToken),
      macDeviceId: input.macDeviceId,
      macDeviceName: input.macDeviceName,
      macPublicKey: input.macPublicKey,
      protocolVersion: PROTOCOL_VERSION,
      status: "waiting_for_android",
      macResultFetched: false,
      androidResultFetched: false,
      expiresAt: new Date(now.getTime() + PAIRING_TTL_MS).toISOString(),
    };
    await store.putSession(session);
    return reply.status(201).send({
      pairingSessionId: session.pairingSessionId,
      claimSecret,
      macSessionToken,
      expiresAt: session.expiresAt,
    });
    },
  );

  app.post<{
    Params: { pairingSessionId: string };
  }>("/v1/pairing-sessions/:pairingSessionId/claim", async (request) => {
    const input = claimPairingSchema.parse(request.body);
    const session = await store.getSession(
      request.params.pairingSessionId,
      config.now(),
    );
    if (!session) throw errors.pairingExpired();
    if (session.status !== "waiting_for_android") {
      throw errors.pairingClaimed();
    }
    if (!secretMatches(input.claimSecret, session.claimSecretHash)) {
      throw errors.invalidClaim();
    }
    const androidSessionToken = newSecret();
    session.androidSessionTokenHash = hashSecret(androidSessionToken);
    session.androidDeviceId = input.androidDeviceId;
    session.androidDeviceName = input.androidDeviceName;
    session.status = "waiting_for_mac_approval";
    await store.putSession(session);
    return {
      androidSessionToken,
      status: session.status,
      expiresAt: session.expiresAt,
    };
  });

  app.get<{
    Params: { pairingSessionId: string };
  }>("/v1/pairing-sessions/:pairingSessionId", async (request) => {
    const session = await store.getSession(
      request.params.pairingSessionId,
      config.now(),
    );
    if (!session) throw errors.pairingExpired();
    const token = credentialFrom(request);
    const isMac = secretMatches(token, session.macSessionTokenHash);
    const isAndroid =
      session.androidSessionTokenHash !== undefined &&
      secretMatches(token, session.androidSessionTokenHash);
    if (!isMac && !isAndroid) throw errors.unauthorized();

    if (isMac) {
      if (session.status === "approved") session.macResultFetched = true;
      const response =
        session.status === "approved"
          ? {
              status: "paired",
              pairingId: session.pairingId,
              deviceCredential: session.macCredential,
              protocolVersion: session.protocolVersion,
            }
          : {
              status: session.status,
              androidDeviceId: session.androidDeviceId,
              androidDeviceName: session.androidDeviceName,
              expiresAt: session.expiresAt,
            };
      await store.putSession(session);
      await maybeDeleteFinishedSession(store, session);
      return response;
    }

    if (session.status === "approved") session.androidResultFetched = true;
    const response =
      session.status === "approved"
        ? {
            status: "paired",
            pairingId: session.pairingId,
            deviceCredential: session.androidCredential,
            macPublicKey: session.macPublicKey,
            macDeviceId: session.macDeviceId,
            macDeviceName: session.macDeviceName,
            protocolVersion: session.protocolVersion,
          }
        : {
            status: session.status,
            expiresAt: session.expiresAt,
          };
    await store.putSession(session);
    await maybeDeleteFinishedSession(store, session);
    return response;
  });

  app.post<{
    Params: { pairingSessionId: string };
  }>("/v1/pairing-sessions/:pairingSessionId/decision", async (request) => {
    const input = pairingDecisionSchema.parse(request.body);
    const session = await store.getSession(
      request.params.pairingSessionId,
      config.now(),
    );
    if (!session) throw errors.pairingExpired();
    const token = credentialFrom(request);
    if (!secretMatches(token, session.macSessionTokenHash)) {
      throw errors.unauthorized();
    }
    if (session.status !== "waiting_for_mac_approval") {
      throw new ApiError(
        409,
        "INVALID_PAIRING_STATE",
        "Pairing session is not waiting for a decision",
      );
    }
    if (input.decision === "reject") {
      session.status = "rejected";
      await store.putSession(session);
      return { status: "rejected" };
    }
    if (
      !session.androidDeviceId ||
      !session.androidDeviceName ||
      (await store.findActivePairingForDevice(session.macDeviceId, "mac"))
    ) {
      throw errors.pairingConflict();
    }
    const now = config.now();
    const androidCredential = newSecret();
    const macCredential = newSecret();
    const pairing: Pairing = {
      pairingId: newId(),
      androidDeviceId: session.androidDeviceId,
      androidDeviceName: session.androidDeviceName,
      macDeviceId: session.macDeviceId,
      macDeviceName: session.macDeviceName,
      macPublicKey: session.macPublicKey,
      protocolVersion: PROTOCOL_VERSION,
      status: "active",
      androidCredentialHash: hashSecret(androidCredential),
      androidCredentialFingerprint: fingerprintSecret(androidCredential),
      macCredentialHash: hashSecret(macCredential),
      macCredentialFingerprint: fingerprintSecret(macCredential),
      createdAt: now.toISOString(),
    };
    await store.putPairing(pairing);
    session.status = "approved";
    session.pairingId = pairing.pairingId;
    session.androidCredential = androidCredential;
    session.macCredential = macCredential;
    await store.putSession(session);
    return { status: "approved", pairingId: pairing.pairingId };
  });

  app.post("/v1/messages", async (request, reply) => {
    const pairing = await authenticate(request, store, "android");
    const envelope = messageEnvelopeSchema.parse(request.body);
    if (envelope.pairingId !== pairing.pairingId) throw errors.forbidden();
    const now = config.now();
    const receivedAt = Date.parse(envelope.receivedAt);
    const requestedExpiry = Date.parse(envelope.expiresAt);
    if (Math.abs(receivedAt - now.getTime()) > CLOCK_SKEW_MS) {
      throw errors.clockSkew();
    }
    if (requestedExpiry <= now.getTime()) throw errors.messageExpired();
    const serverExpiresAt = new Date(
      Math.min(requestedExpiry, now.getTime() + MESSAGE_TTL_MS),
    ).toISOString();
    const message = {
      envelope,
      serverReceivedAt: now.toISOString(),
      serverExpiresAt,
    };
    const stored = await store.putMessage(message);
    if (stored === "created") realtime.pushMessage(message);
    return reply.status(stored === "created" ? 201 : 200).send({
      messageId: envelope.messageId,
      status: stored === "created" ? "received" : "duplicate",
      serverReceivedAt: message.serverReceivedAt,
      serverExpiresAt,
    });
  });

  app.get(
    "/v1/mac/stream",
    { websocket: true },
    (socket, request) => {
      void connectMacStream({
        socket,
        authorization: request.headers.authorization,
        store,
        realtime,
        now: config.now(),
      });
    },
  );

  app.post<{
    Params: { messageId: string };
  }>("/v1/messages/:messageId/ack", async (request) => {
    const pairing = await authenticate(request, store, "mac");
    const input = ackSchema.parse(request.body);
    const now = config.now();
    const existingAck = await store.getAcknowledgement(
      request.params.messageId,
      now,
    );
    if (existingAck) return existingAck;
    const message = await store.getMessage(request.params.messageId, now);
    if (!message) throw errors.notFound();
    if (message.envelope.pairingId !== pairing.pairingId) {
      throw errors.forbidden();
    }
    return await store.acknowledge(
      {
        messageId: request.params.messageId,
        status: input.status,
        acknowledgedAt: now.toISOString(),
      },
      now,
      IDEMPOTENCY_TTL_MS,
    );
  });

  app.delete("/v1/pairing", async (request) => {
    const token = credentialFrom(request);
    const pairing =
      (await store.findPairingByCredential(token, "android")) ??
      (await store.findPairingByCredential(token, "mac"));
    if (!pairing) throw errors.unauthorized();
    if (pairing.status === "active") {
      await store.revokePairing(pairing.pairingId, config.now());
      realtime.revoke(pairing.pairingId);
    }
    return { status: "revoked", pairingId: pairing.pairingId };
  });

  return app;
}

async function maybeDeleteFinishedSession(
  store: RelayStore,
  session: PairingSession,
): Promise<void> {
  if (
    session.status === "approved" &&
    session.macResultFetched &&
    session.androidResultFetched
  ) {
    await store.deleteSession(session.pairingSessionId);
  }
}

async function connectMacStream({
  socket,
  authorization,
  store,
  realtime,
  now,
}: {
  socket: WebSocket;
  authorization: string | string[] | undefined;
  store: RelayStore;
  realtime: RealtimeHub;
  now: Date;
}): Promise<void> {
  try {
    const credential = parseBearer(authorization);
    const pairing = credential
      ? await store.findPairingByCredential(credential, "mac")
      : undefined;
    if (!pairing || pairing.status === "revoked") {
      socket.close(4003, "Unauthorized");
      return;
    }
    realtime.connect(pairing, socket);
    const pending = await store.listMessages(pairing.pairingId, now);
    for (const message of pending) realtime.pushMessage(message);
  } catch {
    socket.close(1011, "Service unavailable");
  }
}
