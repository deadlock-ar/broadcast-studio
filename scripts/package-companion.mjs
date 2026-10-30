import { zipSync, unzipSync, strToU8 } from "fflate";
import { readFile, mkdir, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const files = {};
const runtimeUrl = "https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-x64.zip";
const runtimeSha =
  "57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73";
const cache = new URL("../node_modules/.cache/", import.meta.url);
await mkdir(cache, { recursive: true });
const cached = new URL("node-v24.19.0-win-x64.zip", cache);
let runtime = await readFile(cached).catch(() => null);
if (
  !runtime ||
  createHash("sha256").update(runtime).digest("hex") !== runtimeSha
) {
  const response = await fetch(runtimeUrl, {
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok)
    throw Error(`Official Windows runtime: HTTP ${response.status}`);
  runtime = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(runtime).digest("hex") !== runtimeSha)
    throw Error("Windows runtime checksum mismatch.");
  await writeFile(cached, runtime);
}
const runtimeFiles = unzipSync(runtime, {
  filter: (file) => /\/(node\.exe|LICENSE)$/.test(file.name),
});
for (const [name, bytes] of Object.entries(runtimeFiles))
  files["runtime/" + name.split("/").at(-1)] = bytes;
if (!files["runtime/node.exe"])
  throw Error("Official runtime archive has no node.exe.");
async function dependencies(directory, prefix) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".bin") continue;
    const target = new URL(
        entry.name + (entry.isDirectory() ? "/" : ""),
        directory,
      ),
      key = prefix + "/" + entry.name;
    if (entry.isDirectory()) await dependencies(target, key);
    else if (entry.isFile())
      files[key] = new Uint8Array(await readFile(target));
  }
}
await dependencies(
  new URL("../collector/node_modules/", import.meta.url),
  "collector/node_modules",
);
for (const name of [
  "local-reader.mjs",
  "pov-compat.mjs",
  "extract.mjs",
  "ultimates.mjs",
  "model.mjs",
  "purchases.mjs",
  "enrichment.mjs",
  "package.json",
  "package-lock.json",
  "POV-ADAPTER-LICENSE.txt",
  "data/permanent-pickups.json",
  "data/ultimates.json",
  "data/bridge-buffs.json",
  "data/items.json",
  "data/signatures.json",
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
  "DEADLOCK AR OBSERVER\r\n\r\n1. Extract this ZIP into a folder on the observer PC.\r\n2. Double-click Start-Observer.cmd. The official Windows x64 Node.js runtime and pinned parser are already included. No install is needed.\r\n3. Open your hosted studio, Live desk, and create a pairing code.\r\n4. Enter the studio HTTPS address and code in the companion.\r\n5. Prepare a new recording. Enter its record command in Deadlock before the host starts the match.\r\n6. After game over enter stop in Deadlock. Review and publish the scoreboard in the studio.\r\n\r\nHost must enable cheats. This package does not inject into the game or read process memory.\r\nKeep .dlar-observer private: it contains this computer's publisher credential. Disconnect this computer in the studio to revoke it.\r\nChanging observer PCs does not change OBS URLs.\r\n\r\nCompatibility shim adapts Deadem 4.0.2 (MIT, Igor Losev). Parser and dependency licences are in collector/node_modules. The Node.js licence is in runtime/LICENSE.\r\n",
);
const directory = new URL("../dist/downloads/", import.meta.url);
await mkdir(directory, { recursive: true });
const zip = zipSync(files, { level: 6 });
await writeFile(new URL("Deadlock-AR-Observer.zip", directory), zip);
console.log(
  `Observer companion packaged (${Math.round(zip.length / 1024)} KiB).`,
);
