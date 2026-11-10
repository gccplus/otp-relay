"use strict";

const EventEmitter = require("node:events");
const os = require("node:os");
const QRCode = require("qrcode");
const WebSocket = require("ws");
const {
  OtpCryptoError,
  PROTOCOL_VERSION,
  decryptEnvelope,
  publicKeyFor,
} = require("./crypto");
const {
  DEFAULT_DOMAIN,
  normalizeDomain,
  serviceBaseUrl,
} = require("./endpoint");
const { RelayApi, RelayApiError } = require("./relay-api");
const { pingWithTimeout } = require("./websocket-heartbeat");

const HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000;

class AppController extends EventEmitter {
  constructor({
    secureStore,
    copyText,
    getLaunchAtLogin,
    setLaunchAtLogin,
    api = new RelayApi(),
    WebSocketImplementation = WebSocket,
    qrCode = QRCode,
  }) {
    super();
    this.secureStore = secureStore;
    this.copyText = copyText;
    this.getLaunchAtLogin = getLaunchAtLogin;
    this.setLaunchAtLogin = setLaunchAtLogin;
    this.api = api;
    this.WebSocketImplementation = WebSocketImplementation;
    this.qrCode = qrCode;

    this.persisted = secureStore.load();
    this.serverDomain = this.persisted.serverDomain || DEFAULT_DOMAIN;
    this.connectionState = this.persisted.pairing
      ? "reconnecting"
      : "unpaired";
    this.failureMessage = null;
    this.serverDomainError = null;
    this.qrDataUrl = null;
    this.pairingExpiresAt = null;
    this.pendingSession = null;
    this.pendingAndroidName = null;
    this.lastConnectedAt = null;
    this.lastMessageReceivedAt = null;
    this.pairingGeneration = 0;
    this.streamGeneration = 0;
    this.webSocket = null;
    this.heartbeat = null;
    this.processingIds = new Set();
    this.removeOldCards();
  }

  start() {
    if (this.persisted.pairing) this.startStream();
    this.emitState();
  }

  stop() {
    this.pairingGeneration += 1;
    this.stopStream();
  }

  suspend() {
    if (!this.persisted.pairing) return;
    this.stopStream();
    this.setConnectionState("reconnecting");
  }

  resume() {
    if (this.persisted.pairing) this.startStream();
  }

  getPublicState() {
    const pairing = this.persisted.pairing;
    return {
      connectionState: this.connectionState,
      connectionLabel: this.connectionLabel(),
      failureMessage: this.failureMessage,
      qrDataUrl: this.qrDataUrl,
      cards: this.persisted.cards,
      isPaired: Boolean(pairing),
      pairedDeviceName: pairing?.androidDeviceName || null,
      pairingExpiresAt: this.pairingExpiresAt,
      lastConnectedAt: this.lastConnectedAt,
      lastMessageReceivedAt: this.lastMessageReceivedAt,
      autoCopyEnabled: this.persisted.autoCopyEnabled,
      launchAtLoginEnabled: Boolean(this.getLaunchAtLogin()),
      serverDomain: this.serverDomain,
      serverDomainError: this.serverDomainError,
      activeServerDomain:
        hostname(pairing?.serviceBaseUrl) ||
        normalizeDomain(this.serverDomain) ||
        DEFAULT_DOMAIN,
    };
  }

  async preparePairing() {
    const generation = ++this.pairingGeneration;
    this.pendingSession = null;
    this.pendingAndroidName = null;
    this.qrDataUrl = null;
    this.pairingExpiresAt = null;
    const normalized = normalizeDomain(this.serverDomain);
    const baseUrl = normalized ? serviceBaseUrl(normalized) : null;
    if (!baseUrl) {
      this.serverDomainError = "仅填写域名，例如 otp.example.com";
      this.setFailure("服务器域名无效");
      return;
    }

    this.serverDomain = normalized;
    this.persisted.serverDomain = normalized;
    this.serverDomainError = null;
    this.save();
    this.setConnectionState("creatingQR");

    try {
      const created = await this.api.createPairingSession(baseUrl, {
        macDeviceId: this.persisted.deviceId,
        macDeviceName: os.hostname() || "Windows PC",
        macPublicKey: publicKeyFor(this.persisted.privateKey),
        protocolVersion: PROTOCOL_VERSION,
      });
      if (generation !== this.pairingGeneration) return;

      this.pendingSession = { ...created, baseUrl };
      this.pairingExpiresAt = created.expiresAt;
      const qrPayload = {
        serviceBaseUrl: baseUrl.replace(/\/$/, ""),
        pairingSessionId: created.pairingSessionId,
        claimSecret: created.claimSecret,
        macPublicKey: publicKeyFor(this.persisted.privateKey),
        protocolVersion: PROTOCOL_VERSION,
      };
      this.qrDataUrl = await this.qrCode.toDataURL(JSON.stringify(qrPayload), {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 360,
      });
      if (generation !== this.pairingGeneration) return;
      this.setConnectionState("waitingForAndroid");
      await this.pollForAndroid(generation);
    } catch (error) {
      if (generation !== this.pairingGeneration) return;
      if (error instanceof RelayApiError && error.code === "PAIRING_CONFLICT") {
        this.setFailure("设备仍存在有效配对，请先在原设备解除配对");
      } else if (error instanceof RelayApiError && error.status === 429) {
        this.setFailure("操作过于频繁，请稍后再试");
      } else {
        this.setFailure("无法创建配对，请检查服务器域名和网络");
      }
    }
  }

  async pollForAndroid(generation) {
    while (generation === this.pairingGeneration && this.pendingSession) {
      try {
        const session = this.pendingSession;
        const result = await this.api.queryPairing(
          session.baseUrl,
          session.pairingSessionId,
          session.macSessionToken,
        );
        if (generation !== this.pairingGeneration) return;
        if (result.status === "waiting_for_mac_approval") {
          this.pendingAndroidName = result.androidDeviceName || "Android 设备";
          this.setConnectionState("waitingForApproval");
          return;
        }
        await delay(1_500);
      } catch {
        if (generation === this.pairingGeneration) {
          this.setFailure("配对二维码已过期，请重新生成");
        }
        return;
      }
    }
  }

  async decidePairing(approve) {
    const session = this.pendingSession;
    if (!session || this.connectionState !== "waitingForApproval") return;
    const generation = this.pairingGeneration;
    try {
      await this.api.decidePairing(
        session.baseUrl,
        session.pairingSessionId,
        session.macSessionToken,
        approve,
      );
      if (generation !== this.pairingGeneration) return;
      if (!approve) {
        await this.preparePairing();
        return;
      }

      const result = await this.api.queryPairing(
        session.baseUrl,
        session.pairingSessionId,
        session.macSessionToken,
      );
      if (
        result.status !== "paired" ||
        typeof result.pairingId !== "string" ||
        typeof result.deviceCredential !== "string" ||
        (result.protocolVersion !== undefined &&
          result.protocolVersion !== PROTOCOL_VERSION)
      ) {
        throw new Error("Invalid pairing response");
      }
      this.persisted.pairing = {
        serviceBaseUrl: session.baseUrl,
        pairingId: result.pairingId,
        protocolVersion: result.protocolVersion || PROTOCOL_VERSION,
        deviceCredential: result.deviceCredential,
        androidDeviceName: this.pendingAndroidName || "Android 手机",
      };
      this.pendingSession = null;
      this.pendingAndroidName = null;
      this.qrDataUrl = null;
      this.pairingExpiresAt = null;
      this.save();
      this.startStream();
    } catch {
      if (generation === this.pairingGeneration) {
        this.setFailure("配对确认失败，请重新生成二维码");
      }
    }
  }

  retryConnection() {
    if (this.persisted.pairing) this.startStream();
    else void this.preparePairing();
  }

  setServerDomain(value) {
    if (this.persisted.pairing || typeof value !== "string") return;
    this.serverDomain = value;
    this.serverDomainError = null;
    const normalized = normalizeDomain(value);
    if (normalized) {
      this.persisted.serverDomain = normalized;
      this.save();
    }
    this.emitState();
  }

  setAutoCopyEnabled(enabled) {
    this.persisted.autoCopyEnabled = Boolean(enabled);
    this.save();
    this.emitState();
  }

  setLaunchAtLoginEnabled(enabled) {
    this.setLaunchAtLogin(Boolean(enabled));
    this.emitState();
  }

  copyCard(cardId) {
    const card = this.persisted.cards.find((item) => item.id === cardId);
    if (!card) return false;
    this.copyText(card.code);
    return true;
  }

  async unpair() {
    const pairing = this.persisted.pairing;
    if (!pairing) {
      this.clearLocalPairing();
      return;
    }
    try {
      await this.api.revoke(
        pairing.serviceBaseUrl,
        pairing.deviceCredential,
      );
      this.clearLocalPairing();
    } catch (error) {
      if (
        error instanceof RelayApiError &&
        (error.status === 401 || error.status === 403)
      ) {
        this.clearLocalPairing();
      } else {
        this.setFailure("解除配对失败，请检查网络后重试");
      }
    }
  }

  startStream() {
    if (!this.persisted.pairing) return;
    this.stopStream();
    const generation = this.streamGeneration;
    this.setConnectionState("reconnecting");
    void this.maintainStream(generation);
  }

  stopStream() {
    this.streamGeneration += 1;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    const socket = this.webSocket;
    this.webSocket = null;
    if (socket) {
      try {
        socket.close(1001, "Client suspending");
      } catch {
        socket.terminate?.();
      }
    }
  }

  async maintainStream(generation) {
    let retryMs = 1_000;
    while (
      generation === this.streamGeneration &&
      this.persisted.pairing
    ) {
      const result = await this.connectStream(generation);
      if (generation !== this.streamGeneration) return;
      if (result.code === 4003) {
        this.clearLocalPairing();
        return;
      }
      this.setConnectionState("reconnecting");
      await delay(retryMs);
      retryMs = Math.min(retryMs * 2, 20_000);
    }
  }

  connectStream(generation) {
    const pairing = this.persisted.pairing;
    if (!pairing) return Promise.resolve({ code: 1000 });
    return new Promise((resolve) => {
      const socket = new this.WebSocketImplementation(
        this.api.streamUrl(pairing.serviceBaseUrl),
        {
          headers: {
            Authorization: `Bearer ${pairing.deviceCredential}`,
          },
          handshakeTimeout: 30_000,
          maxPayload: 64 * 1024,
        },
      );
      this.webSocket = socket;
      let finished = false;
      let pingPending = false;
      let heartbeat = null;
      const finish = (code = 1006) => {
        if (finished) return;
        finished = true;
        if (heartbeat) clearInterval(heartbeat);
        if (this.heartbeat === heartbeat) this.heartbeat = null;
        if (this.webSocket === socket) this.webSocket = null;
        resolve({ code });
      };

      socket.on("open", () => {
        if (generation !== this.streamGeneration) {
          socket.close(1001, "Obsolete connection");
          return;
        }
        this.lastConnectedAt = new Date().toISOString();
        this.setConnectionState("connected");
        heartbeat = setInterval(async () => {
          if (
            pingPending ||
            socket.readyState !== this.WebSocketImplementation.OPEN
          ) {
            return;
          }
          pingPending = true;
          try {
            await pingWithTimeout(socket, 8_000);
          } catch {
            socket.terminate();
          } finally {
            pingPending = false;
          }
        }, 10_000);
        this.heartbeat = heartbeat;
      });
      socket.on("message", (data) => {
        void this.handleStreamEvent(data.toString("utf8")).catch(() => {});
      });
      socket.once("close", (code) => finish(code));
      socket.once("error", () => {
        if (socket.readyState !== socket.CLOSED) socket.terminate();
        finish(1006);
      });
    });
  }

  async handleStreamEvent(raw) {
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }
    if (event.event === "pairing.revoked") {
      this.clearLocalPairing();
      return;
    }
    if (event.event === "message.available" && event.data) {
      await this.handleEnvelope(event.data);
    }
  }

  async handleEnvelope(envelope) {
    const pairing = this.persisted.pairing;
    if (!pairing || this.processingIds.has(envelope?.messageId)) return;
    this.processingIds.add(envelope.messageId);
    try {
      const expiresAt = Date.parse(envelope.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        await this.rejectEnvelope(envelope, "MESSAGE_EXPIRED");
        return;
      }

      let payload;
      try {
        payload = decryptEnvelope(
          envelope,
          pairing,
          this.persisted.privateKey,
        );
      } catch (error) {
        if (error instanceof OtpCryptoError) {
          await this.rejectEnvelope(envelope, error.code);
        }
        return;
      }

      let isNew = false;
      if (!this.persisted.cards.some((card) => card.id === envelope.messageId)) {
        const receivedAt = firstValidIsoString(
          payload.receivedAt,
          envelope.receivedAt,
          new Date().toISOString(),
        );
        this.persisted.cards.unshift({
          id: envelope.messageId,
          code: payload.code,
          source: payload.source,
          receivedAt,
        });
        this.persisted.cards.sort(
          (left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt),
        );
        this.removeOldCards();
        this.save();
        isNew = true;
        this.lastMessageReceivedAt = new Date().toISOString();
        if (this.persisted.autoCopyEnabled) this.copyText(payload.code);
        this.emitState();
        this.emit("new-message", envelope.messageId);
      }

      await this.api.acknowledge(
        pairing.serviceBaseUrl,
        pairing.deviceCredential,
        envelope.messageId,
        "displayed",
      );
      if (!isNew) this.emitState();
    } finally {
      this.processingIds.delete(envelope?.messageId);
    }
  }

  async rejectEnvelope(envelope, reason) {
    const pairing = this.persisted.pairing;
    if (!pairing || typeof envelope?.messageId !== "string") return;
    try {
      await this.api.acknowledge(
        pairing.serviceBaseUrl,
        pairing.deviceCredential,
        envelope.messageId,
        "rejected",
        reason,
      );
    } catch {
      // A failed rejection acknowledgement is retried by the server's offline queue.
    }
  }

  clearLocalPairing() {
    this.pairingGeneration += 1;
    this.stopStream();
    this.persisted.pairing = null;
    this.persisted.cards = [];
    this.pendingSession = null;
    this.pendingAndroidName = null;
    this.qrDataUrl = null;
    this.pairingExpiresAt = null;
    this.save();
    this.setConnectionState("unpaired");
  }

  removeOldCards() {
    const cutoff = Date.now() - HISTORY_RETENTION_MS;
    this.persisted.cards = this.persisted.cards.filter((card) => {
      const receivedAt = Date.parse(card.receivedAt);
      return Number.isFinite(receivedAt) && receivedAt >= cutoff;
    });
  }

  save() {
    this.secureStore.save(this.persisted);
  }

  setConnectionState(value) {
    this.connectionState = value;
    this.failureMessage = null;
    this.emitState();
  }

  setFailure(message) {
    this.connectionState = "failed";
    this.failureMessage = message;
    this.emitState();
  }

  connectionLabel() {
    switch (this.connectionState) {
      case "creatingQR":
        return "正在生成配对二维码";
      case "waitingForAndroid":
        return "等待 Android 扫码";
      case "waitingForApproval":
        return `等待确认：${this.pendingAndroidName || "Android 设备"}`;
      case "connected":
        return "已连接";
      case "reconnecting":
        return "正在重连";
      case "failed":
        return this.failureMessage || "暂时无法使用";
      default:
        return "尚未配对";
    }
  }

  emitState() {
    this.emit("state", this.getPublicState());
  }
}

function firstValidIsoString(...values) {
  for (const value of values) {
    if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
      return new Date(value).toISOString();
    }
  }
  return new Date().toISOString();
}

function hostname(value) {
  try {
    return value ? new URL(value).hostname : null;
  } catch {
    return null;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

module.exports = { AppController };
