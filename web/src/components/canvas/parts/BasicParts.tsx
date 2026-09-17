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

/** A face: the box and its text, shared by a lamp state, a switch state and an N-state. */
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

/** A switch shows its Release face at rest; `pressed` swaps to Press. */
export function SwitchPart({ part, pressed }: { part: PartOf<"Switch">; pressed: boolean }) {
  return (
    <Face
      state={pressed ? part.Press : part.Release}
      x={part.Location.Left}
      y={part.Location.Top}
      width={part.Width}
      height={part.Height}
      fallbackFill="#ffffff"
    />
  );
}

/**
 * The bound integer picks the face. Out of range shows the Invalid face when
 * there is one, else the last state - which is what an engineer expects to
 * see rather than nothing.
 */
export function NStateLampPart({ part, value }: { part: PartOf<"N-StateLamp">; value?: number }) {
  const index = Math.trunc(value ?? part.CurrentValue);
  const state =
    index >= 0 && index < part.States.length
      ? part.States[index]
      : (part.Invalid ?? part.States[part.States.length - 1]);
  return (
    <Face
      state={state}
      x={part.Location.Left}
      y={part.Location.Top}
      width={part.Width}
      height={part.Height}
      fallbackFill="#d9d9d9"
    />
  );
}

export function StringDisplayPart({ part, value }: { part: PartOf<"StringDisplay">; value?: string }) {
  const stroke = part.Thickness ?? 1;
  const shown = (value ?? part.CurrentValue).slice(0, part.DisplayLength ?? 255);
  return (
    <>
      <rect
        {...insetStroke(part.Location.Left, part.Location.Top, part.Width, part.Height, stroke)}
        fill={fill(part, "Fill", "#ffffff")}
        stroke={fill(part, "Border", "#515151")}
        strokeWidth={stroke}
      />
      <PlacedText
        text={shown}
        left={part.Location.Left}
        top={part.Location.Top}
        width={part.Width}
        height={part.Height}
        color={fill(part, "TextColor", "#030303")}
        align={part.TextLayout?.HorizontalAlignment ?? 1}
        mono
        {...fontOf(part, 16)}
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
