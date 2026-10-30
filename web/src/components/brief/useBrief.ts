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
 *
 * Both ways in live here. `draft` asks the server to read a description;
 * `begin` opens an empty brief for the engineer to fill in themselves
 * (decision D). After that there is no difference: the same rows, the same
 * editors, the same `accept`. The hook holds one brief, not one per path, so
 * there is no second confirm step that could drift from the first.
 */
"use client";

import { useCallback, useState } from "react";
import { useProject } from "@/store/project";
import {
  Brief,
  EMPTY_BRIEF,
  canConfirm,
  placeholderImport,
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
  /** The description this brief was drafted from, kept so an answer can be added to it. */
  intent?: string;
  /** What the engineer has replied to the clarify questions so far. */
  answers?: string[];
}

export function useBrief() {
  const importTags = useProject((s) => s.importTags);
  const log = useProject((s) => s.log);
  const [state, setState] = useState<BriefState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Asks the server for a brief. Returns it, or null when nothing came back. */
  const draft = useCallback(async (intent: string, answers: string[] = []): Promise<BriefState | null> => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/brief/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent, answers }),
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
      const next: BriefState = { brief: parsed.data, by: data.by ?? "rules", questions: data.questions, intent, answers };
      setState(next);
      return next;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "the brief could not be drafted");
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  /**
   * An answer to the clarify questions: the description and the answer go back
   * together and the brief is drafted again from both.
   *
   * The answer is free text because that is what the clarify mode receives -
   * the question goes in the box, the engineer writes the answer over it, and
   * the reply is an ordinary turn (components/chat/ChatPanel.tsx). Nothing
   * here has to know which of the two questions was answered; the server reads
   * what was said, exactly as it read the description.
   */
  const answer = useCallback(
    (text: string): Promise<BriefState | null> =>
      draft(state?.intent ?? "", [...(state?.answers ?? []), text]),
    [draft, state],
  );

  /**
   * An empty brief for the engineer to fill in, with no description at all.
   *
   * The second way in (decision D). It is the same state the drafting path
   * produces, so the table that appears is the same table and the confirm
   * button behind it is the same button - a form path with its own confirm
   * step would be a second gate to keep in step with this one.
   */
  const begin = useCallback(() => {
    setError(null);
    setState({ brief: EMPTY_BRIEF, by: "form" });
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

  /**
   * The fields the drafting path could fill in but nobody could edit.
   *
   * They exist on a drafted brief too - the model proposes a plant name, the
   * rules propose the alarm signals - so these are editors on the brief rather
   * than inputs belonging to the form. The form path needs them because it has
   * no description to read them from; the drafting path needs them because a
   * proposal nobody can correct is not a review.
   */
  const setPlant = useCallback((plant: Partial<Brief["plant"]>) => {
    edit((brief) => ({ ...brief, plant: { ...brief.plant, ...plant } }));
  }, [edit]);

  const setNamingStart = useCallback((start: number) => {
    edit((brief) => ({ ...brief, naming: { ...brief.naming, start } }));
  }, [edit]);

  const toggleAlarm = useCallback((signal: string) => {
    edit((brief) => ({
      ...brief,
      alarms: brief.alarms.includes(signal) ? brief.alarms.filter((a) => a !== signal) : [...brief.alarms, signal],
    }));
  }, [edit]);

  const toggleScreen = useCallback((which: keyof Brief["screens"]) => {
    edit((brief) => ({ ...brief, screens: { ...brief.screens, [which]: !brief.screens[which] } }));
  }, [edit]);

  const clear = useCallback(() => {
    setState(null);
    setError(null);
  }, []);

  /**
   * The confirm step: placeholder tags from the rows as they stand, recorded
   * as assumed, with the brief kept beside them so validation can check them.
   * Returns how many tags, or null when the brief is not confirmable.
   *
   * One path for both ways in, which is the point: a brief the engineer typed
   * out and a brief the model drafted are confirmed by the same call, so the
   * only difference that survives into the project is the `by` on the record.
   * A brief that was asked about and then filled in by hand is "form" too -
   * the questions produced nothing, the engineer did.
   */
  const accept = useCallback((): number | null => {
    const current = state?.brief;
    if (!current || !canConfirm(current)) return null;
    const by = state.by === "clarify" ? "form" : state.by;
    const { variables, tagImport } = placeholderImport(current, by);
    importTags(variables, tagImport);
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
    /** A question is on screen, so the next thing typed is an answer to it. */
    asking: (state?.questions?.length ?? 0) > 0,
    problems,
    ready: state !== null && problems.length === 0,
    busy,
    error,
    draft,
    answer,
    begin,
    edit,
    setCount,
    toggleSignal,
    removeUnit,
    addUnit,
    setPlant,
    setNamingStart,
    toggleAlarm,
    toggleScreen,
    clear,
    accept,
  };
}
