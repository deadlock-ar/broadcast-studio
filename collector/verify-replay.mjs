import { Worker } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import { matchId } from "./model.mjs";

const [idText, replayFile, metadataFile] = process.argv.slice(2);
const id = matchId(idText);
const reference = metadataFile
  ? JSON.parse(await readFile(metadataFile, "utf8"))
  : null;
const worker = new Worker(new URL("./worker.mjs", import.meta.url), {
  workerData: { id, replayFile, mode: "replay", replaySpeed: 0, replayFrom: 0 },
});
let frames = 0,
  hits = 0,
  effects = new Set(),
  final = null;
worker.on("message", (msg) => {
  if (msg.type === "status") console.log(msg.message);
  if (msg.type === "hit") hits++;
  if (msg.type === "frame") {
    frames++;
    for (const effect of msg.effects) effects.add(effect.abilityId);
    if (msg.frame.endObserved) final = msg.frame;
  }
});
worker.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
worker.on("exit", () => {
  const comparisons = reference?.match_info.players.map((p) => {
    const actual = final?.players.find((a) => a.id === String(p.account_id));
    const expected = p.power_up_buffs
      .filter((b) => b.is_permanent)
      .reduce((s, b) => s + b.value, 0);
    return {
      heroId: p.hero_id,
      expected,
      actual: actual?.buffs,
      kills: actual?.kills,
      expectedKills: p.kills,
      deaths: actual?.deaths,
      expectedDeaths: p.deaths,
    };
  });
  console.log(
    JSON.stringify(
      {
        frames,
        hits,
        effectAbilities: [...effects],
        final: final && {
          players: final.players.length,
          duration: final.duration,
          expectedDuration: reference?.match_info.duration_s,
          winner: final.winner,
          expectedWinner: reference?.match_info.winning_team,
        },
        comparisons,
      },
      null,
      2,
    ),
  );
  if (
    !final ||
    comparisons?.some(
      (c) =>
        c.actual !== c.expected ||
        c.kills !== c.expectedKills ||
        c.deaths !== c.expectedDeaths,
    )
  )
    process.exitCode = 1;
});
