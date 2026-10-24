import { zipSync, strToU8 } from "fflate";
import { readFile, mkdir, writeFile } from "node:fs/promises";
const files = {};
for (const name of [
  "local-reader.mjs",
  "pov-compat.mjs",
  "extract.mjs",
  "ultimates.mjs",
  "model.mjs",
  "purchases.mjs",
  "package.json",
  "package-lock.json",
  "POV-ADAPTER-LICENSE.txt",
  "data/permanent-pickups.json",
  "data/ultimates.json",
  "data/bridge-buffs.json",
  "data/items.json",
])
  files[`collector/${name}`] = new Uint8Array(
    await readFile(new URL(`../collector/${name}`, import.meta.url)),
  );
for (const name of ["observer.mjs", "observer.html"])
  files[`companion/${name}`] = new Uint8Array(
    await readFile(new URL(`../companion/${name}`, import.meta.url)),
  );
for (const name of ["Start-Observer.cmd", "Install-Observer.ps1"])
  files[name] = new Uint8Array(
    await readFile(new URL(`../companion/${name}`, import.meta.url)),
  );
files["README.txt"] = strToU8(
  "DEADLOCK AR OBSERVER\r\n\r\n1. Extract this ZIP into a folder on the observer PC.\r\n2. Double-click Start-Observer.cmd. First run downloads the official portable Node.js runtime and pinned parser.\r\n3. Open your hosted studio, Live desk, and create a pairing code.\r\n4. Enter the studio HTTPS address and code in the companion.\r\n5. Prepare a new recording. Enter its record command in Deadlock before the host starts the match.\r\n6. After game over enter stop in Deadlock. Review and publish the scoreboard in the studio.\r\n\r\nHost must enable cheats. This package does not inject into the game or read process memory.\r\nKeep .dlar-observer private: it contains this computer's publisher credential. Disconnect this computer in the studio to revoke it.\r\nChanging observer PCs does not change OBS URLs.\r\n\r\nCompatibility shim adapts Deadem 4.0.2 (MIT, Igor Losev). Parser and dependency licences are installed in collector/node_modules.\r\n",
);
const directory = new URL("../dist/downloads/", import.meta.url);
await mkdir(directory, { recursive: true });
const zip = zipSync(files, { level: 6 });
await writeFile(new URL("Deadlock-AR-Observer.zip", directory), zip);
console.log(
  `Observer companion packaged (${Math.round(zip.length / 1024)} KiB).`,
);
