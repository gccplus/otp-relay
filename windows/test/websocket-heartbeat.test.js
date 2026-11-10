"use strict";

const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const test = require("node:test");
const { pingWithTimeout } = require("../src/core/websocket-heartbeat");

test("a duplicate pong completes one ping exactly once and removes listeners", async () => {
  const socket = new EventEmitter();
  socket.ping = () => {
    queueMicrotask(() => {
      socket.emit("pong");
      socket.emit("pong");
    });
  };

  await pingWithTimeout(socket, 100);
  assert.equal(socket.listenerCount("pong"), 0);
  assert.equal(socket.listenerCount("close"), 0);
  assert.equal(socket.listenerCount("error"), 0);
});

test("a missing pong times out without leaving listeners behind", async () => {
  const socket = new EventEmitter();
  socket.ping = () => {};

  await assert.rejects(pingWithTimeout(socket, 5), /timed out/);
  assert.equal(socket.listenerCount("pong"), 0);
  assert.equal(socket.listenerCount("close"), 0);
  assert.equal(socket.listenerCount("error"), 0);
});
