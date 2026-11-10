"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  PANEL_WIDTH,
  calculatePanelBounds,
} = require("../src/core/panel-geometry");

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

test("keeps a bottom-taskbar panel compact and inside the work area", () => {
  const result = calculatePanelBounds({
    trayBounds: { x: 1770, y: 1040, width: 24, height: 40 },
    workArea,
    requestedHeight: 310,
  });

  assert.equal(result.width, PANEL_WIDTH);
  assert.equal(result.height, 310);
  assert.equal(result.y, 722);
  assert.ok(result.x >= 0 && result.x + result.width <= 1920);
});

test("supports top, left and right taskbars without changing panel width", () => {
  const cases = [
    { x: 1500, y: -40, width: 24, height: 40 },
    { x: -48, y: 700, width: 48, height: 24 },
    { x: 1920, y: 700, width: 48, height: 24 },
  ];

  for (const trayBounds of cases) {
    const result = calculatePanelBounds({
      trayBounds,
      workArea,
      requestedHeight: 420,
    });
    assert.equal(result.width, PANEL_WIDTH);
    assert.ok(result.x >= 0 && result.x + result.width <= 1920);
    assert.ok(result.y >= 0 && result.y + result.height <= 1040);
  }
});

test("falls back to the bottom-right when Windows does not expose tray bounds", () => {
  assert.deepEqual(
    calculatePanelBounds({
      trayBounds: { x: 0, y: 0, width: 0, height: 0 },
      workArea,
      requestedHeight: 9999,
    }),
    { x: 1492, y: 372, width: 420, height: 660 },
  );
});
