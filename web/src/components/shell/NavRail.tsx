"use client";

/** The left icon rail. Reference screens 1-6. */
import Link from "next/link";

const ITEMS = [
  ["Workspace", ""],
  ["Project", "project"],
  ["Templates", "templates"],
  ["Library", "library"],
  ["Tags", "tags"],
  ["Validation", "validation"],
  ["Export", "export"],
  ["History", "history"],
] as const;

export function NavRail({ projectId, active }: { projectId: string; active?: string }) {
  return (
    <nav className="flex w-20 shrink-0 flex-col items-center gap-1 border-r border-chrome-800 bg-chrome-950 py-3">
      {ITEMS.map(([label, slug]) => {
        const href = slug ? `/project/${projectId}/${slug}` : `/project/${projectId}`;
        const on = (active ?? "") === slug;
        return (
          <Link
            key={label}
            href={href}
            className={`flex w-16 flex-col items-center gap-1 rounded-md px-1 py-2 text-[10px] transition ${
              on
                ? "bg-brand-500/15 text-brand-400"
                : "text-ink-500 hover:bg-chrome-850 hover:text-ink-300"
            }`}
          >
            <span
              aria-hidden
              className={`h-5 w-5 rounded-sm border ${
                on ? "border-brand-400" : "border-current"
              }`}
            />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
