import { describe, it, expect, vi, beforeEach } from "vitest";
import { useTokenStore } from "./tokenStore";
import type { TokenReport } from "../lib/types";

const mockReport: TokenReport = {
  totalInput: 5000,
  totalOutput: 2000,
  totalCached: 1000,
  totalCostUsd: 0.42,
  costBySession: [{ label: "test", costUsd: 0.42, tokens: 7000 }],
  costByModel: [{ label: "claude-opus-4-6", costUsd: 0.42, tokens: 7000 }],
  hourlyTrend: [],
  budgetRemaining: null,
  projectedDailyCost: 10.08,
};

vi.mock("../lib/ipc", () => ({
  ipc: {
    getTokenReport: vi.fn(async () => mockReport),
  },
}));

describe("tokenStore", () => {
  beforeEach(() => {
    useTokenStore.setState({
      report: null,
      loading: false,
      error: null,
      scopeSessionId: null,
    });
  });

  it("starts with null report", () => {
    expect(useTokenStore.getState().report).toBeNull();
  });

  it("refresh loads the report", async () => {
    await useTokenStore.getState().refresh();
    const { report, loading } = useTokenStore.getState();
    expect(loading).toBe(false);
    expect(report).toBeDefined();
    expect(report!.totalInput).toBe(5000);
    expect(report!.totalCostUsd).toBeCloseTo(0.42);
  });

  it("setScope updates scopeSessionId and refreshes", async () => {
    await useTokenStore.getState().setScope("sess-1");
    expect(useTokenStore.getState().scopeSessionId).toBe("sess-1");
    expect(useTokenStore.getState().report).toBeDefined();
  });
});
