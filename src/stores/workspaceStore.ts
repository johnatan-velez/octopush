import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { Workspace } from "../lib/types";

interface WorkspaceState {
  workspaces: Workspace[];
  activeId: string | null;
  loading: boolean;

  load: (projectId: string) => Promise<void>;
  create: (projectId: string, projectPath: string, name: string, task: string,
           branch: string, fromBranch: string, setupScript: string) => Promise<Workspace>;
  select: (id: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  activeId: null,
  loading: false,

  load: async (projectId) => {
    set({ loading: true });
    const workspaces = await ipc.listWorkspaces(projectId);
    set({ workspaces, loading: false });
    if (!get().activeId && workspaces.length > 0) {
      set({ activeId: workspaces[0].id });
    }
  },

  create: async (projectId, projectPath, name, task, branch, fromBranch, setupScript) => {
    const ws = await ipc.createWorkspace(projectId, projectPath, name, task, branch, fromBranch, setupScript);
    set((s) => ({
      workspaces: [ws, ...s.workspaces],
      activeId: ws.id,
    }));
    return ws;
  },

  select: (id) => set({ activeId: id }),
}));
