import { pattern, rule } from "./make";

export const validationRules = [
  rule("naming", "Valid names", { statement: "Use names accepted by the target format and keep them unique.", why: "An invalid or duplicate name can break an exported project.", checker: "naming", severity: "must" }, "web/src/lib/validation/rules.ts#naming", ["validation"]),
  rule("binding", "Valid bindings", { statement: "Bind only to declared tags and available objects.", why: "A broken binding cannot show the intended process value.", checker: "binding", severity: "must" }, "web/src/lib/validation/rules.ts#binding", ["validation"]),
  rule("type-mismatch", "Matching data types", { statement: "Bind a part only to data types it accepts.", why: "A type mismatch leaves the display or action incorrect.", checker: "type-mismatch", severity: "must" }, "web/src/lib/validation/rules.ts#type-mismatch", ["validation"]),
  rule("unused-tag", "Unused tags", { statement: "Review tags that are declared but unused on screens.", why: "An unused signal may indicate missing operator information.", checker: "unused-tag", severity: "should" }, "web/src/lib/validation/rules.ts#unused-tag", ["validation"]),
  rule("completeness", "Screen completeness", { statement: "Provide the essential information for each generated screen.", why: "An incomplete screen cannot support its intended task.", checker: "completeness", severity: "should" }, "web/src/lib/validation/rules.ts#completeness", ["validation"]),
  rule("standards", "Standard pack conformance", { statement: "Review screen and alarm conventions against the selected pack.", why: "Consistent screens help the operator find information quickly.", checker: "standards", severity: "should" }, "web/src/lib/validation/rules.ts#standards", ["validation"]),
];

export const curatedPatterns = [
  pattern("hierarchy", "Display hierarchy", "Use plant overview, unit overview and unit detail levels for navigation.", "web/src/lib/ote/layout.ts#ScreenSpec", ["isa101", "layout"]),
  pattern("fixedChrome", "Consistent navigation and alarms", "Keep header, navigation and alarm banner in consistent positions across screens.", "web/src/lib/ote/layout.ts#chrome", ["isa101", "layout"]),
];
