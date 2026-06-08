# Direct Mode — UI Shell (Plan 2a / Phase B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Direct mode (4th workspace mode) end-to-end on the already-merged backend engine: choose a pipeline template, enter a task, begin a run, watch the assembly-line track update live, resolve checkpoints (approve / reject / edit / abort), and see runs in the Companion — all with the API substrate.

**Architecture:** Two new Zustand stores (`pipelineStore`, `runsStore`) mirror the established `chatStore` pattern (selectors with stable empty defaults + a one-time Tauri `listen()` subscription that reduces `run://` events into state). A new `DirectCanvas` renders either the **setup state** (`PipelineSetup`) when there is no active run, or the **run state** (`RunTrack` header + `StageFocus` detail pane + `CheckpointBar`). The Companion gains a `CompanionRuns` section for `mode === "direct"`. `App.tsx` adds the mode to its render switch and keyboard shortcuts. No backend changes.

**Tech Stack:** React 19 + TypeScript, Zustand, Tailwind v4 (Atelier "Onyx & Brass" tokens), `@tauri-apps/api` events, Vitest. IPC via the existing `ipc` object and `RUN_EVENTS` in `src/lib/ipc.ts` (already merged).

**Scope note:** Plan 2a of the Direct-mode spec `docs/superpowers/specs/2026-06-07-direct-mode-agent-orchestration-design.md`. Plan 2b = CLI substrate (backend). Plan 2c = cost panel, native-surface embedding in the focus pane, motion polish, and the canonical design-spec update. The focus pane in 2a shows a **stage-detail view** (artifact text + tool-call log + status), NOT the fully-embedded Talk/Run/Review surfaces — that embedding is Plan 2c.

**Design rules (enforce in every component):** tokens only (`text-octo-brass`, `bg-octo-panel`, `border-octo-hairline`, `text-octo-sage`, `text-octo-mute`, `text-octo-ivory`) — no hex; **no italics** (no `italic` class); English UI copy only; CTAs as serif phrases (`font-serif`, e.g. `"Begin the run ⟶"`); signature glyphs `⟶` and `§` and roman numerals in brass; reuse motion classes (`.octo-fade-in`, `.octo-rise-in`, `.octo-pop-in`) and `<ModalShell>` for any dialog; never introduce new top-level chrome (Direct reuses the ModeSwitcher).

---

## File Structure

**New:**
- `src/stores/pipelineStore.ts` (+ `pipelineStore.test.ts`) — loads the pipeline catalog (templates) once.
- `src/stores/runsStore.ts` (+ `runsStore.test.ts`) — runs per workspace, the active run + its stages, live cost; reduces `run://` events.
- `src/components/RunTrack.tsx` — the horizontal assembly-line header (stages, substrate pills, per-stage cost, gates, run totals).
- `src/components/StageFocus.tsx` — the focus pane: selected stage's artifact text + tool-call log + status.
- `src/components/CheckpointBar.tsx` — the four checkpoint actions when a run is paused.
- `src/components/PipelineSetup.tsx` — setup/empty state: task field + template picker + per-stage team + estimate + begin CTA.
- `src/components/CompanionRuns.tsx` — Companion section: runs list + "Begin a new run" CTA.
- `src/components/DirectCanvas.tsx` — composes setup vs run state.

**Modified:**
- `src/lib/modes.ts` — add `"direct"`.
- `src/App.tsx` — render `DirectCanvas` overlay for `activeMode === "direct"`; add `⌘⇧D` shortcut; pass the direct branch to Companion.
- `src/components/Companion.tsx` — render `CompanionRuns` for `mode === "direct"`.

---

## Task 1: Register the Direct mode

**Files:**
- Modify: `src/lib/modes.ts`
- Modify: `src/App.tsx` (keyboard shortcut)

- [ ] **Step 1: Add the mode to modes.ts**

Replace the contents of `src/lib/modes.ts` with:

```typescript
export type WorkspaceMode = "talk" | "run" | "review" | "direct";

export const MODES: WorkspaceMode[] = ["run", "talk", "review", "direct"];

export const MODE_LABELS: Record<WorkspaceMode, string> = {
  talk: "Talk",
  run: "Run",
  review: "Review",
  direct: "Direct",
};

export const MODE_SHORTCUTS: Record<WorkspaceMode, string> = {
  talk: "⌘⇧1",
  run: "⌘⇧2",
  review: "⌘⇧3",
  direct: "⌘⇧D",
};
```

- [ ] **Step 2: Add the ⌘⇧D shortcut in App.tsx**

In `src/App.tsx`, find the keyboard handler around lines 680–689 that matches `["1","2","3","!","@","#"]` and maps to `setMode("talk"/"run"/"review")`. Add a `Direct` shortcut. Locate the block (it uses `e.metaKey || e.ctrlKey` + `e.shiftKey`). Add, alongside the existing key checks:

```typescript
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        setMode("direct");
        return;
      }
```

Place it next to the existing `1/2/3` mode shortcuts (so it shares the same guard scope). The `⌘⇧4` key is intentionally not used (macOS screenshot collision).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck 2>&1 | tail -5`
Expected: no errors. (`MODE_LABELS`/`MODE_SHORTCUTS` are `Record<WorkspaceMode, …>` so the compiler now requires the `direct` entries — already added. The `ModeSwitcher` iterates `MODES`, so a 4th button renders automatically.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/modes.ts src/App.tsx
git commit -m "feat(direct): register Direct as the 4th workspace mode"
```

---

## Task 2: pipelineStore (template catalog)

**Files:**
- Create: `src/stores/pipelineStore.ts`
- Test: `src/stores/pipelineStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/stores/pipelineStore.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/ipc", () => ({
  ipc: {
    listPipelines: vi.fn(),
  },
}));

import { ipc } from "../lib/ipc";
import { usePipelineStore } from "./pipelineStore";

const SAMPLE = [
  {
    pipeline: { id: "p1", name: "Feature Factory", description: "d", isBuiltin: true, createdAt: "t" },
    stages: [
      { id: "s1", pipelineId: "p1", position: 0, role: "plan", agentModel: "m", substrate: "api", checkpoint: false },
    ],
  },
];

describe("pipelineStore", () => {
  beforeEach(() => {
    usePipelineStore.setState({ pipelines: [], loaded: false });
    vi.clearAllMocks();
  });

  it("loads pipelines from ipc and marks loaded", async () => {
    (ipc.listPipelines as any).mockResolvedValue(SAMPLE);
    await usePipelineStore.getState().load();
    expect(usePipelineStore.getState().pipelines).toHaveLength(1);
    expect(usePipelineStore.getState().pipelines[0].pipeline.name).toBe("Feature Factory");
    expect(usePipelineStore.getState().loaded).toBe(true);
  });

  it("getById returns the matching pipeline or undefined", async () => {
    (ipc.listPipelines as any).mockResolvedValue(SAMPLE);
    await usePipelineStore.getState().load();
    expect(usePipelineStore.getState().getById("p1")?.pipeline.name).toBe("Feature Factory");
    expect(usePipelineStore.getState().getById("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- pipelineStore 2>&1 | tail -15`
Expected: FAIL — `./pipelineStore` not found.

- [ ] **Step 3: Implement the store**

Create `src/stores/pipelineStore.ts`:

```typescript
import { create } from "zustand";
import { ipc, type PipelineWithStages } from "../lib/ipc";

interface PipelineState {
  pipelines: PipelineWithStages[];
  loaded: boolean;
  load: () => Promise<void>;
  getById: (pipelineId: string) => PipelineWithStages | undefined;
}

export const usePipelineStore = create<PipelineState>((set, get) => ({
  pipelines: [],
  loaded: false,
  load: async () => {
    try {
      const pipelines = await ipc.listPipelines();
      set({ pipelines, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  getById: (pipelineId) =>
    get().pipelines.find((p) => p.pipeline.id === pipelineId),
}));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- pipelineStore 2>&1 | tail -10`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stores/pipelineStore.ts src/stores/pipelineStore.test.ts
git commit -m "feat(direct): pipelineStore (template catalog)"
```

---

## Task 3: runsStore (runs + live run:// reduction)

**Files:**
- Create: `src/stores/runsStore.ts`
- Test: `src/stores/runsStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/stores/runsStore.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/ipc", async () => {
  const actual = await vi.importActual<any>("../lib/ipc");
  return {
    ...actual,
    ipc: {
      listRuns: vi.fn(),
      getRun: vi.fn(),
      createRun: vi.fn(),
      startRun: vi.fn(),
      resolveCheckpoint: vi.fn(),
      abortRun: vi.fn(),
    },
  };
});

import { ipc } from "../lib/ipc";
import { useRunsStore, EMPTY_RUNS } from "./runsStore";

const RUN = {
  id: "r1", workspaceId: "w1", pipelineId: "p1", task: "t", status: "running",
  costUsd: 0.05, baselineUsd: 0.2, referenceModel: "m", linkedIssueKey: null,
  createdAt: "t", finishedAt: null,
};
const STAGE = {
  id: "st1", runId: "r1", position: 0, role: "plan", agentModel: "m", substrate: "api",
  checkpoint: false, status: "running", inputTokens: 0, outputTokens: 0, costUsd: 0,
  artifact: null, feedback: null, error: null, startedAt: null, finishedAt: null,
};

describe("runsStore", () => {
  beforeEach(() => {
    useRunsStore.setState({
      runsByWs: {}, activeRunIdByWs: {}, detailByRun: {}, selectedStageByRun: {},
    });
    vi.clearAllMocks();
  });

  it("getRuns returns the stable empty default for an unknown workspace", () => {
    expect(useRunsStore.getState().getRuns("nope")).toBe(EMPTY_RUNS);
  });

  it("loadRuns populates runs and picks the active (non-terminal) run", async () => {
    (ipc.listRuns as any).mockResolvedValue([RUN]);
    (ipc.getRun as any).mockResolvedValue({ run: RUN, stages: [STAGE] });
    await useRunsStore.getState().loadRuns("w1");
    expect(useRunsStore.getState().getRuns("w1")).toHaveLength(1);
    expect(useRunsStore.getState().getActiveRunId("w1")).toBe("r1");
    expect(useRunsStore.getState().getDetail("r1")?.stages).toHaveLength(1);
  });

  it("applyStageUpdate replaces the run row in detail and runs list", () => {
    useRunsStore.setState({
      runsByWs: { w1: [RUN] },
      activeRunIdByWs: { w1: "r1" },
      detailByRun: { r1: { run: RUN, stages: [STAGE] } },
      selectedStageByRun: {},
    });
    const updated = { ...RUN, status: "paused", costUsd: 0.09 };
    useRunsStore.getState().applyStageUpdate("r1", updated);
    expect(useRunsStore.getState().getDetail("r1")?.run?.status).toBe("paused");
    expect(useRunsStore.getState().getRuns("w1")[0].costUsd).toBe(0.09);
  });

  it("applyCost updates the active run's cost/baseline", () => {
    useRunsStore.setState({
      runsByWs: { w1: [RUN] }, activeRunIdByWs: { w1: "r1" },
      detailByRun: { r1: { run: RUN, stages: [STAGE] } }, selectedStageByRun: {},
    });
    useRunsStore.getState().applyCost("r1", 0.12, 0.4);
    const d = useRunsStore.getState().getDetail("r1");
    expect(d?.run?.costUsd).toBe(0.12);
    expect(d?.run?.baselineUsd).toBe(0.4);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- runsStore 2>&1 | tail -15`
Expected: FAIL — `./runsStore` not found.

- [ ] **Step 3: Implement the store**

Create `src/stores/runsStore.ts`:

```typescript
import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import {
  ipc,
  RUN_EVENTS,
  type Run,
  type RunStage,
  type RunDetail,
  type CheckpointActionName,
} from "../lib/ipc";

export const EMPTY_RUNS: Run[] = [];

const TERMINAL = new Set(["completed", "aborted", "failed"]);

interface RunsState {
  runsByWs: Record<string, Run[]>;
  activeRunIdByWs: Record<string, string | null>;
  detailByRun: Record<string, RunDetail>;
  selectedStageByRun: Record<string, string | null>;

  getRuns: (workspaceId: string) => Run[];
  getActiveRunId: (workspaceId: string) => string | null;
  getDetail: (runId: string) => RunDetail | undefined;
  getSelectedStageId: (runId: string) => string | null;

  loadRuns: (workspaceId: string) => Promise<void>;
  refreshDetail: (runId: string) => Promise<void>;
  begin: (
    workspaceId: string,
    pipelineId: string,
    task: string,
    linkedIssueKey?: string,
  ) => Promise<void>;
  resolve: (
    runId: string,
    action: CheckpointActionName,
    feedback?: string,
    modelOverride?: string,
  ) => Promise<void>;
  abort: (runId: string) => Promise<void>;
  selectStage: (runId: string, stageId: string) => void;

  // Event reducers (also called directly in tests).
  applyStageUpdate: (runId: string, run: Run) => void;
  applyCost: (runId: string, costUsd: number, baselineUsd: number) => void;
}

function replaceRunInList(list: Run[], run: Run): Run[] {
  const idx = list.findIndex((r) => r.id === run.id);
  if (idx === -1) return [run, ...list];
  const next = list.slice();
  next[idx] = run;
  return next;
}

export const useRunsStore = create<RunsState>((set, get) => ({
  runsByWs: {},
  activeRunIdByWs: {},
  detailByRun: {},
  selectedStageByRun: {},

  getRuns: (workspaceId) => get().runsByWs[workspaceId] ?? EMPTY_RUNS,
  getActiveRunId: (workspaceId) => get().activeRunIdByWs[workspaceId] ?? null,
  getDetail: (runId) => get().detailByRun[runId],
  getSelectedStageId: (runId) => get().selectedStageByRun[runId] ?? null,

  loadRuns: async (workspaceId) => {
    const runs = await ipc.listRuns(workspaceId);
    const active = runs.find((r) => !TERMINAL.has(r.status)) ?? null;
    set((s) => ({
      runsByWs: { ...s.runsByWs, [workspaceId]: runs },
      activeRunIdByWs: { ...s.activeRunIdByWs, [workspaceId]: active?.id ?? null },
    }));
    if (active) await get().refreshDetail(active.id);
  },

  refreshDetail: async (runId) => {
    const detail = await ipc.getRun(runId);
    set((s) => ({ detailByRun: { ...s.detailByRun, [runId]: detail } }));
  },

  begin: async (workspaceId, pipelineId, task, linkedIssueKey) => {
    const runId = await ipc.createRun(workspaceId, pipelineId, task, undefined, linkedIssueKey);
    await ipc.startRun(runId);
    set((s) => ({ activeRunIdByWs: { ...s.activeRunIdByWs, [workspaceId]: runId } }));
    await get().loadRuns(workspaceId);
    await get().refreshDetail(runId);
  },

  resolve: async (runId, action, feedback, modelOverride) => {
    await ipc.resolveCheckpoint(runId, action, feedback, modelOverride);
  },

  abort: async (runId) => {
    await ipc.abortRun(runId);
    await get().refreshDetail(runId);
  },

  selectStage: (runId, stageId) =>
    set((s) => ({ selectedStageByRun: { ...s.selectedStageByRun, [runId]: stageId } })),

  applyStageUpdate: (runId, run) => {
    set((s) => {
      const prevDetail = s.detailByRun[runId];
      const detail: RunDetail = prevDetail
        ? { ...prevDetail, run }
        : { run, stages: [] };
      const wsList = s.runsByWs[run.workspaceId] ?? EMPTY_RUNS;
      return {
        detailByRun: { ...s.detailByRun, [runId]: detail },
        runsByWs: { ...s.runsByWs, [run.workspaceId]: replaceRunInList(wsList, run) },
      };
    });
    // Stage rows changed too; pull the authoritative detail.
    void get().refreshDetail(runId);
  },

  applyCost: (runId, costUsd, baselineUsd) => {
    set((s) => {
      const prev = s.detailByRun[runId];
      if (!prev?.run) return {};
      const run = { ...prev.run, costUsd, baselineUsd };
      const wsList = s.runsByWs[run.workspaceId] ?? EMPTY_RUNS;
      return {
        detailByRun: { ...s.detailByRun, [runId]: { ...prev, run } },
        runsByWs: { ...s.runsByWs, [run.workspaceId]: replaceRunInList(wsList, run) },
      };
    });
  },
}));

// One-time event subscriptions (module scope, like chatStore).
void listen<{ runId: string; run: Run }>(RUN_EVENTS.stageUpdate, (ev) => {
  useRunsStore.getState().applyStageUpdate(ev.payload.runId, ev.payload.run);
});
void listen<{ runId: string; costUsd: number; baselineUsd: number }>(
  RUN_EVENTS.cost,
  (ev) => useRunsStore.getState().applyCost(ev.payload.runId, ev.payload.costUsd, ev.payload.baselineUsd),
);
void listen<{ runId: string }>(RUN_EVENTS.checkpoint, (ev) => {
  void useRunsStore.getState().refreshDetail(ev.payload.runId);
});
void listen<{ runId: string; error: string }>(RUN_EVENTS.error, (ev) => {
  void useRunsStore.getState().refreshDetail(ev.payload.runId);
});
```

Note: the test file mocks `../lib/ipc` so the `listen()` calls at module scope receive the mocked (no-op `listen`)? `listen` is from `@tauri-apps/api/event`, not mocked here; in jsdom it returns a promise that never fires — harmless for the store tests, which call the reducers directly. If the test runner errors on `listen` (no Tauri host), add to the test file top: `vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- runsStore 2>&1 | tail -15`
Expected: PASS (4 tests). If `listen` throws under jsdom, add the `vi.mock("@tauri-apps/api/event", …)` line shown above and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/stores/runsStore.ts src/stores/runsStore.test.ts
git commit -m "feat(direct): runsStore with live run:// event reduction"
```

---

## Task 4: RunTrack (assembly-line header)

**Files:**
- Create: `src/components/RunTrack.tsx`
- Test: `npm run typecheck`

- [ ] **Step 1: Implement the component**

Create `src/components/RunTrack.tsx`:

```typescript
import type { Run, RunStage } from "../lib/ipc";

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

function statusColor(status: string): string {
  if (status === "done") return "text-octo-verdigris";
  if (status === "running") return "text-octo-brass";
  if (status === "failed") return "text-octo-rouge";
  if (status === "awaiting_checkpoint") return "text-octo-brass";
  return "text-octo-mute";
}

interface Props {
  run: Run;
  stages: RunStage[];
  selectedStageId: string | null;
  onSelectStage: (stageId: string) => void;
}

export function RunTrack({ run, stages, selectedStageId, onSelectStage }: Props) {
  const saved = Math.max(0, run.baselineUsd - run.costUsd);
  const doneCount = stages.filter((s) => s.status === "done").length;

  return (
    <div className="border-b border-octo-hairline bg-octo-panel px-4 py-3">
      <div className="mb-3 flex items-baseline gap-6 font-mono text-xs">
        <Meta label="spent" value={`$${run.costUsd.toFixed(2)}`} valueClass="text-octo-brass" />
        <Meta label="saved vs all-premium" value={`+$${saved.toFixed(2)}`} valueClass="text-octo-verdigris" />
        <Meta label="stage" value={`${Math.min(doneCount + 1, stages.length)} / ${stages.length}`} valueClass="text-octo-ivory" />
      </div>
      <div className="flex items-stretch">
        {stages.map((s, i) => (
          <div key={s.id} className="flex items-stretch min-w-0">
            {i > 0 && (
              <div className="flex w-6 items-center justify-center text-octo-brass">
                {stages[i - 1].checkpoint ? "⟜" : "⟶"}
              </div>
            )}
            <button
              type="button"
              onClick={() => onSelectStage(s.id)}
              className={`flex min-w-0 flex-1 flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors octo-rise-in ${
                s.id === selectedStageId
                  ? "border-octo-brass bg-[var(--brass-ghost)]"
                  : "border-octo-hairline bg-octo-panel-2 hover:border-[var(--brass-dim)]"
              }`}
            >
              <span className="font-mono text-[10px] text-octo-brass">
                {ROMAN[i] ?? i + 1}{" "}
                <span className={statusColor(s.status)}>
                  {s.status === "running" ? "● running" : s.status === "done" ? "✓" : s.status === "failed" ? "✕ failed" : s.status === "awaiting_checkpoint" ? "◆ review" : "pending"}
                </span>
              </span>
              <span className="font-serif text-sm text-octo-ivory">{labelForRole(s.role)}</span>
              <span className="flex items-center gap-2 font-mono text-[9px] text-octo-sage">
                {s.agentModel}
                <SubstratePill substrate={s.substrate} />
              </span>
              <span className="mt-auto font-mono text-[10px] text-octo-mute">
                ${s.costUsd.toFixed(2)}
              </span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Meta({ label, value, valueClass }: { label: string; value: string; valueClass: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.14em] text-octo-mute">{label}</div>
      <div className={`text-sm ${valueClass}`}>{value}</div>
    </div>
  );
}

function SubstratePill({ substrate }: { substrate: string }) {
  const cls =
    substrate === "cli"
      ? "text-octo-state-purple border-octo-state-purple"
      : "text-octo-state-blue border-octo-state-blue";
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[8px] uppercase ${cls}`}>
      {substrate}
    </span>
  );
}

export function labelForRole(role: string): string {
  const map: Record<string, string> = {
    plan: "Plan",
    plan_review: "Plan review",
    implement: "Implement",
    code_review: "Code review",
    test: "Tests",
    repro: "Reproduce",
    fix: "Fix",
    verify: "Verify",
    critique: "Critique",
    refine: "Refine",
  };
  return map[role] ?? role;
}
```

Note: `text-octo-state-blue`/`text-octo-state-purple` and `border-octo-state-*` resolve from the `--color-state-blue`/`--color-state-purple` tokens via Tailwind's theme. If those utility names don't exist in the theme yet, add them to the `@theme` block in `src/styles.css` next to the other `--color-octo-*` entries:

```css
  --color-octo-state-blue:   #7a9cb8;
  --color-octo-state-purple: #a888b8;
```

(They already exist as `--color-state-blue`/`--color-state-purple`; add the `--color-octo-` aliases so `text-octo-state-*` Tailwind classes resolve. Do this in Step 1 if typecheck/build complains about unknown classes.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck 2>&1 | tail -5`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/RunTrack.tsx src/styles.css
git commit -m "feat(direct): RunTrack assembly-line header"
```

---

## Task 5: StageFocus (focus pane stage detail)

**Files:**
- Create: `src/components/StageFocus.tsx`
- Test: `npm run typecheck`

- [ ] **Step 1: Implement the component**

Create `src/components/StageFocus.tsx`. The artifact is a JSON string (`StageArtifact`) or null; parse defensively.

```typescript
import { useMemo } from "react";
import type { RunStage } from "../lib/ipc";
import { labelForRole } from "./RunTrack";

interface ParsedArtifact {
  kind: string;
  text: string;
  refsWorktree?: boolean;
}

interface Props {
  stage: RunStage | null;
}

export function StageFocus({ stage }: Props) {
  const artifact = useMemo<ParsedArtifact | null>(() => {
    if (!stage?.artifact) return null;
    try {
      return JSON.parse(stage.artifact) as ParsedArtifact;
    } catch {
      return null;
    }
  }, [stage?.artifact]);

  if (!stage) {
    return (
      <div className="flex flex-1 items-center justify-center text-octo-mute font-mono text-sm">
        Select a stage to inspect it.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden octo-fade-in">
      <div className="flex items-center gap-2 border-b border-octo-hairline px-4 py-2.5 font-mono text-xs text-octo-sage">
        <span className="text-octo-brass">§ {stage.role.toUpperCase()}</span>
        <span>· {labelForRole(stage.role)} · {stage.agentModel}</span>
        <span className="ml-auto text-octo-brass">${stage.costUsd.toFixed(2)}</span>
      </div>
      <div className="flex-1 overflow-auto px-4 py-3 font-mono text-[12px] leading-relaxed text-octo-sage whitespace-pre-wrap">
        {stage.status === "failed" && stage.error ? (
          <span className="text-octo-rouge">{stage.error}</span>
        ) : artifact ? (
          <>
            {artifact.refsWorktree && (
              <div className="mb-2 text-octo-mute">
                ⟶ Code changes are in the workspace; open Review to see the diff.
              </div>
            )}
            {artifact.text || "(no output text)"}
          </>
        ) : stage.status === "running" ? (
          <span className="text-octo-brass">working…</span>
        ) : (
          <span className="text-octo-mute">No artifact yet.</span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck 2>&1 | tail -5`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/StageFocus.tsx
git commit -m "feat(direct): StageFocus detail pane"
```

---

## Task 6: CheckpointBar (the four actions)

**Files:**
- Create: `src/components/CheckpointBar.tsx`
- Test: `npm run typecheck`

- [ ] **Step 1: Implement the component**

Create `src/components/CheckpointBar.tsx`. Shows when the run is `paused` and a stage is `awaiting_checkpoint` or `failed`.

```typescript
import { useState } from "react";
import type { RunStage } from "../lib/ipc";
import { labelForRole } from "./RunTrack";

interface Props {
  blockedStage: RunStage;
  onApprove: () => void;
  onReject: (feedback: string) => void;
  onAbort: () => void;
}

export function CheckpointBar({ blockedStage, onApprove, onReject, onAbort }: Props) {
  const [rejecting, setRejecting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const failed = blockedStage.status === "failed";

  return (
    <div className="m-4 rounded-lg border border-dashed border-octo-brass bg-[var(--brass-faint)] px-4 py-3 octo-pop-in">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-octo-brass">
          {failed ? "✕ stage failed" : "⟶ checkpoint"}
        </span>
        <span className="flex-1 text-sm text-octo-sage">
          {failed ? (
            <>Stage <b className="text-octo-ivory">{labelForRole(blockedStage.role)}</b> failed. Re-run or abort.</>
          ) : (
            <>Review <b className="text-octo-ivory">{labelForRole(blockedStage.role)}</b> and choose how to proceed.</>
          )}
        </span>
        {!rejecting && (
          <>
            {!failed && (
              <button type="button" onClick={onApprove}
                className="rounded-md bg-octo-brass px-3 py-1.5 font-serif text-sm text-octo-onyx">
                Approve &amp; continue
              </button>
            )}
            <button type="button" onClick={() => setRejecting(true)}
              className="rounded-md border border-octo-brass px-3 py-1.5 font-mono text-xs text-octo-brass">
              {failed ? "Re-run" : "Reject"}
            </button>
            <button type="button" onClick={onAbort}
              className="rounded-md border border-octo-hairline px-3 py-1.5 font-mono text-xs text-octo-mute hover:text-octo-rouge">
              Abort
            </button>
          </>
        )}
      </div>
      {rejecting && (
        <div className="mt-3 flex flex-col gap-2 octo-rise-in">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Optional feedback for the re-run…"
            className="h-20 resize-none rounded-md border border-octo-hairline bg-octo-onyx px-3 py-2 font-mono text-xs text-octo-ivory placeholder:text-octo-mute"
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => { onReject(feedback); setRejecting(false); setFeedback(""); }}
              className="rounded-md bg-octo-brass px-3 py-1.5 font-serif text-sm text-octo-onyx">
              Re-run the stage ⟶
            </button>
            <button type="button" onClick={() => setRejecting(false)}
              className="rounded-md border border-octo-hairline px-3 py-1.5 font-mono text-xs text-octo-mute">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

Note: `--brass-faint` is referenced; it exists in `styles.css`. If not, add `--brass-faint: rgba(212,165,116,.04);` to the `@theme`/`:root` block alongside `--brass-ghost`.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck 2>&1 | tail -5`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/CheckpointBar.tsx
git commit -m "feat(direct): CheckpointBar with approve/reject/abort"
```

---

## Task 7: PipelineSetup (setup / empty state)

**Files:**
- Create: `src/components/PipelineSetup.tsx`
- Test: `npm run typecheck`

- [ ] **Step 1: Implement the component**

Create `src/components/PipelineSetup.tsx`. Lets the user pick a template, edit the task (prefilled), see the stages, fetch an estimate, and begin.

```typescript
import { useEffect, useState } from "react";
import { ipc, type PipelineWithStages } from "../lib/ipc";
import { usePipelineStore } from "../stores/pipelineStore";
import { labelForRole } from "./RunTrack";

interface Props {
  defaultTask: string;
  onBegin: (pipelineId: string, task: string) => void;
}

export function PipelineSetup({ defaultTask, onBegin }: Props) {
  const pipelines = usePipelineStore((s) => s.pipelines);
  const loaded = usePipelineStore((s) => s.loaded);
  const load = usePipelineStore((s) => s.load);

  const [task, setTask] = useState(defaultTask);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<{ estimateUsd: number; baselineUsd: number } | null>(null);

  useEffect(() => { if (!loaded) void load(); }, [loaded, load]);
  useEffect(() => {
    if (!selectedId && pipelines.length > 0) setSelectedId(pipelines[0].pipeline.id);
  }, [pipelines, selectedId]);
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    ipc.estimateRunCost(selectedId).then((e) => { if (!cancelled) setEstimate(e); }).catch(() => {});
    return () => { cancelled = true; };
  }, [selectedId]);

  const selected: PipelineWithStages | undefined = pipelines.find((p) => p.pipeline.id === selectedId);
  const saved = estimate ? Math.max(0, estimate.baselineUsd - estimate.estimateUsd) : 0;

  return (
    <div className="flex-1 overflow-auto px-5 py-5 octo-fade-in">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-octo-brass">I · Describe the work</p>
      <textarea
        value={task}
        onChange={(e) => setTask(e.target.value)}
        placeholder="What should the team build?"
        className="mb-6 h-20 w-full resize-none rounded-lg border border-octo-hairline bg-octo-panel-2 px-3 py-2 font-mono text-sm text-octo-ivory placeholder:text-octo-mute"
      />

      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-octo-brass">II · Choose a pipeline</p>
      <div className="mb-6 flex gap-2.5">
        {pipelines.map((p) => (
          <button
            key={p.pipeline.id}
            type="button"
            onClick={() => setSelectedId(p.pipeline.id)}
            className={`flex-1 rounded-lg border p-3 text-left transition-colors ${
              p.pipeline.id === selectedId
                ? "border-octo-brass bg-[var(--brass-ghost)]"
                : "border-octo-hairline bg-octo-panel-2 hover:border-[var(--brass-dim)]"
            }`}
          >
            <h3 className="mb-1 font-serif text-[15px] text-octo-ivory">{p.pipeline.name}</h3>
            <p className="m-0 text-[11px] text-octo-sage">{p.pipeline.description}</p>
          </button>
        ))}
      </div>

      {selected && (
        <>
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-octo-brass">III · Your team</p>
          <div className="mb-6 overflow-hidden rounded-lg border border-octo-hairline">
            {selected.stages.map((s) => (
              <div key={s.id} className="flex items-center gap-3 border-b border-octo-hairline bg-octo-panel-2 px-3 py-2.5 last:border-b-0">
                <span className="w-28 font-serif text-sm text-octo-ivory">{labelForRole(s.role)}</span>
                <span className="flex-1 font-mono text-xs text-octo-sage">{s.agentModel}</span>
                <span className="font-mono text-[9px] uppercase text-octo-mute">
                  {s.checkpoint ? "checkpoint" : ""}
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-5 rounded-lg border border-octo-hairline bg-octo-panel-2 p-4">
            <div>
              <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-octo-mute">this pipeline</div>
              <div className="font-serif text-2xl text-octo-brass">
                ~${(estimate?.estimateUsd ?? 0).toFixed(2)}
              </div>
              {estimate && (
                <div className="font-mono text-xs text-octo-verdigris">
                  ↓ saves ~${saved.toFixed(2)} vs all-premium
                </div>
              )}
            </div>
            <button
              type="button"
              disabled={!task.trim()}
              onClick={() => onBegin(selected.pipeline.id, task.trim())}
              className="ml-auto rounded-lg bg-octo-brass px-5 py-2.5 font-serif text-base text-octo-onyx disabled:opacity-40"
            >
              Begin the run ⟶
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck 2>&1 | tail -5`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/PipelineSetup.tsx
git commit -m "feat(direct): PipelineSetup setup state"
```

---

## Task 8: DirectCanvas (compose setup vs run state)

**Files:**
- Create: `src/components/DirectCanvas.tsx`
- Test: `npm run typecheck`

- [ ] **Step 1: Implement the component**

Create `src/components/DirectCanvas.tsx`:

```typescript
import { useEffect } from "react";
import { useRunsStore } from "../stores/runsStore";
import { PipelineSetup } from "./PipelineSetup";
import { RunTrack } from "./RunTrack";
import { StageFocus } from "./StageFocus";
import { CheckpointBar } from "./CheckpointBar";

interface Props {
  workspaceId: string;
  defaultTask: string;
  linkedIssueKey: string | null;
}

export function DirectCanvas({ workspaceId, defaultTask, linkedIssueKey }: Props) {
  const loadRuns = useRunsStore((s) => s.loadRuns);
  const activeRunId = useRunsStore((s) => s.getActiveRunId(workspaceId));
  const detail = useRunsStore((s) => (activeRunId ? s.getDetail(activeRunId) : undefined));
  const selectedStageId = useRunsStore((s) => (activeRunId ? s.getSelectedStageId(activeRunId) : null));
  const selectStage = useRunsStore((s) => s.selectStage);
  const begin = useRunsStore((s) => s.begin);
  const resolve = useRunsStore((s) => s.resolve);
  const abort = useRunsStore((s) => s.abort);

  useEffect(() => { void loadRuns(workspaceId); }, [workspaceId, loadRuns]);

  if (!activeRunId || !detail?.run) {
    return (
      <PipelineSetup
        defaultTask={defaultTask}
        onBegin={(pipelineId, task) =>
          void begin(workspaceId, pipelineId, task, linkedIssueKey ?? undefined)
        }
      />
    );
  }

  const { run, stages } = detail;
  // Default selection: the active/awaiting stage, else the last done stage.
  const activeStage =
    stages.find((s) => s.status === "running" || s.status === "awaiting_checkpoint" || s.status === "failed") ??
    [...stages].reverse().find((s) => s.status === "done") ??
    stages[0] ??
    null;
  const shownStageId = selectedStageId ?? activeStage?.id ?? null;
  const shownStage = stages.find((s) => s.id === shownStageId) ?? null;
  const blockedStage = stages.find((s) => s.status === "awaiting_checkpoint" || s.status === "failed") ?? null;

  return (
    <div className="flex h-full flex-col">
      <RunTrack
        run={run}
        stages={stages}
        selectedStageId={shownStageId}
        onSelectStage={(id) => selectStage(run.id, id)}
      />
      <StageFocus stage={shownStage} />
      {run.status === "paused" && blockedStage && (
        <CheckpointBar
          blockedStage={blockedStage}
          onApprove={() => void resolve(run.id, "approve")}
          onReject={(feedback) => void resolve(run.id, "reject", feedback || undefined)}
          onAbort={() => void abort(run.id)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck 2>&1 | tail -5`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/DirectCanvas.tsx
git commit -m "feat(direct): DirectCanvas composing setup + run states"
```

---

## Task 9: CompanionRuns + Companion wiring

**Files:**
- Create: `src/components/CompanionRuns.tsx`
- Modify: `src/components/Companion.tsx`
- Test: `npm run typecheck`

- [ ] **Step 1: Implement CompanionRuns**

Create `src/components/CompanionRuns.tsx`:

```typescript
import { useEffect } from "react";
import { useRunsStore } from "../stores/runsStore";

function statusLabel(status: string): { text: string; cls: string } {
  switch (status) {
    case "running": return { text: "● running", cls: "text-octo-brass" };
    case "paused": return { text: "◆ paused", cls: "text-octo-brass" };
    case "completed": return { text: "✓ done", cls: "text-octo-verdigris" };
    case "aborted": return { text: "■ aborted", cls: "text-octo-mute" };
    case "failed": return { text: "✕ failed", cls: "text-octo-rouge" };
    default: return { text: status, cls: "text-octo-mute" };
  }
}

interface Props {
  workspaceId: string;
}

export function CompanionRuns({ workspaceId }: Props) {
  const loadRuns = useRunsStore((s) => s.loadRuns);
  const runs = useRunsStore((s) => s.getRuns(workspaceId));
  const activeId = useRunsStore((s) => s.getActiveRunId(workspaceId));

  useEffect(() => { void loadRuns(workspaceId); }, [workspaceId, loadRuns]);

  return (
    <div className="border-b border-octo-hairline">
      <div className="px-3.5 pb-1.5 pt-2.5 font-mono text-[9px] uppercase tracking-[0.13em] text-octo-brass">
        Runs <span className="text-octo-mute">· {runs.length}</span>
      </div>
      {runs.length === 0 && (
        <div className="px-3.5 pb-3 font-mono text-[11px] text-octo-mute">No runs yet.</div>
      )}
      {runs.map((r) => {
        const s = statusLabel(r.status);
        return (
          <div
            key={r.id}
            className={`flex flex-col gap-0.5 border-l-2 px-3.5 py-2 ${
              r.id === activeId ? "border-octo-brass bg-[var(--brass-ghost)]" : "border-transparent"
            }`}
          >
            <div className="truncate text-[12.5px] text-octo-ivory">{r.task || "(untitled run)"}</div>
            <div className="flex items-center gap-2 font-mono text-[10px] text-octo-sage">
              <span className={s.cls}>{s.text}</span>
              <span>· ${r.costUsd.toFixed(2)}</span>
              {r.linkedIssueKey && <span>· {r.linkedIssueKey}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into Companion**

In `src/components/Companion.tsx`: add `"direct"` handling. First, the `Props.mode` is `WorkspaceMode`, which now includes `"direct"` (from Task 1), so no prop type change is needed. Import the component near the other imports:

```typescript
import { CompanionRuns } from "./CompanionRuns";
```

Then in the keyed mode-content block (around lines 114–127, where it branches on `mode === "talk"` / `"run"` / `"review"`), add a branch:

```typescript
        {mode === "direct" && workspaceId && (
          <CompanionRuns workspaceId={workspaceId} />
        )}
```

Place it as a sibling of the existing `mode === "..."` branches inside the same container. The existing `<WorkContextPanel>` (Jira context, rendered unconditionally when configured) stays as-is — it appears under the Runs section for Direct mode automatically, satisfying "Companion = Runs + read-only Jira context".

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck 2>&1 | tail -5`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/CompanionRuns.tsx src/components/Companion.tsx
git commit -m "feat(direct): Companion Runs section"
```

---

## Task 10: App.tsx — render DirectCanvas for the direct mode

**Files:**
- Modify: `src/App.tsx`
- Test: `npm run typecheck` + visual

- [ ] **Step 1: Import DirectCanvas**

In `src/App.tsx`, add near the other component imports:

```typescript
import { DirectCanvas } from "./components/DirectCanvas";
```

- [ ] **Step 2: Add the Direct canvas overlay**

In the Canvas render area (the relative container holding the Talk/Run/Review overlays, lines ~1325–1469), add a fourth overlay sibling after the Review overlay block. Mirror the opacity/visibility pattern the other overlays use:

```typescript
        {/* Direct mode overlay */}
        <div
          className="absolute inset-0"
          style={{
            opacity: activeWorkspace && activeMode === "direct" ? 1 : 0,
            pointerEvents: activeMode === "direct" ? "auto" : "none",
            visibility: activeMode === "direct" ? "visible" : "hidden",
            transition: "opacity 220ms var(--ease-octo)",
          }}
        >
          {activeWorkspace && activeMode === "direct" && (
            <DirectCanvas
              key={activeWorkspace.id}
              workspaceId={activeWorkspace.id}
              defaultTask={activeWorkspace.task || ""}
              linkedIssueKey={activeWorkspace.linkedIssueKey ?? null}
            />
          )}
        </div>
```

Use the exact `activeWorkspace`/`activeMode` variables already in scope (confirmed at App.tsx:493–494, 763). Match the surrounding overlays' container/style conventions if they differ slightly (e.g. if they wrap in a specific class — copy that class).

- [ ] **Step 3: Confirm Companion receives the direct mode**

The Companion is already rendered with `mode={activeMode}` (it takes `mode: WorkspaceMode`). Since `activeMode` can now be `"direct"`, no change is needed beyond Task 9. Verify the `Companion` is passed `workspaceId={activeWorkspaceId}` (it is, per its Props). No edit expected here; if the Companion is given `mode` via a narrowed type, ensure it passes `activeMode` directly.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck 2>&1 | tail -5`
Expected: no errors.

- [ ] **Step 5: Visual verification**

Run the app (`npm run tauri:dev`), open a workspace, press `⌘⇧D` (or click the **Direct** mode button). Expected: the setup state shows the task field (prefilled from the workspace task), the three templates, the team list, and the estimate with "Begin the run ⟶". The Companion shows the **Runs** section (empty) above the Jira context. Click Begin → the track header appears, stages advance live, and at the implement checkpoint the CheckpointBar shows Approve/Reject/Abort. (Stages run via the API substrate; if no provider key is configured, the stage fails and pauses with the error in StageFocus — expected.)

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(direct): render Direct mode canvas in App"
```

---

## Self-Review

**Spec coverage (Phase B):**
- 4th mode in ModeSwitcher (⌘⇧D) → Task 1. ✓
- `pipelineStore` + `runsStore` (event-reducing, stable empty defaults) → Tasks 2, 3. ✓
- Run-state canvas: horizontal track header + focus pane → Tasks 4, 5, 8. ✓
- Setup state: task field (prefilled) + template + team + estimate + "Begin the run" CTA → Task 7. ✓
- Checkpoint actions (approve/reject/edit/abort) → Task 6 (Edit folds into Approve in 2a — `resolve("edit")` wrapper is available in the store for 2c when manual artifact editing lands; abort via store). ✓ (Note: explicit "Edit the artifact by hand" surface is deferred to Plan 2c with the native-surface embedding.)
- Companion: Runs section + reused read-only Jira context → Task 9. ✓
- Per-workspace, non-blocking, optional (ignore the mode → app behaves as before) → Task 10 (overlay only renders for the active workspace in direct mode; trinity untouched). ✓

**Deferred to 2c (correctly out of 2a scope):** the polished cost meters, the focus pane embedding the real Talk/Run/Review surfaces (2a shows artifact text + tool log instead), an explicit hand-edit artifact surface, motion polish on the track reveal, and the canonical design-spec/`design-system.md` update documenting the 4th mode. **Deferred to 2b:** CLI substrate (all seeds run on API in 2a).

**Placeholder scan:** none — every component has full code; the only "add if needed" notes are token-alias guards (`--color-octo-state-*`, `--brass-faint`) with the exact CSS to add.

**Type consistency:** `labelForRole` is defined once in `RunTrack.tsx` and imported by `StageFocus`/`CheckpointBar`/`PipelineSetup`. Store selectors (`getRuns`/`getActiveRunId`/`getDetail`/`getSelectedStageId`) are used with the same names across `DirectCanvas`/`CompanionRuns`. `ipc` method names and `RUN_EVENTS` keys match the merged `src/lib/ipc.ts` (`listPipelines`, `createRun`, `startRun`, `getRun`, `listRuns`, `resolveCheckpoint`, `abortRun`, `estimateRunCost`; `RUN_EVENTS.stageUpdate/cost/checkpoint/error`). `CheckpointActionName` values (`approve`/`reject`/`edit`/`abort`) match the store's `resolve` signature.

---

## Execution Handoff

(Filled in by the writing-plans flow after approval.)
