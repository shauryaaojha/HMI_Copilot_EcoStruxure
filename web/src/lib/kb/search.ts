import { expandedTokens, tokens } from "@/lib/ai/retrieve";
import type { Entry } from "./types";

export const termsOf = (entry: Entry): Map<string, number> => {
  const terms = new Map<string, number>();
  for (const [text, weight] of [[entry.title, 6], [entry.summary, 2], [entry.tags.join(" "), 4]] as const) {
    for (const term of tokens(text)) terms.set(term, Math.max(terms.get(term) ?? 0, weight));
  }
  return terms;
};

export const queryTerms = (query: string) => expandedTokens(query);
