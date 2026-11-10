"use strict";

const { apiUrl, webSocketUrl } = require("./endpoint");

class RelayApiError extends Error {
  constructor(status, code) {
    super(`Relay request failed: ${code} (${status})`);
    this.name = "RelayApiError";
    this.status = status;
    this.code = code;
  }
}

class RelayApi {
  constructor(fetchImplementation = globalThis.fetch) {
    this.fetch = fetchImplementation;
  }

  createPairingSession(baseUrl, body) {
    return this.request(baseUrl, "v1/pairing-sessions", {
      method: "POST",
      body,
    });
  }

  queryPairing(baseUrl, sessionId, sessionToken) {
    return this.request(baseUrl, `v1/pairing-sessions/${sessionId}`, {
      credential: sessionToken,
    });
  }

  decidePairing(baseUrl, sessionId, sessionToken, approve) {
    return this.request(
      baseUrl,
      `v1/pairing-sessions/${sessionId}/decision`,
      {
        method: "POST",
        credential: sessionToken,
        body: { decision: approve ? "approve" : "reject" },
      },
    );
  }

  acknowledge(baseUrl, credential, messageId, status, reason) {
    const body = { status };
    if (reason) body.reason = reason;
    return this.request(baseUrl, `v1/messages/${messageId}/ack`, {
      method: "POST",
      credential,
      body,
    });
  }

  revoke(baseUrl, credential) {
    return this.request(baseUrl, "v1/pairing", {
      method: "DELETE",
      credential,
    });
  }

  streamUrl(baseUrl) {
    return webSocketUrl(baseUrl);
  }

  async request(baseUrl, path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const headers = { Accept: "application/json" };
    if (options.credential) {
      headers.Authorization = `Bearer ${options.credential}`;
    }
    let body;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    try {
      const response = await this.fetch(apiUrl(baseUrl, path), {
        method: options.method || "GET",
        headers,
        body,
        signal: controller.signal,
        redirect: "error",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new RelayApiError(
          response.status,
          data?.error?.code || "HTTP_ERROR",
        );
      }
      if (!data || typeof data !== "object") {
        throw new RelayApiError(response.status, "INVALID_RESPONSE");
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = { RelayApi, RelayApiError };
