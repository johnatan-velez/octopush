import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const PIPE = { pipeline: { id: "p1", name: "Feature Factory", description: "d", isBuiltin: true, createdAt: "t" },
  stages: [
    { id: "s0", pipelineId: "p1", position: 0, role: "plan", agentModel: "m", substrate: "api", checkpoint: false,
      loopTargetPosition: null, loopMaxIterations: 0, loopMode: null },
    { id: "s1", pipelineId: "p1", position: 1, role: "implement", agentModel: "m", substrate: "api", checkpoint: false,
      loopTargetPosition: null, loopMaxIterations: 0, loopMode: null },
  ] };

const storeState = vi.hoisted(() => ({
  pipelines: [] as any[],
  loaded: true,
  load: vi.fn(),
  error: null as string | null,
}));
vi.mock("../stores/pipelineStore", () => ({
  usePipelineStore: (sel: any) => sel(storeState),
}));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => <div /> }));
const estimateMock = vi.hoisted(() => vi.fn());
vi.mock("../lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    ipc: { ...actual.ipc, estimateRunCost: estimateMock },
  };
});

const { PipelineSetup } = await import("./PipelineSetup");

// Fix A: dangling-selectedId recovery — the store mock returns the same shared
// slice, so we cannot cheaply simulate "store reloads without the previously-selected id" in a
// second render. The effect logic is exercised indirectly: the existing tests confirm section III
// renders (auto-select picked pipelines[0]) when `selectedId` starts null, which is the same
// `!exists` branch that now also fires on a dangling id.  Manual test: delete the selected
// pipeline in the app → section III + Begin reappear immediately (was: vanished with no recovery).

beforeEach(() => {
  storeState.pipelines = [PIPE];
  storeState.loaded = true;
  storeState.error = null;
  estimateMock.mockReset();
  estimateMock.mockResolvedValue({ estimateUsd: 0.05, baselineUsd: 0.4 });
});

describe("PipelineSetup begin gate", () => {
  it("disables Begin + shows the helper when a run is executing", () => {
    render(<PipelineSetup defaultTask="build it" onBegin={vi.fn()} executingRun onEditPipeline={vi.fn()} />);
    const begin = screen.getByRole("button", { name: /Begin the run/i });
    expect(begin).toBeDisabled();
    expect(screen.getByText(/A run is in progress/i)).toBeInTheDocument();
  });

  it("enables Begin when no run is executing and a task is set", () => {
    render(<PipelineSetup defaultTask="build it" onBegin={vi.fn()} executingRun={false} onEditPipeline={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Begin the run/i })).not.toBeDisabled();
    expect(screen.queryByText(/A run is in progress/i)).not.toBeInTheDocument();
  });
});

describe("PipelineSetup ceremony & designed states", () => {
  it("renders the ceremony header", () => {
    render(<PipelineSetup defaultTask="" onBegin={vi.fn()} executingRun={false} onEditPipeline={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Direct the work" })).toBeInTheDocument();
    expect(screen.getByText("direct")).toBeInTheDocument(); // DIRECT eyebrow (uppercased by CSS)
  });

  it("shows skeletons while pipelines load, not the error card", () => {
    storeState.loaded = false;
    storeState.pipelines = [];
    const { container } = render(
      <PipelineSetup defaultTask="" onBegin={vi.fn()} executingRun={false} onEditPipeline={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(container.querySelectorAll(".h-24").length).toBe(3); // three skeleton cards
  });

  it("shows 'estimating…' until the estimate arrives", () => {
    estimateMock.mockReturnValue(new Promise(() => {})); // never resolves
    render(<PipelineSetup defaultTask="" onBegin={vi.fn()} executingRun={false} onEditPipeline={vi.fn()} />);
    expect(screen.getByText("estimating…")).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument(); // no zero flash
  });

  it("renders the pipeline mini-map on each card", () => {
    render(<PipelineSetup defaultTask="" onBegin={vi.fn()} executingRun={false} onEditPipeline={vi.fn()} />);
    expect(screen.getByText("I")).toBeInTheDocument();
    expect(screen.getByText("II")).toBeInTheDocument();
    expect(screen.getByText("⟶")).toBeInTheDocument(); // connector between the numerals
  });

  it("leads the estimate with savings", async () => {
    render(<PipelineSetup defaultTask="" onBegin={vi.fn()} executingRun={false} onEditPipeline={vi.fn()} />);
    const saves = (await screen.findAllByText(/saves ~\$0\.35/)).pop()!;
    const spent = screen.getAllByText(/runs at/).pop()!;
    // savings (verdigris serif) leads; the spent figure follows it
    expect(saves.compareDocumentPosition(spent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(saves.className).toContain("text-octo-verdigris");
  });
});
