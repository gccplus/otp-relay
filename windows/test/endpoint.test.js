"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  apiUrl,
  normalizeDomain,
  serviceBaseUrl,
  webSocketUrl,
} = require("../src/core/endpoint");

test("normalizes a production domain and fixes the relay path", () => {
  assert.equal(normalizeDomain(" OTP.Example.COM "), "otp.example.com");
  assert.equal(serviceBaseUrl("otp.example.com"), "https://otp.example.com/otp-relay");
  assert.equal(
    apiUrl("https://otp.example.com/otp-relay", "v1/messages/123/ack"),
    "https://otp.example.com/otp-relay/v1/messages/123/ack",
  );
  assert.equal(
    webSocketUrl("https://otp.example.com/otp-relay"),
    "wss://otp.example.com/otp-relay/v1/mac/stream",
  );
});

test("rejects protocols, paths, ports and single-label hosts", () => {
  for (const value of [
    "https://otp.example.com",
    "otp.example.com/otp-relay",
    "otp.example.com:443",
    "localhost",
    "",
  ]) {
    assert.equal(normalizeDomain(value), null);
  }
});
