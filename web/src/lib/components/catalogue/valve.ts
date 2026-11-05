import { equipmentDef } from "./equipment";

export const Valve = equipmentDef({
  kind: "Valve", letter: "V", variants: ["onOff", "control", "check", "libraryIcon"],
  activeRole: "open", extra: { control: ["position"] },
  roles: [
    { role: "open", dataType: "BOOL", required: false },
    { role: "closed", dataType: "BOOL", required: false },
    { role: "position", dataType: "REAL", required: false },
    { role: "openCmd", dataType: "BOOL", required: false },
    { role: "closeCmd", dataType: "BOOL", required: false },
  ],
});
