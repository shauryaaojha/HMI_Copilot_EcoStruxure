"use client";

/**
 * Screen.dat -> inline SVG. One DOM node per object, each carrying its UniqueId.
 *
 * This is the same object tree the packager writes into the .eote, rendered a
 * second way. Everything the canvas can draw, the packager can emit - if you are
 * tempted to add a visual here that has no OTE part behind it, read the one rule
 * in docs/BUILD_PLAN.md first.
 *
 * Absolute Location + Width/Height inside a ViewBox maps 1:1 onto SVG, which is
 * why click-to-select and hover-to-inspect resolve straight back to a JSON node
 * with no hit-testing of our own.
 *
 * Phase 2 of docs/BUILD_PLAN.md.
 */

import type { Part, Screen } from "@/lib/ote/schema";
import { colorIndexOf, resolveColor } from "@/lib/ote/palette";
import { boundsOf, toPathData } from "@/lib/ote/graphics";

export interface ScreenRendererProps {
  screen: Screen;
  /** UniqueId of the selected object, if any. */
  selectedId?: string;
  onSelect?: (id: string) => void;
  /** Live tag values, keyed by object name. Absent = design state. */
  values?: Record<string, number | boolean>;
}

function fill(node: unknown, key: string, fallback: string) {
  return resolveColor(colorIndexOf(node, key), fallback);
}

function fontOf(node: { Font?: { Size?: number; Bold?: boolean } }, fallback = 12) {
  return {
    fontSize: node.Font?.Size ?? fallback,
    fontWeight: node.Font?.Bold ? 600 : 400,
  };
}

/** OTE alignment flags: horizontal 1 left, 2 centre, 4 right; vertical 64 middle. */
function anchorOf(h?: number) {
  return h === 4 ? "end" : h === 2 ? "middle" : "start";
}

function textX(part: { Location: { Left: number }; Width: number }, h?: number) {
  if (h === 4) return part.Location.Left + part.Width - 8;
  if (h === 2) return part.Location.Left + part.Width / 2;
  return part.Location.Left + 8;
}

function PartNode({
  part,
  values,
}: {
  part: Part;
  values?: Record<string, number | boolean>;
}) {
  const { Left: x, Top: y } = part.Location;
  const w = part.Width;
  const h = part.Height;

  switch (part.Type) {
    case "Rectangle":
      return (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          fill={fill(part, "Fill", "#ffffff")}
          stroke={fill(part, "Border", "#515151")}
          strokeWidth={part.Thickness ?? 1}
        />
      );

    case "TextBox": {
      const { fontSize, fontWeight } = fontOf(part);
      const lines = part.Text.split("\n");
      const align = part.TextLayout?.HorizontalAlignment;
      return (
        <text
          x={textX(part, align)}
          y={y + h / 2}
          fill={fill(part, "TextColor", "#030303")}
          fontSize={fontSize}
          fontWeight={fontWeight}
          textAnchor={anchorOf(align)}
          dominantBaseline="central"
        >
          {lines.map((line, i) => (
            <tspan
              key={i}
              x={textX(part, align)}
              dy={i === 0 ? -((lines.length - 1) * fontSize) / 2 : fontSize}
            >
              {line}
            </tspan>
          ))}
        </text>
      );
    }

    case "Lamp": {
      // A Lamp carries both states; the bound tag chooses. No animation of ours.
      const on = Boolean(values?.[part.Name]);
      const state = on ? part.On : part.Off;
      const { fontSize, fontWeight } = fontOf(state, 13);
      const lines = (state.Text ?? "").split("\n");
      return (
        <>
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            fill={fill(state, "Fill", "#d9d9d9")}
            stroke={fill(state, "Border", "#515151")}
            strokeWidth={(state.Thickness ?? 1) * 2}
          />
          <text
            x={x + w / 2}
            y={y + h / 2}
            fill={fill(state, "TextColor", "#030303")}
            fontSize={fontSize}
            fontWeight={fontWeight}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {lines.map((line, i) => (
              <tspan
                key={i}
                x={x + w / 2}
                dy={i === 0 ? -((lines.length - 1) * fontSize) / 2 : fontSize}
              >
                {line}
              </tspan>
            ))}
          </text>
        </>
      );
    }

    case "NumericDisplay": {
      const raw = values?.[part.Name];
      const value = typeof raw === "number" ? raw : part.CurrentValue;
      const { fontSize, fontWeight } = fontOf(part, 20);
      const align = part.TextLayout?.HorizontalAlignment ?? 4;
      return (
        <>
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            fill={fill(part, "Fill", "#ffffff")}
            stroke={fill(part, "Border", "#515151")}
            strokeWidth={part.Thickness ?? 1}
          />
          <text
            x={textX(part, align)}
            y={y + h / 2}
            fill={fill(part, "TextColor", "#030303")}
            fontSize={fontSize}
            fontWeight={fontWeight}
            textAnchor={anchorOf(align)}
            dominantBaseline="central"
            fontFamily="var(--font-mono)"
          >
            {value.toFixed(part.DecimalDigits ?? 0)}
          </text>
        </>
      );
    }

    case "Path": {
      // A symbol from the shipped graphic object library, drawn from the very
      // geometry the project will contain. Commands and Points are stored the
      // way the product stores them and have to be zipped into an SVG `d` -
      // handing the raw command string to <path> would silently draw nothing.
      const geometry = toPathData(part);
      const natural = boundsOf(part);
      return (
        <svg
          x={x}
          y={y}
          width={w}
          height={h}
          viewBox={`0 0 ${natural.width} ${natural.height}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <path
            d={geometry}
            fill={fill(part, "Fill", "#2b7fd4")}
            stroke={fill(part, "Border", "#0d3f6e")}
            strokeWidth={part.Thickness ?? 1}
          />
        </svg>
      );
    }

    case "AlarmSummary":
      // Rendered by AlarmSummaryPart, which needs the alarm list rather than the
      // object alone. Placeholder frame until Phase 4 wires it up.
      return (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          fill="#ffffff"
          stroke="#515151"
          strokeWidth={1}
        />
      );

    default: {
      // Unknown part types fail visibly rather than silently vanishing, so a
      // packager/canvas mismatch is caught the moment it appears.
      const exhaustive: never = part;
      void exhaustive;
      return null;
    }
  }
}

export function ScreenRenderer({
  screen,
  selectedId,
  onSelect,
  values,
}: ScreenRendererProps) {
  const view = screen.Children[0];

  return (
    <svg
      viewBox={`0 0 ${view.Width} ${view.Height}`}
      width="100%"
      height="100%"
      role="img"
      aria-label={`HMI screen ${screen.Name}`}
      style={{ background: resolveColor(2) }}
    >
      {view.Children.map((part) => {
        const selected = part.UniqueId === selectedId;
        return (
          <g
            key={part.UniqueId}
            data-object-id={part.UniqueId}
            data-object-name={part.Name}
            onClick={() => onSelect?.(part.UniqueId)}
            style={{ cursor: onSelect ? "pointer" : "default" }}
          >
            <PartNode part={part} values={values} />
            {selected && (
              <rect
                x={part.Location.Left - 1}
                y={part.Location.Top - 1}
                width={part.Width + 2}
                height={part.Height + 2}
                fill="none"
                stroke="var(--color-brand-400)"
                strokeWidth={2}
                pointerEvents="none"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
