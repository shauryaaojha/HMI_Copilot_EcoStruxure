"use client";

/**
 * The binder's proposals, after tags arrive in a project that already has
 * screens (lib/tags/binder.ts). Nothing is bound until the engineer says so:
 * clear matches are ticked, ones the binder could not tell apart are listed
 * and left unbound, the same way the import reports its name corrections.
 */

import { useMemo, useState } from "react";
import { Link2 } from "lucide-react";
import { proposeBindings } from "@/lib/tags/binder";
import { useProject } from "@/store/project";
import { Button, Panel } from "@/components/ui";

export function BindingProposals() {
  const screens = useProject((s) => s.screens);
  const variables = useProject((s) => s.variables);
  const bindings = useProject((s) => s.bindings);
  const objectMeta = useProject((s) => s.objectMeta);
  const setBinding = useProject((s) => s.setBinding);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());

  const proposals = useMemo(
    () => proposeBindings({ screens, variables, bindings, objectMeta }),
    [screens, variables, bindings, objectMeta],
  );
  const clear = proposals.filter((p) => p.tag);
  const unclear = proposals.filter((p) => !p.tag);
  if (proposals.length === 0) return null;

  const ticked = clear.filter((p) => !unticked.has(p.targetId));
  const toggle = (id: string) =>
    setUnticked((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <Panel
      title={`${clear.length} binding${clear.length === 1 ? "" : "s"} proposed`}
      leading={<Link2 size={14} aria-hidden className="text-brand-400" />}
      bordered
      flush
    >
      <ul className="max-h-64 divide-y divide-line-subtle overflow-y-auto border-t border-line-subtle text-xs">
        {clear.map((p) => (
          <li key={p.targetId} className="px-3 py-2">
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={!unticked.has(p.targetId)}
                onChange={() => toggle(p.targetId)}
              />
              <span className="min-w-0">
                <span className="font-mono">
                  {p.targetName}
                  <span aria-hidden className="px-1.5 text-text-muted">→</span>
                  <span className="text-text-primary">{p.tag}</span>
                </span>
                <span className="block text-text-muted">{p.reason}</span>
              </span>
            </label>
          </li>
        ))}
        {unclear.map((p) => (
          <li key={p.targetId} className="px-3 py-2">
            <p className="font-mono text-text-secondary">{p.targetName}: left unbound</p>
            <p className="text-text-muted">{p.reason}. Bind it from the inspector.</p>
          </li>
        ))}
      </ul>
      {clear.length > 0 && (
        <div className="flex justify-end border-t border-line-subtle p-2">
          <Button
            size="sm"
            disabled={ticked.length === 0}
            onClick={() => {
              for (const p of ticked) setBinding(p.targetId, p.property, p.tag!);
              setUnticked(new Set());
            }}
          >
            Bind {ticked.length} ticked
          </Button>
        </div>
      )}
    </Panel>
  );
}
