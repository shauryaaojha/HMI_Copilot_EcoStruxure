/**
 * Rectangle, TextBox, Lamp and NumericDisplay - the four parts
 * tools/make_project.py already writes into a file OTE opens.
 *
 * Every default here (#ffffff fill, #515151 border, 20pt numerics, right
 * alignment) is the one render_screen.py uses, so the two renderers agree on an
 * object whose JSON leaves the property out.
 */

import { fill, fontOf, insetStroke, type PartOf } from "./geometry";
import { PlacedText } from "./Text";

export function RectanglePart({ part }: { part: PartOf<"Rectangle"> }) {
  const stroke = part.Thickness ?? 1;
  return (
    <rect
      {...insetStroke(part.Location.Left, part.Location.Top, part.Width, part.Height, stroke)}
      fill={fill(part, "Fill", "#ffffff")}
      stroke={fill(part, "Border", "#515151")}
      strokeWidth={stroke}
    />
  );
}

export function TextBoxPart({ part }: { part: PartOf<"TextBox"> }) {
  return (
    <PlacedText
      text={part.Text}
      left={part.Location.Left}
      top={part.Location.Top}
      width={part.Width}
      height={part.Height}
      color={fill(part, "TextColor", "#030303")}
      align={part.TextLayout?.HorizontalAlignment}
      {...fontOf(part)}
    />
  );
}

/**
 * A Lamp carries both states in the JSON and the bound tag chooses between
 * them. Nothing here animates: `on` comes from the value the simulator pushed,
 * which is exactly how the product decides.
 */
export function LampPart({ part, on }: { part: PartOf<"Lamp">; on: boolean }) {
  const state = on ? part.On : part.Off;
  const stroke = (state.Thickness ?? 1) * 2;
  const { Left: x, Top: y } = part.Location;

  return (
    <>
      <rect
        {...insetStroke(x, y, part.Width, part.Height, stroke)}
        fill={fill(state, "Fill", "#d9d9d9")}
        stroke={fill(state, "Border", "#515151")}
        strokeWidth={stroke}
      />
      <PlacedText
        text={state.Text ?? ""}
        left={x}
        top={y}
        width={part.Width}
        height={part.Height}
        color={fill(state, "TextColor", "#030303")}
        align={2}
        {...fontOf(state, 13)}
      />
    </>
  );
}

export function NumericDisplayPart({
  part,
  value,
}: {
  part: PartOf<"NumericDisplay">;
  value?: number;
}) {
  const stroke = part.Thickness ?? 1;
  const shown = value ?? part.CurrentValue;

  return (
    <>
      <rect
        {...insetStroke(part.Location.Left, part.Location.Top, part.Width, part.Height, stroke)}
        fill={fill(part, "Fill", "#ffffff")}
        stroke={fill(part, "Border", "#515151")}
        strokeWidth={stroke}
      />
      <PlacedText
        text={shown.toFixed(part.DecimalDigits ?? 0)}
        left={part.Location.Left}
        top={part.Location.Top}
        width={part.Width}
        height={part.Height}
        color={fill(part, "TextColor", "#030303")}
        align={part.TextLayout?.HorizontalAlignment ?? 4}
        mono
        {...fontOf(part, 20)}
      />
    </>
  );
}
