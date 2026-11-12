import { useEffect, useRef, useState } from "react";
import {
  createSelectionTracker,
  selectionVoiceLines,
  BAN_EFFECT_DURATION_MS,
  createVoicePlayer,
  createPickFlashController,
} from "./pick-effects.js";
import heroes from "./heroes.json";

const roster = Object.fromEntries(heroes.map((hero) => [hero.id, hero]));

export function usePickEffects(
  snapshot,
  identity,
  initialSnapshots,
  config,
  overlay,
) {
  const [flashes, setFlashes] = useState({});
  const [previewSound, setPreviewSound] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const tracker = useRef(createSelectionTracker());
  const previousIdentity = useRef(identity);
  const flashController = useRef(null);
  const player = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    const voice = createVoicePlayer({
      createAudio: () => audioRef.current,
      onBlocked: setSoundBlocked,
    });
    player.current = voice;
    const flash = createPickFlashController({ onChange: setFlashes });
    flashController.current = flash;
    return () => {
      voice.dispose();
      flash.dispose();
    };
  }, []);

  useEffect(() => {
    player.current.configure({
      enabled:
        (config.voiceLines || config.banVoiceLines) &&
        (overlay || previewSound),
      volume: config.voiceVolume / 100,
    });
  }, [
    config.voiceLines,
    config.banVoiceLines,
    config.voiceVolume,
    overlay,
    previewSound,
  ]);

  useEffect(() => {
    if (previousIdentity.current !== identity) {
      previousIdentity.current = identity;
      tracker.current.reset();
      flashController.current.reset();
      player.current.clear();
    }
    const picks = tracker.current.observe(snapshot, {
      initial: initialSnapshots.current.has(snapshot),
    });
    for (const pick of picks) {
      const hero = roster[pick.heroId];
      if (
        pick.selectionType === "ban"
          ? config.banAnimation !== "none"
          : config.pickEffects
      )
        flashController.current.show(
          pick.id,
          pick.heroId,
          pick.selectionType === "ban" ? BAN_EFFECT_DURATION_MS : undefined,
        );
      const lines = selectionVoiceLines(hero, pick.selectionType, {
        voiceLines: config.voiceLines,
        banVoiceLines: config.banVoiceLines,
      });
      if (lines.length)
        player.current.enqueue(lines[Math.floor(Math.random() * lines.length)]);
    }
  }, [
    snapshot,
    identity,
    initialSnapshots,
    config.pickEffects,
    config.banAnimation,
    config.banVoiceLines,
    config.voiceLines,
  ]);

  // Warm the variants before the first pick so the crossfade has no loading gap.
  useEffect(() => {
    const images = heroes.flatMap((hero) =>
      [hero.gloatImage, hero.criticalImage].filter(Boolean).map((src) => {
        const image = new Image();
        image.src = src;
        return image;
      }),
    );
    return () =>
      images.forEach((image) => {
        image.src = "";
      });
  }, []);

  const enableSound = async () => {
    if (await player.current.unlock()) setPreviewSound(true);
  };
  const togglePreviewSound = () => {
    if (previewSound) setPreviewSound(false);
    else void enableSound();
  };
  return {
    flashes,
    previewSound,
    soundBlocked,
    enableSound,
    togglePreviewSound,
    audioRef,
  };
}
