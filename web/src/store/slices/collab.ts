/**
 * Versions, the chat thread and the pipeline's run log.
 *
 * These are the project's history rather than its content: what was built,
 * what was said, and what a run reported while it happened.
 */


import { current } from "immer";
import type { PipelineStep, StepState } from "@/types/events";
import type { ProjectState, SliceOf } from "../state";
import {
  ensureHandles,
  remember,
} from "../internals";

export type CollabSlice = Pick<
  ProjectState,
  | "snapshot"
  | "restore"
  | "setStep"
  | "attribute"
  | "setGenerating"
  | "log"
  | "addMessage"
  | "patchMessage"
  | "clearChat"
  | "resetRun"
>;

export const createCollabSlice: SliceOf<CollabSlice> = (set, get) => ({
    snapshot: (description) => {
      const at = Date.now();
      set((s) => {
        // current() before copying, because `s` is an immer draft and a draft
        // is a Proxy - structuredClone throws "could not be cloned" on one, and
        // it throws from inside whatever applied the event, which is a long way
        // from where it reads. current() returns a detached plain snapshot, so
        // the version cannot follow later edits either.
        s.versions.unshift({
          at,
          description,
          author: "You",
          screens: current(s.screens),
          variables: current(s.variables),
          alarms: current(s.alarms),
          bindings: current(s.bindings),
        });
        if (s.versions.length > 20) s.versions.length = 20;
      });
      return at;
    },

    restore: (at) =>
      set((s) => {
        const version = s.versions.find((v) => v.at === at);
        if (!version) return;
        remember(s, "Restore version");
        // Same reason: `version` is read out of the draft, so its arrays are
        // drafts too. current() detaches them before they become live state.
        s.screens = current(version.screens);
        s.variables = current(version.variables);
        s.alarms = current(version.alarms);
        s.bindings = current(version.bindings);
        s.activeScreenId = s.screens[0]?.UniqueId;
        s.selectedIds = [];
        s.findings = [];
        ensureHandles(s);
      }),

    setStep: (step, state, detail) =>
      set((s) => {
        s.steps[step] = state;
        if (detail !== undefined) s.stepDetail[step] = detail;
      }),

    attribute: (step, id) =>
      set((s) => {
        (s.produced[step] ??= []).push(id);
      }),

    setGenerating: (on) =>
      set((s) => {
        s.generating = on;
      }),

    log: (message) =>
      set((s) => {
        s.logs.push({
          at: new Date().toLocaleTimeString("en-GB", { hour12: false }),
          message,
        });
      }),

    /* --- the conversation --------------------------------------------- */

    addMessage: (message) =>
      set((s) => {
        s.chat.push(message);
      }),

    patchMessage: (id, patch) =>
      set((s) => {
        const message = s.chat.find((m) => m.id === id);
        if (message) Object.assign(message, patch);
      }),

    clearChat: () =>
      set((s) => {
        s.chat = [];
      }),

    /**
     * A new build replaces the generated project but keeps the tags, the
     * conversation and the versions - those are the engineer's, not the run's.
     */

    /**
     * A new build replaces the generated project but keeps the tags, the
     * conversation and the versions - those are the engineer's, not the run's.
     */
    resetRun: () =>
      set((s) => {
        s.screens = [];
        s.activeScreenId = undefined;
        s.alarms = [];
        s.bindings = [];
        s.equipment = [];
        s.findings = [];
        s.objectMeta = {};
        s.programs = {};
        s.screenPlacement = {};
        s.selectedIds = [];
        s.hoveredId = undefined;
        s.steps = {} as Record<PipelineStep, StepState>;
        s.stepDetail = {};
        s.produced = {};
        s.logs = [];
        s.past = [];
        s.future = [];
      }),
});
