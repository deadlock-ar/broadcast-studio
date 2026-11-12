import { writeFile, mkdir } from "node:fs/promises";
import { murmur2 } from "./hash.mjs";

const get = async (route) => {
  const response = await fetch(
    `https://api.deadlock-api.com/v1/assets/${route}`,
    { signal: AbortSignal.timeout(30000) },
  );
  if (!response.ok) throw Error(`Catalogue HTTP ${response.status}`);
  return response.json();
};
const [heroes, items, misc] = await Promise.all([
  get("heroes"),
  get("items/by-type/ability"),
  get("misc-entities"),
]);
const effects = {
  citadel_ability_psychic_lift: [2249624695],
  citadel_ability_chrono_swap: [2137908006],
  ability_guided_arrow: [1201131818],
  ability_gravity_lasso: [2311212432],
};
const ultimates = heroes
  .filter((h) => h.player_selectable && h.items?.signature4)
  .map((h) => {
    const ability = items.find((i) => i.class_name === h.items.signature4);
    if (!ability) throw Error(`Missing ultimate definition for ${h.name}`);
    return {
      id: ability.id,
      heroId: h.id,
      heroName: h.name,
      heroImage: h.images?.icon_hero_card_webp || "",
      className: ability.class_name,
      name: ability.name,
      image: ability.image_webp || ability.image || "",
      modifiers: effects[ability.class_name] ?? [],
      detection: effects[ability.class_name]
        ? "damage + validated target effect"
        : "damage only; utility effects unverified",
    };
  });
const pickups = misc
  .filter((i) => i.is_permanent_pickup === true && i.modifier?.subclass)
  .map((i) => ({
    type: i.class_name,
    id: murmur2(
      `${i.class_name}/${i.modifier.subclass.subclass_name ?? i.modifier.subclass.class_name}`,
    ),
  }));
if (ultimates.length < 30 || pickups.length < 20)
  throw Error("Incomplete catalogue; existing files were preserved.");
await mkdir(new URL("./data/", import.meta.url), { recursive: true });
await writeFile(
  new URL("./data/ultimates.json", import.meta.url),
  JSON.stringify(ultimates, null, 2),
);
await writeFile(
  new URL("./data/permanent-pickups.json", import.meta.url),
  JSON.stringify(pickups, null, 2),
);
console.log(
  `Saved ${ultimates.length} ultimate definitions and ${pickups.length} permanent pickup types. Replay-check before using a new patch on air.`,
);
