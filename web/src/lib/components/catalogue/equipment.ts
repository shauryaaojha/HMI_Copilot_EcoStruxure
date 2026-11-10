import { z } from "zod";
import { pathPart, type Box } from "@/lib/ote/parts";
import type { ComponentDef, ComponentKind, ComponentUse, RoleSlot } from "../types";
import type { Theme, Token } from "../theme";
import { commandButton } from "./commandButton";
import { assembly, barParts, boxAt, equipmentBadge, INDICATOR, label, merge, reading, shapedLamp, stemOf, symbolParts } from "./shared";

export const EquipmentProps = z.object({
  label: z.string().default("Equipment"),
  min: z.number().default(0), max: z.number().default(100),
  normalLow: z.number().optional(), normalHigh: z.number().optional(),
  units: z.string().default("%"),
  icon: z.object({ Commands: z.string(), Points: z.string() }).optional(),
});
type Props = z.infer<typeof EquipmentProps>;

const TOKENS: readonly Token[] = ["equipmentLine", "equipmentStopped", "equipmentRunning", "equipmentDisabled", "onDark", "ink", "muted", "field", "line", "processValue", "normalBand", "setpoint", "commandFace", "commandPressed", "alarmP1", "alarmP2", "alarmP3", "alarmP4", "onAlarm"];
const SIZES = { S: { width: 48, height: 64 }, M: { width: 64, height: 88 }, L: { width: 88, height: 112 } };

export function equipmentDef(config: {
  kind: Extract<ComponentKind, "Pump" | "Valve" | "Motor">;
  letter: string;
  variants: readonly string[];
  roles: readonly RoleSlot[];
  activeRole: string;
  extra?: Record<string, string[]>;
}): ComponentDef<Props> {
  return {
    kind: config.kind, variants: config.variants, sizes: SIZES,
    states: ["running", "stopped", "manual", "interlocked", "disabled", "unknown"],
    alarmSlot: "topRight", roles: config.roles, tokens: TOKENS, props: EquipmentProps,
    backends: ["parts"],
    expand(use: ComponentUse<Props>, box: Box, theme: Theme) {
      const { parts, wires, add } = assembly();
      const stem = stemOf(use);
      // The alarm sits beside the body, never on it (V7), and only when there
      // is a fault bit to drive it. Without a bit that says what state the
      // machine is in there is no badge: a lamp bound to nothing reads STOPPED
      // for ever, and that is a false statement on an operator's screen.
      const alarmSize = use.tags.fault ? (box.width < 64 ? 12 : box.width < 88 ? 16 : 24) : 0;
      const bodyWidth = Math.floor(Math.min(72, box.width - 8 - (alarmSize ? alarmSize + 4 : 0)) / 4) * 4;
      const hasLabel = use.props.label !== "" && box.height >= 72;
      const tag = use.tags[config.activeRole];
      const rows = (hasLabel ? 20 : 0) + (tag ? 24 : 0);
      const bodyHeight = Math.floor(Math.min(64, box.height - rows) / 4) * 4;
      const body = boxAt(box, 4, 0, bodyWidth, bodyHeight);
      if (use.variant === "libraryIcon" && use.props.icon) {
        add(pathPart(`${stem}_Icon`, use.props.icon, body, { fill: theme.tokens.equipmentStopped, border: theme.tokens.equipmentLine }));
      } else {
        // The body is the state: it fills when the machine runs, and the words under it say so again.
        merge({ parts, wires }, symbolParts(stem, config.kind, body, theme, { state: tag }));
      }
      let y = bodyHeight;
      const column = Math.min(box.width, 88);
      if (hasLabel) {
        add(label(`${stem}_Label`, use.props.label, boxAt(box, 0, y, column, 20), theme, "small"));
        y += 20;
      }
      if (tag) add(equipmentBadge(`${stem}_State`, boxAt(box, 0, y + 4, column, 20), theme, config.activeRole === "open" ? ["CLOSED", "OPEN"] : undefined), tag);
      if (alarmSize) {
        merge({ parts, wires }, shapedLamp(`${stem}_Alarm`, INDICATOR.fault(), boxAt(box, 4 + bodyWidth + 4, 0, alarmSize, alarmSize), theme, { tag: use.tags.fault, on: theme.tokens.alarmP1 }));
      }

      const extras = config.extra?.[use.variant] ?? [];
      if (extras.length > 0 && box.width >= 128) {
        const rightX = 96, rightWidth = box.width - rightX - 4;
        extras.slice(0, 2).forEach((role, i) => {
          const row = i * 44;
          add(label(`${stem}_${role}_Label`, role, boxAt(box, rightX, row, rightWidth, 20), theme, "small"));
          const expanded = barParts(`${stem}_${role}`, boxAt(box, rightX, row + 24, rightWidth, 12), theme, {
            tag: use.tags[role], min: use.props.min, max: use.props.max, normalLow: use.props.normalLow, normalHigh: use.props.normalHigh,
          });
          const start = parts.length;
          parts.push(...expanded.parts);
          wires.push(...expanded.wires.map((wire) => ({ ...wire, index: wire.index + start })));
        });
      }
      if (use.tags.speedSetpoint && box.width >= 240 && box.height >= 136) {
        add(label(`${stem}_SetpointLabel`, "Setpoint", boxAt(box, 88, 88, 72, 20), theme, "small"));
        add(reading(`${stem}_Setpoint`, boxAt(box, 160, 88, 76, 32), theme, 1, true), use.tags.speedSetpoint);
      }
      if (box.width >= 240 && box.height >= 136) {
        const commands = ["start", "stop", "reset"].filter((role) => use.tags[role]);
        commands.forEach((role, i) => {
          const width = Math.max(theme.touchMin.regular, Math.floor((box.width - 8) / Math.max(1, commands.length) / 4) * 4);
          add(commandButton(`${stem}_${role}`, role, boxAt(box, 4 + i * width, box.height - 40, width - 4, 40), theme), use.tags[role], "ClickTrigger.Destination");
        });
      }
      return { parts, wires };
    },
  };
}
