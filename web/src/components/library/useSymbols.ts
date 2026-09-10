"use client";

/**
 * The shipped graphic object library, as data.
 *
 * The real index is served, not imported: it is derived from Schneider's own
 * files and gitignored, so importing it would break the build wherever
 * `npm run index:graphics` has not been run.
 *
 * Three states, not two, and that distinction is the whole point of this hook.
 * "Still fetching" and "there is no index on this machine" look identical if
 * both fall back to the placeholders - so the panel showed two symbols, then
 * 474 a moment later, and which one you saw depended on timing. A caller that
 * can tell them apart shows a loading state for the first and an explanation
 * for the second.
 *
 * The result is cached at module scope, so the second visit to the Library is
 * instant and shows no intermediate state at all.
 */

import { useEffect, useState } from "react";
import { placeholderSymbols } from "@/fixtures";

/** The shape `scripts/index-graphics.mjs` writes, plus the geometry it drops. */
export interface Symbol {
  name: string;
  category: string;
  d: string;
  width: number;
  height: number;
  /** Present only once the index carries them; placement needs both. */
  Commands?: string;
  Points?: string;
}

export type SymbolStatus =
  /** The fetch is in flight and nothing should be drawn yet. */
  | "loading"
  /** The installation's own library, indexed. */
  | "indexed"
  /** No index on this machine; the placeholders are standing in. */
  | "unavailable";

export interface SymbolLibrary {
  symbols: Symbol[];
  status: SymbolStatus;
  /** Kept for callers that only care whether these are the real ones. */
  indexed: boolean;
}

/** Module scope, so a second panel does not refetch what the first already has. */
let cached: Symbol[] | null | undefined;
let inflight: Promise<Symbol[] | null> | null = null;

function fetchSymbols(): Promise<Symbol[] | null> {
  if (cached !== undefined) return Promise.resolve(cached);
  inflight ??= fetch("/api/symbols")
    .then((r) => (r.ok ? r.json() : null))
    .then((body) => {
      cached =
        body?.indexed && Array.isArray(body.symbols) && body.symbols.length
          ? (body.symbols as Symbol[])
          : null;
      return cached;
    })
    .catch(() => {
      // Unreachable route. Treated the same as no index: the placeholders
      // stand in and the panel says which it is showing.
      cached = null;
      return cached;
    });
  return inflight;
}

export function useSymbols(): SymbolLibrary {
  // `undefined` is "not asked yet", `null` is "asked, there is no index".
  const [loaded, setLoaded] = useState<Symbol[] | null | undefined>(cached);

  useEffect(() => {
    if (loaded !== undefined) return;
    let live = true;
    void fetchSymbols().then((symbols) => {
      if (live) setLoaded(symbols);
    });
    return () => {
      live = false;
    };
  }, [loaded]);

  if (loaded === undefined) {
    return { symbols: [], status: "loading", indexed: false };
  }
  if (loaded === null) {
    return {
      symbols: placeholderSymbols as Symbol[],
      status: "unavailable",
      indexed: false,
    };
  }
  return { symbols: loaded, status: "indexed", indexed: true };
}

/** A symbol can become a Path part only if it carries the geometry OTE wants. */
export const isPlaceable = (s?: Symbol | null): boolean =>
  !!s && s.Commands !== undefined && s.Points !== undefined;
