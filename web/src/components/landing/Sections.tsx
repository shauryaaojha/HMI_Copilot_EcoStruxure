"use client";

/**
 * The scroll: what happens between opening the page and opening a project.
 *
 * Every step names the thing in the repository that does it, because an
 * engineering tool is read by engineers who will check, and a claim with a
 * file beside it is a different kind of claim.
 */

import {
  ArrowRight,
  FileUp,
  FolderOpen,
  PenLine,
  ScanEye,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { useNewProject } from "@/components/shell/useNewProject";
import { Glass } from "@/components/motion/Glass";
import { useSpotlights } from "@/components/ui/interactions";
import { useReveal, useRevealGroup } from "./useReveal";

const STEPS = [
  {
    icon: FileUp,
    title: "Bring what you already have",
    body: "A PLC tag export, or a project you built last year. An existing .eote opens, edits and exports back with every entry byte-identical — objects the editor does not model are carried through untouched rather than dropped.",
    evidence: "tests/reader.test.ts",
  },
  {
    icon: Workflow,
    title: "Tags become a plant",
    body: "Pumps, tanks and valves are inferred from ISA-5.1 tag names before any model runs. The plant is laid out in flow order, sources on the left, with a reading beside each machine and at most one question asked of you.",
    evidence: "lib/plant · lib/program",
  },
  {
    icon: PenLine,
    title: "Say what you want changed",
    body: "Every request becomes typed operations against the project — never geometry. They are drawn as ghosts first, land in the same undo history as a mouse edit, and can be refused one at a time.",
    evidence: "lib/ai/ops.ts — 17 operations",
  },
  {
    icon: ScanEye,
    title: "The tool reviews its own work",
    body: "Overlapping objects, symbols too faint to see, text under the contrast floor, labels nearer to a neighbour than to what they name, screens nobody can reach. Checked on every build, with no model and no network.",
    evidence: "lib/critic — found 446 real defects on its first run",
  },
  {
    icon: ShieldCheck,
    title: "Then, and only then, export",
    body: "A project the product opens: screens, variables, alarms, bindings. Nothing leaves until you say so, and the validation report tells you what it would have to fix first.",
    evidence: "lib/ote/packager.ts",
  },
];

export function Flow() {
  const group = useRevealGroup<HTMLOListElement>(90);

  return (
    <section className="relative mx-auto max-w-5xl px-8 py-24">
      <div className="reveal is-in">
        <p className="label-eyebrow">How it goes</p>
        <h2 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight">
          Five steps, and you can stop at any of them.
        </h2>
      </div>

      <ol ref={group} className="relative mt-12 space-y-10">
        {/* the spine */}
        <span aria-hidden className="absolute left-[15px] top-2 bottom-2 w-px bg-line-subtle" />
        {STEPS.map(({ icon: Icon, title, body, evidence }, i) => (
          <li key={title} data-reveal className="relative flex gap-5 pl-0">
            <span className="relative z-10 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line-subtle bg-surface-raised text-brand-400">
              <Icon size={15} aria-hidden />
            </span>
            <div className="min-w-0">
              <h3 className="flex items-baseline gap-2 font-semibold">
                {title}
                <span className="font-mono text-[11px] font-normal text-text-faint">0{i + 1}</span>
              </h3>
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-text-muted">{body}</p>
              <p className="mt-2 inline-block rounded border border-line-subtle bg-surface-raised/60 px-2 py-0.5 font-mono text-[11px] text-text-faint">
                {evidence}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

const ROUTES = [
  {
    icon: Sparkles,
    title: "From nothing",
    body: "Describe the plant. Bring the tags when you have them.",
  },
  {
    icon: FileUp,
    title: "From a tag export",
    body: "CSV, TSV or XLSX. Equipment is inferred from the names, deterministically.",
  },
  {
    icon: FolderOpen,
    title: "From a project you have",
    body: "Open an .eote, change one screen, export it back unchanged everywhere else.",
  },
];

export function Routes() {
  const section = useReveal<HTMLElement>();
  const cards = useSpotlights<HTMLDivElement>();
  const newProject = useNewProject();

  return (
    <section ref={section} className="reveal relative mx-auto max-w-5xl px-8 pb-28">
      <h2 className="text-2xl font-semibold">Three ways in. All of them end in a file the product opens.</h2>
      <p className="mt-2 max-w-2xl text-sm text-text-muted">
        Pick one. The workspace asks the same question and takes the same three answers.
      </p>

      {/* One strip cut into three doors, not three cards. */}
      <Glass orbs className="mt-8 rounded-[1.75rem]">
      <div ref={cards} className="grid overflow-hidden rounded-[1.75rem] sm:grid-cols-3">
        {ROUTES.map(({ icon: Icon, title, body }, i) => (
          <button key={title} type="button" onClick={() => newProject()} className="door spotlight focus-ring group text-left">
            <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-faint">
              <Icon size={13} aria-hidden className="text-brand-400" />
              Route 0{i + 1}
            </span>
            <h3 className="mt-6 text-xl font-semibold tracking-tight">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-text-muted">{body}</p>
            <span className="door-go inline-flex items-center gap-1.5 text-sm font-medium text-brand-400">
              Start here
              <ArrowRight size={14} aria-hidden className="transition-transform group-hover:translate-x-1" />
            </span>
          </button>
        ))}
      </div>
      </Glass>
    </section>
  );
}
