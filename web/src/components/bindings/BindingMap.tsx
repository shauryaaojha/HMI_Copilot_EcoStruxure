"use client";

/**
 * The binding map - tags on the left, the object properties they drive on the
 * right, connectors between.
 *
 * Ported from tools/make_binding_map.py and assets/binding_map.png: the same
 * two columns, the same S-curve with horizontal control handles, the same
 * colour split - green where a tag drives a display property, amber where a tag
 * is an alarm trigger. Nothing is hardcoded; it renders whatever graph the
 * project contains.
 *
 * Unbound rows come from the validation findings rather than from a second
 * check of our own, so the map and the validation list cannot disagree about
 * what is bound. That is the Phase 6 exit criterion: delete a binding and the
 * same finding turns a row amber here and appears there, both pointing at the
 * same object.
 *
 * Phase 6 of docs/BUILD_PLAN.md.
 */

import { useMemo, useState } from "react";
import { Search, TriangleAlert } from "lucide-react";
import { useProject } from "@/store/project";
import { useValidation } from "@/components/validation/useValidation";
import { Badge, Button, Input, Tabs, cn, type TabItem } from "@/components/ui";

type Filter = "all" | "bound" | "unbound" | "alarms";

const FILTERS: TabItem<Filter>[] = [
  { id: "all", label: "All" },
  { id: "bound", label: "Bound" },
  { id: "unbound", label: "Unbound" },
  { id: "alarms", label: "Alarms" },
];

/** Geometry, in the SVG's own units. The Python uses the same proportions. */
const ROW = 44;
const TOP = 16;
const BOX = 32;
const LEFT_X = 0;
const LEFT_W = 260;
const RIGHT_X = 470;
const RIGHT_W = 330;
const WIDTH = RIGHT_X + RIGHT_W;

interface Row {
  key: string;
  tag: string;
  /** Absent when the property is unbound. */
  target?: string;
  property?: string;
  subType: string;
  objectId?: string;
  kind: "display" | "alarm" | "unbound";
}

/** An S-curve with horizontal control handles, as connector() draws it. */
function curve(y1: number, y2: number) {
  const x1 = LEFT_W + 10;
  const x2 = RIGHT_X - 14;
  const mid = (x1 + x2) / 2;
  return `M ${x1},${y1} C ${mid},${y1} ${mid},${y2} ${x2},${y2}`;
}

const COLOUR: Record<Row["kind"], string> = {
  display: "var(--color-status-ok)",
  alarm: "var(--color-status-warn)",
  unbound: "var(--color-status-alarm)",
};

export function BindingMap() {
  const bindings = useProject((s) => s.bindings);
  const screens = useProject((s) => s.screens);
  const variables = useProject((s) => s.variables);
  const findings = useProject((s) => s.findings);
  const selectedIds = useProject((s) => s.selectedIds);
  const select = useProject((s) => s.select);
  const { validate, running } = useValidation();

  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const parts = useMemo(
    () => screens.flatMap((s) => s.Children[0].Children),
    [screens],
  );

  const rows = useMemo<Row[]>(() => {
    const byId = new Map(parts.map((p) => [p.UniqueId, p]));

    const bound: Row[] = bindings.map((b, i) => {
      const part = byId.get(b.targetId);
      // The packager binds an alarm through its VariableName property; that is
      // what make_binding_map.py keys the amber connector off too.
      const alarm = b.property === "VariableName";
      return {
        key: `b${i}-${b.tag}-${b.targetName}`,
        tag: b.tag,
        target: b.targetName,
        property: b.property,
        subType: part?.Type ?? (alarm ? "Alarm" : "—"),
        objectId: part?.UniqueId,
        kind: alarm ? "alarm" : "display",
      };
    });

    // Unbound rows are the binding-integrity findings, not a check of our own -
    // which is what stops this view and the validation list disagreeing.
    const seen = new Set<string>();
    const unbound: Row[] = [];
    for (const finding of findings) {
      if (finding.rule !== "binding" || !finding.objectId) continue;
      if (seen.has(finding.objectId)) continue;
      if (bindings.some((b) => b.targetId === finding.objectId)) continue;
      const part = byId.get(finding.objectId);
      if (!part) continue;
      seen.add(finding.objectId);
      unbound.push({
        key: `u-${finding.objectId}`,
        tag: "",
        target: part.Name,
        subType: part.Type,
        objectId: finding.objectId,
        kind: "unbound",
      });
    }

    return [...bound, ...unbound];
  }, [bindings, parts, findings]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === "bound" && row.kind === "unbound") return false;
      if (filter === "unbound" && row.kind !== "unbound") return false;
      if (filter === "alarms" && row.kind !== "alarm") return false;
      if (!needle) return true;
      return (
        row.tag.toLowerCase().includes(needle) ||
        (row.target ?? "").toLowerCase().includes(needle) ||
        row.subType.toLowerCase().includes(needle)
      );
    });
  }, [rows, filter, query]);

  // One left-hand row per distinct tag, in first-appearance order, as the
  // Python lays out one row per source.
  const tags = useMemo(() => {
    const seen: string[] = [];
    for (const row of shown) {
      if (row.tag && !seen.includes(row.tag)) seen.push(row.tag);
    }
    return seen;
  }, [shown]);

  const tagY = new Map(tags.map((tag, i) => [tag, TOP + i * ROW + BOX / 2]));
  const height = TOP + Math.max(tags.length, shown.length) * ROW + TOP;

  const unboundCount = rows.filter((r) => r.kind === "unbound").length;

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line-subtle p-3">
        <Tabs items={FILTERS} value={filter} onChange={setFilter} variant="pill" aria-label="Binding filter" />

        <div className="relative w-56">
          <Search
            size={14}
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tags or objects"
            aria-label="Search bindings"
            className="pl-8"
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-text-muted">
            {variables.length} tags · {rows.filter((r) => r.kind !== "unbound").length} bindings
          </span>
          {unboundCount > 0 && (
            <Badge tone="alarm" dot>
              {unboundCount} unbound
            </Badge>
          )}
          <Button
            variant="secondary"
            size="sm"
            disabled={running}
            onClick={() => void validate()}
            icon={<TriangleAlert size={14} />}
          >
            {running ? "Checking…" : "Check bindings"}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {shown.length === 0 ? (
          <p className="py-12 text-center text-sm text-text-muted">
            {rows.length === 0
              ? "No bindings yet. Generate a screen, or run Check bindings to find unbound objects."
              : "Nothing matches that filter."}
          </p>
        ) : (
          <div className="min-w-[52rem]">
            <div className="mb-2 flex text-[11px] font-semibold tracking-wide text-text-muted">
              <span style={{ width: LEFT_W }}>PLC TAGS</span>
              <span style={{ marginLeft: RIGHT_X - LEFT_W }}>OBJECT PROPERTIES</span>
            </div>

            <svg
              viewBox={`0 0 ${WIDTH} ${height}`}
              width="100%"
              height={height}
              role="img"
              aria-label="Binding map"
            >
              {/* connectors first, so the boxes sit on top of them */}
              {shown.map((row, i) => {
                const y2 = TOP + i * ROW + BOX / 2;
                const y1 = tagY.get(row.tag);
                if (row.kind === "unbound" || y1 === undefined) return null;
                return (
                  <g key={`c${row.key}`}>
                    <path
                      d={curve(y1, y2)}
                      fill="none"
                      stroke={COLOUR[row.kind]}
                      strokeWidth={1.5}
                    />
                    <path
                      d={`M ${RIGHT_X - 3},${y2} l -7,-4 l 0,8 z`}
                      fill={COLOUR[row.kind]}
                    />
                  </g>
                );
              })}

              {tags.map((tag, i) => (
                <g key={`t${tag}`}>
                  <rect
                    x={LEFT_X}
                    y={TOP + i * ROW}
                    width={LEFT_W}
                    height={BOX}
                    rx={5}
                    fill="var(--color-surface-raised)"
                    stroke="var(--color-line)"
                  />
                  <text
                    x={LEFT_X + 12}
                    y={TOP + i * ROW + BOX / 2}
                    dominantBaseline="central"
                    fontFamily="var(--font-mono)"
                    fontSize={12}
                    fill="var(--color-brand-400)"
                  >
                    {tag}
                  </text>
                </g>
              ))}

              {shown.map((row, i) => {
                const y = TOP + i * ROW;
                const active = row.objectId && selectedIds.includes(row.objectId);
                return (
                  <g
                    key={row.key}
                    onClick={() => row.objectId && select([row.objectId])}
                    style={{ cursor: row.objectId ? "pointer" : "default" }}
                  >
                    <rect
                      x={RIGHT_X}
                      y={y}
                      width={RIGHT_W}
                      height={BOX}
                      rx={5}
                      fill="var(--color-surface-raised)"
                      stroke={active ? "var(--color-brand-400)" : "var(--color-line)"}
                      strokeWidth={active ? 2 : 1}
                    />
                    <text
                      x={RIGHT_X + 12}
                      y={y + BOX / 2}
                      dominantBaseline="central"
                      fontFamily="var(--font-mono)"
                      fontSize={11}
                      fill="var(--color-text-primary)"
                    >
                      {row.property ? `${row.target}.${row.property}` : row.target}
                    </text>
                    <text
                      x={RIGHT_X + RIGHT_W - 12}
                      y={y + BOX / 2}
                      textAnchor="end"
                      dominantBaseline="central"
                      fontSize={10}
                      fill={COLOUR[row.kind]}
                    >
                      {row.kind === "unbound" ? "unbound" : row.subType}
                    </text>
                  </g>
                );
              })}
            </svg>

            <ul className="mt-4 space-y-1 text-xs text-text-muted">
              {(
                [
                  ["display", "display binding — tag drives an object property"],
                  ["alarm", "alarm binding — tag is the alarm trigger"],
                  ["unbound", "unbound — the object displays a value nothing drives"],
                ] as const
              ).map(([kind, text]) => (
                <li key={kind} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={cn("h-0.5 w-6 rounded")}
                    style={{ background: COLOUR[kind] }}
                  />
                  {text}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
