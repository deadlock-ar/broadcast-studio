import { useLayoutEffect, useRef } from "react";
import { fitPanelPlacement } from "./panel-position.js";

export function usePanelPlacement(panel) {
  const ref = useRef(null);
  const { position, scale, x, y, width, fontSize } = panel;
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let disposed = false;
    const fit = () => {
      if (disposed) return;
      const computed = getComputedStyle(element);
      const number = (property) => parseFloat(computed[property]) || 0;
      const borderBox = computed.boxSizing === "border-box";
      const measuredWidth = Math.ceil(
        Math.max(
          element.offsetWidth,
          number("width") +
            (borderBox
              ? 0
              : number("paddingLeft") +
                number("paddingRight") +
                number("borderLeftWidth") +
                number("borderRightWidth")),
        ),
      );
      const measuredHeight = Math.ceil(
        Math.max(
          element.offsetHeight,
          number("height") +
            (borderBox
              ? 0
              : number("paddingTop") +
                number("paddingBottom") +
                number("borderTopWidth") +
                number("borderBottomWidth")),
        ),
      );
      if (!measuredWidth || !measuredHeight) return;
      const fitted = fitPanelPlacement(
        { position, scale, x, y },
        { width: measuredWidth, height: measuredHeight },
      );
      element.style.setProperty("--panel-fit-left", `${fitted.left}px`);
      element.style.setProperty("--panel-fit-top", `${fitted.top}px`);
      element.style.setProperty("--panel-fit-scale", fitted.scale);
    };
    // Fit before the transition parent measures its entry/exit distance.
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    document.fonts?.ready.then(fit);
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [position, scale, x, y, width, fontSize]);
  return ref;
}
