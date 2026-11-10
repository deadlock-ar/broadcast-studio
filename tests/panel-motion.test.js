import test from "node:test";
import assert from "node:assert/strict";
import { panelBounds, panelSlide } from "../src/panel-motion.js";

test("corner and custom placements slide fully past their nearest canvas edge", () => {
  const cases = [
    [{ left: 1248, top: 32, width: 640, height: 530 }, "right"],
    [{ left: 32, top: 518, width: 640, height: 530 }, "left"],
    [{ left: 700, top: 40, width: 500, height: 250 }, "top"],
    [{ left: 700, top: 810, width: 500, height: 250 }, "bottom"],
    [{ left: 640, top: 290, width: 640, height: 500 }, "top"],
  ];
  for (const [bounds, expected] of cases) {
    const slide = panelSlide(bounds);
    assert.equal(slide.edge, expected);
    const left = bounds.left + slide.x;
    const top = bounds.top + slide.y;
    assert.ok(
      left + bounds.width <= -24 ||
        left >= 1944 ||
        top + bounds.height <= -24 ||
        top >= 1104,
      `${expected} must remove the whole panel and its shadow`,
    );
  }
});

test("scaled previews and interrupted slides preserve original panel geometry", () => {
  const panel = { left: 1248, top: 518, width: 640, height: 530 };
  for (const scale of [0.25, 0.5, 1, 1.5]) {
    for (const offset of [0, 170, -300]) {
      const canvas = {
        left: 100 + offset * scale,
        top: 60,
        width: 1920 * scale,
        height: 1080 * scale,
      };
      const measured = {
        left: canvas.left + panel.left * scale,
        top: canvas.top + panel.top * scale,
        width: panel.width * scale,
        height: panel.height * scale,
      };
      assert.deepEqual(panelBounds(canvas, measured), panel);
      assert.equal(panelSlide(panelBounds(canvas, measured)).edge, "right");
    }
  }
});
