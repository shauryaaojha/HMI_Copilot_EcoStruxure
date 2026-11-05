import { isa101Rules } from "./isa101";
import { isa182Rules } from "./isa182";
import { curatedPatterns, validationRules } from "./patterns";

export const curatedEntries = [...isa101Rules, ...isa182Rules, ...validationRules, ...curatedPatterns];
