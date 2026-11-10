"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { DEFAULT_DOMAIN, normalizeDomain } = require("./endpoint");
const { createPrivateKey } = require("./crypto");

const STORE_VERSION = 1;

class SecureStore {
  constructor({ safeStorage, userDataPath }) {
    this.safeStorage = safeStorage;
    this.filePath = path.join(userDataPath, "secure-state.json");
    this.recoveryInfo = null;
  }

  load() {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error("Windows DPAPI 不可用，无法安全保存本机密钥");
    }

    let stored = {};
    if (fs.existsSync(this.filePath)) {
      try {
        stored = this.readProtectedState();
      } catch {
        const backupPath = this.backupUnreadableState();
        this.recoveryInfo = { backupPath };
      }
    }

    const state = {
      deviceId:
        typeof stored.deviceId === "string" ? stored.deviceId : randomUUID(),
      privateKey:
        typeof stored.privateKey === "string"
          ? stored.privateKey
          : createPrivateKey(),
      serverDomain:
        normalizeDomain(stored.serverDomain) || DEFAULT_DOMAIN,
      autoCopyEnabled:
        typeof stored.autoCopyEnabled === "boolean"
          ? stored.autoCopyEnabled
          : true,
      pairing: validPairing(stored.pairing) ? stored.pairing : null,
      cards: Array.isArray(stored.cards) ? stored.cards.filter(validCard) : [],
    };
    this.save(state);
    return state;
  }

  save(state) {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error("Windows DPAPI 不可用，无法安全保存本机密钥");
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const plaintext = JSON.stringify(state);
    const encrypted = this.safeStorage.encryptString(plaintext);
    const verified = this.safeStorage.decryptString(encrypted);
    if (verified !== plaintext) {
      throw new Error("Windows DPAPI 写入验证失败，未保存本机密钥");
    }
    const envelope = JSON.stringify(
      {
        version: STORE_VERSION,
        protectedData: encrypted.toString("base64"),
      },
      null,
      2,
    );
    fs.writeFileSync(this.filePath, envelope, { encoding: "utf8", mode: 0o600 });
  }

  getRecoveryInfo() {
    return this.recoveryInfo;
  }

  readProtectedState() {
    const envelope = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    if (
      envelope.version !== STORE_VERSION ||
      typeof envelope.protectedData !== "string" ||
      envelope.protectedData.length === 0
    ) {
      throw new Error("本机安全存储格式不受支持");
    }
    const plaintext = this.safeStorage.decryptString(
      Buffer.from(envelope.protectedData, "base64"),
    );
    const value = JSON.parse(plaintext);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("本机安全存储内容无效");
    }
    return value;
  }

  backupUnreadableState() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    let backupPath = `${this.filePath}.unreadable-${timestamp}.bak`;
    if (fs.existsSync(backupPath)) {
      backupPath = `${this.filePath}.unreadable-${randomUUID()}.bak`;
    }
    fs.renameSync(this.filePath, backupPath);
    return backupPath;
  }
}

function validPairing(value) {
  return Boolean(
    value &&
      validServiceBaseUrl(value.serviceBaseUrl) &&
      typeof value.pairingId === "string" &&
      value.protocolVersion === 1 &&
      typeof value.deviceCredential === "string" &&
      typeof value.androidDeviceName === "string",
  );
}

function validServiceBaseUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      url.pathname.replace(/\/$/, "") === "/otp-relay"
    );
  } catch {
    return false;
  }
}

function validCard(value) {
  return Boolean(
    value &&
      typeof value.id === "string" &&
      typeof value.code === "string" &&
      typeof value.source === "string" &&
      typeof value.receivedAt === "string",
  );
}

module.exports = { SecureStore };
