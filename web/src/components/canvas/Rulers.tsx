"use client";

/**
 * Rulers along the top and left edge of the screen, in screen units.
 *
 * Screen units, not pixels: the numbers an engineer reads here have to be the
 * numbers in the object's Location, or the ruler is lying at every zoom except
 * 100%. The tick pitch adapts so the labels never collide - 10 units at 400%,
 * 100 at 25%.
 */

const PITCHES = [5, 10, 20, 25, 50, 100, 200, 250, 500];

/** The coarsest pitch that still leaves ~44px between labels at this zoom. */
function pitchFor(scale: number): number {
  return PITCHES.find((p) => p * scale >= 44) ?? PITCHES.at(-1)!;
}

export const RULER = 18;

export function Rulers({
  width,
  height,
  scale,
}: {
  width: number;
  height: number;
  scale: number;
}) {
  const pitch = pitchFor(scale);
  const ticks = (extent: number) => {
    const out: number[] = [];
    for (let v = 0; v <= extent; v += pitch) out.push(v);
    return out;
  };

  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 select-none border-b border-line-subtle bg-surface-panel"
        style={{ width: width * scale + RULER, height: RULER, marginLeft: -RULER }}
      >
        {ticks(width).map((v) => (
          <span
            key={v}
            className="absolute top-0 border-l border-line pl-0.5 text-[9px] leading-[18px] tabular-nums text-text-faint"
            style={{ left: RULER + v * scale, height: RULER }}
          >
            {v}
          </span>
        ))}
      </div>

      <div
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 select-none border-r border-line-subtle bg-surface-panel"
        style={{ width: RULER, height: height * scale, marginLeft: -RULER }}
      >
        {ticks(height).map((v) => (
          <span
            key={v}
            className="absolute left-0 w-full border-t border-line text-center text-[9px] leading-none tabular-nums text-text-faint"
            style={{ top: v * scale }}
          >
            {v}
          </span>
        ))}
      </div>
    </>
  );
}
