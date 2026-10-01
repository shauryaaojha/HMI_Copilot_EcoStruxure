/**
 * One MongoDB connection for the process.
 *
 * Two things need a database on a deployed instance - the project a user
 * opened (lib/ote/imports.ts) and the skeleton a generated project starts
 * from (lib/ote/skeleton.ts) - and they must share a client. A MongoClient per
 * caller opens a pool per caller, and a free-tier cluster runs out of
 * connections long before it runs out of storage.
 *
 * Held on `globalThis` so Next's dev-mode module reloading does not open a new
 * pool on every edit, and so a warm serverless invocation reuses the last one.
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
    cache.__hmiMongo = new MongoClient(uri, {
      // A serverless invocation is short and single-threaded; a large pool
      // only holds connections a shared cluster cannot spare.
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 8000,
    }).connect();
  }
  return cache.__hmiMongo;
}

export async function mongoDb(): Promise<Db> {
  return (await mongoClient()).db(DB_NAME);
}
