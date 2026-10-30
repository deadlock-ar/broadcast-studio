import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanBracket,
  generateBracket,
  setBracketResult,
  recordBracketGame,
  bracketMatch,
  bracketOutput,
  winsRequired,
} from "../src/bracket.js";

const teams = (count) =>
  Array.from({ length: count }, (_, index) => ({
    id: `team-${index + 1}`,
    name: `Team ${index + 1}`,
    players: [
      {
        id: `person-${index + 1}`,
        name: `Player ${index + 1}`,
        steamId: "76561198000000000",
      },
    ],
  }));

test("seeded brackets separate top seeds, award the highest seeds byes and wait for unresolved opponents", () => {
  const bracket = generateBracket(teams(5));
  assert.deepEqual(bracket.slots, [
    "team-1",
    null,
    "team-4",
    "team-5",
    "team-2",
    null,
    "team-3",
    null,
  ]);
  assert.equal(bracketMatch(bracket, "r1-m1").status, "bye");
  assert.equal(bracketMatch(bracket, "r1-m1").winnerId, "team-1");
  assert.equal(bracketMatch(bracket, "r2-m1").status, "waiting");
  assert.equal(bracketMatch(bracket, "r2-m1").winnerId, null);
  assert.equal(bracketMatch(bracket, "r2-m2").status, "ready");
  assert.equal(bracketOutput(bracket).champion, null);
});

test("manual pairings follow the supplied order and random generation actually shuffles it", () => {
  const manual = generateBracket(teams(4), { seeding: "manual" });
  assert.deepEqual(manual.slots, ["team-1", "team-2", "team-3", "team-4"]);
  const randomized = generateBracket(teams(4), {
    seeding: "random",
    random: () => 0,
  });
  assert.deepEqual([...randomized.slots].sort(), [...manual.slots].sort());
  assert.notDeepEqual(randomized.slots, generateBracket(teams(4)).slots);
  assert.throws(
    () => generateBracket(teams(4), { seeding: "random", random: () => 1 }),
    /random bracket/,
  );
});

test("every supported entrant count produces a complete, reachable elimination tree", () => {
  for (let count = 2; count <= 32; count++) {
    let bracket = generateBracket(teams(count));
    const firstRoundIds = bracket.matches
      .filter((match) => match.round === 0)
      .flatMap((match) => match.teamIds)
      .filter(Boolean);
    assert.equal(new Set(firstRoundIds).size, count);
    let played = 0;
    while (bracket.matches.some((match) => match.status === "ready")) {
      const match = bracket.matches.find((item) => item.status === "ready");
      bracket = setBracketResult(bracket, match.id, {
        winnerId: match.teamIds[0],
      });
      played++;
    }
    assert.equal(
      played,
      count - 1,
      `${count} entrants require exactly ${count - 1} played matches`,
    );
    assert.equal(bracketOutput(bracket).champion.id, "team-1");
    assert.ok(
      bracket.matches.every((match) =>
        ["complete", "bye"].includes(match.status),
      ),
    );
    assert.deepEqual(cleanBracket(bracket), bracket);
  }
});

test("changing an upstream winner invalidates only dependent completed results", () => {
  let bracket = generateBracket(teams(8), { seeding: "manual" });
  for (const match of bracket.matches.filter((match) => match.round === 0))
    bracket = setBracketResult(bracket, match.id, {
      winnerId: match.teamIds[0],
    });
  bracket = setBracketResult(bracket, "r2-m1", { winnerId: "team-1" });
  bracket = setBracketResult(bracket, "r2-m2", { winnerId: "team-5" });
  bracket = setBracketResult(bracket, "r3-m1", { winnerId: "team-1" });
  assert.equal(bracketOutput(bracket).champion.id, "team-1");
  const before = structuredClone(bracket);
  bracket = setBracketResult(bracket, "r1-m1", { winnerId: "team-2" });
  assert.equal(before.matches[0].winnerId, "team-1");
  assert.equal(bracketMatch(bracket, "r2-m1").winnerId, null);
  assert.deepEqual(bracketMatch(bracket, "r2-m1").scores, [0, 0]);
  assert.equal(bracketMatch(bracket, "r2-m1").status, "ready");
  assert.equal(bracketMatch(bracket, "r2-m2").winnerId, "team-5");
  assert.equal(bracketMatch(bracket, "r3-m1").status, "waiting");
  assert.equal(bracketOutput(bracket).champion, null);
});

test("clearing an earlier result removes later team assignments and scores", () => {
  let bracket = generateBracket(teams(4), { seeding: "manual" });
  bracket = setBracketResult(bracket, "r1-m1", { winnerId: "team-1" });
  bracket = setBracketResult(bracket, "r1-m2", { winnerId: "team-3" });
  bracket = setBracketResult(bracket, "r2-m1", { winnerId: "team-3" });
  bracket.activeMatchId = "r2-m1";
  bracket = setBracketResult(bracket, "r1-m1", { clear: true });
  assert.deepEqual(bracketMatch(bracket, "r2-m1").teamIds, [null, "team-3"]);
  assert.deepEqual(bracketMatch(bracket, "r2-m1").scores, [0, 0]);
  assert.equal(bracket.activeMatchId, "");
});

test("manual partial scores do not advance a team and inconsistent results are rejected", () => {
  const bracket = generateBracket(teams(2));
  const partial = setBracketResult(bracket, "r1-m1", { scores: [1, 1] });
  assert.equal(bracketMatch(partial, "r1-m1").status, "ready");
  assert.equal(bracketMatch(partial, "r1-m1").winnerId, null);
  assert.throws(
    () => setBracketResult(bracket, "r1-m1", { scores: [2, 2] }),
    /do not agree/,
  );
  assert.throws(
    () =>
      setBracketResult(bracket, "r1-m1", {
        scores: [0, 2],
        winnerId: "team-1",
      }),
    /do not agree/,
  );
  assert.throws(
    () =>
      setBracketResult(bracket, "r1-m1", { scores: [2, 0], winnerId: null }),
    /winning team/,
  );
  assert.throws(
    () => setBracketResult(bracket, "r1-m1", { scores: [9, 0] }),
    /scores from 0 to 2/,
  );
  assert.throws(
    () => setBracketResult(bracket, "r1-m1", { winnerId: "another-team" }),
    /this match/,
  );
  assert.deepEqual(bracketMatch(bracket, "r1-m1").scores, [0, 0]);
});

test("published games update series once and advance only when the series is won", () => {
  let bracket = generateBracket(teams(4), {
    seeding: "manual",
    seriesFormat: "BO3",
  });
  const first = { matchId: "r1-m1", gameId: "123", winnerId: "team-1" };
  bracket = recordBracketGame(bracket, first);
  assert.deepEqual(bracketMatch(bracket, "r1-m1").scores, [1, 0]);
  assert.equal(bracketMatch(bracket, "r2-m1").teamIds[0], null);
  assert.deepEqual(recordBracketGame(bracket, first), bracket);
  bracket = recordBracketGame(bracket, {
    ...first,
    gameId: "124",
    winnerId: "team-2",
  });
  assert.deepEqual(bracketMatch(bracket, "r1-m1").scores, [1, 1]);
  bracket = recordBracketGame(bracket, { ...first, gameId: "125" });
  assert.equal(bracketMatch(bracket, "r1-m1").winnerId, "team-1");
  assert.equal(bracketMatch(bracket, "r2-m1").teamIds[0], "team-1");
  assert.throws(
    () => recordBracketGame(bracket, { ...first, gameId: "126" }),
    /already complete/,
  );
});

test("clearing or correcting scores cannot award an already processed game twice", () => {
  let bracket = generateBracket(teams(2));
  const game = { matchId: "r1-m1", gameId: "123", winnerId: "team-1" };
  bracket = recordBracketGame(bracket, game);
  bracket = setBracketResult(bracket, "r1-m1", { clear: true });
  assert.deepEqual(recordBracketGame(bracket, game), bracket);
  assert.deepEqual(bracketMatch(bracket, "r1-m1").scores, [0, 0]);
});

test("rehearsal games and disabled automatic results do not alter the bracket", () => {
  const bracket = generateBracket(teams(2));
  const game = { matchId: "r1-m1", gameId: "123", winnerId: "team-1" };
  assert.deepEqual(
    recordBracketGame(bracket, { ...game, rehearsal: true }),
    bracket,
  );
  const manual = { ...bracket, autoResults: false };
  assert.deepEqual(recordBracketGame(manual, game), manual);
  assert.throws(
    () => recordBracketGame(bracket, { ...game, winnerId: "team-99" }),
    /not a team/,
  );
  assert.throws(
    () => recordBracketGame(bracket, { ...game, gameId: "../../unsafe" }),
    /saved game ID/,
  );
});

test("BO1, BO3, BO5 and BO7 use the right number of games to decide a series", () => {
  for (const format of ["BO1", "BO3", "BO5", "BO7"]) {
    let bracket = generateBracket(teams(2), { seriesFormat: format });
    const needed = winsRequired(format);
    for (let game = 0; game < needed; game++)
      bracket = recordBracketGame(bracket, {
        matchId: "r1-m1",
        gameId: String(game + 100),
        winnerId: "team-1",
      });
    assert.equal(bracketMatch(bracket, "r1-m1").scores[0], needed);
    assert.equal(bracketOutput(bracket).champion.id, "team-1");
  }
});

test("public output has display names and rounds without player records or Steam IDs", () => {
  const bracket = generateBracket(teams(8));
  const output = bracketOutput(bracket, { title: "Community cup" });
  assert.equal(output.title, "Community cup");
  assert.deepEqual(
    output.rounds.map((round) => round.name),
    ["Quarterfinals", "Semifinals", "Final"],
  );
  assert.equal(output.rounds[0].matches[0].teams[0].name, "Team 1");
  assert.equal(output.visible, true);
  assert.equal(output.transparent, false);
  assert.equal(JSON.stringify(output).includes("steamId"), false);
  assert.equal(JSON.stringify(output).includes("76561198000000000"), false);
  assert.equal(JSON.stringify(output).includes("person-1"), false);
  assert.equal(JSON.stringify(output).includes("processedGameIds"), false);
});

test("invalid entrants are rejected before replacing an existing tournament bracket", () => {
  assert.throws(() => generateBracket(teams(1)), /between 2 and 32/);
  assert.throws(() => generateBracket(teams(33)), /between 2 and 32/);
  const duplicate = teams(2);
  duplicate[1].id = duplicate[0].id;
  assert.throws(() => generateBracket(duplicate), /unique ID/);
  duplicate[1].id = "other";
  duplicate[1].name = "TEAM 1";
  assert.throws(() => generateBracket(duplicate), /different team name/);
});

test("older and corrupt settings normalize safely without trusting stale bracket routing", () => {
  assert.deepEqual(cleanBracket(), cleanBracket(null));
  const bracket = generateBracket(teams(4));
  bracket.matches[0].teamIds = ["team-99", "team-4"];
  bracket.matches[0].scores = [2, 0];
  bracket.matches[0].winnerId = "team-99";
  bracket.entrants[0].logo = "javascript:unsafe";
  bracket.visible = false;
  bracket.transparent = true;
  const cleaned = cleanBracket(bracket);
  assert.deepEqual(cleaned.matches[0].scores, [0, 0]);
  assert.deepEqual(cleaned.matches[0].teamIds, ["team-1", "team-4"]);
  assert.equal(cleaned.matches[0].winnerId, null);
  assert.equal(cleaned.entrants[0].logo, "");
  assert.equal(cleaned.visible, false);
  assert.equal(cleaned.transparent, true);
  assert.deepEqual(cleanBracket(cleaned), cleaned);
});
