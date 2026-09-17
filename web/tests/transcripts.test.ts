/**
 * Transcript replay: recorded multi-turn sessions, run through the applier
 * with the model's answers fixed, checked against the invariants that "after
 * two prompts it makes garbage changes" violated. docs/LLD.md F9.
 *
 * Runs without a key. A change to the applier, the slot resolver or the store
 * that lets any of these through fails here, not in a demo.
 *
 * Invariants, after every turn:
 *   - nothing outside the panel
 *   - no content on top of other content (backgrounds may be covered)
 *   - no duplicate names
 *   - no binding pointing at an object that is not on a screen
 *   - nothing moved that the turn's ops did not name (drift = 0)
 *   - a turn with any rejection changed nothing (dry run discipline)
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { coerceTurn, type Op } from "@/lib/ai/ops";
import { dryRun, commit } from "@/lib/ai/applier";
import { createProjectStore } from "@/store/project";
import type { Part } from "@/lib/ote/schema";
import { demoScreen, demoVariables } from "@/fixtures";

interface Transcript {
  name: string;
  seed: "demo-full" | "demo-sparse";
  turns: {
    request: string;
    turn: unknown;
    expect: { rejected?: number; applied?: number; created?: number; renamed?: number; deleted?: boolean };
  }[];
}

const DIR = join(__dirname, "transcripts");
const transcripts: Transcript[] = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as Transcript);

function seeded(kind: Transcript["seed"]) {
  const store = createProjectStore();
  const screen = structuredClone(demoScreen);
  if (kind === "demo-sparse") screen.Children[0].Children = screen.Children[0].Children.slice(0, 1);
  store.getState().hydrate({
    id: "t",
    name: "Transcript",
    target: { model: "HMIGTO6310", width: 1024, height: 600 },
    screens: [screen],
    activeScreenId: screen.UniqueId,
    variables: structuredClone(demoVariables),
  });
  return store;
}

type Store = ReturnType<typeof seeded>;

const isBackground = (p: Part) => p.Type === "Rectangle";

const overlap = (a: Part, b: Part) =>
  a.Location.Left < b.Location.Left + b.Width &&
  a.Location.Left + a.Width > b.Location.Left &&
  a.Location.Top < b.Location.Top + b.Height &&
  a.Location.Top + a.Height > b.Location.Top;

function checkInvariants(store: Store, label: string) {
  const s = store.getState();
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const screen of s.screens) {
    const view = screen.Children[0];
    const parts = view.Children;
    for (const p of parts) {
      expect(p.Location.Left, `${label}: ${p.Name} left`).toBeGreaterThanOrEqual(0);
      expect(p.Location.Top, `${label}: ${p.Name} top`).toBeGreaterThanOrEqual(0);
      expect(p.Location.Left + p.Width, `${label}: ${p.Name} right edge`).toBeLessThanOrEqual(view.Width);
      expect(p.Location.Top + p.Height, `${label}: ${p.Name} bottom edge`).toBeLessThanOrEqual(view.Height);
      expect(names.has(p.Name), `${label}: duplicate name ${p.Name}`).toBe(false);
      names.add(p.Name);
      ids.add(p.UniqueId);
      expect(s.handles[p.UniqueId], `${label}: ${p.Name} has no handle`).toMatch(/^o\d+$/);
    }
    // Content never on content. Cards and bands are backgrounds; the parts a
    // card holds sit on it by design. Two pieces of content overlapping is the
    // pile the engineer saw.
    const content = parts.filter((p) => !isBackground(p));
    for (let i = 0; i < content.length; i++) {
      for (let j = i + 1; j < content.length; j++) {
        expect(
          overlap(content[i], content[j]),
          `${label}: ${content[i].Name} overlaps ${content[j].Name}`,
        ).toBe(false);
      }
    }
  }
  for (const b of s.bindings) {
    expect(ids.has(b.targetId), `${label}: binding ${b.tag} → ${b.targetName} dangles`).toBe(true);
  }
}

/** Where everything is, keyed by id, to measure drift. */
function positions(store: Store) {
  const out = new Map<string, string>();
  for (const screen of store.getState().screens) {
    for (const p of screen.Children[0].Children) {
      out.set(p.UniqueId, `${p.Location.Left},${p.Location.Top},${p.Width},${p.Height}`);
    }
  }
  return out;
}

/** The handles a turn's ops name, so a move of anything else is drift. */
function named(ops: Op[], store: Store): Set<string> {
  const s = store.getState();
  const byName = new Map<string, string>();
  for (const screen of s.screens) for (const p of screen.Children[0].Children) byName.set(p.Name.toLowerCase(), p.UniqueId);
  const byHandle = new Map(Object.entries(s.handles).map(([id, h]) => [h.toLowerCase(), id]));
  const out = new Set<string>();
  for (const op of ops) {
    for (const ref of [op.target, ...(op.targets ?? [])]) {
      if (!ref) continue;
      const id = byHandle.get(ref.toLowerCase()) ?? byName.get(ref.toLowerCase());
      if (id) out.add(id);
    }
  }
  return out;
}

/** "$handle:N" in a transcript means the handle of the Nth object created so far. */
function resolvePlaceholders(ops: Op[], createdHandles: string[]): Op[] {
  const swap = (v?: string) => (v && v.startsWith("$handle:") ? createdHandles[Number(v.slice(8))] : v);
  return ops.map((op) => ({
    ...op,
    target: swap(op.target),
    targets: op.targets?.map((t) => swap(t)!),
    place: op.place ? { ...op.place, anchor: swap(op.place.anchor) } : op.place,
  }));
}

describe.each(transcripts)("$name", (transcript) => {
  it("replays with every invariant holding after every turn", () => {
    const store = seeded(transcript.seed);
    checkInvariants(store, "seed");
    const createdHandles: string[] = [];

    transcript.turns.forEach((step, index) => {
      const label = `turn ${index + 1} "${step.request}"`;
      const turn = coerceTurn(step.turn);
      expect(turn, `${label}: transcript turn does not parse`).not.toBeNull();
      const ops = resolvePlaceholders(turn!.ops ?? [], createdHandles);

      const before = positions(store);
      const undoDepth = store.getState().past.length;
      const run = dryRun(ops, store);

      // The live store is untouched by a dry run, whatever happened.
      expect(positions(store), `${label}: dry run touched the live store`).toEqual(before);

      const e = step.expect;
      if (e.rejected !== undefined) expect(run.outcome.rejected.length, `${label}: rejected`).toBe(e.rejected);
      if (e.applied !== undefined) expect(run.outcome.applied.length, `${label}: applied`).toBe(e.applied);
      if (e.created !== undefined) expect(run.outcome.created.length, `${label}: created`).toBe(e.created);
      if (e.renamed !== undefined) expect(run.outcome.renamed.length, `${label}: renamed`).toBe(e.renamed);
      if (e.deleted !== undefined) expect(run.outcome.deleted, `${label}: deleted`).toBe(e.deleted);

      // The client commits only a clean turn; a rejected or deleting turn is a
      // proposal. Replay the same rule: commit when clean, else commit nothing
      // and check the project is exactly as it was.
      const clean = run.outcome.rejected.length === 0 && !run.outcome.deleted;
      if (clean) {
        const allowed = named(ops, store);
        commit(run, label, store);
        expect(store.getState().past.length, `${label}: one undo step`).toBe(undoDepth + 1);

        // Drift: anything that moved and was not named by an op.
        const after = positions(store);
        for (const [id, was] of before) {
          if (after.has(id) && after.get(id) !== was && !allowed.has(id)) {
            const name = store.getState().screens.flatMap((x) => x.Children[0].Children).find((p) => p.UniqueId === id)?.Name;
            throw new Error(`${label}: ${name} moved without being named`);
          }
        }
        for (const c of run.outcome.created) createdHandles.push(c.handle);
      } else {
        expect(positions(store), `${label}: a rejected turn changed the project`).toEqual(before);
        expect(store.getState().past.length, `${label}: a rejected turn pushed undo`).toBe(undoDepth);
      }
      checkInvariants(store, label);
    });
  });
});

describe("the replay harness itself", () => {
  it("found the transcripts", () => {
    expect(transcripts.length).toBeGreaterThanOrEqual(3);
  });
});
