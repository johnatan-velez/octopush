import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { ThemeConfig } from "../lib/types";

interface ThemeState {
  theme: ThemeConfig | null;
  themes: ThemeConfig[];
  loading: boolean;

  load: () => Promise<void>;
  apply: (theme: ThemeConfig) => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: null,
  themes: [],
  loading: false,

  load: async () => {
    set({ loading: true });
    try {
      const [theme, themes] = await Promise.all([
        ipc.getTheme(),
        ipc.listThemes(),
      ]);
      set({ theme, themes, loading: false });
      applyThemeToDom(theme);
    } catch {
      set({ loading: false });
    }
  },

  apply: async (theme) => {
    set({ theme });
    applyThemeToDom(theme);
    await ipc.setTheme(theme);
  },
}));

function applyThemeToDom(t: ThemeConfig) {
  const root = document.documentElement;
  root.style.setProperty("--color-octo-bg", t.bg);
  root.style.setProperty("--color-octo-panel", t.panel);
  root.style.setProperty("--color-octo-border", t.border);
  root.style.setProperty("--color-octo-accent", t.accent);
  root.style.setProperty("--color-octo-accent-dim", t.accentDim);
  root.style.setProperty("--color-octo-success", t.success);
  root.style.setProperty("--color-octo-warning", t.warning);
  root.style.setProperty("--color-octo-danger", t.danger);
  // Update body bg to match.
  document.body.style.backgroundColor = t.bg;
}
