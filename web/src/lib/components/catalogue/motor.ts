import { equipmentDef } from "./equipment";

export const Motor = equipmentDef({
  kind: "Motor", letter: "M", variants: ["plain", "withDrive", "fan", "libraryIcon"],
  activeRole: "running", extra: { withDrive: ["speed", "current"] },
  roles: [
    { role: "running", dataType: "BOOL", required: true },
    { role: "fault", dataType: "BOOL", required: false },
    { role: "ready", dataType: "BOOL", required: false },
    { role: "mode", dataType: "BOOL", required: false },
    { role: "speed", dataType: "REAL", required: false },
    { role: "frequency", dataType: "REAL", required: false },
    { role: "current", dataType: "REAL", required: false },
    { role: "torque", dataType: "REAL", required: false },
    { role: "speedSetpoint", dataType: "REAL", required: false },
    { role: "start", dataType: "BOOL", required: false },
    { role: "stop", dataType: "BOOL", required: false },
    { role: "reset", dataType: "BOOL", required: false },
  ],
});
