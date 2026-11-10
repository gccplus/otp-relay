"use strict";

const DEFAULT_DOMAIN = "otp.example.com";

function normalizeDomain(input) {
  if (typeof input !== "string") return null;
  const value = input.trim().toLowerCase();
  if (
    value.length === 0 ||
    value.length > 253 ||
    value.includes("://") ||
    value.includes("/") ||
    value.includes(":")
  ) {
    return null;
  }

  const pattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
  return pattern.test(value) ? value : null;
}

function serviceBaseUrl(domain) {
  const normalized = normalizeDomain(domain);
  return normalized ? `https://${normalized}/otp-relay` : null;
}

function webSocketUrl(baseUrl) {
  const url = new URL("v1/mac/stream", ensureTrailingSlash(baseUrl));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function apiUrl(baseUrl, path) {
  return new URL(path, ensureTrailingSlash(baseUrl)).toString();
}

function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

module.exports = {
  DEFAULT_DOMAIN,
  apiUrl,
  normalizeDomain,
  serviceBaseUrl,
  webSocketUrl,
};
