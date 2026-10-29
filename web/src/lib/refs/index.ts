/**
 * Every reference the project holds to a tag or an object, and the two
 * cascades that keep them honest: renaming tags, and removing objects.
 *
 * The store used to write these inline in each action, so a new place that
 * held a reference was easy to miss. They live here now, as plain functions on
 * plain values; the store calls them and nothing else touches the rules.
 */

import type { CompositeInstance } from "@/store/types";
import type { Equipment } from "@/types/events";

/**
 * The fields that hold a tag name. Anything else that is a string is text
 * (a caption, a label) and is never renamed, even when it looks like a tag.
 * Composites and program readings use these; equipment keeps its tags in a list.
 */
export const TAG_REF_KEYS: ReadonlySet<string> = new Set(["tag", "runTag", "faultTag"]);

/**
 * Rewrites every tag reference in a composite or program tree: renames the
 * matched ones, removes the unmatched. An optional field goes; a list item
 * that needs a tag (a KPI, a callout) leaves its list.
 */
export function retagRefs<T>(node: T, renames: Record<string, string>, dropped: ReadonlySet<string>): T {
  return retagNode(node, renames, dropped) as T;
}

function retagNode(node: unknown, renames: Record<string, string>, dropped: ReadonlySet<string>): unknown {
  if (Array.isArray(node)) {
    return node.flatMap((item) => {
      const tag = (item as { tag?: unknown } | null)?.tag;
      if (typeof tag === "string" && dropped.has(tag)) return [];
      return [retagNode(item, renames, dropped)];
    });
  }
  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node).flatMap(([key, value]) => {
        if (TAG_REF_KEYS.has(key) && typeof value === "string") {
          return dropped.has(value) ? [] : [[key, renames[value] ?? value]];
        }
        return [[key, retagNode(value, renames, dropped)]];
      }),
    );
  }
  return node;
}

/** Equipment keeps its tag names in a list: renamed, or removed when unmatched. */
export function retagEquipment(units: Equipment[], renames: Record<string, string>, dropped: ReadonlySet<string>): Equipment[] {
  return units.map((unit) => ({
    ...unit,
    tags: unit.tags.filter((tag) => !dropped.has(tag)).map((tag) => renames[tag] ?? tag),
  }));
}

/**
 * The composites and bindings that remain once objects are gone. A binding
 * whose target is gone would export as a dangling reference; a composite that
 * lost any part is no longer one, and what is left is ordinary parts.
 */
export function withoutObjects<B extends { targetId: string }>(
  bindings: B[],
  composites: Record<string, CompositeInstance>,
  removed: ReadonlySet<string>,
): { bindings: B[]; composites: Record<string, CompositeInstance> } {
  return {
    bindings: bindings.filter((b) => !removed.has(b.targetId)),
    composites: Object.fromEntries(
      Object.entries(composites).filter(([, instance]) => !instance.partIds.some((id) => removed.has(id))),
    ),
  };
}
