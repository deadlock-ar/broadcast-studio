import { useLayoutEffect, useRef, useState } from "react";
import { panelBounds, panelSlide } from "./panel-motion.js";
import "./PanelTransition.css";

export default function PanelTransition({
  visible = true,
  identity,
  children,
}) {
  const [retained, setRetained] = useState(() =>
    visible ? { identity, children } : null,
  );
  const node = useRef(null);
  const motion = useRef({ interrupted: null, identity });
  const motionIdentity = identity ?? retained?.identity;

  // Retain only the last displayed frame for the short exit. Incoming hidden
  // samples never replace it, and a different game cannot revive that frame.
  if (
    visible &&
    (retained?.children !== children || retained?.identity !== identity)
  )
    setRetained({ identity, children });
  else if (
    !visible &&
    retained &&
    identity &&
    retained.identity &&
    retained.identity !== identity
  )
    setRetained(null);

  useLayoutEffect(() => {
    const element = node.current;
    if (!element) return;
    const box = element.querySelector(".stat-box");
    if (!box) return;
    const slide = panelSlide(
      panelBounds(element.getBoundingClientRect(), box.getBoundingClientRect()),
    );
    const offscreen = `translate3d(${slide.x}px, ${slide.y}px, 0)`;
    const onscreen = "translate3d(0, 0, 0)";
    const from =
      motion.current.identity === motionIdentity && motion.current.interrupted
        ? motion.current.interrupted
        : visible
          ? offscreen
          : onscreen;
    motion.current = { interrupted: null, identity: motionIdentity };
    element.dataset.edge = slide.edge;
    let cancelled = false;
    const finished = () => {
      if (!visible && !cancelled) setRetained(null);
    };
    if (!element.animate) {
      queueMicrotask(finished);
      return () => {
        cancelled = true;
      };
    }
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const animation = element.animate(
      [{ transform: from }, { transform: visible ? onscreen : offscreen }],
      {
        duration: reduced ? 0 : visible ? 360 : 280,
        easing: visible
          ? "cubic-bezier(0.16, 1, 0.3, 1)"
          : "cubic-bezier(0.4, 0, 1, 1)",
        fill: "both",
      },
    );
    animation.onfinish = finished;
    return () => {
      cancelled = true;
      if (animation.playState === "running")
        motion.current.interrupted = getComputedStyle(element).transform;
      animation.onfinish = null;
      animation.cancel();
    };
  }, [visible, motionIdentity]);

  if (!visible && !retained) return null;
  return (
    <div
      className="panel-transition"
      ref={node}
      data-state={visible ? "shown" : "exiting"}
      aria-hidden={!visible}
    >
      {visible ? children : retained.children}
    </div>
  );
}
