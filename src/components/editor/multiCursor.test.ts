import { describe, it, expect } from "vitest";
import { computeOccurrenceRanges } from "./multiCursor";

describe("computeOccurrenceRanges", () => {
  it("finds every non-overlapping occurrence", () => {
    const doc = "key key key";
    expect(computeOccurrenceRanges(doc, "key")).toEqual([
      { from: 0, to: 3 },
      { from: 4, to: 7 },
      { from: 8, to: 11 },
    ]);
  });

  it("does not overlap matches", () => {
    expect(computeOccurrenceRanges("aaaa", "aa")).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ]);
  });

  it("returns [] for an empty query", () => {
    expect(computeOccurrenceRanges("abc", "")).toEqual([]);
  });

  it("returns [] when there is no match", () => {
    expect(computeOccurrenceRanges("abc", "xyz")).toEqual([]);
  });

  it("is case-sensitive", () => {
    expect(computeOccurrenceRanges("Key key", "key")).toEqual([{ from: 4, to: 7 }]);
  });
});
