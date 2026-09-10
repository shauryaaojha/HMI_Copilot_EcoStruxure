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

/**
 * A committed plant export, so the demo never depends on finding a file in an
 * OS file dialog on stage. 1,248 tags across pumps, instruments, valves and
 * motors, including five names the corrector has to report - which is the beat
 * that shows corrections are reported and not applied silently.
 *
 * Phase 10 of docs/BUILD_PLAN.md.
 */
export const SAMPLE_EXPORT = {
  path: "/demo/Plant_Tags.csv",
  name: "Plant_Tags.csv",
  tags: 1248,
};

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

  /** Fetches the committed sample export and puts it through the same path. */
  const useSample = useCallback(async () => {
    setState({ status: "parsing", fileName: SAMPLE_EXPORT.name });
    try {
      const response = await fetch(SAMPLE_EXPORT.path);
      if (!response.ok) throw new Error(`sample export not found (${response.status})`);
      const file = new File([await response.blob()], SAMPLE_EXPORT.name, {
        type: "text/csv",
      });
      return await upload(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : "could not load the sample";
      setState({ status: "failed", fileName: SAMPLE_EXPORT.name, message });
      return null;
    }
  }, [upload]);

  const reset = useCallback(() => setState({ status: "idle" }), []);

  return { state, upload, useSample, reset };
}
