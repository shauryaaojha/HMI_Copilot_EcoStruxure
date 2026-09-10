"use client";

/**
 * The left pane: describe what you need, import tags, pick standards.
 * Reference screens 1, 3, 5, 6. Phases 3 and 4 of docs/BUILD_PLAN.md.
 *
 * Phase 0 built the structure out of the primitives; the tag table, the file
 * parse and the SSE run belong to Phases 3 and 4.
 */

import { useState } from "react";
import { FileSpreadsheet, ShieldCheck, Sparkles, Upload } from "lucide-react";
import { Button, Panel, Textarea } from "@/components/ui";

const MAX_INTENT = 500;

/** Reference screen 5 shows these six, two to a row. */
const QUICK = [
  "Pump station",
  "Motor control",
  "Add alarms",
  "Create trend",
  "Use template",
  "Follow standards",
];

export function IntentPanel() {
  const [intent, setIntent] = useState("");

  return (
    <aside className="flex h-full w-full flex-col overflow-y-auto">
      <Panel title="1. Describe what you need" collapsible>
        <div className="space-y-3">
          <Textarea
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            maxLength={MAX_INTENT}
            showCount
            rows={5}
            aria-label="Describe what you need"
            placeholder="Create a pump station screen with 2 pumps. Show running status, start/stop buttons, flow, pressure, temperature and a high-level alarm. Use our company style."
            className="pb-7"
          />

          <div>
            <p className="mb-1.5 text-xs font-medium text-text-muted">Quick prompts</p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setIntent(q)}
                  className="focus-ring rounded-full border border-line px-2.5 py-1 text-xs text-text-secondary transition hover:border-brand-500 hover:text-brand-400"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          <Button
            variant="primary"
            size="lg"
            block
            disabled={intent.trim().length === 0}
            icon={<Sparkles size={16} />}
          >
            Generate Screen
          </Button>
        </div>
      </Panel>

      <Panel title="2. Import PLC tags" collapsible>
        <label className="focus-ring flex cursor-pointer flex-col items-center gap-1.5 rounded-md border border-dashed border-line p-5 text-center text-xs text-text-muted transition hover:border-brand-500 hover:text-text-secondary">
          <input type="file" accept=".csv,.txt,.xlsx" className="sr-only" />
          <Upload size={18} aria-hidden />
          Drag and drop your tag export
          <span className="text-text-faint">.csv · .txt · .xlsx</span>
        </label>
      </Panel>

      <Panel title="3. Engineering standards" collapsible>
        <button
          type="button"
          className="focus-ring flex w-full items-center gap-3 rounded-md border border-line p-3 text-left transition hover:border-line-strong"
        >
          <ShieldCheck size={18} aria-hidden className="shrink-0 text-status-info" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">
              Schneider Standard
            </span>
            <span className="block truncate text-xs text-text-muted">
              Colours, fonts, layout, naming
            </span>
          </span>
        </button>
      </Panel>

      <Panel title="4. Recent requests" collapsible defaultOpen={false}>
        <p className="flex items-center gap-2 text-xs text-text-faint">
          <FileSpreadsheet size={14} aria-hidden />
          Nothing generated yet in this project.
        </p>
      </Panel>
    </aside>
  );
}
