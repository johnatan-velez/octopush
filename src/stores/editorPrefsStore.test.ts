import { describe, it, expect, beforeEach } from "vitest";
import { useEditorPrefs, FONT_MIN, FONT_MAX, TAB_WIDTHS } from "./editorPrefsStore";

function reset() {
  useEditorPrefs.setState({ wrap: false, fontSize: 13, tabWidth: 2, lineNumbers: true });
}

describe("editorPrefsStore", () => {
  beforeEach(reset);

  it("has sensible defaults", () => {
    const s = useEditorPrefs.getState();
    expect(s.wrap).toBe(false);
    expect(s.fontSize).toBe(13);
    expect(s.tabWidth).toBe(2);
    expect(s.lineNumbers).toBe(true);
  });

  it("toggleWrap flips wrap", () => {
    useEditorPrefs.getState().toggleWrap();
    expect(useEditorPrefs.getState().wrap).toBe(true);
    useEditorPrefs.getState().toggleWrap();
    expect(useEditorPrefs.getState().wrap).toBe(false);
  });

  it("toggleLineNumbers flips lineNumbers", () => {
    useEditorPrefs.getState().toggleLineNumbers();
    expect(useEditorPrefs.getState().lineNumbers).toBe(false);
  });

  it("bumpFontSize clamps to [FONT_MIN, FONT_MAX]", () => {
    useEditorPrefs.setState({ fontSize: FONT_MAX });
    useEditorPrefs.getState().bumpFontSize(5);
    expect(useEditorPrefs.getState().fontSize).toBe(FONT_MAX);
    useEditorPrefs.setState({ fontSize: FONT_MIN });
    useEditorPrefs.getState().bumpFontSize(-5);
    expect(useEditorPrefs.getState().fontSize).toBe(FONT_MIN);
    useEditorPrefs.setState({ fontSize: 13 });
    useEditorPrefs.getState().bumpFontSize(1);
    expect(useEditorPrefs.getState().fontSize).toBe(14);
  });

  it("setFontSize clamps out-of-range values", () => {
    useEditorPrefs.getState().setFontSize(999);
    expect(useEditorPrefs.getState().fontSize).toBe(FONT_MAX);
    useEditorPrefs.getState().setFontSize(1);
    expect(useEditorPrefs.getState().fontSize).toBe(FONT_MIN);
  });

  it("setTabWidth ignores values not in TAB_WIDTHS", () => {
    useEditorPrefs.getState().setTabWidth(4);
    expect(useEditorPrefs.getState().tabWidth).toBe(4);
    useEditorPrefs.getState().setTabWidth(3 as unknown as number);
    expect(useEditorPrefs.getState().tabWidth).toBe(4);
  });

  it("cycleTabWidth walks 2 → 4 → 8 → 2", () => {
    useEditorPrefs.setState({ tabWidth: 2 });
    useEditorPrefs.getState().cycleTabWidth();
    expect(useEditorPrefs.getState().tabWidth).toBe(4);
    useEditorPrefs.getState().cycleTabWidth();
    expect(useEditorPrefs.getState().tabWidth).toBe(8);
    useEditorPrefs.getState().cycleTabWidth();
    expect(useEditorPrefs.getState().tabWidth).toBe(2);
  });

  it("TAB_WIDTHS is [2,4,8]", () => {
    expect(TAB_WIDTHS).toEqual([2, 4, 8]);
  });
});
