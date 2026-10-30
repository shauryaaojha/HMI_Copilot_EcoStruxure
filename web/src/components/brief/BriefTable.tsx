/**
 * The plant brief, as a table, before anything is built.
 *
 * This is the review step §5.3 asks for: units, counts, signals, alarms and
 * screens, in front of the engineer, editable, with "Build" refusing while a
 * row is incomplete. A missing count is shown as missing rather than filled in
 * with one, because the brief exists to make the assumptions visible and a
 * quietly defaulted count is the opposite.
 *
 * Nothing here draws or decides geometry. It edits rows.
 */
"use client";

import { AlertTriangle, Check, Loader2, Plus, X } from "lucide-react";
import { CATALOGUE, kindOf } from "@/lib/brief/catalogue";
import type { Brief, BriefProblem } from "@/lib/brief/brief";
import type { DraftedBy } from "@/lib/brief/draft";

export interface BriefTableProps {
  brief: Brief;
  by: DraftedBy | null;
  problems: BriefProblem[];
  questions?: string[];
  busy?: boolean;
  onCount: (unitId: string, count: number | undefined) => void;
  onToggleSignal: (unitId: string, signal: string) => void;
  onRemove: (unitId: string) => void;
  onAdd: (kindId: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const SOURCE: Record<DraftedBy, string> = {
  model: "Drafted by the model from your description. Nothing is built until you confirm it.",
  rules: "Read from your description by the naming rules. Nothing is built until you confirm it.",
  clarify: "Nothing in the description matched the catalogue, so the brief is empty. Add the units.",
};

export function BriefTable({
  brief,
  by,
  problems,
  questions,
  busy,
  onCount,
  onToggleSignal,
  onRemove,
  onAdd,
  onConfirm,
  onCancel,
}: BriefTableProps) {
  const problemsOf = (unitId: string) => problems.filter((p) => p.unitId === unitId);
  const general = problems.filter((p) => !p.unitId);
  const tags = brief.units.reduce((n, u) => n + (u.count ?? 0) * u.signals.length, 0);

  return (
    <div className="reveal is-in mt-7 rounded-2xl border border-line-subtle bg-surface-raised shadow-xl shadow-black/20">
      <div className="border-b border-line-subtle px-4 py-3">
        <h2 className="text-sm font-semibold">The plant brief</h2>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">{by ? SOURCE[by] : ""}</p>
      </div>

      {questions && questions.length > 0 && (
        <ul className="border-b border-line-subtle px-4 py-3 text-xs leading-relaxed text-text-muted">
          {questions.slice(0, 2).map((question) => (
            <li key={question} className="flex gap-1.5">
              <span aria-hidden className="text-brand-400">?</span>
              {question}
            </li>
          ))}
        </ul>
      )}

      <div className="divide-y divide-line-subtle">
        {brief.units.map((unit) => {
          const kind = kindOf(unit.kind);
          const wrong = problemsOf(unit.id);
          return (
            <div key={unit.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{unit.label}</span>
                <span className="rounded-md border border-line-subtle px-1.5 py-0.5 font-mono text-[10px] text-text-faint">
                  {kind?.prefix ?? "UNT"}_nnn
                </span>

                <label className="ml-auto flex items-center gap-1.5 text-xs text-text-muted">
                  How many
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={unit.count ?? ""}
                    placeholder="?"
                    aria-label={`How many ${unit.label.toLowerCase()}`}
                    onChange={(e) => {
                      const value = e.target.value.trim();
                      onCount(unit.id, value === "" ? undefined : Number(value));
                    }}
                    className={`focus-ring w-16 rounded-md border bg-surface-base px-2 py-1 text-xs text-text-primary ${
                      unit.count === undefined ? "border-status-warn/60" : "border-line-subtle"
                    }`}
                  />
                </label>

                <button
                  type="button"
                  aria-label={`Remove ${unit.label}`}
                  onClick={() => onRemove(unit.id)}
                  className="focus-ring rounded-md p-1 text-text-faint hover:text-status-alarm"
                >
                  <X size={13} aria-hidden />
                </button>
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {(kind?.signals ?? []).map((signal) => {
                  const on = unit.signals.includes(signal.id);
                  return (
                    <button
                      key={signal.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => onToggleSignal(unit.id, signal.id)}
                      title={signal.what || signal.id}
                      className={`focus-ring rounded-md border px-2 py-0.5 font-mono text-[10px] transition ${
                        on
                          ? "border-brand-500/60 bg-brand-500/15 text-text-primary"
                          : "border-line-subtle text-text-faint hover:border-brand-500/40"
                      }`}
                    >
                      {signal.id}
                      <span className="ml-1 opacity-60">{signal.type}</span>
                    </button>
                  );
                })}
              </div>

              {wrong.map((problem) => (
                <p key={problem.field + problem.message} className="mt-2 flex items-center gap-1.5 text-[11px] text-status-warn">
                  <AlertTriangle size={11} aria-hidden />
                  {problem.message}
                </p>
              ))}
            </div>
          );
        })}
      </div>

      {/* --- add a unit the description did not name -------------------- */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-line-subtle px-4 py-3">
        <span className="mr-1 text-xs text-text-muted">Add</span>
        {CATALOGUE.map((kind) => (
          <button
            key={kind.id}
            type="button"
            onClick={() => onAdd(kind.id)}
            className="focus-ring inline-flex items-center gap-1 rounded-md border border-line-subtle px-2 py-0.5 text-[11px] text-text-muted hover:border-brand-500/50 hover:text-text-primary"
          >
            <Plus size={10} aria-hidden />
            {kind.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line-subtle px-4 py-3">
        <p className="text-xs text-text-muted">
          {general.length > 0
            ? general[0].message
            : `${brief.units.length} units, ${tags} placeholder tags. Alarms on ${brief.alarms.join(", ")}.`}
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="focus-ring ml-auto rounded-lg px-3 py-1.5 text-xs text-text-muted hover:text-text-primary"
        >
          Start again
        </button>
        <button
          type="button"
          disabled={busy || problems.length > 0}
          onClick={onConfirm}
          title={problems.length > 0 ? problems[0].message : undefined}
          className="focus-ring inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-1.5 text-xs font-semibold text-text-onbrand transition hover:bg-brand-600 disabled:opacity-40"
        >
          {busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Check size={13} aria-hidden />}
          Confirm and build
        </button>
      </div>
    </div>
  );
}
