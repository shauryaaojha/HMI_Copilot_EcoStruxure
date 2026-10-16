/** Learning preserves laptop use while isolating provider users from shared data. */
import { expect, it, vi } from "vitest";
import { mayLearnImport } from "@/lib/knowledge/privacy";
const state = vi.hoisted(() => ({ store: "filesystem" }));
vi.mock("@/lib/knowledge/store", () => ({ knowledgeStore: () => state.store }));

it("learns local imports, including an implicit laptop user", () => {
  state.store = "filesystem";
  expect(mayLearnImport({ id: "local", name: "Local" })).toBe(true);
  expect(mayLearnImport({ id: "github:alice", name: "Alice" })).toBe(true);
});
it("isolates provider users from the shared corpus but retains anonymous and laptop learning", () => {
  state.store = "mongo";
  expect(mayLearnImport({ id: "github:alice", name: "Alice" })).toBe(false);
  expect(mayLearnImport(null)).toBe(true);
  expect(mayLearnImport({ id: "local", name: "Local" })).toBe(true);
});
it("does not learn when knowledge storage is off", () => {
  state.store = "off";
  expect(mayLearnImport(null)).toBe(false);
  expect(mayLearnImport({ id: "local", name: "Local" })).toBe(false);
});
