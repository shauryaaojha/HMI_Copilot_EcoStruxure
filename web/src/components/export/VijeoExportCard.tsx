"use client";

/**
 * Hand the project's tags to Vijeo Designer.
 *
 * The engineer picks a variable export from their own Vijeo project (one
 * variable is enough); the tags are written into it (lib/vijeo/exportVariables)
 * in the browser and downloaded, ready for Variables > Import in Vijeo. What
 * did not carry is listed under the button, not left to be found on import.
 */

import { useRef, useState } from "react";
import { AlertTriangle, Check, FileDown } from "lucide-react";
import { Button, Panel } from "@/components/ui";
import { useProject } from "@/store/project";
import { writeVijeoVariables } from "@/lib/vijeo/exportVariables";

export function VijeoExportCard() {
  const variables = useProject((s) => s.variables);
  const name = useProject((s) => s.name);
  const picker = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<{ added: number; notes: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function write(template: File) {
    setError(null);
    setResult(null);
    try {
      const out = writeVijeoVariables(new Uint8Array(await template.arrayBuffer()), variables);
      const url = URL.createObjectURL(new Blob([out.bytes as unknown as BlobPart], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name.replace(/[^A-Za-z0-9_-]+/g, "_") || "project"}_vijeo_variables.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setResult({ added: out.added.length, notes: out.notes });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "could not write the Vijeo export");
    }
  }

  return (
    <Panel title="Variables for Vijeo Designer" bordered>
      <div className="space-y-3 text-xs">
        <p className="text-text-muted">
          Pick a variable export from your Vijeo Designer project (Variables &gt; Export; one variable is enough). The {variables.length} tags are written
          into it in Vijeo&apos;s own row layout, ready for Variables &gt; Import.
        </p>
        <input
          ref={picker}
          type="file"
          accept=".csv,.txt"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void write(f);
          }}
        />
        <Button variant="secondary" block disabled={variables.length === 0} onClick={() => picker.current?.click()} icon={<FileDown size={14} />}>
          Choose the Vijeo export to write into
        </Button>
        {error && (
          <p className="flex gap-2 text-status-warn">
            <AlertTriangle size={12} aria-hidden className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}
        {result && (
          <ul className="space-y-1 text-text-secondary">
            <li className="flex gap-2">
              <Check size={12} aria-hidden className="mt-0.5 shrink-0 text-brand-400" />
              {result.added} variables added and downloaded
            </li>
            {result.notes.map((n) => (
              <li key={n} className="flex gap-2 text-text-muted">
                <AlertTriangle size={12} aria-hidden className="mt-0.5 shrink-0 text-text-faint" />
                {n}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
