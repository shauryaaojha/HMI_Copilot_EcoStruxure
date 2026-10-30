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
 *
 * It is also the guided form (decision D). An engineer who starts from the
 * form gets this component with no units in it rather than a second screen
 * with its own fields: the rows, the counts and the signal buttons are the
 * same editors either way, and a form built separately would be a second place
 * to keep the catalogue, the count rule and the confirm gate correct. What the
 * drafting path reads out of a description - the plant name, the numbering
 * start, the alarms - the form path simply types in.
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
  onLabel: (unitId: string, label: string) => void;
  onToggleSignal: (unitId: string, signal: string) => void;
  onFlow: (fromId: string, toId: string | undefined) => void;
  onRemove: (unitId: string) => void;
  onAdd: (kindId: string) => void;
  onPlant: (plant: Partial<Brief["plant"]>) => void;
  onNamingStart: (start: number) => void;
  onToggleAlarm: (signal: string) => void;
  onToggleScreen: (which: keyof Brief["screens"]) => void;
  /** A clarify question the engineer chose to answer. */
  onAnswer: (question: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const SOURCE: Record<DraftedBy, string> = {
  model: "Drafted by the model from your description. Nothing is built until you confirm it.",
  rules: "Read from your description by the naming rules. Nothing is built until you confirm it.",
  clarify: "Nothing in the description matched the catalogue. Answer the question, or fill the brief in here.",
  form: "Yours to fill in. Add the equipment, say how many of each, and nothing is built until you confirm it.",
};

const SCREENS: [keyof Brief["screens"], string][] = [
  ["overview", "Overview"],
  ["perUnitGroup", "One per unit group"],
  ["alarms", "Alarms"],
];

export function BriefTable({
  brief,
  by,
  problems,
  questions,
  busy,
  onCount,
  onLabel,
  onToggleSignal,
  onFlow,
  onRemove,
  onAdd,
  onPlant,
  onNamingStart,
  onToggleAlarm,
  onToggleScreen,
  onAnswer,
  onConfirm,
  onCancel,
}: BriefTableProps) {
  const problemsOf = (unitId: string) => problems.filter((p) => p.unitId === unitId);
  const general = problems.filter((p) => !p.unitId);
  const tags = brief.units.reduce((n, u) => n + (u.count ?? 0) * u.signals.length, 0);
  // An alarm on a signal no unit carries raises nothing, so the only ones
  // worth offering are the ones the rows actually have.
  const alarmable = [...new Set(brief.units.flatMap((u) => u.signals))];

  return (
    <div className="reveal is-in mt-7 rounded-2xl border border-line-subtle bg-surface-raised shadow-xl shadow-black/20">
      <div className="border-b border-line-subtle px-4 py-3">
        <h2 className="text-sm font-semibold">The plant brief</h2>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">{by ? SOURCE[by] : ""}</p>

        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <input
            value={brief.plant.name}
            aria-label="What the plant is called"
            placeholder="Transfer station"
            onChange={(e) => onPlant({ name: e.target.value })}
            className="focus-ring rounded-md border border-line-subtle bg-surface-base px-2 py-1.5 text-xs text-text-primary placeholder:text-text-faint"
          />
          <input
            value={brief.plant.purpose}
            aria-label="What the plant does"
            placeholder="Moves water from the sump to the break tank"
            onChange={(e) => onPlant({ purpose: e.target.value })}
            className="focus-ring rounded-md border border-line-subtle bg-surface-base px-2 py-1.5 text-xs text-text-primary placeholder:text-text-faint"
          />
        </div>
      </div>

      {/* The question is a button for the same reason it is one in the chat:
          clicking it puts it in the box, where the answer is written over it
          and sent as the next thing said (components/chat/ChatPanel.tsx). */}
      {questions && questions.length > 0 && (
        <ul className="space-y-1.5 border-b border-line-subtle px-4 py-3">
          {questions.slice(0, 2).map((question) => (
            <li key={question}>
              <button
                type="button"
                onClick={() => onAnswer(question)}
                title="Put this in the box to answer it"
                className="focus-ring w-full rounded-lg border border-status-info/30 bg-status-info/[0.06] px-3 py-2 text-left text-xs leading-relaxed text-status-info transition hover:border-status-info/60 hover:bg-status-info/10"
              >
                {question}
              </button>
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
                {/* The label is what the tag comments read, so it is the
                    engineer's word for this equipment - "Duty pump", not the
                    catalogue's "Pump". The kind behind it does not change. */}
                <input
                  value={unit.label}
                  aria-label={`What this ${kind?.label.toLowerCase() ?? unit.kind} is called`}
                  onChange={(e) => onLabel(unit.id, e.target.value)}
                  className="focus-ring w-40 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-medium text-text-primary hover:border-line-subtle focus:border-line-subtle focus:bg-surface-base"
                />
                <span className="rounded-md border border-line-subtle px-1.5 py-0.5 font-mono text-[10px] text-text-faint">
                  {kind?.prefix ?? "UNT"}_nnn
                </span>

                {/* What feeds what: the generator reads it for ordering and
                    connections, never for geometry (§5.3). One downstream unit
                    per row covers the plants this is for; the brief itself
                    holds a list of edges, so a branch is representable. */}
                {brief.units.length > 1 && (
                  <label className="flex items-center gap-1.5 text-xs text-text-muted">
                    feeds
                    <select
                      value={brief.flow.find((f) => f.from === unit.id)?.to ?? ""}
                      aria-label={`What ${unit.label} feeds`}
                      onChange={(e) => onFlow(unit.id, e.target.value || undefined)}
                      className="focus-ring rounded-md border border-line-subtle bg-surface-base px-1.5 py-1 text-xs text-text-primary"
                    >
                      <option value="">nothing yet</option>
                      {brief.units
                        .filter((other) => other.id !== unit.id)
                        .map((other) => (
                          <option key={other.id} value={other.id}>
                            {other.label}
                          </option>
                        ))}
                    </select>
                  </label>
                )}

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

      {/* --- alarms, screens and numbering ------------------------------ */}
      <div className="grid gap-3 border-t border-line-subtle px-4 py-3 sm:grid-cols-3">
        <div>
          <p className="label-eyebrow pb-1.5">Alarms on</p>
          <div className="flex flex-wrap gap-1.5">
            {alarmable.length === 0 && <span className="text-[11px] text-text-faint">Add a unit first.</span>}
            {alarmable.map((signal) => {
              const on = brief.alarms.includes(signal);
              return (
                <button
                  key={signal}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onToggleAlarm(signal)}
                  className={`focus-ring rounded-md border px-2 py-0.5 font-mono text-[10px] transition ${
                    on ? "border-status-alarm/60 bg-status-alarm/15 text-text-primary" : "border-line-subtle text-text-faint hover:border-status-alarm/40"
                  }`}
                >
                  {signal}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="label-eyebrow pb-1.5">Screens</p>
          <div className="flex flex-wrap gap-1.5">
            {SCREENS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={brief.screens[key]}
                onClick={() => onToggleScreen(key)}
                className={`focus-ring rounded-md border px-2 py-0.5 text-[10px] transition ${
                  brief.screens[key]
                    ? "border-brand-500/60 bg-brand-500/15 text-text-primary"
                    : "border-line-subtle text-text-faint hover:border-brand-500/40"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="label-eyebrow pb-1.5">Numbering</p>
          <label className="flex items-center gap-1.5 text-xs text-text-muted">
            <span className="font-mono text-[10px] text-text-faint">{brief.naming.pattern}</span>
            <input
              type="number"
              min={1}
              value={brief.naming.start}
              aria-label="The number the first unit of each kind gets"
              onChange={(e) => onNamingStart(Math.max(1, Number(e.target.value) || 1))}
              className="focus-ring w-16 rounded-md border border-line-subtle bg-surface-base px-2 py-1 text-xs text-text-primary"
            />
          </label>
        </div>
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
