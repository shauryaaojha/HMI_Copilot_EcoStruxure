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

export interface ContentScreensValue {
  byId: Map<number, Screen>;
  depth: number;
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
  const { byId, depth } = useContext(ContentScreens);
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
      <ContentScreens.Provider value={{ byId, depth: depth + 1 }}>
        {view.Children.map((child) => (
          <PartNode key={child.UniqueId} part={child} alarms={alarms} />
        ))}
      </ContentScreens.Provider>
    </svg>
  );
}
