# Live Orchestration View — Plan V3 (frontend: track liveness) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the assembly-line `RunTrack` feel alive — the active stage **pulses**, shows a **timer** (from `startedAt`) and a one-line **current activity** mirrored from the live journal, and shows the **verdict** when a review finishes. Completes the live-orchestration mockup (V1 backend + V2 focus journal + V3 track).

**Architecture:** Extract a `StageCard` component from `RunTrack`'s map so each card can use hooks (a new `useElapsed` timer hook + a `runsStore` selector for that stage's live entries). The active card gets a calm CSS pulse (reduced-motion-safe), a timer, and a current-activity line derived from the last live entry; a finished review shows the last `notice` (verdict). Frontend only.

**Tech Stack:** React 19 + TypeScript + Zustand + Tailwind (Atelier tokens). Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-09-direct-live-orchestration-view-design.md` §4.3. Builds on V1+V2 (same branch / PR #21).

**Design rules:** NO italics; English copy; tokens (no hex); calm motion (220–320ms easing, no bounce) that respects `prefers-reduced-motion`; `§` glyph in brass.

---

## File map
- **Create** `src/hooks/useElapsed.ts` — `mm:ss` ticking timer from an ISO `startedAt`.
- **Create** `src/hooks/useElapsed.test.ts` — hook test (fake timers).
- **Modify** `src/components/RunTrack.tsx` — extract `StageCard`; add pulse + timer + current-activity + verdict.
- **Create** `src/components/RunTrack.test.tsx` — track-liveness tests.
- **Modify** `src/styles.css` — a calm `.octo-stage-pulse` class (reduced-motion-safe).

---

### Task 1: `useElapsed` hook

**Files:** Create `src/hooks/useElapsed.ts`, `src/hooks/useElapsed.test.ts`.

- [ ] **Step 1 — Write the failing test** (`src/hooks/useElapsed.test.ts`):
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useElapsed } from "./useElapsed";

describe("useElapsed", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-06-09T00:00:10Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("returns '' when not started", () => {
    const { result } = renderHook(() => useElapsed(null));
    expect(result.current).toBe("");
  });

  it("formats mm:ss elapsed since startedAt and ticks", () => {
    // started 10s ago
    const { result } = renderHook(() => useElapsed("2026-06-09T00:00:00Z"));
    expect(result.current).toBe("00:10");
    vi.advanceTimersByTime(55_000); // +55s -> 65s -> 01:05
    expect(result.current).toBe("01:05");
  });

  it("returns '' for an unparseable timestamp", () => {
    const { result } = renderHook(() => useElapsed("not-a-date"));
    expect(result.current).toBe("");
  });
});
```
- [ ] **Step 2 — Run, confirm FAIL:** `npx vitest run src/hooks/useElapsed 2>&1 | tail -20` (from worktree root).
- [ ] **Step 3 — Implement `src/hooks/useElapsed.ts`:**
```ts
import { useEffect, useState } from "react";

/** `mm:ss` elapsed since `startedAt` (ISO 8601), re-rendering each second.
 *  Returns "" when `startedAt` is null or unparseable. */
export function useElapsed(startedAt: string | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  if (!startedAt) return "";
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return "";
  const secs = Math.max(0, Math.floor((now - start) / 1000));
  const mm = Math.floor(secs / 60).toString().padStart(2, "0");
  const ss = (secs % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}
```
- [ ] **Step 4 — Run, confirm PASS:** `npx vitest run src/hooks/useElapsed 2>&1 | tail -8`. `npm run typecheck` clean.
- [ ] **Step 5 — Commit:**
```bash
git add src/hooks/useElapsed.ts src/hooks/useElapsed.test.ts
git commit -m "feat(direct/live-v3): useElapsed mm:ss timer hook"
```

---

### Task 2: RunTrack — pulse, timer, current activity, verdict

**Files:** Modify `src/components/RunTrack.tsx`, `src/styles.css`; create `src/components/RunTrack.test.tsx`.

Context: `RunTrack` maps `stages` to inline `<button>` cards. Hooks can't be called inside `.map`, so extract a `StageCard` component (one per stage) that uses `useElapsed` + a `runsStore` selector. `stageStatusMeta(status)` (from `../lib/runStatus`) gives the status label/class; `labelForRole`/`ROMAN`/`SubstratePill` stay in RunTrack. `LiveEntry` is in `../lib/ipc`; `useRunsStore` exposes `liveByStage` (V2).

- [ ] **Step 1 — Add the pulse CSS** to `src/styles.css` (near the other `@keyframes`):
```css
/* Calm pulse for the active pipeline stage in the Direct run track. */
@keyframes octo-stage-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(0,0,0,0); }
  50%      { box-shadow: 0 0 0 3px var(--brass-ghost); }
}
.octo-stage-pulse { animation: octo-stage-pulse 2.4s var(--ease-octo, cubic-bezier(0.2,0.8,0.3,1)) infinite; }
@media (prefers-reduced-motion: reduce) {
  .octo-stage-pulse { animation: none; }
}
```
- [ ] **Step 2 — Write the failing test** (`src/components/RunTrack.test.tsx`):
```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { RunTrack } = await import("./RunTrack");
const { useRunsStore } = await import("../stores/runsStore");

function stage(over: Record<string, unknown>) {
  return {
    id: "st1", runId: "r1", position: 0, role: "code_review", agentModel: "haiku",
    substrate: "api", checkpoint: false, status: "pending", inputTokens: 0, outputTokens: 0,
    costUsd: 0, artifact: null, feedback: null, error: null,
    startedAt: null, finishedAt: null,
    loopTargetPosition: null, loopMaxIterations: 0, loopMode: null, loopIterations: 0,
    ...over,
  } as any;
}
const run = { id: "r1", workspaceId: "w1", pipelineId: "p1", task: "t", status: "running",
  costUsd: 0, baselineUsd: 0, referenceModel: null, linkedIssueKey: null, createdAt: "t", finishedAt: null } as any;

describe("RunTrack liveness", () => {
  beforeEach(() => { useRunsStore.setState({ liveByStage: {} }); vi.useRealTimers(); });

  it("shows a timer + current activity on the running stage", () => {
    useRunsStore.setState({ liveByStage: { st1: [
      { kind: "text", text: "looking" }, { kind: "tool", tool: "Read", hint: "src/auth.rs" },
    ] } });
    const running = stage({ status: "running", startedAt: "2026-06-09T00:00:00Z" });
    render(<RunTrack run={run} stages={[running]} selectedStageId={null} onSelectStage={() => {}} />);
    expect(screen.getByText(/§ Read src\/auth\.rs/)).toBeInTheDocument(); // current activity
    expect(screen.getByText(/\d\d:\d\d/)).toBeInTheDocument();            // timer
  });

  it("shows the verdict notice on a finished review", () => {
    useRunsStore.setState({ liveByStage: { st1: [
      { kind: "tool", tool: "Read", hint: "x" }, { kind: "notice", text: "Verdict: changes requested" },
    ] } });
    const done = stage({ status: "done", startedAt: "2026-06-09T00:00:00Z", finishedAt: "t" });
    render(<RunTrack run={run} stages={[done]} selectedStageId={null} onSelectStage={() => {}} />);
    expect(screen.getByText(/changes requested/)).toBeInTheDocument();
  });

  it("a pending stage shows no timer/activity", () => {
    render(<RunTrack run={run} stages={[stage({})]} selectedStageId={null} onSelectStage={() => {}} />);
    expect(screen.queryByText(/§ /)).not.toBeInTheDocument();
  });
});
```
- [ ] **Step 3 — Run, confirm FAIL:** `npx vitest run src/components/RunTrack 2>&1 | tail -20`.
- [ ] **Step 4 — Refactor `RunTrack.tsx`.** Add imports: `useRunsStore` from `../stores/runsStore`, `useElapsed` from `../hooks/useElapsed`, `type { LiveEntry }` from `../lib/ipc`. Add two pure helpers (module scope):
```tsx
const EMPTY_ENTRIES: LiveEntry[] = [];

/** One-line "current activity" from the most recent meaningful live entry. */
function lastActivity(entries: LiveEntry[]): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.kind === "tool") return `§ ${e.tool}${e.hint ? " " + e.hint : ""}`;
    if (e.kind === "text") return e.text.split("\n")[0].slice(0, 60);
    if (e.kind === "notice") return e.text;
  }
  return "";
}
/** The latest verdict notice (for a finished review), or "". */
function lastNotice(entries: LiveEntry[]): string {
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i].kind === "notice") return (entries[i] as { text: string }).text;
  return "";
}
```
  Replace the inline `<button>` inside `stages.map(...)` with a `<StageCard>` element, passing `stage`, `index`, `selected`, `onSelect`. Keep the connector arrow (`i > 0 && <div>⟜/⟶</div>`) in the map, outside StageCard. Then add the `StageCard` component:
```tsx
function StageCard({ stage: s, index, selected, onSelect }: {
  stage: RunStage; index: number; selected: boolean; onSelect: () => void;
}) {
  const entries = useRunsStore((st) => st.liveByStage[s.id] ?? EMPTY_ENTRIES);
  const elapsed = useElapsed(s.status === "running" ? s.startedAt : null);
  const running = s.status === "running";
  const activity = running ? lastActivity(entries) : "";
  const verdict = s.status === "done" ? lastNotice(entries) : "";
  const meta = stageStatusMeta(s.status);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`relative flex min-w-0 flex-1 flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors octo-rise-in ${
        running ? "octo-stage-pulse " : ""
      }${selected ? "border-octo-brass bg-[var(--brass-ghost)]" : "border-octo-hairline bg-octo-panel-2 hover:border-[var(--brass-dim)]"}`}
    >
      {running && elapsed && (
        <span className="absolute right-3 top-2 font-mono text-[10px] text-octo-brass">{elapsed}</span>
      )}
      <span className="font-mono text-[10px] text-octo-brass">
        {ROMAN[index] ?? index + 1} <span className={meta.className}>{meta.label}</span>
      </span>
      <span className="font-serif text-sm text-octo-ivory">{labelForRole(s.role)}</span>
      <span className="flex items-center gap-2 font-mono text-[9px] text-octo-sage">
        {s.agentModel}
        <SubstratePill substrate={s.substrate} />
      </span>
      {running && activity ? (
        <span className="mt-auto truncate font-mono text-[10px] text-octo-brass">{activity}</span>
      ) : verdict ? (
        <span className="mt-auto truncate font-mono text-[10px] text-octo-verdigris">{verdict}</span>
      ) : (
        <span className="mt-auto font-mono text-[10px] text-octo-mute">${s.costUsd.toFixed(2)}</span>
      )}
    </button>
  );
}
```
  (The cost line is replaced by the activity/verdict when present; otherwise it still shows. `ROMAN`, `labelForRole`, `SubstratePill`, `stageStatusMeta` are already in scope.)
- [ ] **Step 5 — Run tests + typecheck + full sweep:** `npx vitest run src/components/RunTrack src/hooks/useElapsed 2>&1 | tail -10`; `npm run typecheck`; `npx vitest run 2>&1 | grep -E "Test Files|Tests "` (whole suite green — RunTrack is used by DirectCanvas; confirm no regression).
- [ ] **Step 6 — Commit:**
```bash
git add src/components/RunTrack.tsx src/components/RunTrack.test.tsx src/styles.css
git commit -m "feat(direct/live-v3): live run track — pulse, timer, current activity, verdict"
```

---

## Self-review (against spec §4.3)

- **Active stage pulses** (`.octo-stage-pulse`, reduced-motion-safe) → Task 2. ✓
- **Timer from `startedAt`** (`useElapsed`, ticks 1s) → Tasks 1/2. ✓
- **Current-activity line** (last live entry, `§ TOOL hint` / text / notice) → Task 2. ✓
- **Verdict on completion** (last `notice`, verdigris) → Task 2. ✓
- **Calm motion, reduced-motion respected, tokens, no italics/hex, `§` brass** → Tasks 1/2. ✓
- **Cost still shown when no activity/verdict** (no regression to the existing cost line) → Task 2. ✓
- **Out of scope:** live cost tick-by-tick (deferred). ✓

**Type consistency:** `useElapsed(string|null): string`; `lastActivity`/`lastNotice(LiveEntry[]): string`; `StageCard` props `{stage: RunStage, index, selected, onSelect}`; `liveByStage` selector returns `LiveEntry[]` (V2). The verdict reads the live `notice` (V1 emits "Verdict: passed"/"changes requested" for auto reviews); gated reviews have no verdict notice → the cost line shows instead (correct — gated decisions are the human's at the checkpoint).

**Note:** verdict-on-complete is sourced from the in-session live feed (`liveByStage`), so it shows for stages that finished in the current view; it is not persisted across a reload (the verdict isn't on the `RunStage` artifact). Persisting it is a follow-up, not required for the live view.
