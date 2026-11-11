export const PANEL_VIEWPORT = { width: 1920, height: 1080 };

export function fitPanelPlacement(panel, measured) {
  const width = Math.max(1, measured.width);
  const height = Math.max(1, measured.height);
  const requestedScale =
    Number.isFinite(panel.scale) && panel.scale > 0 ? panel.scale : 1;
  const scale = Math.min(
    requestedScale,
    PANEL_VIEWPORT.width / width,
    PANEL_VIEWPORT.height / height,
  );
  const renderedWidth = width * scale;
  const renderedHeight = height * scale;
  const maxLeft = Math.max(0, PANEL_VIEWPORT.width - renderedWidth);
  const maxTop = Math.max(0, PANEL_VIEWPORT.height - renderedHeight);
  const finite = (value) => (Number.isFinite(value) ? value : 0);
  let left, top;
  if (panel.position === "custom") {
    left = finite(panel.x);
    top = finite(panel.y);
  } else if (panel.position === "center") {
    left = maxLeft / 2;
    top = maxTop / 2;
  } else {
    left = panel.position?.endsWith("left") ? 32 : maxLeft - 32;
    top = panel.position?.startsWith("top") ? 32 : maxTop - 32;
  }
  return {
    left: Math.max(0, Math.min(maxLeft, left)),
    top: Math.max(0, Math.min(maxTop, top)),
    scale,
    width: renderedWidth,
    height: renderedHeight,
  };
}
