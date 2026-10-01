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
import { ScreenBuild } from "@/components/landing/ScreenBuild";
import { Flow, Routes } from "@/components/landing/Sections";
import { CursorLight } from "@/components/landing/CursorLight";

/**
 * Landing page.
 *
 * Every claim is something the product does and a test holds, because a
 * landing page for an engineering tool is read by engineers who will check.
 *
 * The hero is the product's own output assembling itself rather than an
 * illustration of it - the page's claim is "watch every object being
 * generated", and the first thing a visitor sees is that happening. All of the
 * motion is CSS and stops under `prefers-reduced-motion`; a tool that runs on a
 * panel in a plant should not ship a WebGL runtime to its front door.
 */

const CLAIMS = [
  {
    icon: FileInput,
    title: "Open what you already have",
    note: "An existing .eote opens, edits and exports back with every entry byte-identical.",
  },
  {
    icon: Link2,
    title: "Tags become equipment",
    note: "Pumps, tanks and valves inferred from ISA-5.1 names before any model runs.",
  },
  {
    icon: Ruler,
    title: "A standard, not a style",
    note: "ISA-101 as data. The generator and the lint read the same document.",
  },
  {
    icon: ScanEye,
    title: "It reviews its own screens",
    note: "Overlaps, faint symbols, unreadable text — caught on every build, keyless.",
  },
  {
    icon: CircleCheck,
    title: "Mistakes found at the desk",
    note: "Type mismatches and unreachable screens, before a panel is ever mounted.",
  },
  {
    icon: ShieldCheck,
    title: "Nothing happens without you",
    note: "Every proposal is a ghost first, and every change can be undone.",
  },
];

export default function Landing() {
  return (
    <div className="relative h-full overflow-y-auto">
      {/* the engineering grid the product lays everything out on */}
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-grid mask-fade opacity-[0.35]" />
      <div aria-hidden className="copilot-aurora pointer-events-none fixed inset-0 overflow-hidden" />
      <CursorLight />

      <div className="relative">
        <header className="mx-auto flex max-w-6xl items-center gap-4 px-8 py-5">
          <SchneiderMark className="text-text-primary" />
          <span aria-hidden className="h-6 w-px bg-line" />
          <span className="text-lg font-semibold tracking-tight">HMI Copilot</span>
          <StartButtons compact />
        </header>

        <main>
          {/* --- hero ---------------------------------------------------- */}
          <section className="mx-auto grid max-w-6xl items-center gap-12 px-8 pb-10 pt-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <div className="reveal is-in min-w-0">
              <p className="text-xs font-semibold tracking-[0.2em] text-brand-400">
                ECOSTRUXURE OPERATOR TERMINAL EXPERT 4.4
              </p>
              <h1 className="word-in mt-4 text-[clamp(2.25rem,5vw,3.5rem)] font-semibold leading-[1.05] tracking-tight">
                {"Turn engineering intent into industrial HMI screens.".split(" ").map((w, i) => (
                  <span key={i} style={{ ["--i" as string]: i }} className="mr-[0.22em]">
                    {w}
                  </span>
                ))}
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-text-secondary">
                Bring a PLC tag export and say what the plant does, or open a project
                you already have. Screens drawn to ISA-101, tags declared, alarms
                configured, bindings wired — reviewed before you export, and written
                into a file the product opens.
              </p>

              <StartButtons />

              <p className="mt-6 font-mono text-[11px] text-text-faint">
                Runs with no model key · 699 tests · nothing exported until you say so
              </p>
            </div>

            {/* the product's own output, building itself */}
            <div className="reveal is-in min-w-0" style={{ ["--reveal-delay" as string]: "180ms" }}>
              <figure className="overflow-hidden rounded-xl border border-line-subtle bg-surface-raised shadow-2xl shadow-black/30">
                <div className="flex items-center gap-1.5 border-b border-line-subtle px-3 py-2">
                  <span className="h-2 w-2 rounded-full bg-text-faint/40" />
                  <span className="h-2 w-2 rounded-full bg-text-faint/40" />
                  <span className="h-2 w-2 rounded-full bg-text-faint/40" />
                  <span className="ml-2 font-mono text-[10px] text-text-faint">
                    Transfer_Pump_Station.eote
                  </span>
                </div>
                <ScreenBuild />
              </figure>
              <figcaption className="pt-2.5 text-center text-[11px] text-text-faint">
                A generated L2 process screen, drawn from twenty tags.
              </figcaption>
            </div>
          </section>

          {/* --- claims -------------------------------------------------- */}
          <section className="mx-auto max-w-6xl px-8 py-16">
            <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              {CLAIMS.map(({ icon: Icon, title, note }) => (
                <div key={title} className="flex gap-3">
                  <Icon size={17} aria-hidden className="mt-0.5 shrink-0 text-brand-400" />
                  <div>
                    <dt className="font-semibold">{title}</dt>
                    <dd className="mt-1 text-sm leading-relaxed text-text-muted">{note}</dd>
                  </div>
                </div>
              ))}
            </dl>
          </section>

          <Flow />
          <Routes />

          <footer className="mx-auto max-w-5xl border-t border-line-subtle px-8 py-10">
            <p className="text-sm leading-relaxed text-text-muted">
              The generated project opens in EcoStruxure Operator Terminal Expert 4.4 —
              screens, variables, alarms and the alarm summary grid. The inference, the
              layout, the standard and the review are all deterministic, so it runs on a
              machine with the network cable out.
            </p>
          </footer>
        </main>
      </div>
    </div>
  );
}
