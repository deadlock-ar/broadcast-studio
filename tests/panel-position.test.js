import test from "node:test";
import assert from "node:assert/strict";
import { fitPanelPlacement, PANEL_VIEWPORT } from "../src/panel-position.js";
import { panelBounds, panelSlide } from "../src/panel-motion.js";

const inside = (bounds) => {
  assert.ok(bounds.left >= 0 && bounds.top >= 0);
  assert.ok(bounds.left + bounds.width <= PANEL_VIEWPORT.width + 1e-8);
  assert.ok(bounds.top + bounds.height <= PANEL_VIEWPORT.height + 1e-8);
};

test("a custom graph near the right edge keeps its scale and moves only far enough to fit", () => {
  const fit = fitPanelPlacement(
    { position: "custom", x: 1500, y: 740, scale: 0.68 },
    { width: 640, height: 330 },
  );
  assert.equal(fit.scale, 0.68);
  assert.equal(fit.left, 1484.8);
  assert.equal(fit.top, 740);
  inside(fit);
});

test("actual box size constrains all four custom edges across wide, tall and enlarged panels", () => {
  for (const measured of [
    { width: 240, height: 410 },
    { width: 640, height: 330 },
    { width: 640, height: 1200 },
    { width: 1880, height: 720 },
  ])
    for (const scale of [0.25, 0.68, 1, 2])
      for (const x of [-100, 0, 1500, 1919, 2500])
        for (const y of [-100, 0, 740, 1079, 1500]) {
          const fit = fitPanelPlacement(
            { position: "custom", x, y, scale },
            measured,
          );
          inside(fit);
          assert.ok(fit.scale <= scale);
          if (measured.width * scale <= 1920 && measured.height * scale <= 1080)
            assert.equal(fit.scale, scale);
        }
});

test("presets retain their anchors and oversized content fits before entry and after return", () => {
  for (const position of [
    "top-left",
    "top-right",
    "bottom-left",
    "bottom-right",
    "center",
  ]) {
    const regular = fitPanelPlacement(
      { position, scale: 0.75 },
      { width: 640, height: 330 },
    );
    inside(regular);
    assert.equal(regular.scale, 0.75);
    if (position === "center") {
      assert.equal(regular.left + regular.width / 2, 960);
      assert.equal(regular.top + regular.height / 2, 540);
    }
    const fit = fitPanelPlacement(
      { position, scale: 2 },
      { width: 1880, height: 1400 },
    );
    inside(fit);
    for (const previewScale of [0.25, 0.75, 1]) {
      const measured = panelBounds(
        {
          left: 50,
          top: 80,
          width: 1920 * previewScale,
          height: 1080 * previewScale,
        },
        {
          left: 50 + fit.left * previewScale,
          top: 80 + fit.top * previewScale,
          width: fit.width * previewScale,
          height: fit.height * previewScale,
        },
      );
      inside(measured);
      const slide = panelSlide(measured);
      assert.ok(
        measured.left + slide.x + measured.width <= -23.999999 ||
          measured.left + slide.x >= 1943.999999 ||
          measured.top + slide.y + measured.height <= -23.999999 ||
          measured.top + slide.y >= 1103.999999,
      );
      // Entry ends and exit starts at an unchanged fitted box.
      assert.ok(Math.abs(measured.width - fit.width) < 1e-8);
      assert.ok(Math.abs(measured.height - fit.height) < 1e-8);
    }
  }
});
