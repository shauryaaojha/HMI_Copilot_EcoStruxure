import type { Entry, RuleBody } from "../types";

function digest(text: string): string {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return (value >>> 0).toString(16).padStart(8, "0");
}

export function rule(checker: string, title: string, body: RuleBody, source: string, tags: string[]): Entry<RuleBody> {
  const rev = digest(JSON.stringify(body));
  return { id: `rule:${checker}`, kind: "rule", layer: "docs", title, summary: body.statement, tags: [...new Set(tags)].sort(), body,
    related: [], source: { kind: "doc", ref: source, inputHash: rev }, rev };
}

export function pattern(id: string, title: string, summary: string, source: string, tags: string[]): Entry {
  const body = { statement: summary };
  const rev = digest(JSON.stringify(body));
  return { id: `pattern:${id}`, kind: "pattern", layer: "docs", title, summary, tags, body, related: [],
    source: { kind: "doc", ref: source, inputHash: rev }, rev };
}
