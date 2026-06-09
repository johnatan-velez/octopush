import { describe, it, expect } from "vitest";
import { formatBytes } from "./formatBytes";

describe("formatBytes", () => {
  it("formats bytes, KB, MB, GB at boundaries", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(412 * 1024 * 1024)).toBe("412 MB");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
  });

  it("renders whole numbers at and above 10 of a unit", () => {
    expect(formatBytes(10 * 1024)).toBe("10 KB");
    expect(formatBytes(15 * 1024)).toBe("15 KB");
  });

  it("handles zero and rejects invalid input", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(NaN)).toBe("—");
    expect(formatBytes(-5)).toBe("—");
  });
});
