"use client";

/**
 * Regenerate one screen, as a diff the engineer reviews object by object.
 *
 * docs/AUDIT_2026-10.md §5. Three steps, all reversible until the last and the
 * last undoable with Ctrl+Z:
 *
 *   1. Recipe - what the screen is compiled from: which units, at which ISA-101
 *      level, with which sections. Edit it to add a pump or drop the banner.
 *   2. Review - the screen compiled again (/api/regenerate) and diffed against
 *      what is there (lib/program/regenerate.ts). Each change is a row with a
 *      tick: untouched generated objects are ticked, anything the engineer
 *      edited, placed, imported, locked or hid is not, and says why. Ticked
 *      changes are drawn as ghosts on the canvas while the panel is open, so
 *      the review happens on the screen itself - which is why this is a side
 *      panel and not a modal over the canvas.
 *   3. Apply - one store action, one undo step, one version.
 *
 * Objects the generator never placed are never listed and never touched.
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, RefreshCw, X } from "lucide-react";
import { useProject } from "@/store/project";
import { Button, cn } from "@/components/ui";
import { expectJson } from "@/lib/ingest/client";
import { inferEquipment } from "@/lib/ai/infer";
import { planRegeneration, type FreshScreen, type RegenPlan, type RegenUnit } from "@/lib/program/regenerate";
import type { ScreenProgram } from "@/lib/program/program";
import type { Part } from "@/lib/ote/schema";

type Stage = "recipe" | "comparing" | "review" | "applied" | "failed";

interface Recompiled {
  fresh: FreshScreen;
  program: ScreenProgram;
  reconstructed: boolean;
}

const SECTIONS = ["status", "process", "alarms"] as const;
const LEVELS: { value: 1 | 2 | 3; label: string }[] = [
  { value: 1, label: "L1 overview (tiles)" },
  { value: 2, label: "L2 unit (faceplate cards)" },
  { value: 3, label: "L3 detail (panels)" },
];

export function RegenerateDialog({ screenId, onClose }: { screenId: string; onClose: () => void }) {
  const screen = useProject((s) => s.screens.find((x) => x.UniqueId === screenId));
  const stored = useProject((s) => s.programs[screenId]);
  const variables = useProject((s) => s.variables);
  const structure = useProject((s) => s.tagImport?.structure);
  const setPreview = useProject((s) => s.setPreview);
  const applyRegeneration = useProject((s) => s.applyRegeneration);

  const equipment = useMemo(() => inferEquipment(variables, structure), [variables, structure]);
  const [program, setProgram] = useState<ScreenProgram | undefined>(stored ? structuredClone(stored) : undefined);
  const [stage, setStage] = useState<Stage>("recipe");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Recompiled | null>(null);
  const [plan, setPlan] = useState<RegenPlan | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<{ added: number; updated: number; removed: number } | null>(null);

  // Escape closes.
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  // Closing clears the ghosts - only on close, not on every parent render.
  useEffect(
    () => () => {
      const s = useProject.getState();
      if (s.preview?.messageId === `regen:${screenId}`) s.setPreview(undefined);
    },
    [screenId],
  );

  // Ghosts for what is ticked: the new versions drawn, the replaced ones struck.
  useEffect(() => {
    if (!plan || !result || stage !== "review") return;
    const chosen = plan.units.filter((u) => ticked.has(u.id));
    const freshByKey = new Map(result.fresh.parts.map((p) => [result.fresh.keys[p.UniqueId] ?? p.Name, p]));
    const added: Part[] = chosen.flatMap((u) => u.fresh.map((k) => freshByKey.get(k)).filter((p): p is Part => !!p));
    const removed = chosen.flatMap((u) => u.current);
    setPreview({ messageId: `regen:${screenId}`, screens: { [screenId]: { added, removed, moved: [] } } });
  }, [plan, result, ticked, stage, screenId, setPreview]);

  if (!screen) return null;
  const isProcess = !!program?.process;

  async function compare() {
    if (!screen) return;
    setStage("comparing");
    setError(null);
    try {
      const s = useProject.getState();
      const response = await fetch("/api/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          screenName: screen.Name,
          program,
          parts: screen.Children[0].Children.map((p) => ({ name: p.Name, type: p.Type })),
          screens: s.screens.filter((x) => x.Type !== "Content").map((x) => ({ name: x.Name, program: s.programs[x.UniqueId] })),
          variables: s.variables,
          structure: s.tagImport?.structure,
          panel: s.target,
          plant: s.plant,
        }),
      });
      const data = await expectJson<Recompiled>(response, "Compiling the screen");
      const parts = screen.Children[0].Children;
      const ids = new Set(parts.map((p) => p.UniqueId));
      const planned = planRegeneration(
        {
          parts,
          meta: s.objectMeta,
          bindings: s.bindings.filter((b) => ids.has(b.targetId)),
          composites: Object.values(s.composites).filter((c) => c.screenId === screenId || c.partIds.some((id) => ids.has(id))),
        },
        data.fresh,
      );
      setResult(data);
      setProgram(data.program);
      setPlan(planned);
      setTicked(new Set(planned.units.filter((u) => u.defaultAccept).map((u) => u.id)));
      setStage("review");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "could not compile the screen");
      setStage("failed");
    }
  }

  function apply() {
    if (!plan || !result || !screen) return;
    const done = applyRegeneration(screenId, result.fresh, plan, [...ticked], result.program);
    const s = useProject.getState();
    s.setPreview(undefined);
    const total = done.added + done.updated + done.removed;
    if (total > 0) {
      s.snapshot(`Regenerated ${screen.Name}`);
      s.log(`Regenerated ${screen.Name}: ${done.added} added, ${done.updated} updated, ${done.removed} removed; ${plan.units.length - ticked.size} kept`);
    }
    setSummary(done);
    setStage("applied");
  }

  const toggle = (id: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const editRecipe = (patch: Partial<ScreenProgram>) =>
    setProgram((p) => ({
      ...(p ?? { name: screen.Name, title: screen.Name, level: 2, kpis: [], faceplates: [], sections: ["status"], rationale: "set in the regenerate panel" }),
      ...patch,
    }));

  const changing = plan?.units.filter((u) => !u.protected) ?? [];
  const kept = plan?.units.filter((u) => u.protected) ?? [];

  return (
    <aside
      role="dialog"
      aria-label={`Regenerate ${screen.Name}`}
      className="fixed bottom-4 right-4 top-16 z-40 flex w-[26rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-line bg-surface-float"
      style={{ boxShadow: "var(--elev-3)" }}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line-subtle px-4">
        <RefreshCw size={14} aria-hidden className="text-brand-400" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
          Regenerate <span className="font-normal text-text-muted">{screen.Name}</span>
        </h2>
        <button type="button" onClick={onClose} aria-label="Close" className="focus-ring rounded-md p-1 text-text-muted transition hover:bg-surface-hover hover:text-text-primary">
          <X size={14} aria-hidden />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-xs">
        {(stage === "recipe" || stage === "comparing" || stage === "failed") && (
          <>
            <p className="text-text-muted">
              The screen is compiled again from its recipe against the tags, the Plant Model and the library as they are now. Nothing changes until you
              review and apply; objects you placed by hand are never touched.
            </p>
            {!program && (
              <p className="rounded-lg border border-status-warn/30 bg-status-warn/[0.06] p-2.5 text-status-warn">
                This screen has no stored recipe. One will be reconstructed from the faceplates on it, and you can adjust it on the next step.
              </p>
            )}
            {program && isProcess && (
              <p className="rounded-lg border border-line-subtle p-2.5 text-text-secondary">
                A process view of {program.process!.nodes.length} units, laid out in flow order from the Plant Model. Its units and pipes follow the Plant page.
              </p>
            )}
            {program && !isProcess && (
              <div className="space-y-3">
                <fieldset className="space-y-1">
                  <legend className="mb-1 font-medium text-text-secondary">Level</legend>
                  {LEVELS.map((l) => (
                    <label key={l.value} className="flex cursor-pointer items-center gap-2">
                      <input type="radio" name="level" checked={program.level === l.value} onChange={() => editRecipe({ level: l.value })} className="accent-[var(--color-brand-500)]" />
                      {l.label}
                    </label>
                  ))}
                </fieldset>
                <fieldset className="space-y-1">
                  <legend className="mb-1 font-medium text-text-secondary">Sections</legend>
                  {SECTIONS.map((sec) => (
                    <label key={sec} className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={program.sections?.includes(sec) ?? false}
                        onChange={(e) => editRecipe({ sections: e.target.checked ? [...(program.sections ?? []), sec] : (program.sections ?? []).filter((x) => x !== sec) })}
                        className="accent-[var(--color-brand-500)]"
                      />
                      {sec === "alarms" ? "alarm banner" : sec}
                    </label>
                  ))}
                </fieldset>
                <fieldset className="space-y-1">
                  <legend className="mb-1 font-medium text-text-secondary">Units on this screen</legend>
                  {equipment.filter((u) => u.kind !== "instrument" || program.faceplates?.includes(u.id)).map((u) => (
                    <label key={u.id} className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={program.faceplates?.includes(u.id) ?? false}
                        onChange={(e) =>
                          editRecipe({ faceplates: e.target.checked ? [...(program.faceplates ?? []), u.id] : (program.faceplates ?? []).filter((x) => x !== u.id) })
                        }
                        className="accent-[var(--color-brand-500)]"
                      />
                      <span className="truncate">{u.label}</span>
                      <span className="text-text-faint">{u.kind}</span>
                    </label>
                  ))}
                </fieldset>
              </div>
            )}
            {error && (
              <p className="flex gap-2 rounded-lg border border-status-alarm/40 bg-status-alarm/10 p-3 text-status-alarm">
                <AlertTriangle size={14} aria-hidden className="shrink-0" />
                {error}
              </p>
            )}
          </>
        )}

        {stage === "review" && plan && result && (
          <>
            <p className="text-text-muted">
              {plan.units.length === 0
                ? "Nothing to do: the screen compiles to exactly what is on it."
                : `${plan.units.length} change${plan.units.length === 1 ? "" : "s"}. Ticked ones are drawn on the canvas.`}{" "}
              {plan.unchanged} unchanged{plan.untouched > 0 ? `, ${plan.untouched} placed by hand and left alone` : ""}.
              {result.reconstructed && " The recipe was reconstructed from the faceplates on the screen."}
            </p>
            {changing.length > 0 && <UnitList title="Will change" units={changing} ticked={ticked} toggle={toggle} />}
            {kept.length > 0 && <UnitList title="Your work - kept unless you tick it" units={kept} ticked={ticked} toggle={toggle} warn />}
            {result.fresh.notes.length > 0 && (
              <ul className="space-y-1 text-[11px] text-text-faint">
                {result.fresh.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </>
        )}

        {stage === "applied" && summary && (
          <ul className="space-y-1 text-text-secondary">
            <li className="flex gap-2">
              <Check size={12} aria-hidden className="mt-0.5 shrink-0 text-brand-400" />
              {summary.added} added, {summary.updated} updated, {summary.removed} removed
            </li>
            <li className="flex gap-2 text-text-faint">
              <Check size={12} aria-hidden className="mt-0.5 shrink-0" />
              Updated objects kept their ids, names and bindings. Ctrl+Z undoes the whole regeneration.
            </li>
          </ul>
        )}
      </div>

      <footer className="flex h-12 shrink-0 items-center justify-end gap-2 border-t border-line-subtle px-4">
        {stage === "applied" ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : stage === "review" ? (
          <>
            <Button variant="ghost" onClick={() => setStage("recipe")}>
              Back
            </Button>
            <Button variant="primary" disabled={ticked.size === 0} onClick={apply}>
              Apply {ticked.size > 0 ? ticked.size : ""}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={stage === "comparing" || variables.length === 0} onClick={compare}>
              {stage === "comparing" ? "Compiling…" : "Compare"}
            </Button>
          </>
        )}
      </footer>
    </aside>
  );
}

function UnitList({ title, units, ticked, toggle, warn }: { title: string; units: RegenUnit[]; ticked: Set<string>; toggle: (id: string) => void; warn?: boolean }) {
  const verb = { add: "Add", update: "Update", remove: "Remove" } as const;
  return (
    <section className="space-y-1">
      <h3 className={cn("font-medium", warn ? "text-status-warn" : "text-text-secondary")}>{title}</h3>
      <ul className="space-y-1">
        {units.map((u) => {
          const on = ticked.has(u.id);
          return (
            <li key={`${u.kind}:${u.id}`}>
              <label className={cn("flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-1.5 transition", on ? "border-brand-500/40 bg-brand-500/[0.06]" : "border-line-subtle hover:border-line")}>
                <input type="checkbox" checked={on} onChange={() => toggle(u.id)} className="mt-0.5 accent-[var(--color-brand-500)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-text-primary">
                    {verb[u.kind]} {u.label}
                  </span>
                  <span className="block text-[11px] text-text-muted">
                    {u.reason}
                    {u.changes.length > 0 && ` · ${u.changes.join(", ")}`}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
