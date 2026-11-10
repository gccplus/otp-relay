"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("otpRelay", {
  getState: () => ipcRenderer.invoke("otp:get-state"),
  getVersion: () => ipcRenderer.invoke("otp:get-version"),
  command: (name, payload) =>
    ipcRenderer.invoke("otp:command", { name, payload }),
  setPanelHeight: (height) => ipcRenderer.send("otp:set-panel-height", height),
  onState: (listener) => {
    const wrapped = (_event, state) => listener(state);
    ipcRenderer.on("otp:state", wrapped);
    return () => ipcRenderer.removeListener("otp:state", wrapped);
  },
});
