"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { SecureStore } = require("../src/core/secure-store");

test("persists secrets only inside the protected payload", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "otp-relay-store-"));
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`protected:${value}`, "utf8"),
    decryptString: (value) => value.toString("utf8").slice("protected:".length),
  };
  const store = new SecureStore({ safeStorage, userDataPath: directory });
  const state = store.load();
  state.pairing = {
    serviceBaseUrl: "https://otp.example.com/otp-relay",
    pairingId: "pairing-id",
    protocolVersion: 1,
    deviceCredential: "top-secret-credential",
    androidDeviceName: "Android 手机",
  };
  store.save(state);

  const raw = fs.readFileSync(path.join(directory, "secure-state.json"), "utf8");
  assert.equal(raw.includes("top-secret-credential"), false);
  assert.equal(new SecureStore({ safeStorage, userDataPath: directory }).load().pairing.deviceCredential, "top-secret-credential");
});

test("drops a stored pairing that attempts to downgrade the relay to HTTP", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "otp-relay-store-"));
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, "utf8"),
    decryptString: (value) => value.toString("utf8"),
  };
  const store = new SecureStore({ safeStorage, userDataPath: directory });
  const state = store.load();
  state.pairing = {
    serviceBaseUrl: "http://relay.example.test/otp-relay",
    pairingId: "pairing-id",
    protocolVersion: 1,
    deviceCredential: "credential",
    androidDeviceName: "Android 手机",
  };
  store.save(state);

  assert.equal(store.load().pairing, null);
});

test("backs up unreadable DPAPI ciphertext and creates a fresh local identity", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "otp-relay-store-"));
  let rejectExistingCiphertext = false;
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`current:${value}`, "utf8"),
    decryptString: (value) => {
      const text = value.toString("utf8");
      if (rejectExistingCiphertext && text.startsWith("old-user:")) {
        throw new Error("Error while decrypting the ciphertext provided to safeStorage.decryptString");
      }
      return text.slice(text.indexOf(":") + 1);
    },
  };
  const filePath = path.join(directory, "secure-state.json");
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      version: 1,
      protectedData: Buffer.from(
        `old-user:${JSON.stringify({ deviceId: "old-device" })}`,
        "utf8",
      ).toString("base64"),
    }),
    "utf8",
  );
  rejectExistingCiphertext = true;

  const store = new SecureStore({ safeStorage, userDataPath: directory });
  const state = store.load();
  const recovery = store.getRecoveryInfo();

  assert.notEqual(state.deviceId, "old-device");
  assert.equal(state.pairing, null);
  assert.ok(recovery);
  assert.equal(fs.existsSync(recovery.backupPath), true);
  assert.equal(fs.existsSync(filePath), true);
  assert.equal(new SecureStore({ safeStorage, userDataPath: directory }).load().deviceId, state.deviceId);
});
