"use client";

/**
 * Bind the selected object to a tag, from the inspector.
 *
 * Until now a binding could be made by the generator or by asking the
 * copilot, and the inspector could only report one. An engineer placing a
 * lamp by hand had no way to say what drives it short of typing a sentence.
 * This is the direct route: the tags the part can legitimately take, by
 * type, and a way to clear it.
 *
 * The property is the one validation checks (VALUE_PROPERTY), so what this
 * writes and what the rules read cannot disagree. Parts with no live value -
 * a rectangle, a label, a scale - say so instead of offering a list. A trend
 * names its tags on its channels, so it points there.
 */

import { Link2Off } from "lucide-react";
import type { Part, Variable } from "@/lib/ote/schema";
import { ACCEPTS, VALUE_PROPERTY } from "@/lib/validation/rules";
import type { Binding } from "@/store/types";
import { useProject } from "@/store/project";
import { Badge, Select, cn } from "@/components/ui";

const NONE = "";

export function BindingEditor({
  part,
  bound,
  variables,
  locked,
}: {
  part: Part;
  bound: Binding[];
  variables: Variable[];
  locked: boolean;
}) {
  const setBinding = useProject((s) => s.setBinding);
  const property = VALUE_PROPERTY[part.Type];

  if (part.Type === "TrendGraph" || part.Type === "BlockTrend") {
    return (
      <p className="text-[11px] leading-snug text-text-muted">
        A trend names its tags on its channels. Set each channel&apos;s Variable under Trend
        below.
      </p>
    );
  }

  if (!property) {
    return (
      <p className="text-[11px] leading-snug text-text-faint">
        A {part.Type} has no live value to bind.
      </p>
    );
  }

  const accepts = ACCEPTS[part.Type] ?? [];
  const current = bound.find((b) => b.property === property);
  const eligible = variables.filter((v) => accepts.includes(v.DataType));
  const others = variables.filter((v) => !accepts.includes(v.DataType));
  // A binding made before the tag list changed may name a tag that is no
  // longer eligible, or no longer present. It is shown, and marked.
  const stale = current && !eligible.some((v) => v.Name === current.tag);

  const options = [
    { value: NONE, label: "Unbound" },
    ...eligible.map((v) => ({
      value: v.Name,
      label: v.Comments ? `${v.Name} — ${v.Comments}` : v.Name,
    })),
    ...(stale && current ? [{ value: current.tag, label: `${current.tag} (not in the tag list)` }] : []),
    ...(others.length > 0
      ? [{ value: "__others", label: `— ${others.length} tags of other types —`, disabled: true }]
      : []),
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Select
          aria-label={`Tag driving ${property}`}
          size="sm"
          disabled={locked || variables.length === 0}
          value={current?.tag ?? NONE}
          options={options}
          onChange={(e) => setBinding(part.UniqueId, property, e.target.value || null)}
        />
        {current && (
          <button
            type="button"
            disabled={locked}
            onClick={() => setBinding(part.UniqueId, property, null)}
            title="Unbind"
            aria-label="Unbind"
            className="focus-ring shrink-0 rounded-md p-1.5 text-text-faint transition hover:bg-surface-hover hover:text-status-warn disabled:opacity-50"
          >
            <Link2Off size={13} aria-hidden />
          </button>
        )}
      </div>

      <p className={cn("text-[11px] leading-snug", current ? "text-text-muted" : "text-text-faint")}>
        {current ? (
          <>
            <span className="font-mono text-brand-400">{current.tag}</span> drives {property}.
            {stale && <span className="text-status-warn"> Not in the tag list.</span>}
          </>
        ) : variables.length === 0 ? (
          "Import a tag export first."
        ) : eligible.length === 0 ? (
          `No ${accepts.join("/")} tags to bind.`
        ) : (
          <>
            Takes <span className="font-mono">{accepts.join(", ")}</span>.
          </>
        )}
      </p>

      {!current && <Badge tone="warn" dot>Unbound</Badge>}
    </div>
  );
}
