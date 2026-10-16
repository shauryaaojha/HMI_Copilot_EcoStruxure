"use client";

/**
 * SVG canvas overlay rendering remote collaborators' selections and cursors.
 *
 * When multiple engineers work on the same HMI screen, they must see each other's
 * active focus to avoid conflicting edits on the same objects. This component
 * sits directly inside the ScreenRenderer SVG viewport, above the drawn screen
 * parts but beneath interactive handles.
 *
 * To maintain isolation from the packager and canvas hit tests, all elements are
 * non-interactive (pointerEvents="none") and strictly omit `data-object-id`.
 * Selections highlight parts with dashed bounding outlines matching each user's
 * assigned color, topped by an editing label, while cursors show live pointer
 * positions and names.
 */

import type { Presence } from "@/lib/collab/types";
import type { Part } from "@/lib/ote/schema";
import { colorFor } from "@/store/presence";

export interface PresenceOverlayProps {
  /** Collaborators currently in the project session. */
  users: Presence[];
  /** Identifier of the screen currently rendered in the SVG viewport. */
  screenId: string;
  /** All parts present on the active screen. */
  parts: Part[];
  /** Screen units per CSS pixel, ensuring cosmetic sizes stay proportional across zoom levels. */
  scale?: number;
}

/**
 * Extracts the first word of a collaborator's display name for cursor labeling.
 */
function firstNameOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  const [first] = trimmed.split(/\s+/);
  return first || trimmed;
}

/**
 * Renders live collaborator selection boxes, author labels, and cursor pointers.
 *
 * Takes a pure snapshot of peers, the active screen identifier, the screen's parts,
 * and the current zoom scale. Users viewing other screens or holding selections
 * referencing non-existent parts are filtered out. If there is no activity to
 * display on the current screen, returns null so no empty SVG group is emitted.
 */
export function PresenceOverlay({
  users,
  screenId,
  parts,
  scale = 1,
}: PresenceOverlayProps) {
  const px = (n: number) => n / scale;

  const partsById = new Map<string, Part>();
  for (const part of parts) {
    partsById.set(part.UniqueId, part);
  }

  const activeUsers = users.filter((u) => u.screenId === screenId);

  const drawableUsers = activeUsers
    .map((user) => {
      const selectedParts = (user.selection ?? [])
        .map((id) => partsById.get(id))
        .filter((p): p is Part => p !== undefined);

      const hasCursor =
        user.cursor !== undefined &&
        typeof user.cursor.x === "number" &&
        typeof user.cursor.y === "number";

      if (selectedParts.length === 0 && !hasCursor) {
        return null;
      }

      return {
        user,
        color: colorFor(user.userId),
        selectedParts,
        hasCursor,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (drawableUsers.length === 0) {
    return null;
  }

  return (
    <g pointerEvents="none" data-presence>
      {drawableUsers.map(({ user, color, selectedParts, hasCursor }) => {
        const firstSelectedPart = selectedParts[0];

        return (
          <g key={user.userId}>
            {selectedParts.map((part) => (
              <rect
                key={part.UniqueId}
                x={part.Location.Left}
                y={part.Location.Top}
                width={part.Width ?? 0}
                height={part.Height ?? 0}
                fill="none"
                stroke={color}
                strokeWidth={px(2)}
                strokeDasharray={`${px(5)} ${px(3)}`}
              />
            ))}

            {firstSelectedPart && (() => {
              const labelText = `${user.name} is editing`;
              const labelPadding = px(4);
              const labelHeight = px(16);
              const labelWidth = labelText.length * px(6.2) + labelPadding * 2;
              const labelX = firstSelectedPart.Location.Left;
              const labelY = firstSelectedPart.Location.Top - labelHeight;

              return (
                <g key={`label-${user.userId}`}>
                  <rect
                    x={labelX}
                    y={labelY}
                    width={labelWidth}
                    height={labelHeight}
                    fill={color}
                    rx={px(2)}
                  />
                  <text
                    x={labelX + labelPadding}
                    y={labelY + labelHeight / 2}
                    fill="#ffffff"
                    fontSize={px(10)}
                    dominantBaseline="central"
                  >
                    {labelText}
                  </text>
                </g>
              );
            })()}

            {hasCursor && user.cursor && (() => {
              const { x, y } = user.cursor;
              const firstName = firstNameOf(user.name);

              return (
                <g key={`cursor-${user.userId}`}>
                  <path
                    d={`M ${x} ${y} L ${x} ${y + px(12)} L ${x + px(9)} ${y + px(9)} Z`}
                    fill={color}
                  />
                  {firstName && (
                    <text
                      x={x + px(12)}
                      y={y + px(10)}
                      fill={color}
                      fontSize={px(10)}
                      fontWeight={500}
                      dominantBaseline="central"
                    >
                      {firstName}
                    </text>
                  )}
                </g>
              );
            })()}
          </g>
        );
      })}
    </g>
  );
}
