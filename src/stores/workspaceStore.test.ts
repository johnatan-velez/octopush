/**
 * Tests for workspaceStore.
 *
 * Invariants under test:
 * 1. remove() drops the workspace from BOTH the flat `workspaces` list AND the
 *    per-project `workspacesByProjectId` map (the rail reads the latter, so a
 *    stale entry there keeps a deleted workspace visible — the reported bug).
 * 2. load() activates the remembered workspace for a project when present,
 *    falling back to the first. This is the mechanism cross-project selection
 *    relies on (see rememberActiveForProject + App.handleSelectWorkspace).
 * 3. rememberActiveForProject() records + persists the per-project selection.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Workspace } from "../lib/types";

let nextId = 0;
function makeWorkspace(projectId: string, name: string): Workspace {
  return {
    id: `ws-${++nextId}`,
    projectId,
    name,
    task: "",
    branch: `feat/${name}`,
    worktreePath: `/repo/${name}`,
    setupScript: "",
    status: "active",
    createdAt: "",
    lastActive: "",
    glyph: null,
    tint: null,
    linkedIssueKey: null,
    issueLinkDismissed: false,
  };
}

const mockIpc = {
  listWorkspaces: vi.fn<(projectId: string) => Promise<Workspace[]>>(),
  deleteWorkspace:
    vi.fn<
      (
        workspaceId: string,
        projectPath: string,
        branch: string,
        worktreePath: string | null,
      ) => Promise<void>
    >(),
  createWorkspace: vi.fn(),
  updateWorkspaceCustomization: vi.fn(),
};

vi.mock("../lib/ipc", () => ({ ipc: mockIpc }));

const { useWorkspaceStore } = await import("./workspaceStore");

function resetStore() {
  useWorkspaceStore.setState({
    workspaces: [],
    activeId: null,
    loading: false,
    notifications: {},
    lastActiveByProject: {},
    workspacesByProjectId: {},
  });
  nextId = 0;
  vi.clearAllMocks();
  try {
    localStorage.clear();
  } catch {
    /* jsdom always has localStorage */
  }
}

describe("workspaceStore — remove", () => {
  beforeEach(() => resetStore());

  it("removes the workspace from BOTH workspaces and workspacesByProjectId", async () => {
    const a = makeWorkspace("proj-1", "alpha");
    const b = makeWorkspace("proj-1", "beta");
    useWorkspaceStore.setState({
      workspaces: [a, b],
      activeId: a.id,
      workspacesByProjectId: { "proj-1": [a, b] },
    });
    mockIpc.deleteWorkspace.mockResolvedValueOnce(undefined);

    await useWorkspaceStore
      .getState()
      .remove(a.id, "/repo", a.branch, a.worktreePath);

    const s = useWorkspaceStore.getState();
    // Flat list updated.
    expect(s.workspaces.map((w) => w.id)).toEqual([b.id]);
    // Per-project map updated — this is what the rail renders.
    expect(s.workspacesByProjectId["proj-1"].map((w) => w.id)).toEqual([b.id]);
    // Active cleared because the removed workspace was active.
    expect(s.activeId).toBeNull();
  });

  it("removes a workspace that lives in a non-active project's group", async () => {
    const a = makeWorkspace("proj-1", "alpha");
    const b = makeWorkspace("proj-2", "beta");
    useWorkspaceStore.setState({
      workspaces: [a],
      activeId: a.id,
      workspacesByProjectId: { "proj-1": [a], "proj-2": [b] },
    });
    mockIpc.deleteWorkspace.mockResolvedValueOnce(undefined);

    await useWorkspaceStore
      .getState()
      .remove(b.id, "/repo2", b.branch, b.worktreePath);

    const s = useWorkspaceStore.getState();
    expect(s.workspacesByProjectId["proj-2"]).toEqual([]);
    expect(s.workspacesByProjectId["proj-1"].map((w) => w.id)).toEqual([a.id]);
    // Active untouched — we deleted a different project's workspace.
    expect(s.activeId).toBe(a.id);
  });
});

describe("workspaceStore — load activation", () => {
  beforeEach(() => resetStore());

  it("activates the remembered workspace for the project when present", async () => {
    const a = makeWorkspace("proj-1", "alpha");
    const b = makeWorkspace("proj-1", "beta");
    mockIpc.listWorkspaces.mockResolvedValueOnce([a, b]);
    useWorkspaceStore.setState({ lastActiveByProject: { "proj-1": b.id } });

    await useWorkspaceStore.getState().load("proj-1");

    expect(useWorkspaceStore.getState().activeId).toBe(b.id);
  });

  it("falls back to the first workspace when nothing is remembered", async () => {
    const a = makeWorkspace("proj-1", "alpha");
    const b = makeWorkspace("proj-1", "beta");
    mockIpc.listWorkspaces.mockResolvedValueOnce([a, b]);

    await useWorkspaceStore.getState().load("proj-1");

    expect(useWorkspaceStore.getState().activeId).toBe(a.id);
  });
});

describe("workspaceStore — create", () => {
  beforeEach(() => resetStore());

  it("appends the new workspace to the end and makes it active", async () => {
    const existing = makeWorkspace("proj-1", "alpha");
    useWorkspaceStore.setState({
      workspaces: [existing],
      workspacesByProjectId: { "proj-1": [existing] },
    });
    const created = makeWorkspace("proj-1", "beta");
    mockIpc.createWorkspace.mockResolvedValueOnce(created);

    await useWorkspaceStore
      .getState()
      .create("proj-1", "/repo", "beta", "", created.branch, "main", "");

    const s = useWorkspaceStore.getState();
    // New workspace is LAST, not first.
    expect(s.workspaces.map((w) => w.id)).toEqual([existing.id, created.id]);
    expect(s.workspacesByProjectId["proj-1"].map((w) => w.id)).toEqual([
      existing.id,
      created.id,
    ]);
    // ...but it becomes the active workspace.
    expect(s.activeId).toBe(created.id);
  });
});

describe("workspaceStore — rememberActiveForProject", () => {
  beforeEach(() => resetStore());

  it("records and persists the per-project selection", () => {
    useWorkspaceStore.getState().rememberActiveForProject("proj-9", "ws-42");

    expect(useWorkspaceStore.getState().lastActiveByProject["proj-9"]).toBe(
      "ws-42",
    );
    const persisted = JSON.parse(
      localStorage.getItem("lastActiveWorkspacePerProject") || "{}",
    );
    expect(persisted["proj-9"]).toBe("ws-42");
  });
});

describe("workspaceStore — updateCustomization", () => {
  beforeEach(() => {
    resetStore();
    const a = makeWorkspace("p1", "alpha");
    useWorkspaceStore.setState({
      workspaces: [a],
      workspacesByProjectId: { p1: [a] },
      activeId: a.id,
    });
  });

  it("updates the rail map (workspacesByProjectId), not just workspaces", async () => {
    mockIpc.updateWorkspaceCustomization.mockResolvedValueOnce(undefined);
    const wsId = useWorkspaceStore.getState().workspaces[0].id;

    await useWorkspaceStore
      .getState()
      .updateCustomization(wsId, "★", "verdigris");

    const fromMap = useWorkspaceStore.getState().workspacesByProjectId.p1[0];
    expect(fromMap.glyph).toBe("★");
    expect(fromMap.tint).toBe("verdigris");
  });
});
