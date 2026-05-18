import { describe, it, expect } from "vitest";
import { deriveChatTitle, deriveChatMeta } from "./chatTitle";
import type { ChatMessage } from "./types";

function msg(
  role: ChatMessage["role"],
  content: string,
  createdAt = "2026-05-18T15:00:00Z",
): ChatMessage {
  return {
    id: Math.floor(Math.random() * 1_000_000),
    workspaceId: "ws-1",
    role,
    content,
    model: null,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    createdAt,
  };
}

describe("deriveChatTitle", () => {
  it("returns placeholder for empty message list", () => {
    expect(deriveChatTitle([])).toBe("New conversation");
  });

  it("returns placeholder when there are only assistant or tool messages", () => {
    expect(deriveChatTitle([msg("assistant", "hi there")])).toBe("New conversation");
    expect(deriveChatTitle([msg("tool", "{}")])).toBe("New conversation");
  });

  it("uses the first user message verbatim when short", () => {
    expect(deriveChatTitle([msg("user", "fix the bug")])).toBe("fix the bug");
  });

  it("ignores empty/whitespace user messages and picks the next one", () => {
    expect(
      deriveChatTitle([
        msg("user", "   "),
        msg("assistant", "noise"),
        msg("user", "actual question"),
      ]),
    ).toBe("actual question");
  });

  it("truncates long messages at a word boundary with an ellipsis", () => {
    const long =
      "I would like you to refactor the authentication module to support OAuth properly";
    const out = deriveChatTitle([msg("user", long)]);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(62); // 60 + maybe trailing space + …
    expect(out.startsWith("I would like you")).toBe(true);
  });

  it("collapses newlines to single spaces", () => {
    expect(deriveChatTitle([msg("user", "line one\n\nline two")])).toBe(
      "line one line two",
    );
  });
});

describe("deriveChatMeta", () => {
  const now = new Date("2026-05-18T15:00:00Z");

  it("returns NEW when there are no messages", () => {
    expect(deriveChatMeta([], now)).toBe("NEW");
  });

  it("returns JUST NOW for very recent messages", () => {
    expect(deriveChatMeta([msg("user", "hi", "2026-05-18T14:59:50Z")], now)).toBe(
      "JUST NOW",
    );
  });

  it("returns minutes for messages under an hour", () => {
    expect(deriveChatMeta([msg("user", "hi", "2026-05-18T14:55:00Z")], now)).toBe(
      "5M AGO",
    );
  });

  it("returns hours for messages within today", () => {
    expect(deriveChatMeta([msg("user", "hi", "2026-05-18T12:00:00Z")], now)).toBe(
      "3H AGO",
    );
  });

  it("returns YESTERDAY for a message ~24h ago", () => {
    expect(deriveChatMeta([msg("user", "hi", "2026-05-17T14:00:00Z")], now)).toBe(
      "YESTERDAY",
    );
  });

  it("returns days for messages within a week", () => {
    expect(deriveChatMeta([msg("user", "hi", "2026-05-15T15:00:00Z")], now)).toBe(
      "3D AGO",
    );
  });

  it("falls back to a locale date older than a week", () => {
    const out = deriveChatMeta([msg("user", "hi", "2026-04-15T15:00:00Z")], now);
    // Format depends on Intl locale, but should not contain "AGO".
    expect(out).not.toContain("AGO");
    expect(out.length).toBeGreaterThan(0);
  });
});
