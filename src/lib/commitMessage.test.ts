import { describe, it, expect } from "vitest";
import { COMMIT_SYSTEM, buildCommitPrompt } from "./commitMessage";

describe("commitMessage", () => {
  it("system prompt asks for message-only, subject + optional body", () => {
    expect(COMMIT_SYSTEM).toMatch(/ONLY the message/i);
    expect(COMMIT_SYSTEM).toMatch(/subject/i);
  });
  it("buildCommitPrompt embeds the staged diff", () => {
    expect(buildCommitPrompt("DIFFX")).toContain("DIFFX");
  });
});
