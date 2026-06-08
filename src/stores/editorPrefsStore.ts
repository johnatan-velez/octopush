import { create } from "zustand";
import { persist } from "zustand/middleware";

export const FONT_MIN = 10;
export const FONT_MAX = 22;
export const TAB_WIDTHS = [2, 4, 8] as const;

const clampFont = (n: number) => Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(n)));

export interface EditorPrefs {
  wrap: boolean;
  fontSize: number;
  tabWidth: number;
  lineNumbers: boolean;
}

interface EditorPrefsStore extends EditorPrefs {
  setWrap: (v: boolean) => void;
  toggleWrap: () => void;
  setFontSize: (px: number) => void;
  bumpFontSize: (delta: number) => void;
  setTabWidth: (n: number) => void;
  cycleTabWidth: () => void;
  setLineNumbers: (v: boolean) => void;
  toggleLineNumbers: () => void;
}

export const useEditorPrefs = create<EditorPrefsStore>()(
  persist(
    (set) => ({
      wrap: false,
      fontSize: 13,
      tabWidth: 2,
      lineNumbers: true,

      setWrap: (v) => set({ wrap: v }),
      toggleWrap: () => set((s) => ({ wrap: !s.wrap })),

      setFontSize: (px) => set({ fontSize: clampFont(px) }),
      bumpFontSize: (delta) => set((s) => ({ fontSize: clampFont(s.fontSize + delta) })),

      setTabWidth: (n) => {
        if ((TAB_WIDTHS as readonly number[]).includes(n)) set({ tabWidth: n });
      },
      cycleTabWidth: () =>
        set((s) => {
          const i = (TAB_WIDTHS as readonly number[]).indexOf(s.tabWidth);
          const next = TAB_WIDTHS[(i + 1) % TAB_WIDTHS.length];
          return { tabWidth: next };
        }),

      setLineNumbers: (v) => set({ lineNumbers: v }),
      toggleLineNumbers: () => set((s) => ({ lineNumbers: !s.lineNumbers })),
    }),
    {
      name: "octo-editor-prefs",
      partialize: (s) => ({
        wrap: s.wrap,
        fontSize: s.fontSize,
        tabWidth: s.tabWidth,
        lineNumbers: s.lineNumbers,
      }),
    },
  ),
);
