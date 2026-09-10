"use client";

/**
 * The Tag Summary panel from reference screen 3: a total, then a count per
 * data type.
 *
 * The types listed are whichever ones the import actually produced, in the
 * order lib/ote/schema.ts declares them - a hardcoded BOOL/INT/REAL/STRING
 * would be wrong for the first project that uses a DINT.
 */

import { DATA_TYPES } from "@/lib/ote/schema";
import { useProject } from "@/store/project";
import { Panel } from "@/components/ui";

export function TagSummary({ className }: { className?: string }) {
  const variables = useProject((s) => s.variables);

  const counts = new Map<string, number>();
  for (const variable of variables) {
    counts.set(variable.DataType, (counts.get(variable.DataType) ?? 0) + 1);
  }
  const present = DATA_TYPES.filter((type) => counts.has(type));

  return (
    <Panel title="Tag Summary" bordered className={className}>
      <dl className="divide-y divide-line-subtle">
        <div className="flex items-baseline justify-between py-2">
          <dt className="text-sm font-medium">Total Tags</dt>
          <dd className="text-sm font-semibold tabular-nums">
            {variables.length.toLocaleString()}
          </dd>
        </div>

        {present.length === 0 ? (
          <p className="py-2 text-xs text-text-faint">
            Import a tag export and the breakdown appears here.
          </p>
        ) : (
          present.map((type) => (
            <div key={type} className="flex items-baseline justify-between py-2">
              <dt className="font-mono text-xs text-text-muted">{type}</dt>
              <dd className="text-sm tabular-nums text-text-secondary">
                {counts.get(type)!.toLocaleString()}
              </dd>
            </div>
          ))
        )}
      </dl>
    </Panel>
  );
}
