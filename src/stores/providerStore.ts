import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { ProviderConfig } from "../lib/types";

interface ProviderState {
  providers: ProviderConfig[];
  /** True while the first fetch is in flight (prevents empty-flash on boot). */
  loading: boolean;
  refresh: () => Promise<void>;
}

export const useProviderStore = create<ProviderState>((set) => ({
  providers: [],
  loading: true,
  refresh: async () => {
    try {
      const providers = await ipc.listProviders();
      set({ providers, loading: false });
    } catch {
      set({ loading: false });
    }
  },
}));
