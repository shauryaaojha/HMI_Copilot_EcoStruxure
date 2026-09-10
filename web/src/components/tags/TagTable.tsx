"use client";

/**
 * The tag table from reference screen 3 and the inspector's Tags tab.
 *
 * A tag export is routinely a few thousand rows, so the list is windowed by a
 * simple cap-and-count rather than rendered whole - the engineer is searching,
 * not scrolling to row 1,248.
 *
 * Phase 3 of docs/BUILD_PLAN.md.
 */

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { DATA_TYPES, type Variable } from "@/lib/ote/schema";
import { Badge, Input, Select, cn, type BadgeTone } from "@/components/ui";

/** Type -> chip colour. BOOL reads as a state, the numerics as data. */
const TONE: Record<string, BadgeTone> = {
  BOOL: "brand",
  STRING: "warn",
  REAL: "info",
  LREAL: "info",
};

const PAGE = 200;

export interface TagTableProps {
  variables: Variable[];
  /** Highlighted rows - the tags a selected object is bound to. */
  highlight?: string[];
  onPick?: (tag: Variable) => void;
  compact?: boolean;
  className?: string;
}

export function TagTable({
  variables,
  highlight = [],
  onPick,
  compact = false,
  className,
}: TagTableProps) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [limit, setLimit] = useState(PAGE);

  const lit = useMemo(() => new Set(highlight), [highlight]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return variables.filter((v) => {
      if (type !== "all" && v.DataType !== type) return false;
      if (!needle) return true;
      return (
        v.Name.toLowerCase().includes(needle) ||
        v.Comments.toLowerCase().includes(needle) ||
        v.DeviceAddress.toLowerCase().includes(needle)
      );
    });
  }, [variables, query, type]);

  const shown = matches.slice(0, limit);

  const options = [
    { value: "all", label: "All types" },
    ...DATA_TYPES.filter((t) => variables.some((v) => v.DataType === t)).map((t) => ({
      value: t,
      label: t,
    })),
  ];

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex shrink-0 items-center gap-2 pb-2">
        <div className="relative min-w-0 flex-1">
          <Search
            size={14}
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint"
          />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
            placeholder="Search tags"
            aria-label="Search tags"
            className="pl-8"
          />
        </div>
        {options.length > 1 && (
          <Select
            aria-label="Filter by data type"
            className="w-32 shrink-0"
            value={type}
            options={options}
            onChange={(e) => {
              setType(e.target.value);
              setLimit(PAGE);
            }}
          />
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-line-subtle">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-surface-raised text-text-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                PLC Tag
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Type
              </th>
              {!compact && (
                <>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Address
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Comment
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {shown.map((variable) => (
              <tr
                key={variable.Name}
                onClick={() => onPick?.(variable)}
                className={cn(
                  "border-t border-line-subtle",
                  lit.has(variable.Name) && "bg-brand-500/10",
                  onPick && "cursor-pointer hover:bg-surface-hover",
                )}
              >
                <td className="px-3 py-1.5 font-mono text-text-primary">
                  {variable.Name}
                </td>
                <td className="px-3 py-1.5">
                  <Badge tone={TONE[variable.DataType] ?? "neutral"}>
                    {variable.DataType}
                  </Badge>
                </td>
                {!compact && (
                  <>
                    <td className="px-3 py-1.5 font-mono text-text-faint">
                      {variable.DeviceAddress || "—"}
                    </td>
                    <td className="px-3 py-1.5 text-text-muted">
                      {variable.Comments || "—"}
                    </td>
                  </>
                )}
              </tr>
            ))}

            {shown.length === 0 && (
              <tr>
                <td
                  colSpan={compact ? 2 : 4}
                  className="px-3 py-8 text-center text-text-faint"
                >
                  {variables.length === 0
                    ? "No tags imported yet."
                    : "No tag matches that search."}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {matches.length > shown.length && (
          <button
            type="button"
            onClick={() => setLimit((n) => n + PAGE)}
            className="focus-ring w-full border-t border-line-subtle py-2 text-xs text-text-muted transition hover:bg-surface-hover hover:text-text-secondary"
          >
            Showing {shown.length.toLocaleString()} of {matches.length.toLocaleString()}
            {" — load more"}
          </button>
        )}
      </div>
    </div>
  );
}
