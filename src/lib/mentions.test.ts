import { describe, it, expect } from "vitest";
import {
  findActiveMention,
  rankFiles,
  extractMentions,
  applyMention,
} from "./mentions";

describe("findActiveMention", () => {
  it("detects an @mention at the caret", () => {
    const t = "look at @src/Foo";
    expect(findActiveMention(t, t.length)).toEqual({ query: "src/Foo", start: 8 });
  });
  it("detects a bare @ trigger", () => {
    expect(findActiveMention("@", 1)).toEqual({ query: "", start: 0 });
  });
  it("returns null when the @ is glued to a word (email)", () => {
    const t = "me@example.com";
    expect(findActiveMention(t, t.length)).toBeNull();
  });
  it("returns null when whitespace follows the @ before the caret", () => {
    const t = "@foo bar";
    expect(findActiveMention(t, t.length)).toBeNull();
  });
});

describe("rankFiles", () => {
  const files = ["src/components/Foo.tsx", "src/foo.ts", "lib/bar.ts", "README.md"];
  it("ranks basename prefix matches first, shorter paths before longer", () => {
    expect(rankFiles(files, "foo")).toEqual(["src/foo.ts", "src/components/Foo.tsx"]);
  });
  it("falls back to path substring and subsequence", () => {
    expect(rankFiles(files, "bar")).toContain("lib/bar.ts");
  });
  it("empty query returns the head of the list", () => {
    expect(rankFiles(files, "", 2)).toEqual(["src/components/Foo.tsx", "src/foo.ts"]);
  });
});

describe("extractMentions", () => {
  const known = new Set(["src/foo.ts", "lib/bar.ts"]);
  it("keeps only mentions that match known files, de-duped", () => {
    const t = "compare @src/foo.ts with @lib/bar.ts and @src/foo.ts again, ignore @nobody";
    expect(extractMentions(t, known)).toEqual(["src/foo.ts", "lib/bar.ts"]);
  });
  it("ignores an @ glued to a word", () => {
    expect(extractMentions("ping me@src/foo.ts", known)).toEqual([]);
  });
});

describe("applyMention", () => {
  it("replaces the active query with @path and a trailing space", () => {
    const t = "see @fo";
    const { text, caret } = applyMention(t, 4, t.length, "src/foo.ts");
    expect(text).toBe("see @src/foo.ts ");
    expect(caret).toBe(text.length);
  });
});
