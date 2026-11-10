import type { WebSocket } from "ws";
import type { Pairing, StoredMessage } from "./protocol.js";

export class RealtimeHub {
  private readonly sockets = new Map<
    string,
    { socket: WebSocket; alive: boolean }
  >();
  private readonly heartbeat: NodeJS.Timeout;

  constructor(heartbeatIntervalMs = 15_000) {
    this.heartbeat = setInterval(() => {
      for (const [pairingId, connection] of this.sockets) {
        if (!connection.alive) {
          connection.socket.terminate();
          this.sockets.delete(pairingId);
          continue;
        }
        connection.alive = false;
        connection.socket.ping();
      }
    }, heartbeatIntervalMs);
    this.heartbeat.unref();
  }

  connect(pairing: Pairing, socket: WebSocket): void {
    const previous = this.sockets.get(pairing.pairingId);
    if (previous && previous.socket !== socket) {
      previous.socket.close(4001, "Replaced by a newer connection");
    }
    const connection = { socket, alive: true };
    this.sockets.set(pairing.pairingId, connection);
    socket.on("pong", () => {
      connection.alive = true;
    });
    socket.once("close", () => {
      if (this.sockets.get(pairing.pairingId)?.socket === socket) {
        this.sockets.delete(pairing.pairingId);
      }
    });
    socket.once("error", () => {
      if (this.sockets.get(pairing.pairingId)?.socket === socket) {
        this.sockets.delete(pairing.pairingId);
      }
    });
  }

  pushMessage(message: StoredMessage): boolean {
    return this.send(message.envelope.pairingId, {
      event: "message.available",
      data: message.envelope,
    });
  }

  revoke(pairingId: string): void {
    const connection = this.sockets.get(pairingId);
    if (!connection) return;
    if (connection.socket.readyState === connection.socket.OPEN) {
      connection.socket.send(JSON.stringify({ event: "pairing.revoked" }));
    }
    connection.socket.close(4003, "Pairing revoked");
    this.sockets.delete(pairingId);
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const connection of this.sockets.values()) {
      connection.socket.close(1001, "Server shutting down");
    }
    this.sockets.clear();
  }

  private send(pairingId: string, event: object): boolean {
    const connection = this.sockets.get(pairingId);
    if (
      !connection ||
      connection.socket.readyState !== connection.socket.OPEN
    ) {
      return false;
    }
    try {
      connection.socket.send(JSON.stringify(event), (error) => {
        if (!error) return;
        connection.socket.terminate();
        if (this.sockets.get(pairingId)?.socket === connection.socket) {
          this.sockets.delete(pairingId);
        }
      });
    } catch {
      connection.socket.terminate();
      this.sockets.delete(pairingId);
      return false;
    }
    return true;
  }
}
