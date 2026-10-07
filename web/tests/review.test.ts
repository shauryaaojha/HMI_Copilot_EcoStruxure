/** Whether a conversational edit commits at once or waits for the engineer. */
import { describe, expect, it } from "vitest";
import { commitsWithoutReview } from "@/lib/ai/review";
import { DEFAULT_STANDARDS } from "@/store/types";

describe("reviewing AI edits", () => {
  it("commits a clean edit by default, as before", () => {
    expect(DEFAULT_STANDARDS.reviewAiEdits).toBeUndefined();
    expect(commitsWithoutReview({ rejected: [] }, DEFAULT_STANDARDS)).toBe(true);
  });
  it("proposes anything rejected or deleted, as before", () => {
    expect(commitsWithoutReview({ rejected: ["x"] }, DEFAULT_STANDARDS)).toBe(false);
    expect(commitsWithoutReview({ rejected: [], deleted: 1 }, DEFAULT_STANDARDS)).toBe(false);
  });
  it("proposes every edit when the project asks for review", () => {
    expect(commitsWithoutReview({ rejected: [] }, { ...DEFAULT_STANDARDS, reviewAiEdits: true })).toBe(false);
  });
});
