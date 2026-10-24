import { StringTableType } from "deadem";
import { number } from "./model.mjs";

const STEAM_BASE = 76561197960265728n;
export function accountId(value) {
  try {
    const id = BigInt(String(value)) - STEAM_BASE;
    return id > 0n && id <= 4294967295n ? String(id) : null;
  } catch {
    return null;
  }
}
export function playerFor(demo, entity, includeBots = false, depth = 0) {
  if (!entity) return null;
  if (
    !["CCitadelPlayerPawn", "CCitadelPlayerController"].includes(
      entity.class.name,
    )
  ) {
    if (depth >= 4) return null;
    const owner = entity.getField("m_hOwnerEntity");
    return owner === undefined
      ? null
      : playerFor(demo, demo.getEntityByHandle(owner), includeBots, depth + 1);
  }
  const controller =
    entity.class.name === "CCitadelPlayerPawn"
      ? demo.getEntityByHandle(entity.getField("m_hController"))
      : entity;
  if (controller?.class.name !== "CCitadelPlayerController") return null;
  const slot = controller.getField("m_unLobbyPlayerSlot");
  const id =
    accountId(controller.getField("m_steamID")) ||
    (includeBots && Number.isInteger(slot) && slot >= 1 && slot <= 12
      ? String(4000000000 + slot)
      : null);
  const team = controller.getField("m_iTeamNum");
  const heroId = controller.getField("m_nHeroID");
  if (!id || !heroId || ![2, 3].includes(team)) return null;
  return {
    id,
    team: team - 2,
    heroId,
    slot: controller.getField("m_unLobbyPlayerSlot") ?? controller.index,
    name: String(controller.getField("m_iszPlayerName") ?? "").slice(0, 48),
    controller,
  };
}
export function readFrame(
  demo,
  catalog,
  tick,
  serverTick,
  endObserved = false,
  forcedWinner = null,
  options = {},
) {
  const table = demo.stringTableContainer.getByType(
    StringTableType.ACTIVE_MODIFIERS,
  );
  const known = new Map(catalog.map((item) => [item.id, item.type]));
  const buffs = new Map(),
    serials = new Set();
  for (const entry of table?.getEntries() ?? []) {
    const v = entry.value;
    const type = known.get(v?.modifierSubclass);
    if (!v || v.entryType !== 1 || !type) continue;
    const key = `${v.parent}:${v.serialNumber}`;
    if (serials.has(key)) continue;
    serials.add(key);
    const counts = buffs.get(v.parent) ?? {};
    counts[type] = (counts[type] ?? 0) + 1;
    buffs.set(v.parent, counts);
  }
  const players = [];
  for (const controller of demo.getEntitiesByClassName(
    "CCitadelPlayerController",
  )) {
    const identity = playerFor(demo, controller, options.includeBots);
    if (!identity) continue;
    const { controller: ignored, ...player } = identity;
    void ignored;
    const pawn = demo.getEntityByHandle(controller.getField("m_hHeroPawn"));
    const counts =
      table && pawn?.class.name === "CCitadelPlayerPawn"
        ? (buffs.get(pawn.handle) ?? {})
        : null;
    const scalar = (name) => number(controller.getField(name));
    players.push({
      ...player,
      buffs: counts ? Object.values(counts).reduce((s, n) => s + n, 0) : null,
      buffTypes: counts,
      damage: scalar("m_iHeroDamage"),
      healing: scalar("m_iHeroHealing"),
      souls: scalar("m_iGoldNetWorth"),
      kills: scalar("m_iPlayerKills"),
      deaths: scalar("m_iDeaths"),
      assists: scalar("m_iPlayerAssists"),
      lifeState: pawn?.getField("m_lifeState") ?? null,
    });
  }
  const rules = demo.getEntitiesByClassName("CCitadelGameRulesProxy")[0];
  const field = (name) => rules?.getField(`m_pGameRules.${name}`);
  const paused = field("m_bGamePaused") === true;
  const clock = field("m_flMatchClockAtLastUpdate");
  const clockTick = field("m_nMatchClockUpdateTick");
  const state = field("m_eGameState");
  const duration =
    Number.isFinite(clock) &&
    Number.isFinite(clockTick) &&
    Number.isFinite(serverTick)
      ? Math.max(
          0,
          clock +
            (paused || state === 6 || endObserved
              ? 0
              : Math.max(0, serverTick - clockTick) *
                (demo.server?.tickInterval ?? 1 / 64)),
        )
      : null;
  const winningTeam = field("m_iWinningTeam");
  const winner = [2, 3].includes(winningTeam) ? winningTeam - 2 : forcedWinner;
  const ended = endObserved || (state === 6 && winner !== null);
  return {
    tick,
    serverTick,
    duration: ended && duration !== null ? Math.round(duration) : duration,
    paused,
    winner,
    endObserved: ended,
    players,
  };
}
