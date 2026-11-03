/**
 * What a part needs to know about the project it is drawn in, passed down as
 * a prop.
 *
 * These were React contexts. A context cannot be created or read in a route
 * handler: Next bundles route code with React's server build, which has no
 * createContext and no hooks, so the screen rasteriser (lib/critic/render.ts,
 * behind render_screen and the critic) could not draw a single part
 * (docs/DEFECT_SERVER_RENDER.md). As a prop the same parts draw in the editor
 * and on the server, from one code path.
 */
import type { Screen } from "@/lib/ote/schema";
import type { Look } from "@/lib/ote/co-look";

/** A carried object with its box and, for a Compound Object, how it looks. */
export interface Carried {
  box: { left: number; top: number; width: number; height: number } | null;
  look?: Look;
}

export interface DrawEnv {
  /** The content screens of the project, keyed by the number a display names them by. */
  contents: Map<number, Screen>;
  /** How many content displays deep this part is; the limit stops a content that shows itself. */
  depth: number;
  /** Carried objects per screen id, so a content screen's Compound Objects show in its display. */
  carried?: Record<string, Carried[]>;
  /** Where a picture's bytes are served from, by SHA-1; null draws the placeholder. */
  pictureUrl: (sha: string) => string | null;
}

export const DEFAULT_ENV: DrawEnv = {
  contents: new Map(),
  depth: 0,
  pictureUrl: (sha) => `/api/picture/${sha}`,
};
