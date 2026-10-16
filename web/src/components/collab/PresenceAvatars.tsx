"use client";

/**
 * Top-bar presence indicator showing collaborator avatars.
 *
 * Co-editing requires collaborators to know who else is currently viewing or
 * modifying the shared project. While PresenceOverlay renders in-canvas activity
 * (selection boxes and cursors), PresenceAvatars provides an ambient summary in
 * the shell header.
 *
 * It monitors the presence store, suppresses the local browser user, and renders
 * a compact stack of initials badges for up to four active peers, collapsing any
 * remainder into an overflow count badge followed by the total participant count.
 */

import { colorFor, others, usePresence } from "@/store/presence";

/**
 * Derives up to two uppercase initial characters from a collaborator's name.
 * Takes the first letter of the first two whitespace-separated words.
 */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  return words
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/**
 * Renders the compact collaborator avatar row in the application header.
 *
 * Returns null if no other users are present in the project session. When peers
 * are active, renders circular initial badges with stable peer colors, a tooltip
 * identifying each user, an overflow indicator when exceeding four peers, and
 * the total headcount including the local participant.
 */
export function PresenceAvatars() {
  const users = usePresence((s) => s.users);
  const me = usePresence((s) => s.me);
  const peerUsers = others({ users, me });

  if (peerUsers.length === 0) {
    return null;
  }

  const maxBadges = 4;
  const visible = peerUsers.slice(0, maxBadges);
  const overflow = peerUsers.length - maxBadges;
  const totalCount = peerUsers.length + 1;

  return (
    <div
      className="flex items-center gap-1.5"
      aria-label="People in this project"
      data-presence-avatars
    >
      <div className="flex items-center -space-x-1">
        {visible.map((user) => (
          <span
            key={user.userId}
            title={user.name}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-1 ring-surface-frame"
            style={{ backgroundColor: colorFor(user.userId) }}
          >
            {initialsOf(user.name)}
          </span>
        ))}
        {overflow > 0 && (
          <span
            title={`${overflow} more`}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-surface-hover text-[10px] font-medium text-text-muted ring-1 ring-surface-frame"
          >
            +{overflow}
          </span>
        )}
      </div>
      <span className="text-[11px] text-text-muted">
        {totalCount} people here
      </span>
    </div>
  );
}
