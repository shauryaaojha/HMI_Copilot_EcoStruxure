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
    path: "/demo/Plant_Tags.csv",
    name: "Plant_Tags.csv",
    label: "Water treatment plant",
    tags: 1248,
    note: "1,248 tags · 5 names corrected",
  },
  {
    path: "/demo/Bottling_Line.xlsx",
    name: "Bottling_Line.xlsx",
    label: "Bottling line",
    tags: 82,
    note: "Excel workbook",
  },
  {
    path: "/demo/Conveyor_System.csv",
    name: "Conveyor_System.csv",
    label: "Conveyor system",
    tags: 125,
    note: "semicolon delimited",
  },
  {
    path: "/demo/Batch_Reactors.txt",
    name: "Batch_Reactors.txt",
    label: "Batch reactors",
    tags: 86,
    note: "Symbol column naming",
  },
  {
    path: "/demo/Boiler_House.txt",
    name: "Boiler_House.txt",
    label: "Boiler house",
    tags: 49,
    note: "no header row",
  },
  {
    path: "/demo/Legacy_Retrofit.csv",
    name: "Legacy_Retrofit.csv",
    label: "Legacy panel retrofit",
    tags: 66,
    note: "6 corrections · 4 rows skipped",
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
