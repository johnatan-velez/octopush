import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));

vi.mock("../lib/ipc", async () => {
  const actual = await vi.importActual<any>("../lib/ipc");
  return {
    ...actual,
    ipc: {
      ...actual.ipc,
      getGitDiff: vi.fn().mockResolvedValue(""),
    },
  };
});

const { StageFocus } = await import("./StageFocus");
const { useRunsStore } = await import("../stores/runsStore");

const baseStage = {
  id: "st1", runId: "r1", position: 0, role: "code_review", agentModel: "haiku",
  substrate: "api", checkpoint: false, status: "running", inputTokens: 0, outputTokens: 0,
  costUsd: 0, artifact: null, feedback: null, error: null, startedAt: null, finishedAt: null,
  loopTargetPosition: null, loopMaxIterations: 0, loopMode: null, loopIterations: 0,
} as any;

describe("StageFocus live journal", () => {
  beforeEach(() => { useRunsStore.setState({ liveByStage: {} }); });

  it("renders text as prose and a tool+result as one § card", () => {
    useRunsStore.setState({ liveByStage: { st1: [
      { kind: "text", text: "Inspecting the changes." },
      { kind: "tool", tool: "Read", hint: "src/auth.rs" },
      { kind: "tool_result", ok: true, detail: "142 lines" },
    ] } });
    render(<StageFocus stage={baseStage} workspacePath="/tmp" />);
    expect(screen.getByText("Inspecting the changes.")).toBeInTheDocument();
    expect(screen.getByText("Read")).toBeInTheDocument();          // tool name
    expect(screen.getByText("src/auth.rs")).toBeInTheDocument();   // hint
    expect(screen.getByText(/142 lines/)).toBeInTheDocument();     // result detail
    expect(screen.getByText(/working/)).toBeInTheDocument();       // running pulse
  });

  it("shows the empty 'working…' state when there are no entries yet", () => {
    render(<StageFocus stage={baseStage} workspacePath="/tmp" />);
    expect(screen.getByText(/working/)).toBeInTheDocument();
  });
});
