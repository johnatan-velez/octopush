import { describe, it, expect } from "vitest";
import {
  atelierTheme,
  editorThemeSpec,
  buildEditorTheme,
  resolveEditorTokens,
  makeEditorThemeSpec,
} from "./atelierTheme";

describe("atelierTheme", () => {
  it("is a non-empty extension array", () => {
    expect(Array.isArray(atelierTheme)).toBe(true);
    expect((atelierTheme as unknown[]).length).toBeGreaterThanOrEqual(2);
  });

  it("defines panel + search selectors so the find UI is themed", () => {
    const keys = Object.keys(editorThemeSpec);
    expect(keys.some((k) => k.includes(".cm-panels"))).toBe(true);
    expect(keys.some((k) => k.includes(".cm-panel.cm-search"))).toBe(true);
    expect(keys.some((k) => k.includes(".cm-searchMatch"))).toBe(true);
  });

  it("buildEditorTheme returns a fresh extension array from live tokens", () => {
    const ext = buildEditorTheme();
    expect(Array.isArray(ext)).toBe(true);
    expect((ext as unknown[]).length).toBeGreaterThanOrEqual(2);
  });

  it("resolveEditorTokens falls back to the Onyx & Brass palette when no CSS var is set", () => {
    // jsdom has no stylesheet, so getPropertyValue returns "" → fallbacks.
    const t = resolveEditorTokens();
    expect(t.onyx).toBe("#0c0a08");
    expect(t.brass).toBe("#d4a574");
    expect(t.ivory).toBe("#f4ecdb");
  });

  it("makeEditorThemeSpec threads tokens into the editor surface", () => {
    const spec = makeEditorThemeSpec({
      onyx: "#000000",
      panel: "#111111",
      hairline: "#222222",
      brass: "#abcabc",
      ivory: "#ffffff",
      sage: "#999999",
      mute: "#666666",
      rouge: "#ff0000",
      verdigris: "#00ff00",
      brassGhost: "rgba(0,0,0,0.1)",
      brassFaint: "rgba(0,0,0,0.05)",
      brassGlow: "rgba(0,0,0,0.2)",
    });
    expect(spec["&"].backgroundColor).toBe("#000000");
    expect(spec[".cm-content"].caretColor).toBe("#abcabc");
  });
});
