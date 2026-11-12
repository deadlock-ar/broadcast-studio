import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw Error(`${url}: HTTP ${response.status}`);
  return response.json();
}
const [manifest, heroes] = await Promise.all([
  json("https://cdn.vlviewer.com/deadlock/manifest.json"),
  fs.readFile(path.join(root, "src/heroes.json"), "utf8").then(JSON.parse),
]);
const version = manifest.versions.find((v) => v.id === manifest.latestVersion);
function walk(value, rows) {
  if (!value || typeof value !== "object") return;
  if (value.filename && value.audioKey) rows.push(value);
  else Object.values(value).forEach((child) => walk(child, rows));
}
const catalogue = await json(version.voiceLineUrl);
const normalizedName = (name) =>
  name
    .toLowerCase()
    .replace(/^the /, "")
    .replace(/[^a-z0-9]/g, "");
for (const hero of heroes) {
  const key = Object.keys(catalogue).find(
    (key) => normalizedName(key) === normalizedName(hero.name),
  );
  if (!key) throw Error(`No game voice character for ${hero.name}`);
  const rows = [];
  walk(catalogue[key], rows);
  hero.banVoiceLines = rows
    .filter((voice) => /_unselect_\d+\.mp3$/.test(voice.filename))
    .slice(0, 4)
    .map((voice) => ({
      filename: voice.filename,
      url: new URL(voice.audioKey, manifest.sharedAudioBaseUrl).href,
    }));
  // Sinclair has selection recordings, but no verified unselect recording in this catalogue.
  if (!hero.banVoiceLines.length && hero.id !== 60)
    throw Error(`No deselection clips for ${hero.name}`);
}
// Verify every clip before replacing the catalogue. A partial fetch leaves it intact.
for (let offset = 0; offset < heroes.length; offset += 6) {
  await Promise.all(
    heroes.slice(offset, offset + 6).flatMap((hero) =>
      hero.banVoiceLines.map(async (voice) => {
        const url = new URL(voice.url);
        if (url.protocol !== "https:" || url.hostname !== "cdn.vlviewer.com")
          throw Error("Unexpected voice source");
        const response = await fetch(url);
        if (
          !response.ok ||
          !response.headers.get("content-type")?.startsWith("audio/")
        )
          throw Error(`${voice.filename}: unavailable audio`);
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength < 1000)
          throw Error(`${voice.filename}: empty audio`);
      }),
    ),
  );
}
await fs.writeFile(
  path.join(root, "src/heroes.json"),
  JSON.stringify(heroes, null, 2) + "\n",
);
console.log(
  `Verified ${heroes.reduce((n, hero) => n + hero.banVoiceLines.length, 0)} game deselection clips for ${heroes.length} heroes (${version.id}).`,
);
console.log(
  `No verified deselection audio: ${
    heroes
      .filter((hero) => !hero.banVoiceLines.length)
      .map((hero) => hero.name)
      .join(", ") || "none"
  }.`,
);
