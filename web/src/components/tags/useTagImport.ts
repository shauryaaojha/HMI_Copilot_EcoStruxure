"use client";

/**
 * Uploading a PLC tag export and getting variables back.
 *
 * POSTs to /api/tags/parse, which is real and running - SheetJS over .csv,
 * .txt and .xlsx, with corrections *reported* rather than applied silently.
 * This hook keeps that promise on the way through: corrections and skipped
 * rows land in the store next to the variables so the UI can show what the
 * import changed.
 *
 * Phase 3 of docs/BUILD_PLAN.md.
 */

import { useCallback, useState } from "react";
import type { Variable } from "@/lib/ote/schema";
import { useProject, type TagImport } from "@/store/project";

export const ACCEPTED = ".csv,.txt,.xlsx,.xls";

export interface Sample {
  path: string;
  name: string;
  /** What the plant is, for the picker. */
  label: string;
  tags: number;
  /** What this file exercises that the others do not. */
  note: string;
  /**
   * A sentence that generates a sensible screen from *these* tags.
   *
   * The Copilot's own openers are deliberately generic - a new project should
   * not suggest equipment it has no tags for. Once a known sample is loaded
   * that objection goes away, so this is offered as a starting point instead.
   * Every one names only equipment the file actually contains, and
   * tests/samples.test.ts checks that it still does.
   */
  intent: string;
  /**
   * The same tags asked for a whole application rather than one screen.
   *
   * lib/ai/plan.ts already plans a screen hierarchy - overview first, then
   * areas, capped at six units a screen because that is what ISA-101 warns
   * against - but only when the request asks for one. Absent where a single
   * screen is the honest answer: a two-motor retrofit panel does not need a
   * hierarchy, and generating one would be padding.
   */
  intentFull?: string;
  /** Follow-ups that show the conversation is not one shot. */
  followUps: string[];
}

/**
 * Committed plant exports, so a demo never depends on finding a file in an OS
 * file dialog on stage - and so the importer is exercised against more than one
 * shape of file.
 *
 * They are not variations on a theme. Between them they cover every path
 * lib/tags/parse.ts has: a spreadsheet, a tab-separated file with no header at
 * all, a semicolon-delimited export of the kind Excel writes on a European
 * locale, "Symbol" column naming rather than "Name", and one file that is
 * awkward on purpose. Each figure below is what the live route actually
 * returns - tests/samples.test.ts holds them to it.
 *
 * Phase 10 of docs/BUILD_PLAN.md, and the first stone of the golden corpus
 * docs/PRODUCTION.md argues for.
 */
export const SAMPLES: Sample[] = [
  {
    path: "/demo/Transfer_Pumps.csv",
    name: "Transfer_Pumps.csv",
    label: "Transfer pump station",
    tags: 20,
    note: "20 tags · the shortest run",
    intent:
      "Create a transfer pump station screen. Show which pump is running, flag " +
      "any fault, display the discharge flow and the break tank level, and warn " +
      "before the tank overfills.",
    // No application prompt, for the same reason the retrofit has none: two
    // duty pumps and a standby are one screen. A hierarchy over them would be
    // padding, and tests/samples.test.ts asserts it stays absent.
    followUps: [
      "make the fault lamps red when they are off as well",
      "move the flow reading above the level reading",
      "add a high alarm on the break tank at 85 percent",
    ],
  },
  {
    path: "/demo/Plant_Tags.csv",
    name: "Plant_Tags.csv",
    label: "Water treatment plant",
    tags: 1248,
    note: "1,248 tags · 5 names corrected",
    intent:
      "Create a pump station screen with 2 pumps. Show running status, flow, " +
      "pressure, temperature and a high-level alarm.",
    intentFull:
      "Create a screen for each plant area \u2014 intake, transfer, filtration, " +
      "chemical dosing, distribution and backwash \u2014 with an overview screen " +
      "above them.",
    followUps: [
      "make the pump 2 fault lamp red",
      "add a high alarm on the tank level",
      "add a second screen for the filtration area",
    ],
  },
  {
    path: "/demo/Bottling_Line.xlsx",
    name: "Bottling_Line.xlsx",
    label: "Bottling line",
    tags: 82,
    note: "Excel workbook",
    intent:
      "Create a bottling line overview showing the fillers, cappers and " +
      "labellers with running status and fault lamps, plus the line rate and " +
      "efficiency.",
    intentFull:
      "Build the full application: a line overview, then a screen each for the " +
      "fillers, the cappers, the labellers and the CIP skid.",
    followUps: [
      "add the reject count beside each capper",
      "add a high alarm on the capper torque",
      "add a screen for the CIP skid",
    ],
  },
  {
    path: "/demo/Conveyor_System.csv",
    name: "Conveyor_System.csv",
    label: "Conveyor system",
    tags: 125,
    note: "semicolon delimited",
    intent:
      "Create a conveyor overview showing running status and jam detection for " +
      "the conveyors, with the checkweigher weight and the line throughput.",
    intentFull:
      "Build the full application: a line overview, a screen for the conveyors " +
      "and a screen for the diverters and checkweigher.",
    followUps: [
      "make the jam lamps red",
      "add an alarm for any conveyor jam",
      "add a screen for the diverters",
    ],
  },
  {
    path: "/demo/Batch_Reactors.txt",
    name: "Batch_Reactors.txt",
    label: "Batch reactors",
    tags: 86,
    note: "Symbol column naming",
    intent:
      "Create a reactor screen for the four reactors showing temperature, " +
      "pressure, level and agitator status, with high temperature and high " +
      "pressure alarms.",
    intentFull:
      "Build the full application: a plant overview, a screen per reactor, and " +
      "a screen for the dosing pumps.",
    followUps: [
      "add the batch identifier and recipe step for each reactor",
      "add the dosing pump setpoints and actuals",
      "move the agitator lamps below the readings",
    ],
  },
  {
    path: "/demo/Boiler_House.txt",
    name: "Boiler_House.txt",
    label: "Boiler house",
    tags: 49,
    note: "no header row",
    intent:
      "Create a boiler house screen for the three boilers showing firing " +
      "status, flame proven, drum pressure and drum level, plus the steam " +
      "header pressure and flow.",
    intentFull:
      "Build the full application: a boiler house overview, a screen per boiler, " +
      "and a screen for the feedwater and deaerator.",
    followUps: [
      "add low water alarms for each boiler",
      "add the two feedwater pumps",
      "move the steam header readings to the top",
    ],
  },
  {
    path: "/demo/Legacy_Retrofit.csv",
    name: "Legacy_Retrofit.csv",
    label: "Legacy panel retrofit",
    tags: 66,
    note: "6 corrections · 4 rows skipped",
    intent:
      "Create a motor control screen for the two motors showing running status " +
      "and faults, with the line speed and the second stage pressure.",
    followUps: [
      "make the motor 2 fault lamp red",
      "add a fault alarm for each motor",
    ],
  },
];

/** The one the demo script reaches for. */
export const SAMPLE_EXPORT = SAMPLES[0];

interface ParseResponse {
  variables: Variable[];
  corrections: TagImport["corrections"];
  skipped: TagImport["skipped"];
  summary: TagImport["summary"];
  error?: string;
}

export type ImportState =
  | { status: "idle" }
  | { status: "parsing"; fileName: string }
  | { status: "done"; fileName: string; count: number }
  | { status: "failed"; fileName: string; message: string };

export function useTagImport() {
  const [state, setState] = useState<ImportState>({ status: "idle" });
  const importTags = useProject((s) => s.importTags);
  const snapshot = useProject((s) => s.snapshot);
  const log = useProject((s) => s.log);

  const upload = useCallback(
    async (file: File) => {
      setState({ status: "parsing", fileName: file.name });

      const body = new FormData();
      body.append("file", file);

      try {
        const response = await fetch("/api/tags/parse", { method: "POST", body });
        const data = (await response.json()) as ParseResponse;

        if (!response.ok) {
          const message = data.error ?? `parse failed (${response.status})`;
          setState({ status: "failed", fileName: file.name, message });
          log(`Import failed: ${message}`);
          return null;
        }

        importTags(data.variables, {
          fileName: file.name,
          at: Date.now(),
          corrections: data.corrections ?? [],
          skipped: data.skipped ?? [],
          summary: data.summary ?? { total: data.variables.length },
        });

        setState({ status: "done", fileName: file.name, count: data.variables.length });
        snapshot(`Imported ${data.variables.length} tags from ${file.name}`);
        log(
          `Parsed ${data.variables.length} tags from ${file.name}` +
            (data.corrections?.length
              ? ` — ${data.corrections.length} names corrected`
              : ""),
        );
        return data;
      } catch (error) {
        const message = error instanceof Error ? error.message : "upload failed";
        setState({ status: "failed", fileName: file.name, message });
        log(`Import failed: ${message}`);
        return null;
      }
    },
    [importTags, log, snapshot],
  );

  /**
   * Fetches a committed sample and puts it through the same path a dropped
   * file takes - same route, same corrections, same reporting. Anything else
   * would make the samples a demo mode rather than a test of the importer.
   */
  const useSample = useCallback(
    async (sample: Sample = SAMPLE_EXPORT) => {
      setState({ status: "parsing", fileName: sample.name });
      try {
        const response = await fetch(sample.path);
        if (!response.ok) throw new Error(`sample not found (${response.status})`);
        return await upload(new File([await response.blob()], sample.name));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "could not load the sample";
        setState({ status: "failed", fileName: sample.name, message });
        return null;
      }
    },
    [upload],
  );

  const reset = useCallback(() => setState({ status: "idle" }), []);

  return { state, upload, useSample, reset };
}
