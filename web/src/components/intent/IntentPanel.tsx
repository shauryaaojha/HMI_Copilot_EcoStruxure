"use client";

/**
 * The left pane: describe what you need, import tags, pick standards.
 * Reference screens 1, 3, 5, 6. Phases 3 and 4 of docs/BUILD_PLAN.md.
 */

import { useState } from "react";

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
    <aside className="flex w-[22rem] shrink-0 flex-col gap-5 overflow-y-auto bg-chrome-900 p-4">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">1. Describe what you need</h2>
        <textarea
          value={intent}
          onChange={(e) => setIntent(e.target.value.slice(0, 500))}
          rows={5}
          placeholder="Create a pump station screen with 2 pumps. Show running status, start/stop buttons, flow, pressure, temperature and a high-level alarm. Use our company style."
          className="w-full resize-none rounded-md border border-chrome-700 bg-chrome-850 p-3 text-sm placeholder:text-ink-700 focus:border-brand-500 focus:outline-none"
        />
        <div className="flex flex-wrap gap-1.5">
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setIntent(q)}
              className="rounded-full border border-chrome-700 px-2.5 py-1 text-xs text-ink-300 transition hover:border-brand-500 hover:text-brand-400"
            >
              {q}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={intent.trim().length === 0}
          className="w-full rounded-md bg-brand-500 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Generate Screen
        </button>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">2. Import PLC tags</h2>
        <label className="flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed border-chrome-700 p-5 text-center text-xs text-ink-500 transition hover:border-brand-500">
          <input type="file" accept=".csv,.txt,.xlsx" className="hidden" />
          Drag and drop your tag export
          <span className="text-ink-700">.csv · .txt · .xlsx</span>
        </label>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">3. Engineering standards</h2>
        <button
          type="button"
          className="w-full rounded-md border border-chrome-700 p-3 text-left text-sm transition hover:border-chrome-600"
        >
          Schneider Standard
          <span className="block text-xs text-ink-500">
            Colours, fonts, layout, naming
          </span>
        </button>
      </section>
    </aside>
  );
}
