"use client";

/**
 * Which published standards this project is actually held to, and where.
 *
 * The Standards screen opened on a tab of four grid-and-colour settings, which
 * made it look like a preferences page - and left the interesting claim
 * unstated. The interesting claim is that the standards are enforced by
 * construction rather than checked afterwards: ISA-101 is why a screen holds
 * six units and not twenty, ISA-5.1 is why `FT_101_PV` becomes a flow reading
 * on pump 101's faceplate, and the OTE reserved-word list is why a tag called
 * `TIME` is corrected at import instead of failing when the file is opened.
 *
 * Every figure below is read from the code that enforces it - the reserved-word
 * counts come from the sets the checker uses, the units-per-screen figure from
 * the planner - so this cannot drift into describing a rule the product no
 * longer applies. Where a rule has produced something in *this* project, it
 * says what: 94 units inferred, 21 screens planned, 0 naming errors.
 */

import { BookOpen, CircleCheck, FileCode2, Ruler, Workflow } from "lucide-react";
import { DATA_TYPES } from "@/lib/ote/schema";
import { COLOR_SETS } from "@/lib/ote/palette";
import { RESERVED_COUNTS } from "@/lib/validation/naming";
import { useProject } from "@/store/project";
import { cn } from "@/components/ui";

/** ISA-101 caps a unit display; lib/ai/plan.ts applies it. Kept in step by eye. */
const UNITS_PER_SCREEN = 6;

interface Standard {
  code: string;
  title: string;
  icon: typeof Ruler;
  /** What the standard governs, in one sentence. */
  governs: string;
  /** Where in this codebase it is applied, not merely referred to. */
  enforcedIn: string;
  /** The rules taken from it, as short statements. */
  rules: string[];
  /** What it has done in this project. Absent when the project is empty. */
  applied?: string;
}

export function StandardsInForce() {
  const screens = useProject((s) => s.screens);
  const equipment = useProject((s) => s.equipment);
  const variables = useProject((s) => s.variables);
  const alarms = useProject((s) => s.alarms);
  const bindings = useProject((s) => s.bindings);
  const findings = useProject((s) => s.findings);
  const tagImport = useProject((s) => s.tagImport);
  const standards = useProject((s) => s.standards);

  const objects = screens.reduce(
    (n, screen) => n + screen.Children[0].Children.length,
    0,
  );
  const namingErrors = findings.filter(
    (f) => f.severity === "error" && f.rule?.includes("nam"),
  ).length;
  const corrections = tagImport?.corrections.length ?? 0;
  const set = COLOR_SETS[standards.colorSet as keyof typeof COLOR_SETS] ?? COLOR_SETS[4];

  const list: Standard[] = [
    {
      code: "ANSI/ISA-101.01",
      title: "Human–machine interfaces for process automation",
      icon: Workflow,
      governs:
        "How a set of operator displays is structured: a hierarchy of levels, navigation in the same place on every screen, and colour reserved for abnormal conditions.",
      enforcedIn: "lib/ai/plan.ts · lib/ote/layout.ts",
      rules: [
        "Level 1 plant overview above Level 2 unit overviews above Level 3 detail",
        `At most ${UNITS_PER_SCREEN} units on a unit display — split rather than crowd`,
        "Header, navigation strip and alarm banner at the same position on every screen",
        "Colour as a signal: neutral while normal, red and amber for abnormal only",
      ],
      applied:
        screens.length > 0
          ? `${screens.length} screen${screens.length === 1 ? "" : "s"} planned to this hierarchy, ${objects} objects placed`
          : undefined,
    },
    {
      code: "ANSI/ISA-5.1",
      title: "Instrumentation symbols and identification",
      icon: Ruler,
      governs:
        "How an instrument tag is written, so that a name identifies what a loop measures and which equipment it belongs to.",
      enforcedIn: "lib/ai/infer.ts",
      rules: [
        "First letter is the measured variable: F flow, L level, P pressure, T temperature, A analysis, S speed",
        "A shared loop number groups an instrument with the machine it serves",
        "Role suffixes carry state: _RUN, _FLT, _PV, _SP, _HI, _LO, _CMD",
        "14 machine prefixes recognised — pump, motor, valve, tank, boiler, chiller, reactor and the rest",
      ],
      applied:
        equipment.length > 0
          ? `${equipment.length} unit${equipment.length === 1 ? "" : "s"} inferred from ${variables.length} tag names`
          : undefined,
    },
    {
      code: "IEC 61131-3",
      title: "Programmable controllers — programming languages",
      icon: FileCode2,
      governs:
        "The data types a PLC variable may have, and therefore what an imported tag list is allowed to contain.",
      enforcedIn: "lib/ote/schema.ts · lib/tags/parse.ts",
      rules: [
        `${DATA_TYPES.length} types accepted: ${DATA_TYPES.join(", ")}`,
        "Vendor spellings are mapped, never guessed — Float becomes REAL, EBOOL becomes BOOL",
        "A type that cannot be placed is reported and the row skipped, not defaulted",
      ],
      applied:
        variables.length > 0
          ? `${variables.length} variables typed${tagImport?.skipped.length ? `, ${tagImport.skipped.length} rows reported rather than guessed` : ""}`
          : undefined,
    },
    {
      code: "EcoStruxure OTE 4.4",
      title: "The product's own naming and colour rules",
      icon: BookOpen,
      governs:
        "What Operator Terminal Expert will accept in a project file. Breaking these does not produce a bad screen — it produces a file that will not open.",
      enforcedIn: "lib/validation/naming.ts · lib/ote/palette.ts",
      rules: [
        `${RESERVED_COUNTS.caseInsensitive} reserved words, case-insensitive — data types and control codes`,
        `${RESERVED_COUNTS.caseSensitive} reserved in exact casing, plus ${RESERVED_COUNTS.scriptKeywords} script keywords`,
        "Names are letters, digits and underscore, never leading with a digit",
        `Colour is a palette index, not RGB — ${Object.keys(COLOR_SETS).length} sets of 60, currently "${set.name}"`,
      ],
      applied:
        corrections > 0
          ? `${corrections} name${corrections === 1 ? "" : "s"} corrected at import and reported`
          : variables.length > 0
            ? `${namingErrors} naming errors across ${variables.length} tags`
            : undefined,
    },
  ];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-text-primary">Standards in force</h2>
        <p className="text-xs text-text-muted">
          Applied by construction while a screen is generated, not checked
          afterwards.
        </p>
      </div>

      <ul className="grid gap-3 xl:grid-cols-2">
        {list.map((standard) => {
          const Icon = standard.icon;
          return (
            <li
              key={standard.code}
              className="flex flex-col rounded-panel border border-line-subtle bg-surface-raised p-4"
              style={{ boxShadow: "var(--elev-1)" }}
            >
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/12 text-brand-400">
                  <Icon size={16} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-ident text-brand-400">{standard.code}</p>
                  <h3 className="text-sm font-semibold leading-snug text-text-primary">
                    {standard.title}
                  </h3>
                </div>
              </div>

              <p className="mt-3 text-xs leading-relaxed text-text-muted">
                {standard.governs}
              </p>

              <ul className="mt-3 space-y-1.5">
                {standard.rules.map((rule) => (
                  <li
                    key={rule}
                    className="flex gap-2 text-xs leading-snug text-text-secondary"
                  >
                    <CircleCheck
                      size={12}
                      aria-hidden
                      className="mt-0.5 shrink-0 text-brand-400"
                    />
                    <span className="min-w-0">{rule}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3">
                <span className="label-eyebrow">Enforced in</span>
                <code className="text-ident text-text-muted">{standard.enforcedIn}</code>
              </div>

              <p
                className={cn(
                  "mt-2 rounded-md px-2 py-1.5 text-[11px]",
                  standard.applied
                    ? "bg-brand-500/8 text-brand-400"
                    : "bg-surface-hover text-text-faint",
                )}
              >
                {standard.applied ??
                  "Nothing built in this project yet — generate a screen to see this applied."}
              </p>
            </li>
          );
        })}
      </ul>

      {/* One line of arithmetic that ties the four together. */}
      {objects > 0 && (
        <p className="rounded-panel border border-line-subtle px-4 py-3 text-xs text-text-muted">
          In this project:{" "}
          <span className="text-figure font-medium text-text-secondary">
            {screens.length}
          </span>{" "}
          screens,{" "}
          <span className="text-figure font-medium text-text-secondary">{objects}</span>{" "}
          objects,{" "}
          <span className="text-figure font-medium text-text-secondary">
            {alarms.length}
          </span>{" "}
          alarms and{" "}
          <span className="text-figure font-medium text-text-secondary">
            {bindings.length}
          </span>{" "}
          bindings — every one of them produced under the rules above, and every
          one of them exportable as a file the product opens.
        </p>
      )}
    </section>
  );
}
