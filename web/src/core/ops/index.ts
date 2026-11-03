/**
 * The write path. Every change to a project goes through here.
 *
 * `ops.ts` is the language - the `Op` union a caller speaks - and `apply.ts`
 * is the only thing that turns that language into store actions. Chat, the
 * inspector, the agent loop and later the MCP server all call `applyOps`;
 * none of them writes into the project tree itself, and none of them carries
 * its own copy of the rules.
 *
 * That single path is what makes the rest possible. One undo history, because
 * `commit` lands a dry run as one step. One collaboration stream, because
 * every change is a store diff. One place to check a proposal before it
 * lands. A second write path would have to reproduce all three.
 *
 * `docs/PLAN_FULL_ARCHITECTURE.md` §2.1: core/ops owns "the `Op` union and
 * `applyOps`: the only write path".
 */

export {
  ALIGN_MODES,
  COLOR_NAMES,
  OP_NAMES,
  Op,
  Place,
  Turn,
  TurnMode,
  buildsInstead,
  coerceTurn,
  type OpName,
} from "./ops";

export {
  applyOps,
  commit,
  dryRun,
  handleOf,
  previewOf,
  tagOf,
  type DryRun,
  type OpOutcome,
  type Rejection,
} from "./apply";
