"use client";

/**
 * The object library as a sidebar, beside the canvas rather than instead of it.
 *
 * The full-page library at /project/x/library is a catalogue - filter, inspect,
 * read the natural size. This is the working version: search, a dense grid of
 * previews, and a click that puts the symbol on the screen you are looking at.
 * Placing something on a canvas you cannot see was the reason the full page was
 * the wrong home for it.
 *
 * Placing builds a real Path part through the same factory the packager writes
 * from, so what lands on the canvas is exactly what the export will contain. A
 * symbol whose index entry carries no Commands/Points cannot become a part the
 * packager can emit, so it is shown greyed with the reason rather than placed -
 * the one rule in docs/BUILD_PLAN.md, enforced at the point of temptation.
 */

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { pathPart } from "@/lib/ote/parts";
import { useProject } from "@/store/project";
import { Input, Select, cn } from "@/components/ui";
import { isPlaceable, useSymbols, type Symbol } from "./useSymbols";

export function LibraryPanel() {
  const { symbols, status } = useSymbols();
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");

  const screens = useProject((s) => s.screens);
  const activeScreenId = useProject((s) => s.activeScreenId);
  const appendObject = useProject((s) => s.appendObject);
  const select = useProject((s) => s.select);
  const logLine = useProject((s) => s.log);

  const screen = screens.find((x) => x.UniqueId === activeScreenId) ?? screens[0];

  const categories = useMemo(
    () => ["All", ...new Set(symbols.map((s) => s.category))].sort(),
    [symbols],
  );

  // A category chosen from the placeholders would survive the real index
  // arriving and filter the grid down to nothing.
  const active = categories.includes(category) ? category : "All";

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return symbols
      .filter((symbol) => {
        if (active !== "All" && symbol.category !== active) return false;
        return !needle || symbol.name.toLowerCase().includes(needle);
      })
      .slice(0, 300);
  }, [symbols, category, query]);

  function place(symbol: Symbol) {
    if (!screen || !isPlaceable(symbol)) return;
    const view = screen.Children[0];
    const size = Math.min(160, view.Width / 6);
    // Nudge each placement so a second symbol does not land under the first.
    const placed = view.Children.filter((p) => p.Type === "Path").length;
    const part = pathPart(
      `Sym_${symbol.name.replace(/[^A-Za-z0-9_]/g, "")}`,
      { Commands: symbol.Commands!, Points: symbol.Points! },
      {
        left: Math.round(40 + (placed % 4) * (size + 20)),
        top: Math.round(96 + Math.floor(placed / 4) * (size + 20)),
        width: Math.round(size),
        height: Math.round(size),
      },
    );
    appendObject(screen.UniqueId, part);
    select([part.UniqueId]);
    logLine(`Placed ${symbol.name} on ${screen.Name}`);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 p-3">
        <div className="relative">
          <Search
            size={13}
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search symbols"
            aria-label="Search symbols"
            className="pl-7 text-xs"
          />
        </div>
        <Select
          value={active}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Symbol category"
          options={categories.map((c) => ({ value: c, label: c }))}
        />
      </div>

      <ul className="grid min-h-0 flex-1 auto-rows-min grid-cols-3 gap-1.5 overflow-y-auto px-3 pb-3">
        {shown.map((symbol) => {
          const can = isPlaceable(symbol);
          return (
            <li key={`${symbol.category}/${symbol.name}`}>
              <button
                type="button"
                disabled={!can || !screen}
                onClick={() => place(symbol)}
                title={
                  can
                    ? `Place ${symbol.name} on ${screen?.Name ?? "the screen"}`
                    : `${symbol.name} — the index carries no Commands/Points, so no Path part can be written from it`
                }
                className={cn(
                  "focus-ring flex w-full flex-col items-center gap-1 rounded-md border p-1.5 transition",
                  can
                    ? "border-line-subtle bg-surface-raised hover:border-brand-400 hover:bg-brand-500/5"
                    : "cursor-not-allowed border-dashed border-line-subtle opacity-45",
                )}
              >
                <svg
                  viewBox={`0 0 ${symbol.width || 1} ${symbol.height || 1}`}
                  className="h-9 w-full"
                  role="img"
                  aria-label={symbol.name}
                  preserveAspectRatio="xMidYMid meet"
                >
                  <path
                    d={symbol.d}
                    fill="var(--color-text-muted)"
                    stroke="var(--color-text-faint)"
                    strokeWidth={2}
                  />
                </svg>
                <span className="w-full truncate text-center text-[9px] leading-tight text-text-muted">
                  {symbol.name}
                </span>
              </button>
            </li>
          );
        })}

        {shown.length === 0 && (
          <li className="col-span-full rounded-md border border-dashed border-line p-6 text-center text-xs text-text-muted">
            {status === "loading"
              ? "Reading the graphic object library…"
              : "No symbol matches that search."}
          </li>
        )}
      </ul>

      <p className="shrink-0 border-t border-line-subtle px-3 py-2 text-[10px] leading-relaxed text-text-faint">
        {status === "loading" ? (
          <>Reading the graphic object library…</>
        ) : status === "indexed" ? (
          <>
            {symbols.length.toLocaleString()} symbols from the installation
            {shown.length >= 300 && " · showing the first 300, narrow the search"}
          </>
        ) : (
          <>
            {symbols.length} placeholders. Run{" "}
            <code className="font-mono">npm run index:graphics</code> on a machine with
            EcoStruxure installed.
          </>
        )}
      </p>
    </div>
  );
}
