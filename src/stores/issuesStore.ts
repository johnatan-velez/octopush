import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { Issue } from "../lib/types";

interface IssuesState {
  issues: Issue[] | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;

  /** Detailed view of individual tickets (with `blocks`, `blockedBy`,
   *  `subtasks` populated by getIssue). Shared between ContextHeader and
   *  WorkContextPanel so a workspace switch fires one getIssue, not two.
   *  list_my_issues does NOT populate these fields, so this cache is the
   *  only place to read them from. */
  detailByKey: Record<string, Issue>;
  detailLoadingByKey: Record<string, boolean>;
  loadDetail: (key: string) => Promise<void>;

  /** Open backlog of each epic, fetched lazily when the WorkContext "Epic"
   *  pill is opened. Keyed by epic key (e.g., "CLPNSNS-220"). Survives
   *  pill switches inside the same workspace so re-opening Epic is instant. */
  epicIssuesByKey: Record<string, Issue[]>;
  epicLoadingByKey: Record<string, boolean>;
  loadEpic: (epicKey: string) => Promise<void>;
}

export const useIssuesStore = create<IssuesState>((set, get) => ({
  issues: null,
  loading: false,
  error: null,
  load: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const issues = await ipc.listMyIssues();
      set({ issues, loading: false });
    } catch (e) {
      // Keep the last good list; surface the error quietly.
      set({ loading: false, error: String(e) });
    }
  },

  detailByKey: {},
  detailLoadingByKey: {},
  loadDetail: async (key) => {
    if (!key) return;
    if (get().detailLoadingByKey[key]) return;
    set((s) => ({ detailLoadingByKey: { ...s.detailLoadingByKey, [key]: true } }));
    try {
      const issue = await ipc.getIssue(key);
      set((s) => ({
        detailByKey: { ...s.detailByKey, [key]: issue },
        detailLoadingByKey: { ...s.detailLoadingByKey, [key]: false },
      }));
    } catch {
      set((s) => ({ detailLoadingByKey: { ...s.detailLoadingByKey, [key]: false } }));
    }
  },

  epicIssuesByKey: {},
  epicLoadingByKey: {},
  loadEpic: async (epicKey) => {
    if (!epicKey) return;
    if (get().epicLoadingByKey[epicKey]) return;
    set((s) => ({ epicLoadingByKey: { ...s.epicLoadingByKey, [epicKey]: true } }));
    try {
      const list = await ipc.listIssuesInEpic(epicKey);
      set((s) => ({
        epicIssuesByKey: { ...s.epicIssuesByKey, [epicKey]: list },
        epicLoadingByKey: { ...s.epicLoadingByKey, [epicKey]: false },
      }));
    } catch {
      set((s) => ({ epicLoadingByKey: { ...s.epicLoadingByKey, [epicKey]: false } }));
    }
  },
}));
