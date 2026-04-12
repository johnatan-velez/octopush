import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSessionStore } from "./sessionStore";
import type { Session } from "../lib/types";

// Mock the IPC layer so tests don't need a Tauri runtime.
vi.mock("../lib/ipc", () => ({
  ipc: {
    listSessions: vi.fn(async () => []),
    createSession: vi.fn(async (args: { name: string }) => mockSession(args.name)),
    killSession: vi.fn(async () => {}),
    deleteSession: vi.fn(async () => {}),
  },
}));

function mockSession(name: string): Session {
  return {
    id: `id-${name}`,
    name,
    color: "#a78bfa",
    icon: "🐙",
    projectRoot: "/tmp",
    agent: {
      provider: { type: "anthropic" },
      model: "claude-opus-4-6",
      temperature: 1.0,
      maxTokens: 8192,
      systemPromptOverride: null,
    },
    tokenBudget: null,
    tokensUsed: 0,
    tokensInput: 0,
    tokensOutput: 0,
    status: "active",
    contextFiles: [],
    tags: [],
    createdAt: new Date().toISOString(),
    lastActive: new Date().toISOString(),
  };
}

describe("sessionStore", () => {
  beforeEach(() => {
    // Reset zustand state between tests.
    useSessionStore.setState({
      sessions: [],
      activeId: null,
      loading: false,
      error: null,
    });
  });

  it("starts empty", () => {
    const { sessions, activeId } = useSessionStore.getState();
    expect(sessions).toEqual([]);
    expect(activeId).toBeNull();
  });

  it("create adds session and selects it", async () => {
    const session = await useSessionStore.getState().create({
      name: "test",
      projectRoot: "/tmp",
    });
    const { sessions, activeId } = useSessionStore.getState();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].name).toBe("test");
    expect(activeId).toBe(session.id);
  });

  it("select changes activeId", async () => {
    await useSessionStore.getState().create({ name: "a", projectRoot: "/tmp" });
    await useSessionStore.getState().create({ name: "b", projectRoot: "/tmp" });
    useSessionStore.getState().select("id-a");
    expect(useSessionStore.getState().activeId).toBe("id-a");
  });

  it("remove deletes session and clears activeId if active", async () => {
    await useSessionStore.getState().create({ name: "doomed", projectRoot: "/tmp" });
    expect(useSessionStore.getState().activeId).toBe("id-doomed");
    await useSessionStore.getState().remove("id-doomed");
    expect(useSessionStore.getState().sessions).toHaveLength(0);
    expect(useSessionStore.getState().activeId).toBeNull();
  });
});
