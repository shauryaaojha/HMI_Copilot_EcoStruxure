/**
 * Put the project skeleton into MongoDB, once, from a machine that has the
 * product installed.
 *
 *   npm run skeleton:upload
 *
 * Why this exists: a deployed instance builds from a repository that
 * deliberately does not carry Schneider's files, so `skeleton/` is not there
 * and a generated project cannot be exported. Uploading it to the database the
 * app already uses keeps those files out of the repository and off any public
 * URL, while letting the hosted tool write a project.
 *
 * Reads MONGODB_URI from .env.local, the same place the app reads it.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Binary, MongoClient } from "mongodb";

async function loadEnv() {
  const text = await readFile(join(process.cwd(), ".env.local"), "utf8").catch(() => "");
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}

interface Manifest {
  source: string;
  localVariablesFrom: string;
  entries: { entry: string; file: string }[];
}

async function main() {
  await loadEnv();
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    console.error("MONGODB_URI is not set. Put it in web/.env.local, the same one Vercel uses.");
    process.exit(1);
  }

  const root = join(process.cwd(), "skeleton");
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  } catch {
    console.error("No skeleton/ directory. Run `npm run setup:skeleton` first, on a machine with OTE 4.4 installed.");
    process.exit(1);
  }

  const entries = [];
  let total = 0;
  for (const { entry, file } of manifest.entries) {
    const bytes = await readFile(join(root, "entries", file));
    total += bytes.length;
    entries.push({ entry, bytes: new Binary(bytes) });
  }
  const localVariables = await readFile(join(root, "LocalVariables.db"));
  total += localVariables.length;

  if (total > 15_000_000) {
    console.error(`The skeleton is ${(total / 1048576).toFixed(1)}MB; a document holds 16MB.`);
    process.exit(1);
  }

  const client = await new MongoClient(uri).connect();
  try {
    const db = client.db(process.env.MONGODB_DB?.trim() || "hmi_copilot");
    await db.collection("skeleton").replaceOne(
      { _id: "skeleton" as never },
      {
        _id: "skeleton",
        source: manifest.source,
        localVariablesFrom: manifest.localVariablesFrom,
        entries,
        localVariables: new Binary(localVariables),
        uploadedAt: new Date(),
      } as never,
      { upsert: true },
    );
    console.log(`Uploaded ${entries.length} entries, ${(total / 1024).toFixed(0)}KB, from ${manifest.source}.`);
    console.log("The deployed instance can now export a generated project.");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
