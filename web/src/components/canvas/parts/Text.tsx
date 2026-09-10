/**
 * Multi-line text placed the way tools/render_screen.py places it: the lines
 * are stacked as one block and the block is centred in the object's box, with
 * horizontal alignment honouring the OTE flag.
 */

import {
  anchorOf,
  lineCenterY,
  TEXT_PAD,
  textX,
  type Align,
  type FontSpec,
} from "./geometry";

export interface PlacedTextProps extends FontSpec {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  color: string;
  align?: Align;
  /** Numeric readouts use the mono face, as the product does. */
  mono?: boolean;
  /**
   * Edge padding for left- and right-aligned text; 8px everywhere the product
   * lays out a label, and 0 for the alarm grid, whose columns are positioned by
   * fraction and want no inset of their own.
   */
  pad?: number;
}

export function PlacedText({
  text,
  left,
  top,
  width,
  height,
  color,
  align,
  mono,
  pad = TEXT_PAD,
  fontSize,
  fontWeight,
  fontStyle,
}: PlacedTextProps) {
  const lines = text.split("\n");
  const x = textX(left, width, align, pad);

  return (
    <text
      fill={color}
      fontSize={fontSize}
      fontWeight={fontWeight}
      fontStyle={fontStyle}
      fontFamily={mono ? "var(--font-mono)" : "var(--font-sans)"}
      textAnchor={anchorOf(align)}
      dominantBaseline="central"
      pointerEvents="none"
    >
      {lines.map((line, i) => (
        <tspan key={i} x={x} y={lineCenterY(top, height, i, lines.length, fontSize)}>
          {line}
        </tspan>
      ))}
    </text>
  );
}
