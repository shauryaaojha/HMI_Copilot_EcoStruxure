import Link from "next/link";

/** Landing page - reference screen 1. Phase 9 of docs/BUILD_PLAN.md. */
export default function Landing() {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-8 px-8 text-center">
      <div className="space-y-4">
        <p className="text-sm font-semibold tracking-widest text-brand-400">
          ECOSTRUXURE OPERATOR TERMINAL EXPERT 4.4
        </p>
        <h1 className="text-6xl font-semibold">HMI Copilot</h1>
        <p className="max-w-2xl text-xl text-ink-300">
          Turn engineering intent into industrial HMI screens. A tag export and one
          sentence of plain English become a complete, validated project.
        </p>
      </div>

      <Link
        href="/project/demo"
        className="rounded-md bg-brand-500 px-6 py-3 font-semibold text-white transition hover:bg-brand-600"
      >
        Open the workspace
      </Link>

      <dl className="mt-8 grid grid-cols-2 gap-x-12 gap-y-4 text-sm md:grid-cols-4">
        {[
          ["Reduce engineering time", "minutes, not days"],
          ["Automate tag integration", "every binding generated"],
          ["Ensure consistency", "standards enforced"],
          ["Catch errors early", "at the desk, not on site"],
        ].map(([title, note]) => (
          <div key={title}>
            <dt className="font-semibold text-ink-100">{title}</dt>
            <dd className="text-ink-500">{note}</dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
