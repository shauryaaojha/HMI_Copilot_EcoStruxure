/**
 * The agent: build, check against everything that can judge the project,
 * repair, and check again - then prove it in the product when it can.
 *
 * docs/AGENTIC_PLAN.md §3. Each round:
 *
 *   look    tags → plant model → screen programs (the pipeline: no coordinates from a model)
 *   check   preflight (what the export refuses), rules (naming, limits, overlap, ISA-101),
 *           semantics (every unit has its readings, commands and alarms on some screen)
 *   repair  findings → the conversation model as an edit request → ops, dry-run on a
 *           copy of the project; kept only if the error count drops
 *   prove   package, read the bytes back (selfCheck), and - on a machine with the
 *           licensed editor - open and simulate it there (scripts/ote-bench.ps1)
 *
 * With no model configured the repair step is skipped and says so; the build,
 * the checks and the proof still run. Every step is yielded, so the CLI prints
 * it and the API streams it, and nothing is written without being reported.
 */

import { buildFromTags } from "./build";
import { converse, digestOf } from "@/lib/ai/converse";
import { applyOps } from "@/core/ops";
import { resolveProvider } from "@/lib/ai/provider";
import { packageProject, type PackageInput } from "@/lib/ote/packager";
import { preflight, selfCheck } from "@/lib/ote/preflight";
import { validateProject } from "@/lib/validation/rules";
import { createProjectStore } from "@/store/project";
import type { Variable } from "@/lib/ote/schema";
import type { Wire } from "@/lib/ote/bindings";

export type AgentStep =
  | { kind: "look" | "act" | "check" | "repair" | "prove" | "note"; message: string; data?: unknown }
  | { kind: "done"; message: string; bytes: Uint8Array; report: AgentReport; input: PackageInput };

export interface Finding {
  severity: string;
  rule: string;
  message: string;
  /** The object it is about, when there is one: the repair works on its screen. */
  objectId?: string;
}

export interface AgentReport {
  rounds: number;
  errors: number;
  warnings: number;
  findings: Finding[];
  repairsKept: number;
  repairsDropped: number;
  bench?: BenchResult | null;
  provider: string | null;
}

export interface BenchResult {
  opened: boolean;
  simulated: boolean;
  convertPrompt?: boolean;
  explorer?: Record<string, number>;
  errors?: string[];
  dialogs?: unknown[];
  notes?: string[];
  problems?: string[];
  shots?: string[];
}

export interface AgentOptions {
  goal: string;
  name: string;
  variables: Variable[];
  panel: { model: string; width: number; height: number };
  /** Repair rounds after the first check. */
  rounds?: number;
  /** Prove it in the licensed editor; given by the caller that can (CLI on Windows). */
  bench?: (bytes: Uint8Array) => Promise<BenchResult | null>;
  /**
   * Check and repair this project instead of building one from the tags: a
   * shared project's server snapshot (Phase D), whose screens already exist.
   */
  from?: PackageInput;
  /**
   * Package the result and read it back. On by default; the server's run for
   * a shared project turns it off, because the result becomes a proposal, not
   * bytes, and the skeleton may not be on that machine.
   */
  prove?: boolean;
}

/** Every check the project can be put through without the product. */
export function check(input: PackageInput): Finding[] {
  const pre = preflight(input).map((p) => ({ severity: "error", rule: "preflight", message: `${p.where}: ${p.problem}` }));
  const rules = validateProject(input, input.target).map((f) => ({ severity: f.severity, rule: f.rule, message: f.message, ...(f.objectId ? { objectId: f.objectId } : {}) }));
  return [...pre, ...rules];
}

const errorsIn = (f: Finding[]) => f.filter((x) => x.severity === "error").length;
const warningsIn = (f: Finding[]) => f.filter((x) => x.severity === "warning").length;

/** A store holding the project, so the edit ops the chat uses apply here too. */
function storeOf(input: PackageInput) {
  const store = createProjectStore();
  store.getState().hydrate({
    name: input.name,
    target: input.target,
    screens: structuredClone(input.screens),
    activeScreenId: input.screens[0]?.UniqueId,
    variables: structuredClone(input.variables),
    alarms: structuredClone(input.alarms),
    bindings: input.wires.map((w) => ({ tag: w.tag, targetId: w.part.UniqueId, targetName: w.part.Name, property: w.property, ...(w.converter ? { converter: w.converter } : {}) })),
  } as never);
  return store;
}

/** The store back into what the packager takes. */
function inputOf(store: ReturnType<typeof createProjectStore>): PackageInput {
  const s = store.getState();
  const byId = new Map(s.screens.flatMap((screen) => screen.Children[0].Children.map((part) => [part.UniqueId, { part, screenId: screen.UniqueId }] as const)));
  const wires: Wire[] = s.bindings.flatMap((b) => {
    const found = byId.get(b.targetId);
    return found ? [{ part: found.part, tag: b.tag, property: b.property, screenId: found.screenId, ...(b.converter ? { converter: b.converter } : {}) }] : [];
  });
  return { name: s.name, target: s.target, screens: s.screens, variables: s.variables, alarms: s.alarms, wires };
}

/** The findings as the request the conversation model answers with ops. */
function repairRequest(findings: Finding[]): string {
  const worst = findings.filter((f) => f.severity === "error" || f.severity === "warning").slice(0, 12);
  return (
    "Fix these validation findings with the smallest edits that remove them. " +
    "Do not delete equipment or bindings to make a finding go away; move, resize or add instead.\n" +
    worst.map((f, i) => `${i + 1}. [${f.severity}] ${f.rule}: ${f.message}`).join("\n")
  );
}

export async function* runAgent(options: AgentOptions): AsyncGenerator<AgentStep> {
  const provider = resolveProvider();
  yield { kind: "look", message: `${options.variables.length} tags, panel ${options.panel.model} ${options.panel.width}x${options.panel.height}; model: ${provider.provider ? `${provider.model}` : "none"}` };

  // --- build ------------------------------------------------------------------
  let input: PackageInput;
  if (options.from) {
    input = options.from;
    yield { kind: "act", message: `checking the project as it stands: ${input.screens.length} screens, ${input.wires.length} bindings` };
  } else {
    const built = await buildFromTags({ name: options.name, intent: options.goal, variables: options.variables, panel: options.panel });
    input = built.input;
    yield { kind: "act", message: `built ${input.screens.length} screens, ${input.wires.length} bindings, ${input.alarms.length} alarms`, data: built.log };
  }

  // --- check and repair ---------------------------------------------------------
  let findings = check(input);
  yield { kind: "check", message: `${errorsIn(findings)} errors, ${warningsIn(findings)} warnings, ${findings.length - errorsIn(findings) - warningsIn(findings)} notes`, data: findings };

  let kept = 0;
  let dropped = 0;
  let round = 0;
  const maxRounds = options.rounds ?? 2;
  while (round < maxRounds && errorsIn(findings) + warningsIn(findings) > 0) {
    round++;
    if (!provider.provider) {
      yield { kind: "note", message: `no model configured (${provider.reason}); findings are reported, not repaired` };
      break;
    }
    const store = storeOf(input);
    const s = store.getState();
    // The model sees one screen in detail: the one the worst findings are on,
    // with their objects selected, so "move X" has X in front of it.
    const serious = findings.filter((f) => f.severity === "error" || f.severity === "warning");
    const screenOfObject = new Map(s.screens.flatMap((sc) => sc.Children[0].Children.map((p) => [p.UniqueId, sc.UniqueId] as const)));
    const focus = serious.map((f) => (f.objectId ? screenOfObject.get(f.objectId) : undefined)).find(Boolean) ?? s.activeScreenId;
    const onFocus = serious.filter((f) => f.objectId && screenOfObject.get(f.objectId) === focus);
    const request = repairRequest(onFocus.length > 0 ? onFocus : serious);
    const selectedIds = onFocus.map((f) => f.objectId!).filter((id, i, a) => a.indexOf(id) === i);
    const digest = digestOf({ name: s.name, target: s.target, screens: s.screens, activeScreenId: focus, variables: s.variables, alarms: s.alarms, bindings: s.bindings, selectedIds, handles: s.handles }, request);
    const answer = await converse({ history: [{ role: "user", text: request }], digest }).catch((e: unknown) => {
      return { error: e instanceof Error ? e.message : String(e) } as const;
    });
    if (!answer || "error" in answer) {
      yield { kind: "note", message: `round ${round}: the model gave no usable answer${answer && "error" in answer ? ` (${answer.error})` : ""}` };
      break;
    }
    const ops = answer.turn.ops ?? [];
    if (ops.length === 0) {
      yield { kind: "repair", message: `round ${round}: the model proposed no edits: ${answer.turn.reply ?? ""}`.slice(0, 300) };
      break;
    }
    const outcome = applyOps(ops, store);
    const candidate = inputOf(store);
    const after = check(candidate);
    const better = errorsIn(after) < errorsIn(findings) || (errorsIn(after) === errorsIn(findings) && warningsIn(after) < warningsIn(findings));
    if (better) {
      input = candidate;
      kept++;
      yield { kind: "repair", message: `round ${round}: kept ${ops.length} edits; ${errorsIn(findings)}→${errorsIn(after)} errors, ${warningsIn(findings)}→${warningsIn(after)} warnings`, data: { ops, outcome } };
      findings = after;
    } else {
      dropped++;
      yield { kind: "repair", message: `round ${round}: dropped ${ops.length} edits; they did not reduce the findings (${errorsIn(after)} errors, ${warningsIn(after)} warnings)`, data: { ops, outcome } };
      break;
    }
  }

  // --- prove --------------------------------------------------------------------
  let bytes: Uint8Array = new Uint8Array();
  if (options.prove !== false) {
    bytes = await packageProject(input);
    await selfCheck(bytes, input);
    yield { kind: "prove", message: `packaged ${(bytes.length / 1024).toFixed(0)} KB and read it back: it opens as written` };
  }

  let bench: BenchResult | null | undefined;
  if (options.bench) {
    yield { kind: "prove", message: "opening it in the licensed EcoStruxure Operator Terminal Expert…" };
    bench = await options.bench(bytes).catch(() => null);
    if (!bench) yield { kind: "note", message: "the editor could not be driven on this machine" };
    else
      yield {
        kind: "prove",
        message: bench.simulated
          ? `the product opened and simulated it${bench.errors?.length ? `, with ${bench.errors.length} entries in its Errors pane` : ", Errors pane empty"}`
          : bench.opened
            ? `the product opened it but did not simulate: ${[...(bench.problems ?? []), ...((bench.dialogs ?? []) as unknown[][]).map((d) => d.join(" "))].join("; ")}`
            : `the product did not open it: ${(bench.problems ?? []).join("; ")}`,
        data: bench,
      };
  }

  const report: AgentReport = {
    rounds: round,
    errors: errorsIn(findings),
    warnings: warningsIn(findings),
    findings,
    repairsKept: kept,
    repairsDropped: dropped,
    bench: bench ?? null,
    provider: provider.provider ? `${provider.provider}:${provider.model}` : null,
  };
  yield { kind: "done", message: `${input.screens.length} screens; ${report.errors} errors, ${report.warnings} warnings left${bench ? (bench.simulated ? "; simulates in OTE" : "; OTE did not simulate it") : ""}`, bytes, report, input };
}
