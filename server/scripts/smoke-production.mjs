import { createECDH, randomBytes, randomUUID } from "node:crypto";
import WebSocket from "ws";

const baseURL = process.env.OTP_RELAY_BASE_URL?.replace(/\/+$/, "");
if (!baseURL?.startsWith("https://")) {
  throw new Error("OTP_RELAY_BASE_URL must be an https URL");
}

const b64 = (bytes) => Buffer.from(bytes).toString("base64url");
const macKey = createECDH("prime256v1");
macKey.generateKeys();
let macCredential;
let socket;

async function api(path, options = {}) {
  const headers = {
    ...options.headers,
    ...(options.body ? { "content-type": "application/json" } : {}),
  };
  const response = await fetch(`${baseURL}/${path.replace(/^\/+/, "")}`, {
    ...options,
    headers,
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path}: ${response.status}`);
  }
  return body;
}

try {
  const suffix = randomUUID();
  const created = await api("v1/pairing-sessions", {
    method: "POST",
    body: JSON.stringify({
      macDeviceId: `smoke-mac-${suffix}`,
      macDeviceName: "Production Smoke Test",
      macPublicKey: b64(macKey.getPublicKey()),
      protocolVersion: 1,
    }),
  });
  const claimed = await api(
    `v1/pairing-sessions/${created.pairingSessionId}/claim`,
    {
      method: "POST",
      body: JSON.stringify({
        claimSecret: created.claimSecret,
        androidDeviceId: `smoke-android-${suffix}`,
        androidDeviceName: "Production Smoke Test",
        protocolVersion: 1,
      }),
    },
  );
  await api(`v1/pairing-sessions/${created.pairingSessionId}/decision`, {
    method: "POST",
    headers: { authorization: `Bearer ${created.macSessionToken}` },
    body: JSON.stringify({ decision: "approve" }),
  });
  const macResult = await api(
    `v1/pairing-sessions/${created.pairingSessionId}`,
    { headers: { authorization: `Bearer ${created.macSessionToken}` } },
  );
  const androidResult = await api(
    `v1/pairing-sessions/${created.pairingSessionId}`,
    { headers: { authorization: `Bearer ${claimed.androidSessionToken}` } },
  );
  macCredential = macResult.deviceCredential;

  const streamURL = new URL(
    `${baseURL}/v1/mac/stream`.replace(/^https:/, "wss:"),
  );
  socket = new WebSocket(streamURL, {
    headers: { authorization: `Bearer ${macCredential}` },
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("WebSocket open timeout")),
      10_000,
    );
    socket.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("error", reject);
  });

  const messageId = randomUUID();
  const delivered = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("WebSocket delivery timeout")),
      10_000,
    );
    socket.on("message", (data) => {
      const event = JSON.parse(data.toString());
      if (
        event.event === "message.available" &&
        event.data?.messageId === messageId
      ) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  const ephemeralKey = createECDH("prime256v1");
  ephemeralKey.generateKeys();
  const now = new Date();
  await api("v1/messages", {
    method: "POST",
    headers: {
      authorization: `Bearer ${androidResult.deviceCredential}`,
    },
    body: JSON.stringify({
      messageId,
      pairingId: macResult.pairingId,
      protocolVersion: 1,
      receivedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 300_000).toISOString(),
      ephemeralPublicKey: b64(ephemeralKey.getPublicKey()),
      nonce: b64(randomBytes(12)),
      ciphertext: b64(randomBytes(80)),
    }),
  });
  await delivered;
  await api(`v1/messages/${messageId}/ack`, {
    method: "POST",
    headers: { authorization: `Bearer ${macCredential}` },
    body: JSON.stringify({ status: "displayed" }),
  });
  await api("v1/pairing", {
    method: "DELETE",
    headers: { authorization: `Bearer ${macCredential}` },
  });
  macCredential = undefined;
  console.log("production smoke test passed: HTTPS, pairing, WSS, delivery, ACK, revoke");
} finally {
  socket?.close();
  if (macCredential) {
    await api("v1/pairing", {
      method: "DELETE",
      headers: { authorization: `Bearer ${macCredential}` },
    }).catch(() => {});
  }
}
