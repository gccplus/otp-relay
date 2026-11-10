"use strict";

const path = require("node:path");
const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  safeStorage,
  screen,
  Tray,
} = require("electron");
const { AppController } = require("./core/app-controller");
const {
  PANEL_MAX_HEIGHT,
  PANEL_MIN_HEIGHT,
  PANEL_WIDTH,
  calculatePanelBounds,
} = require("./core/panel-geometry");
const { SecureStore } = require("./core/secure-store");

let tray;
let panelWindow;
let settingsWindow;
let controller;
let isQuitting = false;
let autoHideTimer;
let panelHeight = 420;
let repairingPanelGeometry = false;

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();

app.on("second-instance", () => {
  if (panelWindow) showPanel();
});

app.whenReady().then(() => {
  app.setAppUserModelId("com.otprelay.windows");
  const store = new SecureStore({
    safeStorage,
    userDataPath: app.getPath("userData"),
  });
  try {
    controller = new AppController({
      secureStore: store,
      copyText: (value) => clipboard.writeText(value),
      getLaunchAtLogin: () => app.getLoginItemSettings().openAtLogin,
      setLaunchAtLogin: (enabled) => {
        app.setLoginItemSettings({
          openAtLogin: enabled,
          path: process.execPath,
        });
      },
    });
  } catch (error) {
    dialog.showErrorBox(
      "验证码同步无法启动",
      error instanceof Error ? error.message : "本机安全存储初始化失败",
    );
    app.quit();
    return;
  }

  createPanelWindow();
  createTray();
  registerIpc();
  controller.on("state", broadcastState);
  controller.on("new-message", () => showPanelForNewMessage());
  powerMonitor.on("suspend", () => controller.suspend());
  powerMonitor.on("resume", () => controller.resume());
  controller.start();

  const recovery = store.getRecoveryInfo();
  if (recovery) {
    void dialog.showMessageBox({
      type: "warning",
      title: "本机安全状态已恢复",
      message: "旧的加密状态无法由当前 Windows 用户解密",
      detail:
        "客户端已保留原文件并重建本机密钥。为保证端到端加密安全，请重新配对 Android 手机。\n\n备份位置：" +
        recovery.backupPath,
      buttons: ["知道了"],
      defaultId: 0,
      noLink: true,
    });
  }
});

app.on("window-all-closed", (event) => event.preventDefault());
app.on("before-quit", () => {
  isQuitting = true;
  controller?.stop();
});

function createPanelWindow() {
  panelWindow = new BrowserWindow({
    width: PANEL_WIDTH,
    height: panelHeight,
    minWidth: PANEL_WIDTH,
    maxWidth: PANEL_WIDTH,
    minHeight: 190,
    maxHeight: 660,
    show: false,
    frame: false,
    useContentSize: true,
    resizable: false,
    skipTaskbar: true,
    fullscreenable: false,
    maximizable: false,
    alwaysOnTop: true,
    backgroundColor: "#f7f8fb",
    roundedCorners: true,
    webPreferences: secureWebPreferences(),
  });
  panelWindow.loadFile(path.join(__dirname, "renderer", "index.html"), {
    query: { view: "panel" },
  });
  lockWindowZoom(panelWindow);
  panelWindow.on("blur", () => {
    if (!panelWindow.webContents.isDevToolsOpened()) hidePanel();
  });
  panelWindow.on("focus", () => clearTimeout(autoHideTimer));
  panelWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      hidePanel();
    }
  });
  panelWindow.on("maximize", () => schedulePanelGeometryRepair());
  panelWindow.on("enter-full-screen", () => schedulePanelGeometryRepair());
  panelWindow.on("resize", () => {
    if (repairingPanelGeometry) return;
    const bounds = panelWindow.getBounds();
    if (bounds.width !== PANEL_WIDTH || bounds.height !== panelHeight) {
      schedulePanelGeometryRepair();
    }
  });
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) return settingsWindow;
  settingsWindow = new BrowserWindow({
    width: 520,
    height: 570,
    minWidth: 500,
    minHeight: 480,
    show: false,
    title: "验证码同步设置",
    backgroundColor: "#f4f5f8",
    autoHideMenuBar: true,
    webPreferences: secureWebPreferences(),
  });
  settingsWindow.loadFile(path.join(__dirname, "renderer", "index.html"), {
    query: { view: "settings" },
  });
  lockWindowZoom(settingsWindow);
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
  return settingsWindow;
}

function secureWebPreferences() {
  return {
    preload: path.join(__dirname, "preload.js"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  };
}

function createTray() {
  const iconPath = path.join(__dirname, "..", "assets", "tray.png");
  let trayIcon = nativeImage.createFromPath(iconPath);
  if (trayIcon.isEmpty()) {
    trayIcon = nativeImage.createFromPath(
      path.join(__dirname, "..", "assets", "icon.png"),
    );
  }
  tray = new Tray(trayIcon.resize({ width: 20, height: 20 }));
  tray.setToolTip("验证码同步");
  tray.on("click", () => {
    if (panelWindow.isVisible()) hidePanel();
    else showPanel();
  });
  tray.on("right-click", () => {
    tray.popUpContextMenu(
      Menu.buildFromTemplate([
        { label: "打开验证码面板", click: showPanel },
        { label: "偏好设置", click: showSettings },
        { type: "separator" },
        { label: "退出", click: confirmQuit },
      ]),
    );
  });
}

function registerIpc() {
  ipcMain.handle("otp:get-state", () => controller.getPublicState());
  ipcMain.handle("otp:get-version", () => app.getVersion());
  ipcMain.handle("otp:command", async (_event, request) => {
    const { name, payload } = request || {};
    switch (name) {
      case "preparePairing":
        return controller.preparePairing();
      case "approvePairing":
        return controller.decidePairing(true);
      case "rejectPairing":
        return controller.decidePairing(false);
      case "retryConnection":
        return controller.retryConnection();
      case "copyCard":
        return controller.copyCard(payload?.cardId);
      case "setAutoCopyEnabled":
        return controller.setAutoCopyEnabled(payload?.enabled);
      case "setLaunchAtLoginEnabled":
        return controller.setLaunchAtLoginEnabled(payload?.enabled);
      case "setServerDomain":
        return controller.setServerDomain(payload?.value);
      case "unpair":
        return controller.unpair();
      case "openSettings":
        return showSettings();
      case "hidePanel":
        return hidePanel();
      case "quit":
        return confirmQuit();
      default:
        throw new Error("Unsupported command");
    }
  });
  ipcMain.on("otp:set-panel-height", (_event, requestedHeight) => {
    if (
      !panelWindow ||
      typeof requestedHeight !== "number" ||
      !Number.isFinite(requestedHeight)
    ) {
      return;
    }
    panelHeight = Math.min(
      Math.max(Math.ceil(requestedHeight), PANEL_MIN_HEIGHT),
      PANEL_MAX_HEIGHT,
    );
    repairPanelGeometry();
  });
}

function broadcastState(state) {
  for (const window of [panelWindow, settingsWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send("otp:state", state);
    }
  }
}

function showPanel() {
  if (!panelWindow) return;
  clearTimeout(autoHideTimer);
  repairPanelGeometry();
  panelWindow.show();
  panelWindow.focus();
}

function hidePanel() {
  clearTimeout(autoHideTimer);
  panelWindow?.hide();
}

function showPanelForNewMessage() {
  if (!panelWindow) return;
  clearTimeout(autoHideTimer);
  repairPanelGeometry();
  panelWindow.showInactive();
  autoHideTimer = setTimeout(() => panelWindow?.hide(), 8_000);
}

function repairPanelGeometry() {
  if (!tray || !panelWindow) return;
  if (repairingPanelGeometry) {
    schedulePanelGeometryRepair();
    return;
  }
  repairingPanelGeometry = true;
  resetWindowZoom(panelWindow);
  if (panelWindow.isMinimized()) panelWindow.restore();
  if (panelWindow.isFullScreen()) panelWindow.setFullScreen(false);
  if (panelWindow.isMaximized()) panelWindow.unmaximize();

  const trayBounds = tray.getBounds();
  const display =
    trayBounds.width > 0 && trayBounds.height > 0
      ? screen.getDisplayNearestPoint({
          x: Math.round(trayBounds.x + trayBounds.width / 2),
          y: Math.round(trayBounds.y + trayBounds.height / 2),
        })
      : screen.getPrimaryDisplay();
  const bounds = calculatePanelBounds({
    trayBounds,
    workArea: display.workArea,
    requestedHeight: panelHeight,
  });
  panelWindow.setBounds(bounds, false);
  panelHeight = bounds.height;
  setImmediate(() => {
    repairingPanelGeometry = false;
  });
}

function schedulePanelGeometryRepair() {
  setImmediate(() => repairPanelGeometry());
}

function lockWindowZoom(window) {
  window.webContents.on("did-finish-load", () => resetWindowZoom(window));
  window.webContents.on("zoom-changed", (event) => {
    event.preventDefault();
    resetWindowZoom(window);
  });
  window.webContents.on("before-input-event", (event, input) => {
    if (
      input.control &&
      ["+", "=", "-", "_", "0", "Add", "Subtract"].includes(input.key)
    ) {
      event.preventDefault();
      resetWindowZoom(window);
    }
  });
}

function resetWindowZoom(window) {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
    return;
  }
  window.webContents.setZoomFactor(1);
}

function showSettings() {
  const window = createSettingsWindow();
  resetWindowZoom(window);
  window.show();
  window.focus();
}

async function confirmQuit() {
  if (!controller?.getPublicState().isPaired) {
    isQuitting = true;
    app.quit();
    return;
  }
  const result = await dialog.showMessageBox({
    type: "question",
    title: "退出验证码同步",
    message: "确认退出应用？",
    detail: "配对信息已安全保存，下次启动无需重新配对。",
    buttons: ["退出", "取消"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (result.response === 0) {
    isQuitting = true;
    app.quit();
  }
}
