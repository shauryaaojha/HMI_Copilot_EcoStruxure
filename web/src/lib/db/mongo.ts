/**
 * One MongoDB connection for the process.
 *
 * Everything that needs a database on a deployed instance - the repository
 * (lib/server/storage.ts), the opened-file store (lib/ote/imports.ts), the
 * skeleton (lib/ote/skeleton.ts) and the knowledge store - shares this client.
 * A MongoClient per caller opens a pool per caller, and a free-tier cluster
 * (500 connections on Atlas M0) runs out of connections long before it runs
 * out of storage.
 *
 * Held on `globalThis` so Next's dev-mode module reloading does not open a new
 * pool on every edit, and so a warm serverless invocation reuses the last one.
 * On Vercel the pool is attached to the function (`attachDatabasePool`), so
 * idle connections are closed before an instance is suspended instead of
 * being left open on the cluster until it times them out.
 *
 * Node only. Nothing here is imported by the browser bundle.
 */

import type { Db, MongoClient } from "mongodb";

export const DB_NAME = process.env.MONGODB_DB?.trim() || "hmi_copilot";

/** The configured connection string, or undefined when there is no database. */
export const mongoUri = (): string | undefined => process.env.MONGODB_URI?.trim() || undefined;

/** Whether this instance has a database at all. */
export const hasMongo = (): boolean => mongoUri() !== undefined;

const cache = globalThis as unknown as { __hmiMongo?: Promise<MongoClient> };

export async function mongoClient(): Promise<MongoClient> {
  const uri = mongoUri();
  if (!uri) throw new Error("MONGODB_URI is not set");
  if (!cache.__hmiMongo) {
    const { MongoClient } = await import("mongodb");
    const client = new MongoClient(uri, {
      appName: "hmi-copilot",
      // A serverless invocation is short and single-threaded; a large pool
      // only holds connections a shared cluster cannot spare.
      maxPoolSize: 5,
      // Let an idle instance give its connections back.
      maxIdleTimeMS: 60_000,
      serverSelectionTimeoutMS: 8000,
    });
    if (process.env.VERCEL) {
      try {
        const { attachDatabasePool } = await import("@vercel/functions");
        attachDatabasePool(client);
      } catch {
        // Outside a Vercel function (a build step, a script): nothing to attach to.
      }
    }
    cache.__hmiMongo = client.connect().catch(error => { cache.__hmiMongo = undefined; throw error; });
  }
  return cache.__hmiMongo;
}

export async function mongoDb(): Promise<Db> {
  return (await mongoClient()).db(DB_NAME);
}
