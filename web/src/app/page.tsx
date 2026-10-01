import {
  CircleCheck,
  FileInput,
  Link2,
  Ruler,
  ScanEye,
  ShieldCheck,
} from "lucide-react";
import { SchneiderMark } from "@/components/shell/SchneiderMark";
import { StartButtons } from "@/components/landing/StartButtons";

/**
 * Landing page.
 *
 * Every claim below is something the product does and a test holds, because a
 * landing page for an engineering tool is read by engineers who will check.
 * The round trip is tests/reader.test.ts, the standard is lib/standard/lint.ts,
 * the review is lib/critic/, the bindings are the binding map, the validation
 * is lib/validation/rules.ts.
 *
 * It used to open the workspace on a built-in demo project. That is gone - the
 * first screen an engineer saw was somebody else's plant, which demonstrated
 * the tool rather than helping with theirs.
 */

const CLAIMS = [
  {
    icon: FileInput,
    title: "Open what you already have",
    note: "An existing .eote opens, edits and exports back with every entry byte-identical. Objects the editor does not model are carried through untouched, not dropped.",
  },
  {
    icon: Link2,
    title: "Tags become equipment",
    note: "Pumps, tanks and valves are inferred from ISA-5.1 tag names before any model runs, and every binding is shown tag by tag.",
  },
  {
    icon: Ruler,
    title: "A standard, not a style",
    note: "ISA-101 as data: grey ground, colour reserved for abnormal states, a font floor for the viewing distance. The generator and the lint read the same document.",
  },
  {
    icon: ScanEye,
    title: "The tool reviews its own screens",
    note: "Every screen is checked for overlapping objects, invisible symbols, unreadable text and orphaned labels — on every build, with no model and no network.",
  },
  {
    icon: CircleCheck,
    title: "Mistakes found at the desk",
    note: "Type mismatches, unbound objects, reserved words and unreachable screens are reported before the panel is ever mounted.",
  },
  {
    icon: ShieldCheck,
    title: "Nothing happens without you",
    note: "Every change the conversation proposes is drawn as a ghost first, lands in the same undo history as a mouse edit, and nothing is exported until you say so.",
  },
];

export default function Landing() {
  return (
    <div className="h-full overflow-y-auto">
      <header className="flex items-center gap-4 px-8 py-5">
        <SchneiderMark className="text-text-primary" />
        <span aria-hidden className="h-6 w-px bg-line" />
        <span className="text-lg font-semibold tracking-tight">HMI Copilot</span>
        <StartButtons compact />
      </header>

      <main className="mx-auto max-w-5xl px-8 pb-16 pt-10">
        <p className="text-xs font-semibold tracking-[0.2em] text-brand-400">
          ECOSTRUXURE OPERATOR TERMINAL EXPERT 4.4
        </p>
        <h1 className="mt-4 max-w-3xl text-5xl font-semibold leading-tight">
          Turn engineering intent into industrial HMI screens.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-text-secondary">
          Bring a PLC tag export and say what the plant does, or open a project you
          already have. You get screens drawn to ISA-101, tags declared, alarms
          configured and bindings wired — reviewed before you export, and written
          into a file the product opens.
        </p>

        <StartButtons />

        <dl className="mt-14 grid gap-x-10 gap-y-8 sm:grid-cols-2">
          {CLAIMS.map(({ icon: Icon, title, note }) => (
            <div key={title} className="flex gap-3">
              <Icon size={18} aria-hidden className="mt-0.5 shrink-0 text-brand-400" />
              <div>
                <dt className="font-semibold">{title}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-text-muted">{note}</dd>
              </div>
            </div>
          ))}
        </dl>

        <div className="mt-14 border-t border-line-subtle pt-6">
          <p className="text-sm leading-relaxed text-text-muted">
            The generated project opens in EcoStruxure Operator Terminal Expert 4.4 —
            screens, variables, alarms and the alarm summary grid. It runs without a
            model key, where the inference, the layout, the standard and the review
            are all deterministic.
          </p>
        </div>
      </main>
    </div>
  );
}
