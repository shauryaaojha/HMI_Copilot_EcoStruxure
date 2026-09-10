/**
 * The product's own alarm summary grid.
 *
 * This is the one part that cannot be drawn from its own JSON: the object says
 * where the grid is, the alarm list says what is in it. That is why it needs
 * the project's alarms passed in rather than just the part.
 *
 * The layout - a 30px header band, five columns at these fractions, #ffecec
 * rows, "No active alarms" centred when empty - is lifted from
 * draw_alarm_summary() in tools/render_screen.py so the browser and the Python
 * renderer produce the same grid from the same file.
 */

import { useId } from "react";
import { resolveColor } from "@/lib/ote/palette";
import { insetStroke, type PartOf } from "./geometry";
import { PlacedText } from "./Text";

/** One row of the summary, already resolved to what the operator would read. */
export interface AlarmRow {
  time: string;
  variable: string;
  message: string;
  severity: string;
  state: string;
}

const COLUMNS: { label: string; key: keyof AlarmRow; at: number }[] = [
  { label: "TIME", key: "time", at: 0.02 },
  { label: "VARIABLE", key: "variable", at: 0.14 },
  { label: "MESSAGE", key: "message", at: 0.34 },
  { label: "SEV", key: "severity", at: 0.72 },
  { label: "STATE", key: "state", at: 0.84 },
];

const HEADER_HEIGHT = 30;
const ROW_HEIGHT = 30;

/** Palette indices, resolved once: white paper, #515151 chrome, #cd505a alarm text. */
const PAPER = resolveColor(21, "#ffffff");
const CHROME = resolveColor(22, "#515151");
const ALARM_TEXT = resolveColor(45, "#cd505a");
const ALARM_ROW = "#ffecec";

export function AlarmSummaryPart({
  part,
  rows,
}: {
  part: PartOf<"AlarmSummary">;
  rows: AlarmRow[];
}) {
  const clipId = useId();
  const { Left: x, Top: y } = part.Location;
  const w = part.Width;
  const h = part.Height;

  const visible = Math.max(0, Math.floor((h - HEADER_HEIGHT) / ROW_HEIGHT));
  const shown = rows.slice(0, visible);

  return (
    <>
      <rect
        {...insetStroke(x, y, w, h, 1)}
        fill={PAPER}
        stroke={CHROME}
        strokeWidth={1}
      />

      <clipPath id={clipId}>
        <rect x={x} y={y} width={w} height={h} />
      </clipPath>

      <g clipPath={`url(#${clipId})`}>
        <rect x={x} y={y} width={w} height={HEADER_HEIGHT} fill={CHROME} />
        {COLUMNS.map((column) => (
          <PlacedText
            key={column.key}
            text={column.label}
            left={x + w * column.at}
            top={y}
            width={w}
            height={HEADER_HEIGHT}
            color={PAPER}
            align={1}
            pad={0}
            fontSize={11}
            fontWeight={700}
            fontStyle="normal"
          />
        ))}

        {shown.map((row, i) => {
          const top = y + HEADER_HEIGHT + i * ROW_HEIGHT;
          return (
            <g key={`${row.time}-${row.variable}-${i}`}>
              <rect
                x={x + 1}
                y={top}
                width={w - 2}
                height={ROW_HEIGHT}
                fill={ALARM_ROW}
              />
              {COLUMNS.map((column) => (
                <PlacedText
                  key={column.key}
                  text={row[column.key]}
                  left={x + w * column.at}
                  top={top}
                  width={w}
                  height={ROW_HEIGHT}
                  color={ALARM_TEXT}
                  align={1}
                  pad={0}
                  fontSize={11}
                  fontWeight={400}
                  fontStyle="normal"
                />
              ))}
            </g>
          );
        })}

        {shown.length === 0 && (
          <PlacedText
            text="No active alarms"
            left={x}
            top={y + HEADER_HEIGHT}
            width={w}
            height={h - HEADER_HEIGHT}
            color={CHROME}
            align={2}
            fontSize={12}
            fontWeight={400}
            fontStyle="normal"
          />
        )}
      </g>
    </>
  );
}
