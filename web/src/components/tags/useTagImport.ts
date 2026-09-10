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

  const reset = useCallback(() => setState({ status: "idle" }), []);

  return { state, upload, reset };
}
