/**
 * The project the workspace is editing. One JSON tree, cheap undo/redo.
 *
 * The store holds exactly what the packager needs and nothing else - if a field
 * is not in here, it does not reach the .eote. Phase 3 of docs/BUILD_PLAN.md.
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Alarm, Part, Screen, Variable } from "@/lib/ote/schema";
import type { Equipment, PipelineStep, StepState } from "@/types/events";

export interface Binding {
  tag: string;
  targetId: string;
  targetName: string;
  property: string;
}

export interface Finding {
  severity: "error" | "warning" | "info";
  message: string;
  objectId?: string;
  suggestion?: string;
}

interface ProjectState {
  id: string;
  name: string;
  target: { model: string; width: number; height: number };

  screens: Screen[];
  activeScreenId?: string;
  variables: Variable[];
  alarms: Alarm[];
  bindings: Binding[];
  equipment: Equipment[];
  findings: Finding[];

  selectedObjectId?: string;
  /** Live values by object name; empty means the design state. */
  values: Record<string, number | boolean>;
  simulating: boolean;

  steps: Record<PipelineStep, StepState>;
  logs: { at: string; message: string }[];

  select: (id?: string) => void;
  appendObject: (screenId: string, part: Part) => void;
  updateObject: (id: string, patch: Partial<Part>) => void;
  setStep: (step: PipelineStep, state: StepState) => void;
  log: (message: string) => void;
  reset: () => void;
}

const NO_STEPS = {} as Record<PipelineStep, StepState>;

export const useProject = create<ProjectState>()(
  immer((set) => ({
    id: "",
    name: "Untitled",
    target: { model: "HMIGTO6310", width: 1024, height: 768 },
    screens: [],
    variables: [],
    alarms: [],
    bindings: [],
    equipment: [],
    findings: [],
    values: {},
    simulating: false,
    steps: NO_STEPS,
    logs: [],

    select: (id) =>
      set((s) => {
        s.selectedObjectId = id;
      }),

    appendObject: (screenId, part) =>
      set((s) => {
        const screen = s.screens.find((x) => x.UniqueId === screenId);
        screen?.Children[0].Children.push(part);
      }),

    updateObject: (id, patch) =>
      set((s) => {
        for (const screen of s.screens) {
          const i = screen.Children[0].Children.findIndex((p) => p.UniqueId === id);
          if (i !== -1) {
            Object.assign(screen.Children[0].Children[i], patch);
            return;
          }
        }
      }),

    setStep: (step, state) =>
      set((s) => {
        s.steps[step] = state;
      }),

    log: (message) =>
      set((s) => {
        s.logs.push({
          at: new Date().toLocaleTimeString("en-GB", { hour12: false }),
          message,
        });
      }),

    reset: () =>
      set((s) => {
        s.screens = [];
        s.variables = [];
        s.alarms = [];
        s.bindings = [];
        s.equipment = [];
        s.findings = [];
        s.values = {};
        s.steps = {} as Record<PipelineStep, StepState>;
        s.logs = [];
      }),
  })),
);
