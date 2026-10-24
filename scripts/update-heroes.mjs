import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const previous = JSON.parse(
  await fs.readFile(path.join(root, "src/heroes.json"), "utf8"),
);
const response = await fetch("https://statlocker.gg/api/info/heroes-full");
if (!response.ok)
  throw Error(
    `Hero catalogue returned HTTP ${response.status}. Existing assets were kept.`,
  );
const all = await response.json();
const manifestResponse = await fetch(
  "https://cdn.vlviewer.com/deadlock/manifest.json",
);
if (!manifestResponse.ok)
  throw Error("Voice manifest unavailable; existing catalogue retained.");
const manifest = await manifestResponse.json();
const voiceVersion = manifest.versions.find(
  (v) => v.id === manifest.latestVersion,
);
const voicesResponse = await fetch(voiceVersion.voiceLineUrl);
if (!voicesResponse.ok)
  throw Error("Voice catalogue unavailable; existing catalogue retained.");
const voices = [];
function walk(value) {
  if (!value || typeof value !== "object") return;
  if (value.filename && value.audioKey) voices.push(value);
  else for (const child of Object.values(value)) walk(child);
}
walk(await voicesResponse.json());
const heroes = all
  .filter((h) => h.player_selectable && !h.in_development && !h.prerelease_only)
  .map((h) => ({
    id: h.id,
    name: h.name,
    image: `/heroes/${h.id}.webp`,
    source: h.images.icon_hero_card_webp,
    gloatImage: `/heroes/${h.id}-gloat.webp`,
    criticalImage: `/heroes/${h.id}-critical.webp`,
    variantSources: {
      gloat: h.images.hero_card_gloat_webp,
      critical: h.images.hero_card_critical_webp,
    },
    voiceLines: previous.find((hero) => hero.id === h.id)?.voiceLines || [],
    voiceFolder: h.class_name.replace(/^hero_/, ""),
  }));
const cards = await Promise.all(
  heroes.map(async (hero) => {
    if (
      !Number.isSafeInteger(hero.id) ||
      new URL(hero.source).hostname !== "assets-bucket.deadlock-api.com" ||
      !hero.source.startsWith("https://")
    )
      throw Error("Unexpected hero image source.");
    const r = await fetch(hero.source);
    if (!r.ok) throw Error(`${hero.name}: HTTP ${r.status}`);
    return { hero, bytes: Buffer.from(await r.arrayBuffer()) };
  }),
);
await fs.mkdir(path.join(root, "public/heroes"), { recursive: true });
await fs.mkdir(path.join(root, "public/voices"), { recursive: true });
for (const { hero, bytes } of cards)
  await fs.writeFile(path.join(root, `public/heroes/${hero.id}.webp`), bytes);
for (const hero of heroes) {
  for (const [variant, url] of Object.entries(hero.variantSources)) {
    if (!url || new URL(url).hostname !== "assets-bucket.deadlock-api.com")
      throw Error(`${hero.name}: missing ${variant} portrait`);
    const r = await fetch(url);
    if (!r.ok) throw Error(`${hero.name} ${variant}: HTTP ${r.status}`);
    await fs.writeFile(
      path.join(root, `public/heroes/${hero.id}-${variant}.webp`),
      Buffer.from(await r.arrayBuffer()),
    );
  }
  if (!hero.voiceLines.length) {
    const folder = hero.voiceFolder;
    const selected = voices
      .filter((v) =>
        new RegExp(`^${folder}/${folder}_select_\\d+\\.mp3$`).test(v.filename),
      )
      .slice(0, 4);
    for (const [i, voice] of selected.entries()) {
      const url = new URL(voice.audioKey, manifest.sharedAudioBaseUrl);
      if (url.hostname !== "cdn.vlviewer.com" || url.protocol !== "https:")
        throw Error("Unexpected voice source.");
      const r = await fetch(url);
      if (!r.ok) throw Error(`${hero.name} voice: HTTP ${r.status}`);
      const filename = `/voices/${hero.id}-select-${i + 1}.mp3`;
      await fs.writeFile(
        path.join(root, "public", filename),
        Buffer.from(await r.arrayBuffer()),
      );
      hero.voiceLines.push(filename);
    }
  }
  delete hero.voiceFolder;
}
await fs.writeFile(
  path.join(root, "src/heroes.json"),
  JSON.stringify(heroes, null, 2) + "\n",
);
console.log(
  `Updated ${heroes.length} hero cards. Run npm run build before deployment.`,
);
const missing = heroes.filter((hero) => !hero.voiceLines.length);
if (missing.length)
  console.warn(
    "Add verified hero-select voice URLs for: " +
      missing.map((hero) => hero.name).join(", "),
  );
