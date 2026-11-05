import { BIT_OPERATION, switchPart, type Box } from "@/lib/ote/parts";
import type { Theme } from "../theme";

export function commandButton(name: string, action: string, box: Box, theme: Theme) {
  const part = switchPart(name, action.toUpperCase(), box, BIT_OPERATION.momentary);
  if (part.Type === "Switch") {
    part.Release = { ...part.Release, Fill: { Color: { Value: theme.tokens.commandFace } }, Border: { Color: { Value: theme.tokens.line } }, Thickness: 2,
      Font: { ...part.Release.Font, Size: theme.type.regular.label } };
    part.Press = { ...part.Press, Fill: { Color: { Value: theme.tokens.commandPressed } }, TextColor: { Color: { Value: theme.tokens.onDark } }, Border: { Color: { Value: theme.tokens.line } }, Thickness: 2 };
  }
  return part;
}
