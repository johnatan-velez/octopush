import { describe, it, expect } from "vitest";
import { parseKeyPhrase } from "./parseKeyPhrase";

describe("parseKeyPhrase", () => {
  it("splits a plain sentence + body", () => {
    const r = parseKeyPhrase("Because skipRefreshCheck is true. The flag was meant for tests only.");
    expect(r.keyPhrase).toBe("Because skipRefreshCheck is true.");
    expect(r.body).toBe("The flag was meant for tests only.");
  });

  it("works with ? and ! terminators", () => {
    expect(parseKeyPhrase("What if we ditched the cache? It seems redundant.").keyPhrase)
      .toBe("What if we ditched the cache?");
    expect(parseKeyPhrase("Done! All tests pass.").keyPhrase)
      .toBe("Done!");
  });

  it("preserves inline code in the key phrase", () => {
    const r = parseKeyPhrase("Because `skipRefreshCheck` is true. Body here.");
    expect(r.keyPhrase).toBe("Because `skipRefreshCheck` is true.");
    expect(r.body).toBe("Body here.");
  });

  it("returns null keyPhrase when content starts with a fenced code block", () => {
    const r = parseKeyPhrase("```ts\nconst x = 1;\n```\nThe code above…");
    expect(r.keyPhrase).toBeNull();
    expect(r.body).toBe("```ts\nconst x = 1;\n```\nThe code above…");
  });

  it("returns null keyPhrase when content starts with a heading", () => {
    const r = parseKeyPhrase("# Plan\n\nFirst step is…");
    expect(r.keyPhrase).toBeNull();
    expect(r.body).toBe("# Plan\n\nFirst step is…");
  });

  it("returns null keyPhrase when content starts with a list", () => {
    const r = parseKeyPhrase("- First item\n- Second item");
    expect(r.keyPhrase).toBeNull();
    expect(r.body).toBe("- First item\n- Second item");
  });

  it("returns null when there is no body after the key phrase", () => {
    const r = parseKeyPhrase("All done.");
    expect(r.keyPhrase).toBeNull();
    expect(r.body).toBe("All done.");
  });

  it("returns null when the lead sentence is too long (over 160 chars)", () => {
    const long = "This is a very long lead sentence that exceeds the threshold for what looks like a punchy display phrase and would render awkwardly large on the screen if treated as a heading, so we skip the parse.";
    const r = parseKeyPhrase(long + " Body content.");
    expect(r.keyPhrase).toBeNull();
    expect(r.body).toBe(long + " Body content.");
  });

  it("trims surrounding whitespace from both parts", () => {
    const r = parseKeyPhrase("  Hello there.    Second sentence.   ");
    expect(r.keyPhrase).toBe("Hello there.");
    expect(r.body).toBe("Second sentence.");
  });

  it("handles content with no terminator (returns null key phrase)", () => {
    const r = parseKeyPhrase("Just a fragment without punctuation");
    expect(r.keyPhrase).toBeNull();
    expect(r.body).toBe("Just a fragment without punctuation");
  });

  it("recognises punctuation followed by a streaming cursor block", () => {
    const r = parseKeyPhrase("Found it. Looking at the file now▊");
    expect(r.keyPhrase).toBe("Found it.");
    expect(r.body).toBe("Looking at the file now▊");
  });
});
