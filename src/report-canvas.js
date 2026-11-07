import heroes from "./heroes.json";
const palette = {
  paper: "#292b27",
  gold: "#65734f",
  bg: "#eae1cf",
  panel: "#d9ddca",
  firstBan: "#ff914d",
  ban: "#f16578",
  firstPick: "#65734f",
  pick: "#5f9df7",
  unknownPick: "#60776c",
  unknownBan: "#7c705e",
};
const displayFont = (size, weight = 600) =>
  `${weight} ${size}px "DLAR Arabic", "DLAR Display", "Cairo", Georgia, serif`;
const condensedFont = (size, weight = 500) =>
  `${weight} ${size}px "DLAR Arabic", "DLAR Condensed", "Cairo", "Barlow Condensed", sans-serif`;
async function prepareFonts() {
  const fonts = globalThis.document?.fonts;
  if (!fonts?.load) return;
  await Promise.allSettled([
    fonts.load(displayFont(58), "DEADLOCK AR البطولة"),
    fonts.load(condensedFont(28), "0123456789 HERO PRIORITY"),
    fonts.load('700 28px "DLAR Arabic"', "البطولة اللاعب"),
  ]);
}
function priorityMark(c, key, x, y, size = 5.5) {
  c.fillStyle = palette[key];
  c.strokeStyle = palette[key];
  c.lineWidth = 1.6;
  c.beginPath();
  if (key === "unknownPick") {
    c.rect(x - size, y - size, size * 2, size * 2);
    c.stroke();
  } else if (key === "unknownBan") {
    c.moveTo(x, y - size - 1);
    c.lineTo(x + size + 1, y);
    c.lineTo(x, y + size + 1);
    c.lineTo(x - size - 1, y);
    c.closePath();
    c.stroke();
  } else {
    c.arc(x, y, size, 0, 2 * Math.PI);
    c.fill();
    if (key.startsWith("first")) {
      c.fillStyle = palette.bg;
      c.font = condensedFont(size * 1.8, 700);
      c.textAlign = "center";
      c.fillText("1", x, y + size * 0.65);
      c.textAlign = "left";
    }
  }
}
async function picture(url) {
  if (!url) return null;
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(Error("Could not load report image: " + url));
    image.src = url;
  });
}
function base(canvas, height, title, subtitle) {
  canvas.width = 1920;
  canvas.height = height;
  const c = canvas.getContext("2d");
  const fill = c.createLinearGradient(0, 0, 1920, height);
  fill.addColorStop(0, "#f3ecdc");
  fill.addColorStop(1, "#e0e4d2");
  c.fillStyle = fill;
  c.fillRect(0, 0, 1920, height);
  c.fillStyle = "#1b2b23";
  c.fillRect(54, 54, 1812, 174);
  c.fillStyle = "#eae1cf";
  c.fillRect(70, 72, 108, 112);
  c.fillStyle = "#65734f";
  c.font = displayFont(42, 700);
  c.fillText("AR", 92, 145);
  c.strokeStyle = palette.gold;
  c.lineWidth = 3;
  c.strokeRect(36, 36, 1848, height - 72);
  c.lineWidth = 1;
  c.strokeRect(44, 44, 1832, height - 88);
  c.strokeStyle = "#b5a36e";
  c.beginPath();
  c.moveTo(202, 188);
  c.lineTo(330, 188);
  c.moveTo(1590, 188);
  c.lineTo(1806, 188);
  c.stroke();
  for (const x of [36, 1884])
    for (const y of [36, height - 36]) {
      const dx = x === 36 ? 1 : -1,
        dy = y === 36 ? 1 : -1;
      c.beginPath();
      c.moveTo(x, y + dy * 85);
      c.lineTo(x + dx * 24, y + dy * 24);
      c.lineTo(x + dx * 85, y);
      c.stroke();
    }
  c.textAlign = "center";
  c.fillStyle = "#b8c5a2";
  c.font = condensedFont(18);
  c.fillText("DEADLOCK AR  /  TOURNAMENT REPORT", 960, 88);
  c.fillStyle = "#eee6d6";
  c.font = displayFont(58, 700);
  c.fillText(title.toUpperCase().slice(0, 43), 960, 165, 1460);
  c.font = condensedFont(24);
  c.fillStyle = "#c3cbb5";
  c.fillText(subtitle.slice(0, 115), 960, 209);
  c.textAlign = "left";
  return c;
}
async function footer(c, height, text) {
  c.fillStyle = palette.gold;
  c.font = condensedFont(19);
  c.textAlign = "center";
  c.fillText(text, 960, height - 64);
  c.textAlign = "left";
  const logo = await picture("/logo.png");
  if (logo) {
    c.fillStyle = "#eae1cf";
    c.fillRect(70, 72, 108, 112);
    c.drawImage(logo, 78, 79, 92, 100);
  }
}
export async function drawHeroReport(canvas, { rows, title }) {
  await prepareFonts();
  const groups = Map.groupBy(rows, (r) => r.total),
    capacity = 12,
    cell = 143;
  const cellHeight = (total) => Math.max(112, Math.ceil(total / 4) * 14 + 24);
  const height =
    470 +
    [...groups.values()].reduce(
      (h, g) =>
        h +
        Math.max(1, Math.ceil(g.length / capacity)) * cellHeight(g[0].total) +
        12,
      0,
    );
  const images = await Promise.all(rows.map((r) => picture(r.image)));
  const imageMap = new Map(rows.map((r, i) => [r.id, images[i]]));
  const c = base(
    canvas,
    height,
    title || "Hero priority",
    "HERO PRIORITY · PICKS & BANS",
  );
  let y = 245;
  for (const [total, group] of groups) {
    const rowHeight = Math.ceil(group.length / capacity) * cellHeight(total);
    c.fillStyle = palette.panel;
    c.fillRect(72, y, 1776, rowHeight);
    c.fillStyle = palette.paper;
    c.font = condensedFont(48, 700);
    c.fillText(String(total), 92, y + 66);
    group.forEach((row, index) => {
      const x = 165 + (index % capacity) * cell,
        top = y + Math.floor(index / capacity) * cellHeight(total) + 10,
        image = imageMap.get(row.id);
      if (image) c.drawImage(image, x, top, 62, 87);
      const markers = [];
      for (const k of [
        "firstBan",
        "ban",
        "firstPick",
        "pick",
        "unknownPick",
        "unknownBan",
      ])
        for (let i = 0; i < row[k]; i++) markers.push(k);
      markers.forEach((k, i) => {
        const mx = x + 72 + (i % 4) * 14,
          my = top + 12 + Math.floor(i / 4) * 14;
        priorityMark(c, k, mx, my);
      });
    });
    y += rowHeight + 12;
  }
  let x = 300;
  for (const [key, label] of [
    ["firstBan", "FIRST ROUND BANNED"],
    ["ban", "BANNED"],
    ["firstPick", "FIRST ROUND PICKED"],
    ["pick", "PICKED"],
  ]) {
    priorityMark(c, key, x, y + 20, 7);
    c.fillStyle = palette.paper;
    c.font = condensedFont(18);
    c.fillText(label, x + 15, y + 26);
    x += key.startsWith("first") ? 400 : 230;
  }
  for (const [key, label, left] of [
    ["unknownPick", "PICK · ORDER UNKNOWN", 565],
    ["unknownBan", "BAN · ORDER UNKNOWN", 1045],
  ]) {
    priorityMark(c, key, left, y + 66, 7);
    c.fillStyle = palette.paper;
    c.font = condensedFont(18);
    c.fillText(label, left + 19, y + 72);
  }
  c.fillStyle = "#67735c";
  c.font = condensedFont(16);
  c.textAlign = "center";
  c.fillText(
    "Unknown-order selections count toward totals without implying a draft round.",
    960,
    y + 108,
  );
  c.textAlign = "left";
  await footer(c, height, "DEADLOCK AR · COMMUNITY TOURNAMENTS");
}
export async function drawItemReport(
  canvas,
  { rows, title, games, baselineGames, limit = 20 },
) {
  await prepareFonts();
  const selected = rows.slice(0, limit),
    height = 390 + selected.length * 70;
  const images = await Promise.all(selected.map((r) => picture(r.image)));
  const c = base(
    canvas,
    height,
    title || "Top items",
    `AVERAGE PURCHASES PER GAME · ${games} GAME${games === 1 ? "" : "S"}${baselineGames ? ` · COMPARED WITH ${baselineGames} GAMES` : ""}`,
  );
  c.fillStyle = "#65734f";
  c.font = condensedFont(18);
  c.fillText("ITEM", 180, 260);
  c.fillText("TOTAL", 1210, 260);
  c.fillText("RANK Δ", 1390, 260);
  c.fillText("AVG Δ", 1545, 260);
  c.fillText("AVG / GAME", 1700, 260);
  const max = selected[0]?.average || 1;
  selected.forEach((r, i) => {
    const y = 280 + i * 70;
    c.fillStyle = palette.panel;
    c.fillRect(72, y, 1776, 64);
    c.fillStyle = "#abb894";
    c.fillRect(160, y + 2, (1040 * r.average) / max, 60);
    c.font = condensedFont(24);
    c.fillStyle = palette.paper;
    c.fillText(String(i + 1), 94, y + 43);
    if (images[i]) c.drawImage(images[i], 170, y + 6, 50, 50);
    c.font = condensedFont(28, 700);
    c.fillText(r.name || `Item ${r.id}`, 235, y + 43, 945);
    c.font = condensedFont(24);
    c.fillText(String(r.total), 1220, y + 43);
    c.fillStyle = "#526142";
    c.fillText(
      r.rankChange === null
        ? "—"
        : r.rankChange > 0
          ? `▲ ${r.rankChange}`
          : r.rankChange < 0
            ? `▼ ${-r.rankChange}`
            : "± 0",
      1390,
      y + 43,
    );
    c.fillText(
      r.averageChange === null
        ? "—"
        : `${r.averageChange >= 0 ? "+" : ""}${r.averageChange.toFixed(1)}`,
      1545,
      y + 43,
    );
    c.fillStyle = palette.paper;
    c.font = condensedFont(34, 700);
    c.fillText(r.average.toFixed(1), 1735, y + 44);
  });
  await footer(c, height, "DEADLOCK AR · COMMUNITY TOURNAMENTS");
}
export async function drawMvpReport(canvas, { player, title }) {
  await prepareFonts();
  const value = (n) =>
    Number.isFinite(n) ? Math.round(n).toLocaleString() : "—";
  const c = base(canvas, 1080, title || "Series MVP", "MOST VALUABLE PLAYER");
  if (!player) return;
  const image = await picture(
    heroes.find((h) => h.id === player.heroId)?.gloatImage || player.image,
  );
  if (image) c.drawImage(image, 195, 285, 360, 510);
  c.fillStyle = palette.gold;
  c.font = condensedFont(26, 700);
  c.fillText("MOST VALUABLE PLAYER", 650, 365);
  c.fillStyle = palette.paper;
  c.font = displayFont(62, 700);
  c.fillText(player.name, 650, 455, 1125);
  c.font = condensedFont(45, 700);
  c.fillText(
    `${value(player.kills)} / ${value(player.deaths)} / ${value(player.assists)}`,
    650,
    570,
  );
  c.font = condensedFont(22);
  c.fillText("TOTAL KILLS / DEATHS / ASSISTS", 650, 615);
  c.font = condensedFont(40, 700);
  c.fillText(`${value(player.damage)} DAMAGE`, 650, 715);
  c.fillText(`${value(player.souls)} SOULS`, 650, 790);
  await footer(c, 1080, "DEADLOCK AR · COMMUNITY TOURNAMENTS");
}
export function downloadCanvas(canvas, name) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = name + ".png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}
