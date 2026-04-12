import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { TokenReport } from "../lib/types";

interface TokenState {
  report: TokenReport | null;
  loading: boolean;
  error: string | null;
  /** Currently scoped session (null = global) */
  scopeSessionId: string | null;

  refresh: () => Promise<void>;
  setScope: (sessionId: string | null) => void;
}

const EMPTY_REPORT: TokenReport = {
  totalInput: 0,
  totalOutput: 0,
  totalCached: 0,
  totalCostUsd: 0,
  costBySession: [],
  costByModel: [],
  hourlyTrend: [],
  budgetRemaining: null,
  projectedDailyCost: 0,
};

export const useTokenStore = create<TokenState>((set, get) => ({
  report: null,
  loading: false,
  error: null,
  scopeSessionId: null,

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const report = await ipc.getTokenReport(
        get().scopeSessionId ?? undefined,
      );
      set({ report, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false, report: EMPTY_REPORT });
    }
  },

  setScope: (sessionId) => {
    set({ scopeSessionId: sessionId });
    get().refresh();
  },
}));
