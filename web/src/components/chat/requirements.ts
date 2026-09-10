/**
 * What a request has to carry before it can be acted on, checked against the
 * project rather than against a form.
 *
 * This is the honest answer to "what do you need from me?". Three of the four
 * are satisfied by the project itself and the engineer never has to think about
 * them; the fourth is the sentence they are about to type. Showing the list
 * only when something is missing keeps it a prompt rather than a gate - the
 * assistant still tries, and says what it assumed.
 */

import type { Requirement } from "@/store/types";
import type { Alarm, Screen, Variable } from "@/lib/ote/schema";

export interface RequirementInput {
  variables: Variable[];
  screens: Screen[];
  alarms: Alarm[];
  target: { model: string; width: number; height: number };
}

export function requirementsOf(input: RequirementInput): Requirement[] {
  const { variables, screens, target } = input;

  return [
    {
      id: "subject",
      label: "What the screen is about",
      // Only the engineer can supply this, so it is never "met" - it is the
      // sentence they type, listed so they know it is the one thing needed.
      met: false,
      detail:
        "Name the equipment or the area you want a screen for, and what should " +
        "be visible on it — status, readings, alarms.",
    },
    {
      id: "tags",
      label: "PLC tags to bind to",
      met: variables.length > 0,
      detail:
        variables.length > 0
          ? `${variables.length} tag${variables.length === 1 ? "" : "s"} available — equipment is inferred from their names.`
          : "Import a tag export on the Tags page. Without tags a screen can be drawn but nothing can be bound to it.",
    },
    {
      id: "panel",
      label: "Panel size",
      met: target.width > 0 && target.height > 0,
      detail: `${target.model} — ${target.width} × ${target.height}. Change it in Project settings.`,
    },
    {
      id: "screen",
      label: "Somewhere to put it",
      met: screens.length > 0,
      detail:
        screens.length > 0
          ? `${screens.length} screen${screens.length === 1 ? "" : "s"} in the project.`
          : "Ask for a screen and one is created.",
    },
  ];
}

/**
 * Whether the checklist is worth showing at all. Only the subject being missing
 * is normal - that is what the composer is for - so the panel appears when
 * something the project should have supplied is absent.
 */
export const anythingMissing = (requirements: Requirement[]) =>
  requirements.some((r) => r.id !== "subject" && !r.met);
