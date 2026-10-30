import { useEffect, useRef } from "react";
import heroes from "./heroes.json";
import { renderMatchBanner } from "./match-banner.js";
import "./MatchOverlay.css";

const hurtHeroes = heroes.map((hero) => ({
  ...hero,
  portrait: hero.criticalImage || hero.image,
}));

export default function MatchOverlay({ state, guide = false }) {
  const root = useRef(null);
  useEffect(() => {
    const element = root.current;
    if (!state || !element) return;
    renderMatchBanner(element, state, hurtHeroes);
    element.classList.toggle("show-guide", guide);
  }, [state, guide]);
  useEffect(() => {
    const element = root.current;
    return () => {
      element?.__bannerResizeObserver?.disconnect();
      if (element) {
        element.__bannerKey = null;
        element.replaceChildren();
      }
    };
  }, []);
  return (
    <div
      ref={root}
      hidden={!state || state.visible === false}
      aria-label="Compact tournament match overlay"
      data-format={state?.format}
    />
  );
}
