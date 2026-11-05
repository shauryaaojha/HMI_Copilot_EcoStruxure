import { rule } from "./make";

export const isa182Rules = [
  rule("alarm", "Alarm configuration", { statement: "Give alarms a valid trigger, priority and usable operator message.", why: "An alarm needs an actionable condition and a clear response.", checker: "alarm", severity: "must" }, "web/src/lib/validation/rules.ts#alarm", ["isa182", "alarm"]),
];
