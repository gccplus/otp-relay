"use strict";

const PANEL_WIDTH = 420;
const PANEL_MIN_HEIGHT = 190;
const PANEL_MAX_HEIGHT = 660;
const PANEL_GAP = 8;

function calculatePanelBounds({ trayBounds, workArea, requestedHeight }) {
  const height = clamp(
    Math.ceil(requestedHeight),
    PANEL_MIN_HEIGHT,
    Math.min(PANEL_MAX_HEIGHT, workArea.height),
  );
  const width = Math.min(PANEL_WIDTH, workArea.width);
  const right = workArea.x + workArea.width;
  const bottom = workArea.y + workArea.height;

  if (!validBounds(trayBounds)) {
    return {
      x: right - width - PANEL_GAP,
      y: bottom - height - PANEL_GAP,
      width,
      height,
    };
  }

  const centerX = trayBounds.x + trayBounds.width / 2;
  const centerY = trayBounds.y + trayBounds.height / 2;
  const distances = {
    top: Math.abs(centerY - workArea.y),
    bottom: Math.abs(centerY - bottom),
    left: Math.abs(centerX - workArea.x),
    right: Math.abs(centerX - right),
  };
  const edge = Object.entries(distances).sort(
    (leftEntry, rightEntry) => leftEntry[1] - rightEntry[1],
  )[0][0];

  let x;
  let y;
  if (edge === "top") {
    x = centerX - width / 2;
    y = workArea.y + PANEL_GAP;
  } else if (edge === "bottom") {
    x = centerX - width / 2;
    y = bottom - height - PANEL_GAP;
  } else if (edge === "left") {
    x = workArea.x + PANEL_GAP;
    y = centerY - height / 2;
  } else {
    x = right - width - PANEL_GAP;
    y = centerY - height / 2;
  }

  return {
    x: Math.round(clamp(x, workArea.x, right - width)),
    y: Math.round(clamp(y, workArea.y, bottom - height)),
    width,
    height,
  };
}

function validBounds(value) {
  return Boolean(
    value &&
      Number.isFinite(value.x) &&
      Number.isFinite(value.y) &&
      Number.isFinite(value.width) &&
      Number.isFinite(value.height) &&
      value.width > 0 &&
      value.height > 0,
  );
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

module.exports = {
  PANEL_MAX_HEIGHT,
  PANEL_MIN_HEIGHT,
  PANEL_WIDTH,
  calculatePanelBounds,
};
