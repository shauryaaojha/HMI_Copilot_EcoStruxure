/**
 * Naming a project after what it turned out to be.
 *
 * A new project starts as `Untitled`, because at that moment nobody knows what
 * it is - not the engineer, who has not typed anything, and certainly not us.
 * One turn later everybody does: there is a request, inferred equipment and, if
 * it was a build, screens with names the plan already chose carefully. So the
 * name is derived then rather than demanded up front, and the engineer is never
 * shown a "name your project" box before they have anything to name.
 *
 * Four sources, best first. The model's suggestion is preferred because it read
 * the sentence; everything below it is deterministic, so a project gets a real
 * name with no key configured and no network.
 */

const FILLER = new Set([
  "a", "an", "and", "the", "for", "with", "of", "on", "in", "to", "my", "our",
  "me", "i", "we", "please", "can", "you", "create", "make", "build", "generate",
  "add", "show", "screen", "screens", "hmi", "display", "displays", "page",
  "new", "some", "that", "this", "it", "up", "out", "then", "also", "want",
  "need", "would", "like", "give", "draw", "put", "set", "one", "two", "all",
  // Conversational words that survive the filter above but are never the name
  // of a plant. "please can you help" was coming out as Help.
  "help", "thanks", "thank", "hello", "hey", "okay", "yes", "sorry", "again",
  "something", "anything", "thing", "things", "stuff", "work", "working",
  "ready", "start", "started", "here", "there", "now", "just", "very", "how",
  "what", "why", "when", "where", "which", "does", "did", "was", "are", "let",
]);

/** Words worth keeping even though they are short. */
const KEEP = new Set(["cip", "vsd", "plc", "ahu", "rtu"]);

/** OTE is happy with letters, digits and underscore. So is a filename. */
function sanitise(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (cleaned.length === 0) return "";
  // A leading digit is legal in a project name but reads as a version number.
  return /^[0-9]/.test(cleaned) ? `P_${cleaned}` : cleaned;
}

const titled = (word: string) =>
  word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

/**
 * `PumpStation1` -> `Pump_Station`. The plan names screens carefully, so the
 * first one is usually a better name than anything a regex finds in prose.
 */
export function fromScreenName(screenName: string): string {
  const withoutIndex = screenName.replace(/[_-]?\d+$/, "");
  const words = withoutIndex
    // Split PascalCase and snake_case alike.
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .filter(Boolean);
  // "Overview" and "PlantOverview" say nothing about which plant.
  const meaningful = words.filter((w) => !/^overview$|^detail$|^screen$/i.test(w));
  const chosen = meaningful.length > 0 ? meaningful : words;
  return sanitise(chosen.slice(0, 4).map(titled).join("_"));
}

/** The words in the request that name a thing, in the order they appeared. */
export function fromIntent(intent: string): string {
  const words = intent
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !FILLER.has(w) && (w.length > 2 || KEEP.has(w)))
    // A bare number is a loop tag, not a name.
    .filter((w) => !/^\d+$/.test(w));

  const unique: string[] = [];
  for (const word of words) {
    if (!unique.includes(word)) unique.push(word);
    if (unique.length === 3) break;
  }
  return sanitise(unique.map(titled).join("_"));
}

/** The dominant machine kind, when nothing else said anything. */
export function fromEquipment(kinds: string[]): string {
  const counts = new Map<string, number>();
  for (const kind of kinds) {
    if (!kind || kind === "instrument") continue;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return top ? sanitise(`${titled(top)}_Station`) : "";
}

export interface NameSources {
  /** What the model suggested, if a model answered at all. */
  suggested?: string;
  /** The engineer's own sentence. */
  intent?: string;
  /** Screen names, in project order. */
  screens?: string[];
  /** Inferred equipment kinds. */
  kinds?: string[];
  /** Names already in use, so two projects are distinguishable. */
  taken?: Set<string>;
}

/**
 * A project name is only ever assigned while the project is still called
 * `Untitled`. Once it has a real name - auto or typed - it keeps it, because
 * renaming a project out from under someone on their fourth request is worse
 * than a slightly wrong name on the first.
 */
export const isUnnamed = (name: string): boolean =>
  /^untitled(_\d+)?$/i.test(name.trim());

export function nameProject(sources: NameSources): string | null {
  const candidates = [
    sources.suggested ? sanitise(sources.suggested) : "",
    sources.screens?.[0] ? fromScreenName(sources.screens[0]) : "",
    sources.intent ? fromIntent(sources.intent) : "",
    sources.kinds ? fromEquipment(sources.kinds) : "",
  ];

  const chosen = candidates.find((c) => c.length >= 3 && !isUnnamed(c));
  if (!chosen) return null;

  const taken = sources.taken ?? new Set<string>();
  if (!taken.has(chosen)) return chosen;
  for (let n = 2; n < 100; n++) {
    const candidate = `${chosen}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return chosen;
}
