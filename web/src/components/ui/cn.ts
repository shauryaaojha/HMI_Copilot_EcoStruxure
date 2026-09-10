/**
 * Class name joiner. Deliberately not clsx: package.json is frozen (see
 * docs/WORKSTREAMS.md), and this is the whole of what we use clsx for.
 *
 * There is no tailwind-merge either, so the rule is: caller-supplied
 * `className` goes last in every primitive, and later classes win.
 */
export type ClassValue = string | false | null | undefined;

export function cn(...parts: ClassValue[]): string {
  return parts.filter(Boolean).join(" ");
}
