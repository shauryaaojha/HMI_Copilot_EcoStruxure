/**
 * A screen drawn with nothing to interact with: the paper, the carried
 * objects, every part, and the frame.
 *
 * This is what the rasteriser (lib/critic/render.ts) draws, behind
 * render_screen and the visual critic. It holds no hook and no context, and
 * carries no "use client", because a route handler is bundled with React's
 * server build, which has neither; ScreenRenderer, which needs its hooks for
 * dragging and selection, could not be called there at all
 * (docs/DEFECT_SERVER_RENDER.md).
 *
 * The layers the editor draws in the same places come from here too
 * (`ForeignLayer`, `ScreenFrame`, `PAPER`), so the server's pixels are the
 * editor's pixels minus selection, guides, presence and comments.
 */

import { rootBox, type Screen } from "@/lib/ote/schema";
import { resolveColor } from "@/lib/ote/palette";
import type { Look } from "@/lib/ote/co-look";
import type { ForeignPart } from "@/store/types";
import { DEFAULT_ENV, PartNode, type AlarmRow, type DrawEnv } from "./parts";
import { LookNode } from "./parts/ContentDisplay";

/** Palette index 2 is the paper the product draws a screen on; 22 its frame. */
export const PAPER = resolveColor(2, "#f1f1f1");
export const FRAME = resolveColor(22, "#515151");

/** When no panel is given: the most common ST6 size in the corpus. */
export const FALLBACK_PANEL = { width: 1024, height: 600 };

/**
 * Carried objects, under everything the editor owns. The product will paint
 * them at their original index; the canvas cannot know what they look like,
 * so it shows where they are and what they are.
 */
export function ForeignLayer({
  foreign,
  alarms,
  env,
  px = (n) => n,
}: {
  foreign?: ForeignPart[];
  alarms: AlarmRow[];
  env: DrawEnv;
  /** Screen units for something cosmetic, so it looks the same at every zoom. */
  px?: (n: number) => number;
}) {
  if (!foreign || foreign.length === 0) return null;
  return (
    <g pointerEvents="none" data-foreign>
      <defs>
        <pattern id="foreign-hatch" width={px(8)} height={px(8)} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={px(8)} stroke="var(--color-text-faint)" strokeWidth={px(1)} />
        </pattern>
      </defs>
      {foreign.map((f, i) => {
        const look = (f as ForeignPart & { look?: Look }).look;
        return f.box && look ? (
          <LookNode key={i} box={f.box} look={look} alarms={alarms} env={env} />
        ) : f.box ? (
          <g key={i}>
            <rect x={f.box.left} y={f.box.top} width={f.box.width} height={f.box.height} fill="url(#foreign-hatch)" fillOpacity={0.35} />
            <rect x={f.box.left} y={f.box.top} width={f.box.width} height={f.box.height} fill="none" stroke="var(--color-text-faint)" strokeWidth={px(1)} strokeDasharray={`${px(3)} ${px(3)}`} />
            <text
              x={f.box.left + px(4)}
              y={f.box.top + px(4)}
              fill="var(--color-text-muted)"
              fontSize={px(10)}
              fontFamily="var(--font-mono)"
              dominantBaseline="hanging"
            >
              {f.type}
              {f.name ? ` ${f.name}` : ""}
            </text>
          </g>
        ) : null;
      })}
    </g>
  );
}

/** render_screen.py frames the whole screen; without this the browser render is a pixel short of the picture in the deck. */
export function ScreenFrame({ width, height }: { width: number; height: number }) {
  return <rect x={0.5} y={0.5} width={width - 1} height={height - 1} fill="none" stroke={FRAME} strokeWidth={1} pointerEvents="none" />;
}

export interface StaticScreenProps {
  screen: Screen;
  foreign?: ForeignPart[];
  alarms?: AlarmRow[];
  values?: Record<string, number | boolean | string>;
  env?: DrawEnv;
  /** The panel's size, for a screen whose root gives none (an opened project's Canvas). */
  panel?: { width: number; height: number };
}

export function StaticScreen({ screen, foreign, alarms = [], values, env = DEFAULT_ENV, panel }: StaticScreenProps) {
  const view = screen.Children[0];
  const box = rootBox(view, panel ?? FALLBACK_PANEL);
  return (
    <svg
      viewBox={`0 0 ${box.width} ${box.height}`}
      width="100%"
      height="100%"
      role="img"
      aria-label={`HMI screen ${screen.Name}`}
      style={{ background: PAPER }}
    >
      <ForeignLayer foreign={foreign} alarms={alarms} env={env} />
      {view.Children.map((part) => (
        <g key={part.UniqueId} data-object-id={part.UniqueId} data-object-name={part.Name} data-object-type={part.Type}>
          <PartNode part={part} values={values} alarms={alarms} env={env} />
        </g>
      ))}
      <ScreenFrame width={box.width} height={box.height} />
    </svg>
  );
}
