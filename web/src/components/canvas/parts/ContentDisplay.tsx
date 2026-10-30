/**
 * A ContentDisplay: a window onto a content screen, chosen by number.
 *
 * Schneider's templates are built this way - GPS_Slider01 is one screen of
 * displays over eighteen content screens - so drawing the display as an empty
 * frame showed nothing of the template at all. It draws the content screen's
 * own parts instead, scaled from the content's box into the display's.
 *
 * The content screens come from context rather than props because a display
 * can sit anywhere in the part tree, and a content screen can hold displays of
 * its own. The depth limit stops a content that shows itself from recursing.
 */

import { createContext, useContext } from "react";
import { rootBox, type Screen } from "@/lib/ote/schema";
import { fill, type PartOf } from "./geometry";
import { PartNode, type AlarmRow } from "./index";
import type { Look } from "@/lib/ote/co-look";

/** A carried object with its box and, for a Compound Object, how it looks. */
export interface Carried {
  box: { left: number; top: number; width: number; height: number } | null;
  look?: Look;
}

export interface ContentScreensValue {
  byId: Map<number, Screen>;
  depth: number;
  /** Carried objects per screen id, so a content screen's Compound Objects show in its display. */
  carried?: Record<string, Carried[]>;
}

export const ContentScreens = createContext<ContentScreensValue>({ byId: new Map(), depth: 0 });

/** The content screens of a project, keyed by the number a display names them by. */
export function contentsById(screens: Screen[]): Map<number, Screen> {
  const map = new Map<number, Screen>();
  for (const s of screens) if (s.Type === "Content" && typeof s.ContentID === "number") map.set(s.ContentID, s);
  return map;
}

const MAX_DEPTH = 3;

export function ContentDisplayPart({ part, alarms }: { part: PartOf<"ContentDisplay">; alarms: AlarmRow[] }) {
  const { byId, depth, carried } = useContext(ContentScreens);
  const x = part.Location.Left;
  const y = part.Location.Top;
  const width = part.Width ?? 0;
  const height = part.Height ?? 0;
  const content = part.ScreenId !== undefined ? byId.get(part.ScreenId) : undefined;
  const background = fill(part, "Fill", "none");

  if (!content || depth >= MAX_DEPTH) {
    // Nothing to show: say which content it would show, rather than a hole.
    return (
      <g>
        <rect
          x={x + 0.5}
          y={y + 0.5}
          width={Math.max(0, width - 1)}
          height={Math.max(0, height - 1)}
          fill={background}
          stroke="#8a8f98"
          strokeDasharray="4 3"
        />
        <text x={x + 6} y={y + 14} fontSize={11} fill="#8a8f98">
          {content ? content.Name : `Content ${part.ScreenId ?? "?"}`}
        </text>
      </g>
    );
  }

  const view = content.Children[0];
  const own = rootBox(view, { width, height });
  const viewFill = "Fill" in view && view.Fill ? fill(view, "Fill", "none") : "none";
  return (
    <svg
      x={x}
      y={y}
      width={width}
      height={height}
      viewBox={`0 0 ${own.width} ${own.height}`}
      preserveAspectRatio="none"
      overflow="hidden"
    >
      {background !== "none" && <rect width={own.width} height={own.height} fill={background} />}
      {viewFill !== "none" && <rect width={own.width} height={own.height} fill={viewFill} />}
      <ContentScreens.Provider value={{ byId, depth: depth + 1, carried }}>
        {(carried?.[content.UniqueId] ?? []).map((c, i) =>
          c.box && c.look ? <LookNode key={`look${i}`} box={c.box} look={c.look} alarms={alarms} /> : null,
        )}
        {view.Children.map((child) => (
          <PartNode key={child.UniqueId} part={child} alarms={alarms} />
        ))}
      </ContentScreens.Provider>
    </svg>
  );
}

/** A Compound Object drawn from its definition (lib/ote/co-look.ts): its own
 *  parts in its own coordinates, scaled into the instance's box. */
export function LookNode({ box, look, alarms }: { box: NonNullable<Carried["box"]>; look: Look; alarms: AlarmRow[] }) {
  return (
    <svg
      x={box.left}
      y={box.top}
      width={box.width}
      height={box.height}
      viewBox={`${look.x ?? 0} ${look.y ?? 0} ${look.width} ${look.height}`}
      preserveAspectRatio={look.uniform ? "xMidYMid meet" : "none"}
      overflow={look.clip ? "hidden" : "visible"}
    >
      {look.items.map((item, i) =>
        item.kind === "part" ? (
          <PartNode key={i} part={item.part} alarms={alarms} />
        ) : (
          <LookNode key={i} box={item.box} look={item.look} alarms={alarms} />
        ),
      )}
    </svg>
  );
}
