"use client";

/**
 * The graphic object library - reference screen 4's second half.
 *
 * The product ships 475 objects under
 * Buildtime/PropertyDefinitions/ScreenDesign/GraphicObjects/. `npm run
 * index:graphics` converts them on a machine that has the installation; the
 * output is gitignored, because they are Schneider's files. Until then this
 * browses `placeholderSymbols` until /api/symbols answers with the real index.
 *
 * Placing one is deliberately unavailable, and the panel says why. A Path part
 * needs the Commands and Points the .path file carries, and the current index
 * stores only the SVG `d` it derived from them - see the note in the panel. A
 * "place" button that produced an object the packager cannot emit would break
 * the one rule in docs/BUILD_PLAN.md, which is exactly the failure this product
 * is meant to make impossible.
 *
 * Phase 2b / Phase 9 of docs/BUILD_PLAN.md.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Info, Plus, Search } from "lucide-react";
import { placeholderSymbols } from "@/fixtures";
import { Badge, Button, Input, Panel, Tabs, cn, type TabItem } from "@/components/ui";
import { useProject } from "@/store/project";
import { pathPart } from "@/lib/ote/parts";

/** The shape `scripts/index-graphics.mjs` writes, plus the geometry it drops. */
interface Symbol {
  name: string;
  category: string;
  d: string;
  width: number;
  height: number;
  /** Present only once the index carries them; placement needs both. */
  Commands?: string;
  Points?: string;
}

/**
 * The real index is served, not imported: it is derived from Schneider's own
 * files and gitignored, so importing it would break the build wherever
 * `npm run index:graphics` has not been run. Placeholders stand in until it
 * answers, and the footer says which of the two you are looking at.
 */
function useSymbols(): { symbols: Symbol[]; indexed: boolean } {
  const [loaded, setLoaded] = useState<Symbol[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/symbols")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (live && body?.indexed && Array.isArray(body.symbols) && body.symbols.length) {
          setLoaded(body.symbols as Symbol[]);
        }
      })
      .catch(() => {
        // No index, or the route is unreachable. The placeholders stand.
      });
    return () => {
      live = false;
    };
  }, []);

  return loaded
    ? { symbols: loaded, indexed: true }
    : { symbols: placeholderSymbols, indexed: false };
}

export function LibraryScreen() {
  const { symbols, indexed } = useSymbols();
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [pickedName, setPickedName] = useState<string | null>(null);

  // Held by name, not by object: the list is replaced wholesale when the real
  // index arrives, and a selection holding a placeholder would survive it.
  const picked = symbols.find((s) => s.name === pickedName) ?? symbols[0] ?? null;
  const setPicked = (s: Symbol | null) => setPickedName(s?.name ?? null);

  const categories = useMemo(
    () => ["All", ...new Set(symbols.map((s) => s.category))],
    [],
  );
  const tabs: TabItem<string>[] = categories.map((c) => ({ id: c, label: c }));

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return symbols.filter((symbol) => {
      if (category !== "All" && symbol.category !== category) return false;
      return !needle || symbol.name.toLowerCase().includes(needle);
    });
  }, [category, query]);

  const placeable = picked?.Commands !== undefined && picked?.Points !== undefined;

  const router = useRouter();
  const projectId = useProject((s) => s.id);
  const screens = useProject((s) => s.screens);
  const activeScreenId = useProject((s) => s.activeScreenId);
  const appendObject = useProject((s) => s.appendObject);
  const select = useProject((s) => s.select);
  const logLine = useProject((s) => s.log);

  const screen = screens.find((x) => x.UniqueId === activeScreenId) ?? screens[0];
  const screenName = screen?.Name;

  /**
   * Builds a real Path part and puts it in the store.
   *
   * pathPart() is the same factory the packager writes from, so what lands on
   * the canvas is exactly what an export would contain - the symbol is not
   * redrawn here from the SVG the panel previews.
   */
  function place(symbol: (typeof symbols)[number]) {
    if (!screen || symbol.Commands === undefined || symbol.Points === undefined) return;

    const view = screen.Children[0];
    const size = Math.min(160, view.Width / 6);
    // Nudge each placement so a second symbol does not land under the first.
    const placed = view.Children.filter((p) => p.Type === "Path").length;
    const part = pathPart(
      `Sym_${symbol.name.replace(/[^A-Za-z0-9_]/g, "")}`,
      { Commands: symbol.Commands, Points: symbol.Points },
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
    router.push(`/project/${projectId}`);
  }

  return (
    <div className="grid h-full min-h-0 gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="flex min-h-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs
            items={tabs}
            value={category}
            onChange={setCategory}
            variant="pill"
            aria-label="Symbol category"
          />
          <div className="relative ml-auto w-56">
            <Search
              size={14}
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search symbols"
              aria-label="Search symbols"
              className="pl-8"
            />
          </div>
        </div>

        <ul className="grid min-h-0 flex-1 auto-rows-min gap-3 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {shown.map((symbol) => (
            <li key={`${symbol.category}/${symbol.name}`}>
              <button
                type="button"
                onClick={() => setPicked(symbol)}
                aria-pressed={picked?.name === symbol.name}
                className={cn(
                  "focus-ring flex w-full flex-col items-center gap-2 rounded-panel border p-3 transition",
                  picked?.name === symbol.name
                    ? "border-brand-400 bg-brand-500/5"
                    : "border-line-subtle bg-surface-raised hover:border-line-strong",
                )}
              >
                <svg
                  viewBox={`0 0 ${symbol.width || 1} ${symbol.height || 1}`}
                  className="h-16 w-full"
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
                <span className="w-full truncate text-center text-[11px] text-text-secondary">
                  {symbol.name}
                </span>
              </button>
            </li>
          ))}

          {shown.length === 0 && (
            <li className="col-span-full rounded-panel border border-dashed border-line p-10 text-center text-sm text-text-muted">
              No symbol matches that search.
            </li>
          )}
        </ul>
      </div>

      <div className="space-y-4">
        <Panel title="Symbol" bordered>
          {!picked ? (
            <p className="text-sm text-text-muted">Pick a symbol to see its details.</p>
          ) : (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-text-muted">Name</dt>
                <dd className="font-mono text-xs">{picked.name}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-text-muted">Category</dt>
                <dd className="font-mono text-xs">{picked.category}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-text-muted">Natural size</dt>
                <dd className="font-mono text-xs">
                  {picked.width} × {picked.height}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-text-muted">Placeable</dt>
                <dd>
                  <Badge tone={placeable ? "ok" : "warn"}>
                    {placeable ? "yes" : "not yet"}
                  </Badge>
                </dd>
              </div>
            </dl>
          )}
        </Panel>

        {placeable ? (
          <Button
            variant="primary"
            block
            icon={<Plus size={15} />}
            onClick={() => place(picked!)}
          >
            Place on {screenName ?? "the screen"}
          </Button>
        ) : (
          <Panel
            title="Why placing is unavailable"
            leading={<Info size={14} aria-hidden className="text-status-info" />}
            bordered
          >
            <div className="space-y-2 text-xs text-text-muted">
              <p>
                A <code className="font-mono text-text-secondary">Path</code> part is
                written into the .eote from the{" "}
                <code className="font-mono text-text-secondary">Commands</code> and{" "}
                <code className="font-mono text-text-secondary">Points</code> the
                product&apos;s own .path file carries.
              </p>
              <p>
                This symbol carries only the SVG{" "}
                <code className="font-mono text-text-secondary">d</code> derived from
                those two, so it cannot become a part the packager can emit. Placing
                it anyway would put an object on the canvas no export could contain —
                the one thing docs/BUILD_PLAN.md forbids.
              </p>
              <p>
                Run <code className="font-mono">npm run index:graphics</code> on a
                machine with EcoStruxure installed; the button appears on its own.
              </p>
            </div>
          </Panel>
        )}

        <p className="text-xs text-text-faint">
          {indexed ? (
            <>
              {symbols.length.toLocaleString()} symbols, indexed from the
              installation&apos;s own graphic object library.
            </>
          ) : (
            <>
              Showing {symbols.length} placeholder symbols. Run{" "}
              <code className="font-mono">npm run index:graphics</code> on a machine
              with EcoStruxure installed for the ones the product ships.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
