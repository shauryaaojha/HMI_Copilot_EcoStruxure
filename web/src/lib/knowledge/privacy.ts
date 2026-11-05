/** Private provider imports may teach a local library, but never a shared corpus. */
import type { User } from "@/lib/server/repo";
import { knowledgeStore } from "./store";

/** This store policy is separate from the route's requirement for an owner identity. */
export function mayLearnImport(user: User | null): boolean {
  const store = knowledgeStore();
  return store !== "off" && (store !== "mongo" || !user || user.id === "local");
}
