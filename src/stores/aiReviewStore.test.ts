import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../lib/ipc", () => ({
  ipc: { aiComplete: vi.fn() },
}));
import { ipc } from "../lib/ipc";
import { useAiReview, diffHash } from "./aiReviewStore";

const okJson = JSON.stringify({ summary: "s", findings: [{ severity: "high", category: "bug", title: "t", detail: "d", file: "a.ts", line: 3 }] });

beforeEach(() => {
  localStorage.clear();
  useAiReview.setState({ models: {}, reviews: {} });
  (ipc.aiComplete as any).mockReset();
});

describe("aiReviewStore", () => {
  it("defaults the model to claude-sonnet-4-6 per workspace", () => {
    expect(useAiReview.getState().modelFor("w1")).toBe("claude-sonnet-4-6");
  });
  it("setModel persists per workspace", () => {
    useAiReview.getState().setModel("w1", "claude-opus-4-6");
    expect(useAiReview.getState().modelFor("w1")).toBe("claude-opus-4-6");
    expect(localStorage.getItem("octo-ai-review")).toContain("claude-opus-4-6");
  });
  it("run goes running → done and stamps the diff hash", async () => {
    (ipc.aiComplete as any).mockResolvedValue({ text: okJson, inputTokens: 1, outputTokens: 1, costUsd: 0 });
    const p = useAiReview.getState().run("w1", "DIFF");
    expect(useAiReview.getState().reviewFor("w1").status).toBe("running");
    await p;
    const r = useAiReview.getState().reviewFor("w1");
    expect(r.status).toBe("done");
    expect(r.result?.findings).toHaveLength(1);
    expect(r.diffHash).toBe(diffHash("DIFF"));
  });
  it("run sets error on ipc failure", async () => {
    (ipc.aiComplete as any).mockRejectedValue(new Error("no key"));
    await useAiReview.getState().run("w1", "DIFF");
    const r = useAiReview.getState().reviewFor("w1");
    expect(r.status).toBe("error");
    expect(r.error).toContain("no key");
  });
  it("diffHash changes with the diff (freshness)", () => {
    expect(diffHash("a")).not.toBe(diffHash("b"));
  });
});
