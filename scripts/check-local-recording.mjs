import { collectLocal } from "../collector/local-reader.mjs";
import { writeFile } from "node:fs/promises";
let samples = 0,
  complete = 0,
  latest,
  bridgeObserved = false;
const stages = [];
const result = await collectLocal(
  { file: process.argv[2], fixture: true, fromStart: false },
  (snapshot) => {
    if (!snapshot.frame) return;
    samples++;
    if (snapshot.frame.players.length === 12) complete++;
    latest = structuredClone(snapshot);
    if (snapshot.frame.players.some((p) => p.bridgeBuffs?.length))
      bridgeObserved = true;
    if (samples % 200 === 0)
      stages.push({
        tick: snapshot.frame.tick,
        clock: snapshot.frame.duration,
        players: snapshot.frame.players.length,
      });
  },
);
const report = {
  ...result,
  samples,
  complete,
  bridgeObserved,
  stages,
  players: latest.frame.players.map((p) => ({
    id: p.id,
    name: p.name,
    damage: p.damage,
    souls: p.souls,
    buffs: p.buffs,
  })),
  purchases: latest.items.purchases,
  reviewCount: latest.items.reviewCount,
};
if (process.argv[3])
  await writeFile(process.argv[3], JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    ...report,
    players: report.players.slice(0, 2),
    purchases: report.purchases.filter((p) => p.playerName === "okey"),
  }),
);
