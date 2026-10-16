/**
 * Render tests for live co-editing presence UI components.
 *
 * Verifies that PresenceOverlay correctly projects peer selections, author labels,
 * and cursors into the SVG canvas coordinate space without polluting the exportable
 * object hierarchy, and that PresenceAvatars renders responsive peer initials and
 * headcount badges from the presence store during server-side static rendering.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { demoScreen } from "@/fixtures";
import type { Presence } from "@/lib/collab/types";
import { colorFor, usePresence } from "@/store/presence";
import { PresenceAvatars } from "@/components/collab/PresenceAvatars";
import { PresenceOverlay } from "@/components/collab/PresenceOverlay";

const parts = demoScreen.Children[0].Children;
const screenId = demoScreen.UniqueId;
const [firstPart, secondPart] = parts;

describe("PresenceOverlay", () => {
  it("renders active peer selection outline, author label, and cursor", () => {
    const user1: Presence = {
      userId: "user-alice",
      name: "Alice Smith",
      screenId,
      selection: [firstPart.UniqueId],
      cursor: { x: 140, y: 95 },
      expiresAt: Date.now() + 60000,
    };

    const user2: Presence = {
      userId: "user-bob",
      name: "Bob Jones",
      screenId: "other-screen",
      selection: [firstPart.UniqueId],
      cursor: { x: 220, y: 180 },
      expiresAt: Date.now() + 60000,
    };

    const markup = renderToStaticMarkup(
      createElement(PresenceOverlay, {
        users: [user1, user2],
        screenId,
        parts,
      }),
    );

    // Markup contains one "is editing" label for the first user's name
    expect(markup).toContain("Alice Smith is editing");
    expect(markup).not.toContain("Bob Jones is editing");
    const labelMatches = markup.match(/is editing/g);
    expect(labelMatches?.length).toBe(1);

    // Contains their colour from colorFor
    expect(markup).toContain(colorFor(user1.userId));
    expect(markup).not.toContain(colorFor(user2.userId));

    // Contains no data-object-id
    expect(markup).not.toContain("data-object-id");

    // Contains pointer-events="none"
    expect(markup).toContain('pointer-events="none"');

    // Contains cursor pointer with first name
    expect(markup).toContain("Alice");
    expect(markup).not.toContain("Bob");
  });

  it("renders selection outlines for multiple selected parts but only one author label", () => {
    const user: Presence = {
      userId: "user-charlie",
      name: "Charlie Brown",
      screenId,
      selection: [firstPart.UniqueId, secondPart.UniqueId],
      expiresAt: Date.now() + 60000,
    };

    const markup = renderToStaticMarkup(
      createElement(PresenceOverlay, {
        users: [user],
        screenId,
        parts,
      }),
    );

    expect(markup).toContain("Charlie Brown is editing");
    const labelMatches = markup.match(/is editing/g);
    expect(labelMatches?.length).toBe(1);

    // Dashed bounding boxes for both parts
    expect(markup).toContain(`x="${firstPart.Location.Left}"`);
    expect(markup).toContain(`x="${secondPart.Location.Left}"`);
  });

  it("draws nothing for selection ids that do not exist", () => {
    const userWithMissingPart: Presence = {
      userId: "user-ghost",
      name: "Ghost User",
      screenId,
      selection: ["non-existent-id-0000", "non-existent-id-1111"],
      expiresAt: Date.now() + 60000,
    };

    const markup = renderToStaticMarkup(
      createElement(PresenceOverlay, {
        users: [userWithMissingPart],
        screenId,
        parts,
      }),
    );

    expect(markup).toBe("");
  });

  it("draws nothing for users on another screen", () => {
    const userOnOtherScreen: Presence = {
      userId: "user-remote",
      name: "Remote User",
      screenId: "screen-somewhere-else",
      selection: [firstPart.UniqueId],
      cursor: { x: 50, y: 50 },
      expiresAt: Date.now() + 60000,
    };

    const markup = renderToStaticMarkup(
      createElement(PresenceOverlay, {
        users: [userOnOtherScreen],
        screenId,
        parts,
      }),
    );

    expect(markup).toBe("");
  });

  it("draws empty string markup for empty users list", () => {
    const markup = renderToStaticMarkup(
      createElement(PresenceOverlay, {
        users: [],
        screenId,
        parts,
      }),
    );

    expect(markup).toBe("");
  });
});

describe("PresenceAvatars", () => {
  const initialPresence = { ...usePresence.getInitialState() };

  afterEach(() => {
    usePresence.setState(initialPresence);
    Object.assign(usePresence.getInitialState(), initialPresence);
  });

  function setPresenceState(users: Presence[], me: string | null) {
    const state = { users, me };
    usePresence.setState(state);
    Object.assign(usePresence.getInitialState(), state);
  }

  it("renders nothing when only 'me' is present", () => {
    setPresenceState(
      [
        {
          userId: "me-id",
          name: "My Self",
          selection: [],
          expiresAt: Date.now() + 60000,
        },
      ],
      "me-id",
    );

    const markup = renderToStaticMarkup(createElement(PresenceAvatars));
    expect(markup).toBe("");
  });

  it("renders initials, headcount, and title attributes with 2 others", () => {
    const meId = "user-me";
    const user1: Presence = {
      userId: "user-alice",
      name: "Alice Adams",
      selection: [],
      expiresAt: Date.now() + 60000,
    };
    const user2: Presence = {
      userId: "user-bob",
      name: "Bob Brown",
      selection: [],
      expiresAt: Date.now() + 60000,
    };

    setPresenceState(
      [
        { userId: meId, name: "Local Engineer", selection: [], expiresAt: Date.now() + 60000 },
        user1,
        user2,
      ],
      meId,
    );

    const markup = renderToStaticMarkup(createElement(PresenceAvatars));

    // Peer initials
    expect(markup).toContain("AA");
    expect(markup).toContain("BB");

    // Total headcount text counting everyone including me
    expect(markup).toContain("3 people here");

    // Title attributes showing full names
    expect(markup).toContain('title="Alice Adams"');
    expect(markup).toContain('title="Bob Brown"');

    // Accessibility and container marker
    expect(markup).toContain('aria-label="People in this project"');
    expect(markup).toContain("data-presence-avatars");
  });

  it("renders an overflow badge when more than 4 others are present", () => {
    const meId = "user-me";
    const othersList: Presence[] = [
      { userId: "u1", name: "One Alpha", selection: [], expiresAt: Date.now() + 60000 },
      { userId: "u2", name: "Two Bravo", selection: [], expiresAt: Date.now() + 60000 },
      { userId: "u3", name: "Three Charlie", selection: [], expiresAt: Date.now() + 60000 },
      { userId: "u4", name: "Four Delta", selection: [], expiresAt: Date.now() + 60000 },
      { userId: "u5", name: "Five Echo", selection: [], expiresAt: Date.now() + 60000 },
      { userId: "u6", name: "Six Foxtrot", selection: [], expiresAt: Date.now() + 60000 },
    ];

    setPresenceState(
      [
        { userId: meId, name: "Local Engineer", selection: [], expiresAt: Date.now() + 60000 },
        ...othersList,
      ],
      meId,
    );

    const markup = renderToStaticMarkup(createElement(PresenceAvatars));

    // Shows 4 initials badges and an overflow badge +2
    expect(markup).toContain("OA");
    expect(markup).toContain("TB");
    expect(markup).toContain("TC");
    expect(markup).toContain("FD");
    expect(markup).toContain("+2");

    // 6 others + 1 me = 7 people
    expect(markup).toContain("7 people here");
  });
});
