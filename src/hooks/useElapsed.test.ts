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

  it("shows correct elapsed immediately when startedAt transitions from null to a value", () => {
    // Start with null (not running)
    let startedAt: string | null = null;
    const { result, rerender } = renderHook(() => useElapsed(startedAt));
    expect(result.current).toBe("");

    // Set startedAt to 30s in the past
    act(() => {
      vi.setSystemTime(new Date("2026-06-09T00:01:00Z")); // advance clock by 50s
      startedAt = "2026-06-09T00:00:30Z"; // 30s ago relative to 00:01:00
    });
    rerender();
    // The reset in useEffect fires synchronously via act, so first paint must be "00:30"
    expect(result.current).toBe("00:30");
  });
});
