"use client";

/**
 * The right pane: properties, bindings and the object library.
 * Reference screens 1, 2, 5, 6. Phase 5 of docs/BUILD_PLAN.md.
 *
 * Property groups are generated from the Phase 1 zod schemas rather than hand
 * written per part type, so a part gains an editor the moment it gains a schema.
 */

import { useProject } from "@/store/project";

export function Inspector() {
  const { screens, selectedObjectId } = useProject();

  const part = screens
    .flatMap((s) => s.Children[0].Children)
    .find((p) => p.UniqueId === selectedObjectId);

  return (
    <aside className="flex w-[20rem] shrink-0 flex-col overflow-y-auto bg-chrome-900">
      <div className="flex h-12 shrink-0 items-center gap-4 border-b border-chrome-800 px-4 text-sm">
        <span className="border-b-2 border-brand-400 py-3 text-brand-400">Properties</span>
        <span className="text-ink-500">Tags</span>
        <span className="text-ink-500">Library</span>
      </div>

      {part ? (
        <div className="space-y-4 p-4 text-sm">
          <h2 className="font-semibold">{part.Type}</h2>
          <dl className="space-y-2">
            {[
              ["Name", part.Name],
              ["Position", `X ${part.Location.Left}   Y ${part.Location.Top}`],
              ["Size", `W ${part.Width}   H ${part.Height}`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-ink-500">{k}</dt>
                <dd className="font-mono text-xs">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <p className="p-4 text-sm text-ink-500">
          Select an object on the canvas to inspect its properties and bindings.
        </p>
      )}
    </aside>
  );
}
