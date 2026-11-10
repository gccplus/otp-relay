"use strict";

function pingWithTimeout(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let completed = false;
    const done = (error) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      socket.off("pong", onPong);
      socket.off("close", onClose);
      socket.off("error", onError);
      if (error) reject(error);
      else resolve();
    };
    const onPong = () => done();
    const onClose = () => done(new Error("Socket closed during ping"));
    const onError = (error) => done(error);
    const timeout = setTimeout(
      () => done(new Error("WebSocket ping timed out")),
      timeoutMs,
    );
    socket.once("pong", onPong);
    socket.once("close", onClose);
    socket.once("error", onError);
    try {
      socket.ping();
    } catch (error) {
      done(error);
    }
  });
}

module.exports = { pingWithTimeout };
