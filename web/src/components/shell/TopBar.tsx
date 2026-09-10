"use client";

/** Product identity, project name, target panel and Export. Reference screens 1-6. */
export function TopBar({
  projectName,
  target,
  savedAt,
}: {
  projectName: string;
  target: string;
  savedAt?: string;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-chrome-800 bg-chrome-950 px-4">
      <div className="flex items-baseline gap-3">
        <span className="text-lg font-semibold">HMI Copilot</span>
        <span className="hidden text-sm text-ink-500 lg:inline">
          From intent to HMI — faster, smarter, safer.
        </span>
      </div>

      <div className="ml-6 flex items-center gap-3">
        <span className="rounded-md bg-chrome-850 px-3 py-1.5 text-sm">{projectName}</span>
        {savedAt && (
          <span className="flex items-center gap-1.5 text-xs text-ink-500">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
            Saved {savedAt}
          </span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-3">
        <span className="rounded-md border border-chrome-700 px-3 py-1.5 text-sm text-ink-300">
          {target}
        </span>
        <button
          type="button"
          className="rounded-md bg-brand-500 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-600"
        >
          Export
        </button>
      </div>
    </header>
  );
}
