import { MATCH_OVERLAY_FONTS, matchOverlayWins } from "./match-overlay.js";
const SVG_NS = "http://www.w3.org/2000/svg";
let instance = 0;

const safeText = (value, fallback = "") =>
  typeof value === "string" ? value.slice(0, 160) : fallback;
const color = (value, fallback) =>
  /^#[0-9a-f]{3,8}$/i.test(value || "") ? value : fallback;
const imageSource = (value) =>
  typeof value === "string" &&
  /^(?:data:image\/(?:png|jpeg|webp|gif|svg\+xml);|blob:|assets\/|\/heroes\/|https:\/\/)/i.test(
    value,
  )
    ? value
    : "";

function scaffold(root) {
  const key = "banner-" + ++instance;
  root.classList.add("match-banner-scene");
  // This template contains only fixed artwork. All editable values are assigned
  // through textContent or SVG attributes below rather than HTML interpolation.
  root.innerHTML = `<div class="match-hero-window" aria-label="Transparent live game HUD space, maximum 70 pixels"><div class="match-hero-window-guide">LIVE GAME HUD · 70px MAX</div></div>
<svg class="match-banner-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2048 82" width="2048" height="82" role="img" aria-label="Compact editable tournament scoreboard">
<defs>
 <linearGradient id="${key}-paper" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#f4eedf"/><stop offset=".62" stop-color="#ece4d0"/><stop offset="1" stop-color="#e1d7bf"/></linearGradient>
 <linearGradient id="${key}-forest" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#303b29"/><stop offset=".55" stop-color="#1e281c"/><stop offset="1" stop-color="#151d14"/></linearGradient>
 <linearGradient id="${key}-leaf" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#9ca786"/><stop offset=".48" stop-color="#78855c"/><stop offset="1" stop-color="#435337"/></linearGradient>
 <linearGradient id="${key}-card" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#0a100b" stop-opacity="0"/><stop offset="1" stop-color="#090e09" stop-opacity="0"/></linearGradient>
 <clipPath id="${key}-outline"><path d="M0 12H2048V142H1902Q1894 142 1884 135Q1878 131 1868 131H1562Q1555 131 1548 134H1182Q1170 134 1162 138H891Q880 138 869 134H600Q518 134 502 133Q495 133 489 131H180Q172 131 165 136Q154 142 145 142H0Z"/></clipPath>
 <clipPath id="${key}-left-cards"><rect x="243" y="18" width="40" height="40" rx="6"/><rect x="313" y="18" width="40" height="40" rx="6"/><rect x="383" y="18" width="40" height="40" rx="6"/></clipPath>
 <clipPath id="${key}-right-cards"><rect x="1631" y="18" width="40" height="40" rx="6"/><rect x="1701" y="18" width="40" height="40" rx="6"/><rect x="1771" y="18" width="40" height="40" rx="6"/></clipPath>
</defs>
<!-- Compress the ornament geometry only. Text, portraits and logos retain
     their natural proportions in the compact layout below. -->
<g transform="scale(1 .5)" clip-path="url(#${key}-outline)">
 <path fill="url(#${key}-forest)" d="M0 12H2048V143H0Z"/>
 <path d="M0 13H2048M0 141H145Q154 141 165 135Q172 130 180 130H489" fill="none" stroke="#c3c5ad" stroke-width="2"/>
 <path d="M2048 141H1902Q1894 141 1884 135Q1878 130 1868 130H1562" fill="none" stroke="#c3c5ad" stroke-width="2"/>
 <g fill="url(#${key}-leaf)">
  <path d="M108 12H141C161 68 202 108 260 126C188 117 136 76 108 12Z"/>
  <path d="M156 12H190C209 58 242 85 291 101C228 94 182 60 156 12Z"/>
  <path d="M206 12H244C265 43 302 60 343 65C287 69 241 50 206 12Z"/>
  <path d="M185 133C239 94 298 85 367 108C303 100 251 111 214 133Z"/>
  <path d="M279 13H348C378 33 422 37 458 42C387 54 323 36 279 13Z"/>
  <g transform="translate(2048 0) scale(-1 1)">
   <path d="M108 12H141C161 68 202 108 260 126C188 117 136 76 108 12Z"/>
   <path d="M156 12H190C209 58 242 85 291 101C228 94 182 60 156 12Z"/>
   <path d="M206 12H244C265 43 302 60 343 65C287 69 241 50 206 12Z"/>
   <path d="M185 133C239 94 298 85 367 108C303 100 251 111 214 133Z"/>
   <path d="M279 13H348C378 33 422 37 458 42C387 54 323 36 279 13Z"/>
  </g>
 </g>
 <!-- Ivory team panels retain the angled ends and dark undersides of the reference. -->
 <path d="M350 12H811L860 96L840 121H501L479 79C451 32 409 26 350 12Z" fill="url(#${key}-paper)" stroke="#c0c0aa" stroke-width="1.3"/>
 <path d="M1698 12H1237L1188 96L1208 121H1547L1569 79C1597 32 1639 26 1698 12Z" fill="url(#${key}-paper)" stroke="#c0c0aa" stroke-width="1.3"/>
 <path d="M499 122H849L836 135H506Z" fill="#111911"/>
 <path d="M1549 122H1199L1212 135H1542Z" fill="#111911"/>
 <path class="left-accent" d="M713 116H850L839 128H720Z" fill="#e49d21"/>
 <path class="right-accent" d="M1335 116H1198L1209 128H1328Z" fill="#5f8de7"/>
 <path d="M422 20L430 26L427 36M483 98L489 105L485 116M1626 20L1618 26L1621 36M1565 98L1559 105L1563 116" stroke="#878d73" stroke-width=".85" opacity=".5" fill="none"/>
 <!-- Solid, crisp ban pods replace the screenshot's blurred cutout areas. -->
 <rect x="221" y="29" width="224" height="93" rx="20" fill="#101b13" stroke="#657253" stroke-width="1.5"/>
 <rect x="1609" y="29" width="224" height="93" rx="20" fill="#101b13" stroke="#657253" stroke-width="1.5"/>
 <path d="M240 33H426M1628 33H1814" stroke="#9fa88b" stroke-width=".7" opacity=".35"/>
 <!-- Central plate and its olive wing ornament. -->
 <path d="M809 12H1239L1174 126Q1168 139 1151 139H895Q879 139 871 126Z" fill="url(#${key}-paper)" stroke="#bfc2ad" stroke-width="1.3"/>
 <g fill="#657450">
  <path d="M814 14C844 30 874 34 908 21C883 44 846 43 814 14Z"/>
  <path d="M820 23C839 42 856 49 879 48C857 59 836 48 820 23Z"/>
  <path d="M824 41C837 55 842 66 844 78C828 68 825 55 824 41Z"/>
  <g transform="translate(2048 0) scale(-1 1)">
   <path d="M814 14C844 30 874 34 908 21C883 44 846 43 814 14Z"/>
   <path d="M820 23C839 42 856 49 879 48C857 59 836 48 820 23Z"/>
   <path d="M824 41C837 55 842 66 844 78C828 68 825 55 824 41Z"/>
  </g>
 </g>
</g>
<g class="bans-left"></g><g class="bans-right"></g>
<text class="side-text side-heading tournament-name" x="69" y="26" text-anchor="middle"></text>
<path d="M30 34H108M1940 34H2018" stroke="#7d8968" stroke-width=".7"/>
<path d="M69 31L71 33L74 34L71 35L69 38L67 35L64 34L67 33Z" fill="#eee9d9"/>
<path d="M1979 31L1981 33L1984 34L1981 35L1979 38L1977 35L1974 34L1977 33Z" fill="#eee9d9"/>
<text class="side-text side-detail tournament-detail" x="69" y="49" text-anchor="middle"></text>
<text class="side-text side-heading sponsor-heading" x="1979" y="26" text-anchor="middle"></text>
<text class="side-text side-detail sponsor-name" x="1979" y="49" text-anchor="middle"></text>
<image class="sponsor-logo" x="1920" y="39" width="118" height="26" preserveAspectRatio="xMidYMid meet"/>
<text class="team-name team-left" x="643" y="52" text-anchor="middle" fill="#182119"></text>
<text class="team-name team-right" x="1405" y="52" text-anchor="middle" fill="#182119"></text>
<g class="score-boxes score-boxes-left"></g><g class="score-boxes score-boxes-right"></g>
<!-- The center remains blank until the user uploads their own logo. -->
<g class="custom-crest" style="display:none"><image x="970" y="14" width="108" height="42" preserveAspectRatio="xMidYMid meet"/></g>
</svg>`;

  const updateSize = () => {
    const width = root.getBoundingClientRect().width;
    root.style.setProperty("--banner-baseline", (width * 71) / 2048 + "px");
  };
  if (typeof ResizeObserver !== "undefined") {
    root.__bannerResizeObserver = new ResizeObserver(updateSize);
    root.__bannerResizeObserver.observe(root);
  } else {
    addEventListener("resize", updateSize);
  }
  root.__bannerKey = key;
  root.__bannerUpdateSize = updateSize;
  updateSize();
}

function fitText(text, content, maximum, fontSize) {
  text.textContent = content;
  text.removeAttribute("textLength");
  text.removeAttribute("lengthAdjust");
  const measure = () => {
    if (!text.isConnected || text.textContent !== content) return;
    text.removeAttribute("textLength");
    text.removeAttribute("lengthAdjust");
    let actual = 0;
    try {
      actual = text.getComputedTextLength();
    } catch (_) {
      /* Hidden preview. */
    }
    if (actual > maximum) {
      text.setAttribute("textLength", maximum);
      text.setAttribute("lengthAdjust", "spacingAndGlyphs");
    }
    if (fontSize) text.setAttribute("font-size", fontSize);
  };
  measure();
  if (document.fonts) document.fonts.ready.then(measure);
}

function multiline(node, content, x, firstY, lineHeight, maxWidth) {
  node.replaceChildren();
  const lines = String(content || "")
    .split(/\r?\n/)
    .slice(0, 2);
  if (lines.length === 1 && lines[0].length > 15) {
    const words = lines[0].split(/\s+/);
    if (words.length > 1) {
      let pivot = 1;
      for (let i = 1; i < words.length; i++) {
        if (
          Math.abs(
            words.slice(0, i).join(" ").length -
              words.slice(i).join(" ").length,
          ) <
          Math.abs(
            words.slice(0, pivot).join(" ").length -
              words.slice(pivot).join(" ").length,
          )
        )
          pivot = i;
      }
      lines.splice(
        0,
        1,
        words.slice(0, pivot).join(" "),
        words.slice(pivot).join(" "),
      );
    }
  }
  lines.forEach((line, i) => {
    const span = document.createElementNS(SVG_NS, "tspan");
    span.setAttribute("x", x);
    span.setAttribute("y", firstY + i * lineHeight);
    node.appendChild(span);
    fitText(span, line.toUpperCase(), maxWidth);
  });
}

function bans(group, selections, heroes, side, key) {
  group.replaceChildren();
  const positions = side === 0 ? [243, 313, 383] : [1631, 1701, 1771];
  const clip = `url(#${key}-${side === 0 ? "left" : "right"}-cards)`;
  for (let slot = 0; slot < 3; slot++) {
    const hero = heroes.find(
      (item) => String(item.id) === String((selections || [])[slot]),
    );
    const x = positions[slot];
    const groupSlot = document.createElementNS(SVG_NS, "g");
    const plate = document.createElementNS(SVG_NS, "rect");
    Object.entries({
      x,
      y: 18,
      width: 40,
      height: 40,
      rx: 6,
      fill: "#31412a",
      stroke: hero ? "#a9b695" : "#526447",
      "stroke-width": 0.8,
    }).forEach(([attr, value]) => plate.setAttribute(attr, value));
    groupSlot.appendChild(plate);
    if (hero && imageSource(hero.portrait)) {
      const portrait = document.createElementNS(SVG_NS, "image");
      Object.entries({
        x,
        y: 18,
        width: 40,
        height: 40,
        href: imageSource(hero.portrait),
        preserveAspectRatio: "xMidYMid slice",
        "clip-path": clip,
        class: "ban-portrait",
      }).forEach(([attr, value]) => portrait.setAttribute(attr, value));
      groupSlot.appendChild(portrait);
      const shade = document.createElementNS(SVG_NS, "rect");
      Object.entries({
        x,
        y: 18,
        width: 40,
        height: 40,
        rx: 6,
        fill: `url(#${key}-card)`,
      }).forEach(([attr, value]) => shade.setAttribute(attr, value));
      groupSlot.appendChild(shade);
      const border = document.createElementNS(SVG_NS, "rect");
      Object.entries({
        x,
        y: 18,
        width: 40,
        height: 40,
        rx: 6,
        fill: "none",
        stroke: "#c34b3f",
        "stroke-width": 1,
      }).forEach(([attr, value]) => border.setAttribute(attr, value));
      groupSlot.appendChild(border);
      const slash = document.createElementNS(SVG_NS, "path");
      slash.setAttribute("d", `M${x + 4} 54L${x + 36} 22`);
      slash.setAttribute("stroke", "#ef4946");
      slash.setAttribute("stroke-width", "1.8");
      slash.setAttribute("stroke-linecap", "round");
      groupSlot.appendChild(slash);
    } else {
      const mark = document.createElementNS(SVG_NS, "text");
      mark.setAttribute("x", x + 20);
      mark.setAttribute("y", "42");
      mark.setAttribute("text-anchor", "middle");
      mark.setAttribute("class", "empty-ban");
      mark.textContent = "—";
      groupSlot.appendChild(mark);
    }
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = hero
      ? "Banned: " + safeText(hero.name)
      : "Ban slot " + (slot + 1) + ": empty";
    groupSlot.appendChild(title);
    group.appendChild(groupSlot);
  }
}

function scoreBoxes(group, team, side, format) {
  group.replaceChildren();
  const selected = Array.isArray(team.scoreBoxes)
    ? team.scoreBoxes
    : [Number(team.score) > 0, Number(team.score) > 1];
  const count = matchOverlayWins(format);
  const size = count > 2 ? 16 : 20;
  const gap = count > 2 ? 7 : 10;
  const middle = side === 0 ? 909 : 1139;
  const start = middle - (count * size + (count - 1) * gap) / 2;
  const positions = Array.from(
    { length: count },
    (_, index) => start + index * (size + gap),
  );
  const accent = color(team.accent, side === 0 ? "#e49d21" : "#5f8de7");
  positions.forEach((x, index) => {
    const rect = document.createElementNS(SVG_NS, "rect");
    Object.entries({
      x,
      y: 43 - size / 2,
      width: size,
      height: size,
      rx: 0.5,
      fill: selected[index] ? accent : "none",
      stroke: "#27351f",
      "stroke-width": 1.8,
      class: "score-box",
      "data-filled": String(!!selected[index]),
      "data-slot": index,
      "aria-label": `Score box ${index + 1}: ${selected[index] ? "filled" : "empty"}`,
    }).forEach(([attr, value]) => rect.setAttribute(attr, value));
    group.appendChild(rect);
  });
}

export function renderMatchBanner(root, state, heroes) {
  if (!root || !(root instanceof Element))
    throw new TypeError("A banner root element is required.");
  if (!root.__bannerKey) scaffold(root);
  state = state || {};
  heroes = Array.isArray(heroes) ? heroes : [];
  const left = (state.teams || [])[0] || {};
  const right = (state.teams || [])[1] || {};
  const tournament = state.tournament || {};
  const sponsor = state.sponsor || {};
  const center = state.center || {};
  const query = (selector) => root.querySelector(selector);
  const font =
    MATCH_OVERLAY_FONTS.find((item) => item.id === state.font) ||
    MATCH_OVERLAY_FONTS[0];
  root.style.setProperty("--match-team-font", font.family);

  fitText(
    query(".team-left"),
    safeText(left.name, "TEAM ALPHA").toUpperCase(),
    302,
  );
  fitText(
    query(".team-right"),
    safeText(right.name, "TEAM OMEGA").toUpperCase(),
    302,
  );
  scoreBoxes(query(".score-boxes-left"), left, 0, state.format);
  scoreBoxes(query(".score-boxes-right"), right, 1, state.format);
  fitText(
    query(".tournament-name"),
    safeText(tournament.name, "AR CUP").toUpperCase(),
    112,
  );
  multiline(
    query(".tournament-detail"),
    safeText(tournament.subtitle, "COMMUNITY\nTOURNAMENT"),
    69,
    49,
    11,
    120,
  );
  fitText(
    query(".sponsor-heading"),
    safeText(sponsor.heading, "SUPPORTED BY").toUpperCase(),
    117,
  );
  multiline(
    query(".sponsor-name"),
    safeText(sponsor.name, "COMMUNITY\nPARTNERS"),
    1979,
    49,
    11,
    120,
  );
  const sponsorLogo = imageSource(sponsor.logo);
  query(".sponsor-logo").style.display = sponsorLogo ? "" : "none";
  query(".sponsor-logo").setAttribute("href", sponsorLogo);
  query(".sponsor-name").style.display = sponsorLogo ? "none" : "";
  const centerLogo = imageSource(center.logo);
  query(".custom-crest").style.display = centerLogo ? "" : "none";
  query(".custom-crest image").setAttribute("href", centerLogo);
  root
    .querySelectorAll(".left-accent")
    .forEach((el) => el.setAttribute("fill", color(left.accent, "#e49d21")));
  root
    .querySelectorAll(".right-accent")
    .forEach((el) => el.setAttribute("fill", color(right.accent, "#5f8de7")));
  bans(query(".bans-left"), left.bans, heroes, 0, root.__bannerKey);
  bans(query(".bans-right"), right.bans, heroes, 1, root.__bannerKey);
  const requested = state.hudHeight == null ? 35 : Number(state.hudHeight);
  const hudHeight = Number.isFinite(requested)
    ? Math.max(0, Math.min(70, requested))
    : 35;
  root.style.setProperty("--hero-height", hudHeight + "px");
  query(".match-hero-window-guide").textContent =
    "LIVE GAME HUD · " + hudHeight + "px";
  root.__bannerUpdateSize();
  return {
    svg: query(".match-banner-svg"),
    heroWindow: query(".match-hero-window"),
    hudHeight,
  };
}
