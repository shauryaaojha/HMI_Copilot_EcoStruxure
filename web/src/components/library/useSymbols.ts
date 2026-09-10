"use client";

/**
 * The shipped graphic object library, as data.
 *
 * The real index is served, not imported: it is derived from Schneider's own
 * files and gitignored, so importing it would break the build wherever
 * `npm run index:graphics` has not been run. Placeholders stand in until the
 * route answers, and every caller says which of the two it is showing.
 *
 * One fetch per page load, shared, because both the full-page library and the
 * sidebar panel want the same 474 objects.
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

/** Module-level so a second panel does not refetch what the first already has. */
let cached: Symbol[] | null = null;
let inflight: Promise<Symbol[] | null> | null = null;

function fetchSymbols(): Promise<Symbol[] | null> {
  if (cached) return Promise.resolve(cached);
  inflight ??= fetch("/api/symbols")
    .then((r) => (r.ok ? r.json() : null))
    .then((body) => {
      if (body?.indexed && Array.isArray(body.symbols) && body.symbols.length) {
        cached = body.symbols as Symbol[];
        return cached;
      }
      return null;
    })
    .catch(() => null);
  return inflight;
}

export function useSymbols(): { symbols: Symbol[]; indexed: boolean } {
  const [loaded, setLoaded] = useState<Symbol[] | null>(cached);

  useEffect(() => {
    let live = true;
    void fetchSymbols().then((symbols) => {
      if (live && symbols) setLoaded(symbols);
    });
    return () => {
      live = false;
    };
  }, []);

  return loaded
    ? { symbols: loaded, indexed: true }
    : { symbols: placeholderSymbols as Symbol[], indexed: false };
}

/** A symbol can become a Path part only if it carries the geometry OTE wants. */
export const isPlaceable = (s?: Symbol | null): boolean =>
  !!s && s.Commands !== undefined && s.Points !== undefined;
