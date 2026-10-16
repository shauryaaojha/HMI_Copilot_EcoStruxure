/**
 * Compound-object harness: every .co it can find is read, checked against the
 * invariants the product's own files hold (lib/ote/co.ts checkCo), written
 * back, and compared entry by entry.
 *
 *   npx tsx scripts/co-corpus.mts [dir|file.co|file.pkg ...]
 *
 * With no arguments: the installed library (Buildtime\TemplateCOs\COs.pkg),
 * ~/Downloads/Compound Object (Schneider's published set) and demo_objects/.
 * Schneider's files are read where they are and never copied.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import JSZip from "jszip";
import { checkCo, readCo, readCoPackage, summarizeCo, writeCo, type CompoundObject } from "../src/lib/ote/co";

const INSTALL = "C:/Program Files/Schneider Electric/EcoStruxure Operator Terminal Expert 4.4/Buildtime/TemplateCOs/COs.pkg";
const here = resolve(new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const inputs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [INSTALL, join(homedir(), "Downloads", "Compound Object"), resolve(here, "../../demo_objects")];

const items: { label: string; bytes: Uint8Array }[] = [];
for (const input of inputs) {
  if (!existsSync(input)) {
    console.log(`skip ${input}: not here`);
    continue;
  }
  if (statSync(input).isDirectory()) {
    for (const f of readdirSync(input).filter((f) => f.toLowerCase().endsWith(".co"))) items.push({ label: f, bytes: new Uint8Array(readFileSync(join(input, f))) });
  } else if (input.toLowerCase().endsWith(".pkg")) {
    const zip = await JSZip.loadAsync(readFileSync(input));
    for (const [n, f] of Object.entries(zip.files)) if (n.endsWith(".co")) items.push({ label: `pkg:${n}`, bytes: await f.async("uint8array") });
  } else items.push({ label: input, bytes: new Uint8Array(readFileSync(input)) });
}

let failed = 0;
for (const { label, bytes } of items) {
  let co: CompoundObject;
  try {
    co = await readCo(bytes);
  } catch (e) {
    failed++;
    console.log(`FAIL ${label}: ${(e as Error).message}`);
    continue;
  }
  const problems = checkCo(co);
  const back = await readCo(await writeCo(co));
  const changed = [...co.entries].filter(([n, b]) => {
    const c = back.entries.get(n);
    return !c || Buffer.compare(Buffer.from(b), Buffer.from(c)) !== 0;
  }).map(([n]) => n);
  const s = summarizeCo(co);
  const ok = problems.length === 0 && changed.length === 0 && back.entries.size === co.entries.size;
  if (!ok) failed++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${s.name.padEnd(20)} ${String(s.version).padEnd(10)} ${String(s.brand).padEnd(9)} ${s.layout.padEnd(7)} ` +
      `props ${String(s.properties.filter((p) => !p.group).length).padStart(2)}  wires ${String(s.wires).padStart(3)}  scripts ${s.scripts}` +
      (changed.length ? `  changed: ${changed.join(", ")}` : "") +
      (problems.length ? `\n       ${problems.slice(0, 6).join("\n       ")}${problems.length > 6 ? `\n       … ${problems.length - 6} more` : ""}` : ""),
  );
}
if (existsSync(INSTALL)) {
  const pkg = await readCoPackage(new Uint8Array(readFileSync(INSTALL)));
  console.log(`package: ${pkg.objects.length} objects in ${pkg.hierarchy.length} folders`);
}
console.log(`${items.length - failed}/${items.length} read, consistent and written back entry-identical`);
process.exitCode = failed ? 1 : 0;
