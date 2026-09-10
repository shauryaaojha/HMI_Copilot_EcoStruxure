/**
 * One component per part type, and the exhaustive switch that chooses between
 * them.
 *
 * The `never` assignment in the default branch is the mechanism described in
 * docs/WORKSTREAMS.md: when FORMAT adds a part to lib/ote/schema.ts, this file
 * stops compiling until the canvas can draw it. Do not widen the type to make
 * that error go away - render the part. The canvas may only draw what the
 * packager can emit, and this is that rule enforced by tsc rather than by
 * discipline.
 */

import type { Part } from "@/lib/ote/schema";
import {
  LampPart,
  NumericDisplayPart,
  RectanglePart,
  TextBoxPart,
} from "./BasicParts";
import { AlarmSummaryPart, type AlarmRow } from "./AlarmSummaryPart";
import { PathPartNode } from "./GraphicObject";

export { AlarmSummaryPart, type AlarmRow } from "./AlarmSummaryPart";
export { GraphicObject } from "./GraphicObject";

export interface PartNodeProps {
  part: Part;
  /** Live tag values keyed by object name; absent means the design state. */
  values?: Record<string, number | boolean>;
  /** The alarms the summary grid should list. */
  alarms: AlarmRow[];
}

export function PartNode({ part, values, alarms }: PartNodeProps) {
  switch (part.Type) {
    case "Rectangle":
      return <RectanglePart part={part} />;

    case "TextBox":
      return <TextBoxPart part={part} />;

    case "Lamp":
      return <LampPart part={part} on={Boolean(values?.[part.Name])} />;

    case "NumericDisplay": {
      const raw = values?.[part.Name];
      return (
        <NumericDisplayPart
          part={part}
          value={typeof raw === "number" ? raw : undefined}
        />
      );
    }

    case "AlarmSummary":
      return <AlarmSummaryPart part={part} rows={alarms} />;

    case "Path":
      return <PathPartNode part={part} />;

    default: {
      const exhaustive: never = part;
      void exhaustive;
      return null;
    }
  }
}
