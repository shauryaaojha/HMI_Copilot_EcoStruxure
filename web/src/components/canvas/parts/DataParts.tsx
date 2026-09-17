/**
 * The second batch of the part-coverage track: ToggleSwitch, BarScale, Pipe,
 * DateTimeDisplay, TrendGraph and BlockTrend.
 *
 * Same rule as BasicParts: a part is drawn from its own JSON and from the
 * value the simulator pushed, never from anything the canvas made up. Where
 * the product draws something the file does not describe - the curve on a
 * trend that has no data yet - the canvas draws a deterministic stand-in and
 * says so in a comment, so the design view is recognisable without being
 * mistaken for a recording.
 */

import type { ReactNode } from "react";
import { resolveColor } from "@/lib/ote/palette";
import { fill, fontOf, insetStroke, type PartOf } from "./geometry";
import { PlacedText } from "./Text";

/** The product lays out path geometry in a 3072-unit square, scaled to the box. */
const UNIT = 3072;

/** A face: the box and its text, as a Lamp's state is drawn. */
function Face({
  state,
  x,
  y,
  width,
  height,
  fallbackFill,
}: {
  state: {
    Text?: string;
    Thickness?: number;
    TextLayout?: { HorizontalAlignment?: number };
    Font?: { Size?: number; Bold?: boolean; Italic?: boolean };
  };
  x: number;
  y: number;
  width: number;
  height: number;
  fallbackFill: string;
}) {
  const stroke = (state.Thickness ?? 1) * 2;
  return (
    <>
      <rect
        {...insetStroke(x, y, width, height, stroke)}
        fill={fill(state, "Fill", fallbackFill)}
        stroke={fill(state, "Border", "#515151")}
        strokeWidth={stroke}
      />
      <PlacedText
        text={state.Text ?? ""}
        left={x}
        top={y}
        width={width}
        height={height}
        color={fill(state, "TextColor", "#030303")}
        align={state.TextLayout?.HorizontalAlignment ?? 2}
        {...fontOf(state, 13)}
      />
    </>
  );
}

/**
 * A toggle shows its Off face until the bound bit is set. The knob along the
 * bottom edge is the one thing drawn beyond the face: it is how an operator
 * tells a latching switch from a momentary one at a glance.
 */
export function ToggleSwitchPart({ part, on }: { part: PartOf<"ToggleSwitch">; on: boolean }) {
  const { Left: x, Top: y } = part.Location;
  const state = on ? part.On : part.Off;
  const knob = Math.max(4, Math.min(10, part.Height / 6));
  return (
    <>
      <Face state={state} x={x} y={y} width={part.Width} height={part.Height} fallbackFill="#d9d9d9" />
      <rect
        x={on ? x + part.Width - knob * 2 - 4 : x + 4}
        y={y + part.Height - knob - 4}
        width={knob * 2}
        height={knob}
        rx={knob / 2}
        fill={fill(state, "TextColor", "#030303")}
        opacity={0.6}
        pointerEvents="none"
      />
    </>
  );
}

/**
 * A scale runs along the box's longer side. Five major divisions from zero to
 * LabelAttribute.Max, with a minor tick between each pair, and a label at each
 * major tick when the box is wide enough to hold one beside the tick.
 */
export function BarScalePart({ part }: { part: PartOf<"BarScale"> }) {
  const { Left: x, Top: y } = part.Location;
  const vertical = part.Height >= part.Width;
  const stroke = fill(part, "Stroke", "#030303");
  const label = part.LabelAttribute ?? {};
  const max = typeof label.Max === "number" ? label.Max : 100;
  const digits = typeof label.FloatDigits === "number" ? label.FloatDigits : 0;
  const font = fontOf(label as { Font?: { Size?: number } }, 10);
  const labelColor = fill(label, "TextColor", stroke);
  const showLabels = part.ScaleLabel !== false && (vertical ? part.Width >= 28 : part.Height >= 22);
  const major = 5;
  const ticks: ReactNode[] = [];

  for (let i = 0; i <= major * 2; i += 1) {
    const isMajor = i % 2 === 0;
    const t = i / (major * 2);
    const len = isMajor ? 8 : 4;
    if (vertical) {
      const ty = y + t * part.Height;
      ticks.push(<line key={i} x1={x} y1={ty} x2={x + len} y2={ty} stroke={stroke} strokeWidth={1} />);
      if (isMajor && showLabels)
        ticks.push(
          <text
            key={`l${i}`}
            x={x + len + 3}
            y={ty}
            fill={labelColor}
            dominantBaseline="central"
            fontFamily="var(--font-mono)"
            {...font}
          >
            {(max * (1 - t)).toFixed(digits)}
          </text>,
        );
    } else {
      const tx = x + t * part.Width;
      ticks.push(<line key={i} x1={tx} y1={y} x2={tx} y2={y + len} stroke={stroke} strokeWidth={1} />);
      if (isMajor && showLabels)
        ticks.push(
          <text
            key={`l${i}`}
            x={tx}
            y={y + len + 3}
            fill={labelColor}
            textAnchor="middle"
            dominantBaseline="hanging"
            fontFamily="var(--font-mono)"
            {...font}
          >
            {(max * t).toFixed(digits)}
          </text>,
        );
    }
  }

  return (
    <g pointerEvents="none">
      {vertical ? (
        <line x1={x} y1={y} x2={x} y2={y + part.Height} stroke={stroke} strokeWidth={1} />
      ) : (
        <line x1={x} y1={y} x2={x + part.Width} y2={y} stroke={stroke} strokeWidth={1} />
      )}
      {ticks}
    </g>
  );
}

/**
 * A pipe is its polyline drawn twice: the border stroke, then the narrower
 * fill stroke over it. The bound value picks the state; out of range shows
 * the Invalid state when there is one, else the last.
 */
export function PipePart({ part, value }: { part: PartOf<"Pipe">; value?: number }) {
  const { Left: x, Top: y } = part.Location;
  const index = Math.trunc(value ?? 0);
  const state =
    index >= 0 && index < part.States.length
      ? part.States[index]
      : (part.Invalid ?? part.States[part.States.length - 1]);
  const points = part.Path.Data.map(
    ({ Location }) =>
      `${x + (Location.Left / UNIT) * part.Width},${y + (Location.Top / UNIT) * part.Height}`,
  ).join(" ");
  const border = state.BorderThickness ?? 7;
  const inner = state.FillThickness ?? 3;
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <polyline points={points} stroke={fill(state, "Border", "#515151")} strokeWidth={border} />
      <polyline points={points} stroke={fill(state, "Fill", "#d9d9d9")} strokeWidth={inner} />
    </g>
  );
}

/**
 * The clock has no design-time value; the product shows the current time. The
 * canvas shows the same fixed instant on every render so that a screenshot,
 * a test and a server render all agree - a live clock would make the preview
 * differ from itself.
 */
export const DESIGN_TIME = "2026-01-01 12:00:00";

export function DateTimeDisplayPart({
  part,
  value,
}: {
  part: PartOf<"DateTimeDisplay">;
  value?: string;
}) {
  const stroke = part.Thickness ?? 1;
  return (
    <>
      <rect
        {...insetStroke(part.Location.Left, part.Location.Top, part.Width, part.Height, stroke)}
        fill={fill(part, "Fill", "#ffffff")}
        stroke={fill(part, "Border", "#515151")}
        strokeWidth={stroke}
      />
      <PlacedText
        text={value ?? DESIGN_TIME}
        left={part.Location.Left}
        top={part.Location.Top}
        width={part.Width}
        height={part.Height}
        color={fill(part, "TextColor", "#030303")}
        align={part.TextLayout?.HorizontalAlignment ?? 2}
        mono
        {...fontOf(part, 14)}
      />
    </>
  );
}

/**
 * The stand-in curve for a channel that has no data yet: a smooth, bounded
 * waveform seeded by the channel index, so two channels never coincide and
 * the same file always draws the same picture.
 */
function sampleCurve(channel: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / Math.max(1, count - 1);
    const v =
      0.5 +
      0.28 * Math.sin(t * Math.PI * (1.5 + channel * 0.5) + channel * 1.3) +
      0.12 * Math.sin(t * Math.PI * 5 + channel);
    out.push(Math.min(0.95, Math.max(0.05, v)));
  }
  return out;
}

type Trend = PartOf<"TrendGraph"> | PartOf<"BlockTrend">;
interface Plot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The plot area inside a trend's frame, and the axis lines around it. */
function TrendFrame({ part, children }: { part: Trend; children: (plot: Plot) => ReactNode }) {
  const { Left: x, Top: y } = part.Location;
  const pad = { left: 36, right: 10, top: 10, bottom: 22 };
  const plot: Plot = {
    x: x + pad.left,
    y: y + pad.top,
    w: Math.max(0, part.Width - pad.left - pad.right),
    h: Math.max(0, part.Height - pad.top - pad.bottom),
  };
  const axis = "#7d8b99";
  return (
    <g pointerEvents="none">
      <rect
        {...insetStroke(x, y, part.Width, part.Height, 1)}
        fill={fill(part, "Fill", "#ffffff")}
        stroke={fill(part, "Border", "#515151")}
        strokeWidth={1}
      />
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1={plot.x}
          y1={plot.y + plot.h * f}
          x2={plot.x + plot.w}
          y2={plot.y + plot.h * f}
          stroke={axis}
          strokeOpacity={0.25}
          strokeDasharray="2 3"
        />
      ))}
      <line x1={plot.x} y1={plot.y} x2={plot.x} y2={plot.y + plot.h} stroke={axis} />
      <line x1={plot.x} y1={plot.y + plot.h} x2={plot.x + plot.w} y2={plot.y + plot.h} stroke={axis} />
      {["100", "50", "0"].map((label, i) => (
        <text
          key={label}
          x={plot.x - 4}
          y={plot.y + (plot.h * i) / 2}
          fill={axis}
          fontSize={9}
          fontFamily="var(--font-mono)"
          textAnchor="end"
          dominantBaseline="central"
        >
          {label}
        </text>
      ))}
      {children(plot)}
    </g>
  );
}

/** Channel legend along the foot of the frame, in each channel's colour. */
function Legend({ part, plot }: { part: Trend; plot: Plot }) {
  let cursor = plot.x;
  return (
    <>
      {part.Channels.map((channel, i) => {
        const colour = fill(channel, "Stroke", resolveColor(3));
        const label = channel.Variable ?? `Channel ${i + 1}`;
        const at = cursor;
        cursor += 14 + label.length * 5.6 + 10;
        if (at > plot.x + plot.w) return null;
        return (
          <g key={i}>
            <rect x={at} y={plot.y + plot.h + 8} width={8} height={8} fill={colour} />
            <text
              x={at + 12}
              y={plot.y + plot.h + 12}
              fill="#4a5764"
              fontSize={9}
              fontFamily="var(--font-mono)"
              dominantBaseline="central"
            >
              {label}
            </text>
          </g>
        );
      })}
    </>
  );
}

export function TrendGraphPart({ part }: { part: PartOf<"TrendGraph"> }) {
  return (
    <TrendFrame part={part}>
      {(plot) => (
        <>
          {part.Channels.map((channel, i) => {
            const samples = sampleCurve(i, 24);
            const points = samples
              .map(
                (v, k) =>
                  `${plot.x + (k / (samples.length - 1)) * plot.w},${plot.y + (1 - v) * plot.h}`,
              )
              .join(" ");
            const colour = fill(channel, "Stroke", resolveColor(3));
            const filled = typeof channel.Fill?.Type === "number" && channel.Fill.Type !== 0;
            return (
              <g key={i}>
                {filled && (
                  <polygon
                    points={`${plot.x},${plot.y + plot.h} ${points} ${plot.x + plot.w},${plot.y + plot.h}`}
                    fill={colour}
                    fillOpacity={0.12}
                  />
                )}
                <polyline
                  points={points}
                  fill="none"
                  stroke={colour}
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                />
              </g>
            );
          })}
          <Legend part={part} plot={plot} />
        </>
      )}
    </TrendFrame>
  );
}

export function BlockTrendPart({ part }: { part: PartOf<"BlockTrend"> }) {
  const points = Math.max(1, Math.min(64, part.NumberOfDataPoints ?? 12));
  return (
    <TrendFrame part={part}>
      {(plot) => {
        const groups = part.Channels.length;
        const slot = plot.w / points;
        const bar = Math.max(1, (slot * 0.7) / groups);
        return (
          <>
            {part.Channels.map((channel, c) => {
              const samples = sampleCurve(c, points);
              const colour = fill(channel, "Stroke", resolveColor(3));
              return samples.map((v, k) => (
                <rect
                  key={`${c}-${k}`}
                  x={plot.x + k * slot + slot * 0.15 + c * bar}
                  y={plot.y + (1 - v) * plot.h}
                  width={bar}
                  height={v * plot.h}
                  fill={colour}
                  fillOpacity={0.85}
                />
              ));
            })}
            <Legend part={part} plot={plot} />
          </>
        );
      }}
    </TrendFrame>
  );
}
