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
 *
 * Clicking a tag shows everywhere it is bound: its connectors stay lit, the
 * rest dim, and a panel above lists each binding with its screen, so a tag
 * whose objects sit far down the list is still answered at a glance. Clicking
 * an object property does the reverse: which tags drive that object.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Search, TriangleAlert, X } from "lucide-react";
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
  /** The screen the object is on, for the focus panel. */
  screen?: string;
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

/** What the map is showing everything about: one tag, or one object. */
type Focus = { kind: "tag"; tag: string } | { kind: "object"; key: string; objectId?: string; target?: string };

/** Cut a label to fit a box, by an average glyph width; the full text goes in a tooltip. */
function fit(text: string, width: number, glyph: number): string {
  const max = Math.max(4, Math.floor(width / glyph));
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Whether a row belongs to what is focused. */
function inFocus(row: Row, focus: Focus | null): boolean {
  if (!focus) return true;
  if (focus.kind === "tag") return row.tag === focus.tag;
  return focus.objectId ? row.objectId === focus.objectId : row.key === focus.key;
}

/** The distinct values of a field, without blanks. */
const distinct = (values: (string | undefined)[]) => new Set(values.filter((v): v is string => !!v)).size;

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
  /** Clicked, and kept until clicked again or Escape. */
  const [focus, setFocus] = useState<Focus | null>(null);
  /** Under the pointer: a preview, when nothing is clicked. */
  const [hover, setHover] = useState<Focus | null>(null);
  const lit = focus ?? hover;
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocus(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const parts = useMemo(
    () => screens.flatMap((s) => s.Children[0].Children),
    [screens],
  );

  const rows = useMemo<Row[]>(() => {
    const byId = new Map(parts.map((p) => [p.UniqueId, p]));
    const screenOf = new Map(screens.flatMap((s) => s.Children[0].Children.map((p) => [p.UniqueId, s.Name] as const)));

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
        screen: part ? screenOf.get(part.UniqueId) : undefined,
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
        screen: screenOf.get(finding.objectId),
        kind: "unbound",
      });
    }

    return [...bound, ...unbound];
  }, [bindings, parts, screens, findings]);

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

  /** The rows the clicked thing is part of, in map order, for the panel. */
  const focused = useMemo(() => (focus ? shown.filter((row) => inFocus(row, focus)) : []), [focus, shown]);
  const focusedTags = distinct(focused.map((r) => r.tag));
  const focusedScreens = distinct(focused.map((r) => r.screen));

  const toggle = (next: Focus) =>
    setFocus((current) => {
      const same =
        !!current &&
        (next.kind === "tag"
          ? current.kind === "tag" && current.tag === next.tag
          : current.kind === "object" && current.key === next.key);
      return same ? null : next;
    });

  /** Bring a row of the map into view, and select its object on the canvas. */
  const goTo = (row: Row) => {
    const i = shown.indexOf(row);
    const el = scroller.current;
    if (el && i >= 0) el.scrollTo({ top: Math.max(0, TOP + i * ROW - el.clientHeight / 3), behavior: "smooth" });
    if (row.objectId) select([row.objectId]);
  };

  const onKeys = (e: React.KeyboardEvent, next: Focus) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    toggle(next);
  };

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

      <div ref={scroller} className="min-h-0 flex-1 overflow-auto p-4">
        {shown.length === 0 ? (
          <p className="py-12 text-center text-sm text-text-muted">
            {rows.length === 0
              ? "No bindings yet. Generate a screen, or run Check bindings to find unbound objects."
              : "Nothing matches that filter."}
          </p>
        ) : (
          <>
          {focus && (
            <div className="menu animate-pop sticky left-0 top-0 z-10 mb-3 p-3">
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 text-xs text-text-muted">
                  {focus.kind === "tag" ? (
                    <>
                      <span className="text-ident text-brand-400">{focus.tag}</span> is bound in{" "}
                      <span className="font-medium text-text-primary">
                        {focused.length} place{focused.length === 1 ? "" : "s"}
                      </span>
                      {focusedScreens > 1 && ` on ${focusedScreens} screens`}
                    </>
                  ) : (
                    <>
                      <span className="text-ident text-text-primary">{focus.target}</span>{" "}
                      {focusedTags > 0 ? `is driven by ${focusedTags} tag${focusedTags === 1 ? "" : "s"}` : "is bound to no tag"}
                    </>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => setFocus(null)}
                  aria-label="Show every binding again"
                  title="Show every binding again (Esc)"
                  className="focus-ring rounded-md p-1 text-text-faint transition hover:bg-surface-hover hover:text-text-primary"
                >
                  <X size={13} aria-hidden />
                </button>
              </div>
              <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto">
                {focused.map((row) => (
                  <li key={row.key}>
                    <button
                      type="button"
                      onClick={() => goTo(row)}
                      title="Show it on the map and select it on the canvas"
                      className="focus-ring flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition hover:bg-surface-hover"
                    >
                      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: COLOUR[row.kind] }} />
                      {focus.kind === "object" && row.tag && (
                        <>
                          <span className="text-ident shrink-0 text-brand-400">{row.tag}</span>
                          <ArrowRight size={10} aria-hidden className="shrink-0 text-text-faint" />
                        </>
                      )}
                      <span className="text-ident min-w-0 flex-1 truncate text-text-primary">
                        {row.property ? `${row.target}.${row.property}` : row.target}
                      </span>
                      <span className="shrink-0 text-text-faint">{row.kind === "unbound" ? "unbound" : row.subType}</span>
                      {row.screen && (
                        <span className="shrink-0 rounded border border-line-subtle px-1.5 py-px font-mono text-[10px] text-text-muted">{row.screen}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
                const on = inFocus(row, lit);
                return (
                  <g key={`c${row.key}`} style={{ opacity: on ? 1 : 0.1, transition: "opacity 160ms ease" }}>
                    <path
                      d={curve(y1, y2)}
                      fill="none"
                      stroke={COLOUR[row.kind]}
                      strokeWidth={lit && on ? 2.5 : 1.5}
                    />
                    <path
                      d={`M ${RIGHT_X - 3},${y2} l -7,-4 l 0,8 z`}
                      fill={COLOUR[row.kind]}
                    />
                  </g>
                );
              })}

              {tags.map((tag, i) => {
                const on = !lit || (lit.kind === "tag" ? lit.tag === tag : shown.some((row) => row.tag === tag && inFocus(row, lit)));
                const picked = focus?.kind === "tag" && focus.tag === tag;
                const pick: Focus = { kind: "tag", tag };
                return (
                <g
                  key={`t${tag}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Show where ${tag} is bound`}
                  aria-pressed={picked}
                  onClick={() => toggle(pick)}
                  onKeyDown={(e) => onKeys(e, pick)}
                  onPointerEnter={() => setHover(pick)}
                  onPointerLeave={() => setHover(null)}
                  className="outline-none"
                  style={{ cursor: "pointer", opacity: on ? 1 : 0.35, transition: "opacity 160ms ease" }}
                >
                  <title>{tag}</title>
                  <rect
                    x={LEFT_X}
                    y={TOP + i * ROW}
                    width={LEFT_W}
                    height={BOX}
                    rx={5}
                    fill={picked ? "color-mix(in srgb, var(--color-brand-500) 14%, var(--color-surface-raised))" : "var(--color-surface-raised)"}
                    stroke={picked || (lit?.kind === "tag" && lit.tag === tag) ? "var(--color-brand-400)" : "var(--color-line)"}
                    strokeWidth={picked ? 2 : 1}
                  />
                  <text
                    x={LEFT_X + 12}
                    y={TOP + i * ROW + BOX / 2}
                    dominantBaseline="central"
                    fontFamily="var(--font-mono)"
                    fontSize={12}
                    fill="var(--color-brand-400)"
                  >
                    {fit(tag, LEFT_W - 24, 7.3)}
                  </text>
                </g>
                );
              })}

              {shown.map((row, i) => {
                const y = TOP + i * ROW;
                const active = row.objectId && selectedIds.includes(row.objectId);
                const on = inFocus(row, lit);
                const picked = !!focus && on;
                const label = row.property ? `${row.target}.${row.property}` : (row.target ?? "");
                const type = row.kind === "unbound" ? "unbound" : row.subType;
                const pick: Focus = { kind: "object", key: row.key, objectId: row.objectId, target: row.target };
                return (
                  <g
                    key={row.key}
                    role="button"
                    tabIndex={0}
                    aria-label={`Show which tags drive ${row.target}`}
                    onClick={() => {
                      toggle(pick);
                      if (row.objectId) select([row.objectId]);
                    }}
                    onKeyDown={(e) => onKeys(e, pick)}
                    onPointerEnter={() => setHover(pick)}
                    onPointerLeave={() => setHover(null)}
                    className="outline-none"
                    style={{ cursor: "pointer", opacity: on ? 1 : 0.35, transition: "opacity 160ms ease" }}
                  >
                    <title>{`${label} (${type})${row.screen ? ` on ${row.screen}` : ""}`}</title>
                    <rect
                      x={RIGHT_X}
                      y={y}
                      width={RIGHT_W}
                      height={BOX}
                      rx={5}
                      fill="var(--color-surface-raised)"
                      stroke={active || picked ? "var(--color-brand-400)" : "var(--color-line)"}
                      strokeWidth={active || picked ? 2 : 1}
                    />
                    <text
                      x={RIGHT_X + 12}
                      y={y + BOX / 2}
                      dominantBaseline="central"
                      fontFamily="var(--font-mono)"
                      fontSize={11}
                      fill="var(--color-text-primary)"
                    >
                      {fit(label, RIGHT_W - 36 - type.length * 5.6, 6.7)}
                    </text>
                    <text
                      x={RIGHT_X + RIGHT_W - 12}
                      y={y + BOX / 2}
                      textAnchor="end"
                      dominantBaseline="central"
                      fontSize={10}
                      fill={COLOUR[row.kind]}
                    >
                      {type}
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
          </>
        )}
      </div>
    </div>
  );
}
