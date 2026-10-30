/**
 * Drafting a plant brief, editing it, and confirming it into placeholder tags.
 *
 * The step that did not exist. `useTagImport().draft` turned a description
 * straight into tags and the build began; this drafts a brief, hands it back
 * for a person to read, and only mints tags when they say so
 * (docs/PLAN_FULL_ARCHITECTURE.md §5.3).
 *
 * The confirm step runs in the browser, not on the server, for a reason worth
 * stating: a confirmed brief is the engineer's, and the server never had a
 * version of it that a person had seen. So the tags are derived from exactly
 * the rows that were on screen when the button was pressed.
 */
"use client";

import { useCallback, useState } from "react";
import { useProject } from "@/store/project";
import {
  Brief,
  canConfirm,
  confirm as confirmBrief,
  problemsWith,
  type BriefProblem,
  type Unit,
} from "@/lib/brief/brief";
import { CATALOGUE, kindOf } from "@/lib/brief/catalogue";
import type { DraftedBy } from "@/lib/brief/draft";

export interface BriefState {
  brief: Brief;
  by: DraftedBy;
  questions?: string[];
}

export function useBrief() {
  const importTags = useProject((s) => s.importTags);
  const log = useProject((s) => s.log);
  const [state, setState] = useState<BriefState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Asks the server for a brief. Returns it, or null when nothing came back. */
  const draft = useCallback(async (intent: string): Promise<BriefState | null> => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/brief/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent }),
      });
      const data = (await response.json().catch(() => null)) as
        | { brief?: unknown; by?: DraftedBy; questions?: string[]; error?: string }
        | null;
      if (!response.ok || !data?.brief) {
        setError(data?.error ?? "the brief could not be drafted");
        return null;
      }
      // Parsed again on this side: the route's answer is JSON like any other.
      const parsed = Brief.safeParse(data.brief);
      if (!parsed.success) {
        setError("the brief that came back could not be read");
        return null;
      }
      const next: BriefState = { brief: parsed.data, by: data.by ?? "rules", questions: data.questions };
      setState(next);
      return next;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "the brief could not be drafted");
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const edit = useCallback((change: (brief: Brief) => Brief) => {
    setState((s) => (s ? { ...s, brief: change(s.brief) } : s));
  }, []);

  const setCount = useCallback((unitId: string, count: number | undefined) => {
    edit((brief) => ({ ...brief, units: brief.units.map((u) => (u.id === unitId ? { ...u, count } : u)) }));
  }, [edit]);

  const toggleSignal = useCallback((unitId: string, signal: string) => {
    edit((brief) => ({
      ...brief,
      units: brief.units.map((u) => {
        if (u.id !== unitId) return u;
        const has = u.signals.includes(signal);
        return { ...u, signals: has ? u.signals.filter((s) => s !== signal) : [...u.signals, signal] };
      }),
    }));
  }, [edit]);

  const removeUnit = useCallback((unitId: string) => {
    edit((brief) => ({
      ...brief,
      units: brief.units.filter((u) => u.id !== unitId),
      flow: brief.flow.filter((f) => f.from !== unitId && f.to !== unitId),
    }));
  }, [edit]);

  const addUnit = useCallback((kindId: string) => {
    edit((brief) => {
      const kind = kindOf(kindId) ?? CATALOGUE[0];
      // A fresh id rather than a reused index, so provenance stays unambiguous
      // after rows have been removed.
      const id = `${kind.id}-${Date.now().toString(36)}`;
      const unit: Unit = { id, kind: kind.id, label: kind.label, count: undefined, signals: [...kind.defaultSignals] };
      return { ...brief, units: [...brief.units, unit] };
    });
  }, [edit]);

  const clear = useCallback(() => {
    setState(null);
    setError(null);
  }, []);

  /**
   * The confirm step: placeholder tags from the rows as they stand, recorded
   * as assumed, with the brief kept beside them so validation can check them.
   * Returns how many tags, or null when the brief is not confirmable.
   */
  const accept = useCallback((): number | null => {
    const current = state?.brief;
    if (!current || !canConfirm(current)) return null;
    const by = state.by === "clarify" ? "form" : state.by;
    const { confirmed, variables } = confirmBrief(current, by);
    importTags(variables, {
      fileName: "Assumed from the confirmed brief",
      at: confirmed.confirmedAt,
      corrections: [],
      skipped: [],
      summary: { total: variables.length },
      pending: true,
      brief: confirmed,
    });
    log(
      `Brief confirmed: ${current.units.length} units, ${variables.length} placeholder tags ` +
        `(drafted ${state.by === "model" ? "by the model" : state.by === "rules" ? "by rules" : "by hand"}); ` +
        "import the real export later to bind them",
    );
    return variables.length;
  }, [state, importTags, log]);

  const problems: BriefProblem[] = state ? problemsWith(state.brief) : [];

  return {
    brief: state?.brief ?? null,
    by: state?.by ?? null,
    questions: state?.questions,
    problems,
    ready: state !== null && problems.length === 0,
    busy,
    error,
    draft,
    edit,
    setCount,
    toggleSignal,
    removeUnit,
    addUnit,
    clear,
    accept,
  };
}
