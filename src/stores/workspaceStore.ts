import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { Workspace } from "../lib/types";

interface WorkspaceState {
  workspaces: Workspace[];
  activeId: string | null;
  loading: boolean;
  notifications: Record<string, number>;
  /**
   * Remembers the last workspace selected per project, so that switching
   * back to a project restores the previously viewed workspace instead of
   * jumping to the first one in the list.
   */
  lastActiveByProject: Record<string, string>;

  load: (projectId: string) => Promise<void>;
  create: (projectId: string, projectPath: string, name: string, task: string,
           branch: string, fromBranch: string, setupScript: string) => Promise<Workspace>;
  select: (id: string | null) => void;
  remove: (workspaceId: string, projectPath: string, branch: string, worktreePath: string | null) => Promise<void>;
  updateCustomization: (workspaceId: string, glyph: string | null, tint: string | null) => Promise<void>;
  notify: (workspaceId: string) => void;
  clearNotification: (workspaceId: string) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  activeId: null,
  loading: false,
  notifications: {},
  lastActiveByProject: {},

  load: async (projectId) => {
    set({ loading: true });
    const workspaces = await ipc.listWorkspaces(projectId);
    // Atomic update: pick the activeId in the same set() call so React never
    // sees a frame with `workspaces.find(activeId) === undefined`, which
    // would briefly flip activeWorkspace to null and unmount all the
    // TerminalPanes (killing their PTYs). Prefer the last-active for this
    // project, fall back to the first workspace.
    const remembered = get().lastActiveByProject[projectId];
    const exists = remembered && workspaces.some((w) => w.id === remembered);
    const nextActive = exists
      ? remembered
      : workspaces.length > 0
        ? workspaces[0].id
        : null;
    set({ workspaces, loading: false, activeId: nextActive });
  },

  create: async (projectId, projectPath, name, task, branch, fromBranch, setupScript) => {
    const ws = await ipc.createWorkspace(projectId, projectPath, name, task, branch, fromBranch, setupScript);
    set((s) => ({
      workspaces: [ws, ...s.workspaces],
      activeId: ws.id,
      lastActiveByProject: { ...s.lastActiveByProject, [projectId]: ws.id },
    }));
    return ws;
  },

  select: (id) =>
    set((s) => {
      const next: Partial<WorkspaceState> = { activeId: id };
      if (id !== null) {
        // Persist the selection per-project so re-entering a project
        // restores the workspace the user was last viewing.
        const ws = s.workspaces.find((w) => w.id === id);
        if (ws) {
          next.lastActiveByProject = {
            ...s.lastActiveByProject,
            [ws.projectId]: id,
          };
        }
      }
      return next as WorkspaceState;
    }),

  remove: async (workspaceId, projectPath, branch, worktreePath) => {
    await ipc.deleteWorkspace(workspaceId, projectPath, branch, worktreePath);
    set((s) => ({
      workspaces: s.workspaces.filter((w) => w.id !== workspaceId),
      activeId: s.activeId === workspaceId ? null : s.activeId,
    }));
  },

  updateCustomization: async (workspaceId, glyph, tint) => {
    await ipc.updateWorkspaceCustomization(workspaceId, glyph, tint as any);
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === workspaceId
          ? { ...w, glyph: (glyph as any), tint: (tint as any) }
          : w,
      ),
    }));
  },

  notify: (workspaceId) =>
    set((s) => ({
      notifications: {
        ...s.notifications,
        [workspaceId]: (s.notifications[workspaceId] ?? 0) + 1,
      },
    })),

  clearNotification: (workspaceId) =>
    set((s) => ({
      notifications: { ...s.notifications, [workspaceId]: 0 },
    })),
}));
