import { equipmentDef } from "./equipment";

export const Pump = equipmentDef({
  kind: "Pump", letter: "P", variants: ["centrifugal", "positiveDisplacement", "withSpeed", "libraryIcon"],
  activeRole: "running", extra: { withSpeed: ["speed"] },
  roles: [
    { role: "running", dataType: "BOOL", required: true },
    { role: "fault", dataType: "BOOL", required: false },
    { role: "mode", dataType: "BOOL", required: false },
    { role: "speed", dataType: "REAL", required: false },
    { role: "start", dataType: "BOOL", required: false },
    { role: "stop", dataType: "BOOL", required: false },
    { role: "reset", dataType: "BOOL", required: false },
  ],
});
