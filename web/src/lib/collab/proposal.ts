/**
 * What an AI edit would do to a shared project, worked out on the server.
 *
 * In a shared project nothing the Copilot suggests lands directly (Phase D).
 * Its ops run on a scratch store built from the server snapshot - the same
 * applier the chat uses in the browser (lib/ai/applier.ts) - and the result is
 * kept as StoreChange records: what every member's canvas ghosts, and what
 * goes through the ordinary change log if an editor accepts it.
 *
 * Accepting some ops and not others runs just those ops again, on the snapshot
 * as it is at that moment, so an op that needed a left-out one is rejected and
 * shown rather than half-applied.
 */
import { applyOps, type OpOutcome } from "@/core/ops";
import type { Op } from "@/core/ops";
import { labelOp } from "@/lib/ai/review";
import type { PackageInput } from "@/lib/ote/packager";
import { createProjectStore } from "@/store/project";
import type { ObjectMeta, ScreenPreview } from "@/store/types";
import { diff, docOf } from "./changes";
import type { Doc, StoreChange } from "./types";

/** A dry run's result, in the vocabulary the change log and the canvas share. */
export interface SnapshotRun {
  outcome: OpOutcome;
  changes: StoreChange[];
  /** One line per op, for the per-op ticking in the chat panel. */
  labels: string[];
}

/** A scratch store holding the shared document, with one screen in focus. */
function storeFor(doc: Doc, screenId?: string) {
  const store = createProjectStore();
  store.getState().hydrate({
    ...structuredClone(doc),
    objectMeta: structuredClone(doc.objectMeta ?? {}),
    screenPlacement: structuredClone(doc.screenPlacement ?? {}),
    handles: { ...(doc.handles ?? {}) },
    handleSeq: doc.handleSeq ?? 0,
    activeScreenId: doc.screens.some((s) => s.UniqueId === screenId) ? screenId : doc.screens[0]?.UniqueId,
    selectedIds: [],
  });
  return store;
}

/**
 * The Copilot's provenance on what it touched: a part it created, or one the
 * generator placed and it then changed, is "generated" - not "manual" or
 * "edited", which mark the engineer's own hand (lib/program/regenerate.ts).
 */
function keepGenerated(before: Doc, after: Doc): Doc {
  const had = new Set(before.screens.flatMap((s) => s.Children[0].Children.map((p) => p.UniqueId)));
  const meta: Record<string, ObjectMeta> = { ...after.objectMeta };
  for (const screen of after.screens) {
    for (const part of screen.Children[0].Children) {
      const was = before.objectMeta?.[part.UniqueId]?.origin;
      const now = meta[part.UniqueId]?.origin;
      if (!had.has(part.UniqueId)) meta[part.UniqueId] = { ...meta[part.UniqueId], origin: "generated" };
      else if (was === "generated" && now === "edited") meta[part.UniqueId] = { ...meta[part.UniqueId], origin: "generated" };
    }
  }
  return { ...after, objectMeta: meta };
}

/** Run chat ops against a snapshot; the snapshot itself is not changed. */
export function dryRunOnSnapshot(doc: Doc, ops: Op[], screenId?: string): SnapshotRun {
  const before = docOf(doc);
  const store = storeFor(before, screenId);
  const outcome = applyOps(ops, store);
  const after = keepGenerated(before, docOf(store.getState()));
  return { outcome, changes: diff(before, after), labels: ops.map(labelOp) };
}

/**
 * The changes that turn a snapshot into what the agent loop ended with: its
 * screens, alarms and wires, with everything it placed marked as generated.
 */
export function agentChanges(doc: Doc, result: PackageInput): StoreChange[] {
  const before = docOf(doc);
  const bindings = result.wires.map((w) => ({
    tag: w.tag,
    targetId: w.part.UniqueId,
    targetName: w.part.Name,
    property: w.property,
    ...(w.converter ? { converter: w.converter } : {}),
  }));
  const after = keepGenerated(before, { ...before, screens: result.screens, alarms: result.alarms, bindings });
  return diff(before, after);
}

/**
 * What a list of changes would show on each screen of `doc`, for the canvas
 * ghosts: parts that appear, parts that go, parts whose box moves.
 */
export function previewOfChanges(doc: Doc, changes: StoreChange[]): Record<string, ScreenPreview> {
  const out: Record<string, ScreenPreview> = {};
  const parts = new Map(doc.screens.flatMap((s) => s.Children[0].Children.map((p) => [p.UniqueId, p] as const)));
  const at = (screenId: string) => (out[screenId] ??= { added: [], removed: [], moved: [] });
  const box = (p: { Location: { Left: number; Top: number }; Width?: number; Height?: number }) => ({
    left: p.Location.Left,
    top: p.Location.Top,
    width: p.Width ?? 0,
    height: p.Height ?? 0,
  });
  for (const change of changes) {
    if (change.kind === "setPart") {
      const old = parts.get(change.part.UniqueId);
      if (!old) {
        at(change.screenId).added.push(change.part);
        continue;
      }
      const from = box(old);
      const to = box(change.part);
      if (from.left !== to.left || from.top !== to.top || from.width !== to.width || from.height !== to.height) {
        at(change.screenId).moved.push({ id: old.UniqueId, from, to });
      }
    } else if (change.kind === "removePart") {
      if (parts.has(change.partId)) at(change.screenId).removed.push(change.partId);
    } else if (change.kind === "removeScreen") {
      const screen = doc.screens.find((s) => s.UniqueId === change.screenId);
      if (screen) at(screen.UniqueId).removed.push(...screen.Children[0].Children.map((p) => p.UniqueId));
    } else if (change.kind === "addScreen") {
      at(change.screen.UniqueId).added.push(...change.screen.Children[0].Children);
    }
  }
  return out;
}
