const CANVAS = { width: 1920, height: 1080 };

// Measure in broadcast coordinates, including the panel's own scale, while
// excluding the wrapper's current slide and the browser-source preview scale.
export function panelBounds(canvas, panel) {
  const scaleX = canvas.width / CANVAS.width || 1;
  const scaleY = canvas.height / CANVAS.height || 1;
  return {
    left: (panel.left - canvas.left) / scaleX,
    top: (panel.top - canvas.top) / scaleY,
    width: panel.width / scaleX,
    height: panel.height / scaleY,
  };
}

export function panelSlide(bounds) {
  const { left, top, width, height } = bounds;
  const edges = [
    { edge: "left", distance: left, x: -Math.max(24, left + width + 24), y: 0 },
    {
      edge: "right",
      distance: CANVAS.width - left - width,
      x: Math.max(24, CANVAS.width - left + 24),
      y: 0,
    },
    { edge: "top", distance: top, x: 0, y: -Math.max(24, top + height + 24) },
    {
      edge: "bottom",
      distance: CANVAS.height - top - height,
      x: 0,
      y: Math.max(24, CANVAS.height - top + 24),
    },
  ];
  return edges.reduce((nearest, edge) =>
    edge.distance < nearest.distance ? edge : nearest,
  );
}
