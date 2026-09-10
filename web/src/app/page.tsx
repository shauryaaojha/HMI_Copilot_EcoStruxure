import Link from "next/link";
import {
  ArrowRight,
  CircleCheck,
  Clock,
  Link2,
  ShieldCheck,
} from "lucide-react";
import { SchneiderMark } from "@/components/shell/SchneiderMark";

/**
 * Landing page - reference screen 1. Phase 9 of docs/BUILD_PLAN.md.
 *
 * The four claims below are the ones docs/SOLUTION.md makes, and each is
 * something the product actually does rather than a slogan: the timings come
 * from the demo path, the bindings from the binding map, the standards from the
 * rules engine, the errors from design-time validation.
 */

const CLAIMS = [
  {
    icon: Clock,
    title: "Reduce engineering time",
    note: "A tag export and one sentence become a screen in minutes, not days.",
  },
  {
    icon: Link2,
    title: "Automate tag integration",
    note: "Every binding generated and shown, tag by tag, in the binding map.",
  },
  {
    icon: ShieldCheck,
    title: "Ensure consistency",
    note: "Company standards applied by construction — colours, naming, layout.",
  },
  {
    icon: CircleCheck,
    title: "Catch errors early",
    note: "Type mismatches and unbound objects found at the desk, not on site.",
  },
];

export default function Landing() {
  return (
    <div className="h-full overflow-y-auto">
      <header className="flex items-center gap-4 px-8 py-5">
        <SchneiderMark className="text-text-primary" />
        <span aria-hidden className="h-6 w-px bg-line" />
        <span className="text-lg font-semibold tracking-tight">HMI Copilot</span>
        <Link
          href="/project/demo"
          className="focus-ring ml-auto inline-flex h-9 items-center gap-2 rounded-md bg-brand-500 px-4 text-sm font-medium text-text-onbrand transition hover:bg-brand-600"
        >
          Get started
          <ArrowRight size={15} aria-hidden />
        </Link>
      </header>

      <main className="mx-auto max-w-5xl px-8 pb-16 pt-10">
        <p className="text-xs font-semibold tracking-[0.2em] text-brand-400">
          ECOSTRUXURE OPERATOR TERMINAL EXPERT 4.4
        </p>
        <h1 className="mt-4 max-w-3xl text-5xl font-semibold leading-tight">
          Turn engineering intent into industrial HMI screens.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-text-secondary">
          A PLC tag export plus one sentence of plain English becomes a complete,
          validated project — screens drawn, tags declared, alarms configured,
          bindings wired — while you watch every object being generated and approve
          it before export.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/project/demo"
            className="focus-ring inline-flex h-11 items-center gap-2 rounded-md bg-brand-500 px-6 text-sm font-semibold text-text-onbrand transition hover:bg-brand-600"
          >
            Open the workspace
            <ArrowRight size={16} aria-hidden />
          </Link>
          <Link
            href="/project/demo/tags"
            className="focus-ring inline-flex h-11 items-center rounded-md border border-line px-6 text-sm font-medium text-text-secondary transition hover:border-line-strong hover:text-text-primary"
          >
            Import a tag export
          </Link>
        </div>

        <dl className="mt-14 grid gap-x-10 gap-y-8 sm:grid-cols-2">
          {CLAIMS.map(({ icon: Icon, title, note }) => (
            <div key={title} className="flex gap-3">
              <Icon size={18} aria-hidden className="mt-0.5 shrink-0 text-brand-400" />
              <div>
                <dt className="font-semibold">{title}</dt>
                <dd className="mt-1 text-sm text-text-muted">{note}</dd>
              </div>
            </div>
          ))}
        </dl>

        <p className="mt-14 border-t border-line-subtle pt-6 text-sm text-text-muted">
          The generated project opens in EcoStruxure Operator Terminal Expert 4.4 —
          screens, variables, alarms and the alarm summary grid, none of it written
          by Schneider&apos;s software.
        </p>
      </main>
    </div>
  );
}
