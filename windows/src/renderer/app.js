"use strict";

const api = window.otpRelay;
const root = document.getElementById("app");
const view = new URLSearchParams(window.location.search).get("view") || "panel";
document.body.dataset.view = view;
let state;
let version = "0.1.2";
let selectedCardId = null;
let latestCardId = null;
let expandedList = false;
let copiedCardId = null;
let showUnpairConfirmation = false;

Promise.all([api.getState(), api.getVersion()]).then(([initialState, appVersion]) => {
  state = initialState;
  version = appVersion;
  syncCardSelection();
  render();
});

api.onState((nextState) => {
  state = nextState;
  syncCardSelection();
  render();
});

setInterval(() => {
  if (state) render();
}, 1_000);

document.addEventListener("keydown", (event) => {
  if (
    view === "panel" &&
    event.ctrlKey &&
    event.shiftKey &&
    event.key.toLowerCase() === "c"
  ) {
    const card = state?.cards.find((item) => item.id === selectedCardId);
    if (card) {
      event.preventDefault();
      copyCard(card.id);
    }
  }
});

function render() {
  if (!state) return;
  root.replaceChildren(view === "settings" ? settingsView() : panelView());
  if (view === "panel") {
    requestAnimationFrame(() => {
      api.setPanelHeight(root.firstElementChild?.getBoundingClientRect().height || 190);
    });
  }
}

function panelView() {
  return h("section", { className: "panel-shell" }, [
    appHeader(),
    h("div", { className: "panel-content" }, [panelContent()]),
  ]);
}

function appHeader() {
  return h("header", { className: "app-header" }, [
    h("div", { className: "brand" }, [
      h("div", { className: "brand-mark", ariaLabel: "验证码" }, ["•••"]),
      h("div", { className: "brand-title" }, ["验证码同步"]),
    ]),
    h("div", { className: "status-pill", title: state.connectionLabel }, [
      h("span", {
        className: `status-dot ${state.connectionState}`,
      }),
      h("span", {}, [state.connectionLabel]),
    ]),
  ]);
}

function panelContent() {
  switch (state.connectionState) {
    case "connected":
      return state.cards.length > 0
        ? codeList()
        : statusView("✓", "正在等待验证码", "Android 收到验证码短信后\n会安全地显示在这里");
    case "reconnecting":
      return statusView("↻", "正在重新连接", "恢复后会继续接收新验证码", {
        label: "立即重试",
        action: () => command("retryConnection"),
      });
    case "creatingQR":
      return h("div", { className: "center-state" }, [
        h("div", { className: "spinner" }),
        h("h2", { className: "state-title" }, ["正在生成配对二维码…"]),
        h("p", { className: "state-detail" }, ["请稍候"]),
      ]);
    case "waitingForAndroid":
      return qrPairingView(false);
    case "waitingForApproval":
      return approvalView(false);
    case "failed":
      return statusView("!", "暂时无法使用", state.failureMessage || "请稍后重试", {
        label: "重试",
        action: () => command("retryConnection"),
      });
    default:
      return statusView("↗", "尚未配对", "配对 Android 手机后\n自动同步验证码到本机", {
        label: "开始配对",
        action: () => command("preparePairing"),
      });
  }
}

function statusView(icon, title, detail, action) {
  const children = [
    h("div", { className: "round-icon", ariaHidden: "true" }, [icon]),
    h("h2", { className: "state-title" }, [title]),
    h("p", { className: "state-detail" }, [detail]),
  ];
  if (action) {
    children.push(
      h("button", { className: "primary-button", onClick: action.action }, [
        action.label,
      ]),
    );
  }
  return h("div", { className: "center-state" }, children);
}

function qrPairingView(isSettings) {
  return h("div", { className: isSettings ? "settings-pairing" : "center-state" }, [
    h("h2", { className: "state-title" }, [
      isSettings ? "连接 Android 手机" : "扫描二维码配对",
    ]),
    isSettings
      ? h("p", { className: "state-detail" }, ["打开 Android 客户端，扫描下方二维码"])
      : null,
    h("div", { className: "qr-card" }, [
      state.qrDataUrl
        ? h("img", { src: state.qrDataUrl, alt: "Android 配对二维码" })
        : h("div", { className: "spinner" }),
    ]),
    h("div", { className: "secure-line" }, [
      h("span", { className: "secure-dot" }),
      h("span", {}, [`${state.activeServerDomain} · 加密连接`]),
    ]),
    state.pairingExpiresAt
      ? h("div", { className: "countdown" }, [
          `二维码 ${remainingTime(state.pairingExpiresAt)} 后失效`,
        ])
      : null,
    h("button", {
      className: isSettings ? "secondary-button" : "text-button",
      onClick: () => command("preparePairing"),
    }, ["重新生成"]),
  ]);
}

function approvalView(isSettings) {
  return h("div", { className: isSettings ? "settings-pairing" : "center-state" }, [
    h("div", { className: "round-icon", ariaHidden: "true" }, ["▯"]),
    h("h2", { className: "state-title" }, ["确认配对"]),
    h("div", { className: "row-title" }, [
      state.connectionLabel.replace(/^等待确认：/, ""),
    ]),
    h("p", { className: "state-detail" }, [
      "该设备识别到的验证码将\n端到端加密发送至本机",
    ]),
    h("div", { className: "button-row" }, [
      h("button", {
        className: "secondary-button",
        onClick: () => command("rejectPairing"),
      }, ["拒绝"]),
      h("button", {
        className: "primary-button",
        onClick: () => command("approvePairing"),
      }, ["允许配对"]),
    ]),
  ]);
}

function codeList() {
  const displayedCards = expandedList ? state.cards : state.cards.slice(0, 3);
  const rows = displayedCards.map((card) =>
    card.id === selectedCardId ? expandedCard(card) : compactCard(card),
  );
  if (state.cards.length > 3) {
    rows.push(
      h("button", {
        className: "expand-row",
        onClick: (event) => {
          event.stopPropagation();
          expandedList = !expandedList;
          if (!expandedList) selectedCardId = state.cards[0]?.id || null;
          render();
        },
      }, [expandedList ? "收起列表 ︿" : `展开另外 ${state.cards.length - 3} 条 ﹀`]),
    );
  }
  return h("div", {
    className: "code-list",
    onClick: () => {
      selectedCardId = null;
      render();
    },
  }, rows);
}

function expandedCard(card) {
  return h("article", {
    className: "code-card expanded",
    onClick: (event) => {
      event.stopPropagation();
      selectedCardId = null;
      render();
    },
  }, [
    h("div", { className: "card-heading" }, [
      h("span", { className: "source-name" }, [card.source]),
      h("time", { className: "relative-time" }, [relativeTime(card.receivedAt)]),
    ]),
    h("div", { className: "code-action-row" }, [
      h("span", { className: "otp-code" }, [displayCode(card.code)]),
      h("span", { className: "shortcut" }, ["Ctrl ⇧ C"]),
      h("button", {
        className: "copy-button",
        onClick: (event) => {
          event.stopPropagation();
          copyCard(card.id);
        },
      }, [copiedCardId === card.id ? "已复制" : "复制"]),
    ]),
  ]);
}

function compactCard(card) {
  return h("article", {
    className: "code-card compact-card",
    onClick: (event) => {
      event.stopPropagation();
      selectedCardId = card.id;
      render();
    },
  }, [
    h("span", { className: "source-name" }, [card.source]),
    h("span", { className: "compact-code" }, [displayCode(card.code)]),
    h("time", { className: "relative-time" }, [relativeTime(card.receivedAt)]),
  ]);
}

function settingsView() {
  return h("section", { className: "settings-shell" }, [
    h("h1", { className: "settings-title" }, ["验证码同步设置"]),
    h("div", { className: "settings-card" }, [
      settingsPairingSection(),
      showUnpairConfirmation ? unpairConfirmation() : null,
      toggleRow(
        "自动复制验证码",
        "收到新验证码时自动复制到剪贴板",
        state.autoCopyEnabled,
        (enabled) => command("setAutoCopyEnabled", { enabled }),
      ),
      toggleRow(
        "开机自动启动",
        state.isPaired ? "登录 Windows 后保持同步" : "登录 Windows 后保持应用运行",
        state.launchAtLoginEnabled,
        (enabled) => command("setLaunchAtLoginEnabled", { enabled }),
      ),
      serverRow(),
      settingsRow("版本", null, h("span", { className: "row-value" }, [version])),
    ]),
  ]);
}

function settingsPairingSection() {
  if (state.isPaired) {
    return settingsRow(
      "已配对设备",
      state.pairedDeviceName || "Android 手机",
      h("button", {
        className: "secondary-button",
        onClick: () => {
          showUnpairConfirmation = true;
          render();
        },
      }, ["解除配对"]),
      true,
    );
  }
  if (state.connectionState === "creatingQR") {
    return h("div", { className: "settings-pairing" }, [
      h("div", { className: "spinner" }),
      h("p", { className: "state-detail" }, ["正在生成配对二维码…"]),
    ]);
  }
  if (state.connectionState === "waitingForAndroid") return qrPairingView(true);
  if (state.connectionState === "waitingForApproval") return approvalView(true);
  return settingsRow(
    "配对设备",
    state.connectionState === "failed"
      ? state.failureMessage
      : "尚未连接 Android 手机",
    h("button", {
      className: "primary-button",
      onClick: () => command("preparePairing"),
    }, ["开始配对"]),
    true,
  );
}

function unpairConfirmation() {
  return h("div", { className: "confirm-box" }, [
    h("div", { className: "row-title" }, ["确认解除配对？"]),
    h("p", {}, ["Android 将停止同步，本机和云端配对凭证会立即失效"]),
    h("div", { className: "button-row" }, [
      h("button", {
        className: "secondary-button",
        onClick: () => {
          showUnpairConfirmation = false;
          render();
        },
      }, ["取消"]),
      h("button", {
        className: "danger-button",
        onClick: () => {
          showUnpairConfirmation = false;
          command("unpair");
        },
      }, ["确认解除"]),
    ]),
  ]);
}

function toggleRow(title, detail, enabled, action) {
  return settingsRow(
    title,
    detail,
    h("button", {
      className: `switch ${enabled ? "on" : ""}`,
      role: "switch",
      ariaChecked: String(enabled),
      ariaLabel: title,
      onClick: () => action(!enabled),
    }),
  );
}

function serverRow() {
  const control = state.isPaired
    ? h("span", { className: "row-value" }, [state.activeServerDomain])
    : h("input", {
        className: "domain-input",
        value: state.serverDomain,
        placeholder: "otp.example.com",
        ariaLabel: "云端服务域名",
        onChange: (event) =>
          command("setServerDomain", { value: event.target.value }),
        onKeyDown: (event) => {
          if (event.key === "Enter") event.target.blur();
        },
      });
  const detail = state.isPaired
    ? "端到端加密；解除配对后可修改"
    : "仅填写域名，不包含协议或路径";
  const row = settingsRow("云端服务", detail, control);
  if (!state.isPaired && state.serverDomainError) {
    row.classList.add("stacked");
    row.appendChild(h("div", { className: "row-error" }, [state.serverDomainError]));
  }
  return row;
}

function settingsRow(title, detail, control, withPhoneIcon = false) {
  return h("div", { className: "settings-row" }, [
    withPhoneIcon
      ? h("div", { className: "phone-icon", ariaHidden: "true" }, ["▯"])
      : null,
    h("div", { className: "row-copy" }, [
      h("div", { className: "row-title" }, [title]),
      detail ? h("div", { className: "row-detail" }, [detail]) : null,
    ]),
    control,
  ]);
}

function syncCardSelection() {
  const firstId = state.cards[0]?.id || null;
  if (firstId && latestCardId !== firstId) {
    latestCardId = firstId;
    selectedCardId = firstId;
  } else if (selectedCardId && !state.cards.some((card) => card.id === selectedCardId)) {
    selectedCardId = firstId;
  }
}

function copyCard(cardId) {
  copiedCardId = cardId;
  command("copyCard", { cardId });
  render();
  setTimeout(() => {
    if (copiedCardId === cardId) {
      copiedCardId = null;
      render();
    }
  }, 1_500);
}

function displayCode(value) {
  const compact = value.replaceAll(" ", "");
  if (!/^\d+$/.test(compact)) return compact;
  if (compact.length === 6) return `${compact.slice(0, 3)} ${compact.slice(3)}`;
  if (compact.length === 8) return `${compact.slice(0, 4)} ${compact.slice(4)}`;
  return compact;
}

function relativeTime(value) {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1_000));
  if (seconds < 10) return "刚刚";
  if (seconds < 60) return `${seconds}秒前`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}分钟前`;
  return `${Math.floor(seconds / 3_600)}小时前`;
}

function remainingTime(value) {
  const seconds = Math.max(0, Math.floor((Date.parse(value) - Date.now()) / 1_000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function command(name, payload) {
  return api.command(name, payload).catch(() => undefined);
}

function h(tag, attributes = {}, children = []) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    if (key === "className") element.className = value;
    else if (key.startsWith("on") && typeof value === "function") {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "ariaLabel") element.setAttribute("aria-label", value);
    else if (key === "ariaHidden") element.setAttribute("aria-hidden", value);
    else if (key === "ariaChecked") element.setAttribute("aria-checked", value);
    else if (key === "role") element.setAttribute("role", value);
    else if (key === "value") element.value = value;
    else element.setAttribute(key, value);
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}
