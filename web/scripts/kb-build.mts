import { mkdir, writeFile } from "node:fs/promises";
import { generateCode } from "../src/lib/kb/gen/code";

const file = new URL("../src/lib/kb/generated/code.json", import.meta.url);
await mkdir(new URL("../src/lib/kb/generated/", import.meta.url), { recursive: true });
await writeFile(file, `${JSON.stringify(generateCode(), null, 2)}\n`);
