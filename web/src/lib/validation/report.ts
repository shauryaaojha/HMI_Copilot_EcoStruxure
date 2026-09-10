/**
 * The sign-off report.
 *
 * A standalone HTML file a customer's QA process can archive next to the
 * project: what was checked, what was found, and enough of the project's own
 * figures that the report can be read a year later without the project to hand.
 *
 * Self-contained by design - no external stylesheet, no font host, no script.
 * It has to open from a network share on a machine with no internet, which is
 * what a commissioning laptop usually is.
 *
 * Phase 7 of docs/BUILD_PLAN.md.
 */

import type { PackageInput } from "@/lib/ote/packager";
import type { Finding, Severity } from "./rules";
import { summarise } from "./rules";

export interface ReportInput {
  project: PackageInput;
  findings: Finding[];
  /** The panel Target.dat declares, when the caller knows it. */
  panel?: { model: string; width: number; height: number } | null;
  generatedAt?: Date;
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Findings carry tag and object names that came from a file we did not write. */
function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

const SEVERITY_LABEL: Record<Severity, string> = {
  error: "Error",
  warning: "Warning",
  info: "Information",
};

const RULE_LABEL: Record<string, string> = {
  naming: "Naming conventions",
  binding: "Binding integrity",
  "type-mismatch": "Type compatibility",
  alarm: "Alarm configuration",
  completeness: "Completeness",
  standards: "Standards conformance",
  "unused-tag": "Unused tags",
};

/** What each rule actually checked, so the report stands on its own. */
const RULE_SCOPE: [string, string][] = [
  ["Naming conventions", "Reserved words, leading digits, illegal characters and duplicates, against the product's own documented rules."],
  ["Binding integrity", "Every binding resolves to a declared tag; every value-displaying object is driven by one."],
  ["Type compatibility", "A tag's IEC data type is one the bound part accepts."],
  ["Alarm configuration", "Bit alarms trigger on BOOL, level alarms on a numeric with a numeric setpoint."],
  ["Completeness", "Fault tags raise an alarm; the project has at least one screen."],
  ["Standards conformance", "Screens fit the target panel and objects fall inside the screen area."],
];

function countBy<T extends string>(items: T[]): [T, number][] {
  const counts = new Map<T, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function findingRow(finding: Finding): string {
  const where = finding.tag
    ? `<code>${esc(finding.tag)}</code>`
    : finding.objectId
      ? `<code class="id">${esc(finding.objectId.slice(0, 8))}</code>`
      : "&mdash;";
  const suggestion = finding.suggestion
    ? `<div class="fix">Suggested: <code>${esc(finding.suggestion)}</code></div>`
    : "";
  return `<tr class="sev-${finding.severity}">
      <td class="sev"><span class="pill ${finding.severity}">${SEVERITY_LABEL[finding.severity]}</span></td>
      <td class="rule">${esc(RULE_LABEL[finding.rule] ?? finding.rule)}</td>
      <td class="msg">${esc(finding.message)}${suggestion}</td>
      <td class="where">${where}</td>
    </tr>`;
}

export function renderReport(input: ReportInput): string {
  const { project, findings } = input;
  const at = input.generatedAt ?? new Date();
  const counts = summarise(findings);
  const passed = counts.errors === 0;

  const parts = project.screens.flatMap((s) => s.Children[0].Children);
  const partTypes = countBy(parts.map((p) => p.Type));
  const alarmKinds = {
    bit: project.alarms.filter((a) => a.AlarmRecordType === 1).length,
    level: project.alarms.filter((a) => a.AlarmRecordType === 2).length,
  };

  const panel = input.panel
    ? `${input.panel.model} &middot; ${input.panel.width} &times; ${input.panel.height}`
    : `${project.target.model} &middot; ${project.target.width} &times; ${project.target.height}`;

  const rows = (["error", "warning", "info"] as Severity[])
    .flatMap((s) => findings.filter((f) => f.severity === s))
    .map(findingRow)
    .join("\n");

  const facts: [string, string][] = [
    ["Screens", String(project.screens.length)],
    ["Objects placed", String(parts.length)],
    ["Variables declared", String(project.variables.length)],
    ["Alarms configured", `${project.alarms.length} (${alarmKinds.bit} bit, ${alarmKinds.level} level)`],
    ["Tag bindings", String(project.wires.length + project.alarms.length)],
    ["Target panel", panel],
  ];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Validation report &mdash; ${esc(project.name)}</title>
<style>
  :root {
    --ink: #16202b; --soft: #44535f; --muted: #6b7a85;
    --rule: #d5dee4; --ground: #f5f8f9; --surface: #fff;
    --ok: #0a7a4a; --warn: #96620a; --err: #b3352b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--ground); color: var(--ink);
    font: 15px/1.6 "Segoe UI", system-ui, -apple-system, sans-serif;
  }
  .sheet { max-width: 960px; margin: 0 auto; padding: 40px 24px 64px; }
  header { border-bottom: 2px solid var(--ink); padding-bottom: 18px; margin-bottom: 26px; }
  .kicker {
    font: 500 11px/1 ui-monospace, Consolas, monospace;
    letter-spacing: .14em; text-transform: uppercase; color: var(--muted); margin: 0 0 12px;
  }
  h1 { font-size: 28px; line-height: 1.15; margin: 0 0 6px; letter-spacing: -.01em; }
  .subject { color: var(--soft); margin: 0; }
  .verdict {
    display: inline-flex; align-items: center; gap: 9px;
    margin-top: 18px; padding: 9px 16px; border-radius: 3px;
    font-weight: 600; font-size: 15px;
    background: ${passed ? "#e6f4ec" : "#fbeae8"};
    color: ${passed ? "var(--ok)" : "var(--err)"};
    border: 1px solid ${passed ? "#b9dfc9" : "#f0c3bd"};
  }
  .verdict::before {
    content: ""; width: 9px; height: 9px; border-radius: 50%;
    background: ${passed ? "var(--ok)" : "var(--err)"};
  }
  h2 {
    font-size: 13px; letter-spacing: .08em; text-transform: uppercase;
    color: var(--muted); margin: 34px 0 12px; font-weight: 600;
  }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1px; background: var(--rule); border: 1px solid var(--rule); }
  .cell { background: var(--surface); padding: 13px 15px; }
  .cell dt { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin: 0 0 4px; }
  .cell dd { margin: 0; font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .cell dd.small { font-size: 14px; font-weight: 500; }
  table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--rule); font-size: 13.5px; }
  th {
    text-align: left; padding: 9px 14px; border-bottom: 1px solid #b9c6ce;
    font: 600 10.5px/1.4 ui-monospace, Consolas, monospace;
    letter-spacing: .08em; text-transform: uppercase; color: var(--muted);
  }
  td { padding: 10px 14px; border-bottom: 1px solid var(--rule); vertical-align: top; color: var(--soft); }
  tr:last-child td { border-bottom: 0; }
  td.sev { width: 92px; }
  td.rule { width: 168px; color: var(--ink); }
  td.where { width: 132px; }
  .pill {
    display: inline-block; padding: 2px 8px; border-radius: 999px;
    font-size: 10.5px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
  }
  .pill.error { background: #fbeae8; color: var(--err); }
  .pill.warning { background: #fdf3e2; color: var(--warn); }
  .pill.info { background: #eaf0f4; color: var(--muted); }
  code { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; color: var(--ink); }
  code.id { color: var(--muted); }
  .fix { margin-top: 5px; font-size: 12.5px; color: var(--muted); }
  .clean { background: var(--surface); border: 1px solid var(--rule); padding: 22px; color: var(--soft); }
  .scope { list-style: none; padding: 0; margin: 0; border: 1px solid var(--rule); background: var(--surface); }
  .scope li { padding: 11px 15px; border-bottom: 1px solid var(--rule); font-size: 13.5px; color: var(--soft); }
  .scope li:last-child { border-bottom: 0; }
  .scope b { color: var(--ink); font-weight: 600; }
  footer {
    margin-top: 34px; padding-top: 16px; border-top: 1px solid var(--rule);
    font-size: 12px; color: var(--muted);
  }
  @media print {
    body { background: #fff; }
    .sheet { padding: 0; max-width: none; }
    tr { break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="sheet">

<header>
  <p class="kicker">Design-time validation report</p>
  <h1>${esc(project.name)}</h1>
  <p class="subject">
    EcoStruxure Operator Terminal Expert 4.4 &middot; ${panel}
  </p>
  <div class="verdict">${passed
    ? `Passed with ${counts.warnings} warning${counts.warnings === 1 ? "" : "s"}`
    : `${counts.errors} error${counts.errors === 1 ? "" : "s"} must be resolved before download`}</div>
</header>

<h2>Findings</h2>
<dl class="grid">
  <div class="cell"><dt>Errors</dt><dd>${counts.errors}</dd></div>
  <div class="cell"><dt>Warnings</dt><dd>${counts.warnings}</dd></div>
  <div class="cell"><dt>Information</dt><dd>${counts.info}</dd></div>
  <div class="cell"><dt>Total checks reported</dt><dd>${counts.all}</dd></div>
</dl>

${rows
  ? `<table>
  <thead><tr><th>Severity</th><th>Check</th><th>Finding</th><th>Object / tag</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>`
  : `<div class="clean">No findings. Every check passed against this project.</div>`}

<h2>Project contents</h2>
<dl class="grid">
${facts
  .map(
    ([k, v]) =>
      `  <div class="cell"><dt>${k}</dt><dd${v.length > 12 ? ' class="small"' : ""}>${v}</dd></div>`,
  )
  .join("\n")}
</dl>

<h2>Objects on screen</h2>
<dl class="grid">
${partTypes
  .map(([type, n]) => `  <div class="cell"><dt>${esc(type)}</dt><dd>${n}</dd></div>`)
  .join("\n")}
</dl>

<h2>What was checked</h2>
<ul class="scope">
${RULE_SCOPE.map(([name, what]) => `  <li><b>${name}.</b> ${what}</li>`).join("\n")}
</ul>

<footer>
  Generated by HMI Copilot on ${esc(at.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC"))}.
  Naming rules are taken from the product's own documented conventions; part shapes
  and binding properties from the sample projects it ships.
</footer>

</div>
</body>
</html>
`;
}
