import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useElapsed } from "./useElapsed";

describe("useElapsed", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-06-09T00:00:10Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("returns '' when not started", () => {
    const { result } = renderHook(() => useElapsed(null));
    expect(result.current).toBe("");
  });

  it("formats mm:ss elapsed since startedAt and ticks", () => {
    // started 10s ago
    const { result } = renderHook(() => useElapsed("2026-06-09T00:00:00Z"));
    expect(result.current).toBe("00:10");
    act(() => { vi.advanceTimersByTime(55_000); }); // +55s -> 65s -> 01:05
    expect(result.current).toBe("01:05");
  });

  it("returns '' for an unparseable timestamp", () => {
    const { result } = renderHook(() => useElapsed("not-a-date"));
    expect(result.current).toBe("");
  });
});
