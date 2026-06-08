# Direct Mode — Polish (Plan 2c / Phase C-frontend + D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Direct mode's experience: a **per-stage model picker** (the cost-optimization knob) at run setup, the **real diff embedded** in the focus pane for code stages, a polished **cost meter**, **motion polish**, and the **design-system docs** updated to make the 4th mode canonical.

**Architecture:** Mostly frontend, reusing what exists. The model picker reuses the existing `ModelPicker` component and threads run-scoped `stageOverrides` (position → model) through `createRun` (a small backend addition — the pipeline template stays immutable; overrides apply only when copying stages into `run_stages`). The focus-pane diff reuses `ReviewCanvas`'s already-factored `parseFullDiff` + hunk renderers, extracted into a read-only `DiffViewer`, fed by `ipc.getGitDiff(worktreePath)`. The cost meter and motion reuse `runsStore` fields and the `.octo-*` primitives. Docs get the 4th mode added.

**Tech Stack:** React 19 + TS + Zustand + Tailwind v4 (Atelier tokens); Rust (`rusqlite`) for the one backend addition. Tests: Vitest (stores/logic), Rust `#[test]` for the override; components gate on `npm run typecheck` + `npm run build`.

**Scope note:** Plan 2c of the Direct-mode spec (Phases C-frontend + D). Plans 1/2a/2b are merged. **Out of scope:** template editing / `clonePipeline` (overrides are run-scoped only), a full linear pipeline builder (reorder/add stages), Codex as a 2nd CLI, budget *enforcement*.

**Design rules:** tokens only (no hex), **no italics**, English copy, serif-phrase CTAs, signature glyphs (`⟶`/`§`/roman numerals/substrate pills), reuse `.octo-*` motion (which already respects `prefers-reduced-motion`).

---

## File Structure

**New:**
- `src/components/DiffViewer.tsx` — read-only diff renderer extracted from `ReviewCanvas` (reuses `parseFullDiff` + a hunk/line renderer; no accept/reject).
- `src/components/RunCostMeter.tsx` — the cost card (spent / baseline / savings %, per-stage breakdown) from `runsStore`.

**Modified:**
- `src-tauri/src/db.rs` — `create_run` gains a `stage_model_overrides: &[(i64, String)]` (position→model) applied in the `run_stages` insert.
- `src-tauri/src/commands.rs` — `create_run` command gains a `stageOverrides: Option<Vec<(i64,String)>>` (or a `HashMap`) param.
- `src/lib/ipc.ts` — `createRun` wrapper gains an optional `stageOverrides` arg.
- `src/stores/runsStore.ts` — `begin(...)` threads `stageOverrides` to `createRun`.
- `src/components/PipelineSetup.tsx` — per-stage `ModelPicker`; collect overrides; pass to `begin`; refresh the estimate.
- `src/components/StageFocus.tsx` — embed `<DiffViewer>` for code stages (artifact `refsWorktree`), fetched via `ipc.getGitDiff`.
- `src/components/DirectCanvas.tsx` — mount `<RunCostMeter>` in the run state; pass `workspacePath` down for the diff fetch.
- `src/components/RunTrack.tsx` / `StageFocus.tsx` — apply `.octo-fade-in` / `.octo-rise-in` motion.
- `docs/superpowers/specs/2026-05-16-octopus-ux-redesign-design.md` + `docs/design-system.md` — document the 4th Direct mode.

---

## Task 1: Backend — run-scoped per-stage model overrides

**Files:** `src-tauri/src/db.rs`, `src-tauri/src/commands.rs`, `src/lib/ipc.ts`; Test: `src-tauri/src/tests.rs`

- [ ] **Step 1: Write the failing test**

In `src-tauri/src/tests.rs`, append to `mod run_crud_tests` (it has `test_db()` + `seed_workspace`):
```rust
    #[test]
    fn create_run_applies_stage_model_overrides() {
        let db = test_db();
        let ws = seed_workspace(&db);
        db.seed_builtin_pipelines().unwrap();
        let ff = db.list_pipelines().unwrap().into_iter().find(|p| p.name == "Feature Factory").unwrap();
        // Override the stage at position 2 (implement) to a different model.
        let overrides = vec![(2_i64, "claude-opus-4-6".to_string())];
        let run_id = db.create_run(&ws, &ff.id, "t", None, None, &overrides).unwrap();
        let stages = db.list_run_stages(&run_id).unwrap();
        let implement = stages.iter().find(|s| s.position == 2).unwrap();
        assert_eq!(implement.agent_model, "claude-opus-4-6");
        // A non-overridden stage keeps the template model.
        let plan = stages.iter().find(|s| s.position == 0).unwrap();
        assert_ne!(plan.agent_model, "claude-opus-4-6");
    }
```
Also update the EXISTING `create_run` call sites in tests (`create_run_copies_stages_and_lists`, `complete_stage_persists_outcome_and_status`, `create_run_rejects_unknown_pipeline`) to pass a trailing `&[]` (empty overrides) — the signature gains a param. (Grep `mod run_crud_tests` + `mod orchestrator_tests` + `cli_template_tests` for `.create_run(` and add `&[]` as the last arg. The orchestrator’s internal `create_run` call in tests, if any, also needs it.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd src-tauri && cargo test run_crud_tests 2>&1 | head -20`
Expected: FAIL (arity mismatch / new test unresolved).

- [ ] **Step 3: Add the param to `db.rs::create_run`**

In `src-tauri/src/db.rs`, change `create_run`'s signature + the stage-copy loop. Current end of signature: `linked_issue_key: Option<&str>,) -> AppResult<String>`. Add a param:
```rust
pub fn create_run(
    &self,
    workspace_id: &str,
    pipeline_id: &str,
    task: &str,
    reference_model: Option<&str>,
    linked_issue_key: Option<&str>,
    stage_model_overrides: &[(i64, String)],
) -> AppResult<String> {
```
In the loop that inserts `run_stages` from the pipeline stages, compute the model per stage:
```rust
    for s in &stages {
        let model = stage_model_overrides
            .iter()
            .find(|(pos, _)| *pos == s.position)
            .map(|(_, m)| m.as_str())
            .unwrap_or(s.agent_model.as_str());
        let sid = Uuid::new_v4().to_string();
        self.conn.execute(
            "INSERT INTO run_stages (id, run_id, position, role, agent_model, substrate, checkpoint, status)
             VALUES (?1,?2,?3,?4,?5,?6,?7,'pending')",
            params![sid, id, s.position, s.role, model, s.substrate, s.checkpoint as i64],
        )?;
    }
```
(Replace the existing `s.agent_model` bind with `model`. Everything else unchanged.)

- [ ] **Step 4: Thread through the command**

In `src-tauri/src/commands.rs`, the `create_run` command. Add a param and pass it (use `Vec<(i64, String)>` over the wire; Tauri deserializes a JS array of `[number, string]` tuples):
```rust
#[tauri::command]
pub async fn create_run(
    state: State<'_, AppState>,
    workspace_id: String,
    pipeline_id: String,
    task: String,
    reference_model: Option<String>,
    linked_issue_key: Option<String>,
    stage_overrides: Option<Vec<(i64, String)>>,
) -> AppResult<String> {
    let overrides = stage_overrides.unwrap_or_default();
    state.db.lock().create_run(
        &workspace_id,
        &pipeline_id,
        &task,
        reference_model.as_deref(),
        linked_issue_key.as_deref(),
        &overrides,
    )
}
```

- [ ] **Step 5: Frontend wrapper**

In `src/lib/ipc.ts`, update the `createRun` wrapper to accept overrides (a `[number,string][]`):
```typescript
  createRun: (
    workspaceId: string,
    pipelineId: string,
    task: string,
    referenceModel?: string,
    linkedIssueKey?: string,
    stageOverrides?: [number, string][],
  ) =>
    invoke<string>("create_run", {
      workspaceId,
      pipelineId,
      task,
      referenceModel: referenceModel ?? null,
      linkedIssueKey: linkedIssueKey ?? null,
      stageOverrides: stageOverrides ?? null,
    }),
```

- [ ] **Step 6: Run tests + build**

Run: `cd src-tauri && cargo test 2>&1 | tail -8` (all pass, incl. the new override test + the `&[]`-updated call sites) and `cargo build 2>&1 | tail -4`. Then `npm run typecheck 2>&1 | tail -3`.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/db.rs src-tauri/src/commands.rs src/lib/ipc.ts src-tauri/src/tests.rs
git commit -m "feat(direct): run-scoped per-stage model overrides in create_run"
```

---

## Task 2: PipelineSetup — per-stage model picker

**Files:** `src/components/PipelineSetup.tsx`, `src/stores/runsStore.ts`; Test: `npm run typecheck` + visual

- [ ] **Step 1: Thread `stageOverrides` through `runsStore.begin`**

In `src/stores/runsStore.ts`, change `begin` to accept overrides and pass them to `ipc.createRun`. The signature becomes:
```typescript
  begin: (
    workspaceId: string,
    pipelineId: string,
    task: string,
    stageOverrides: [number, string][],
    linkedIssueKey?: string,
  ) => Promise<void>;
```
And the impl's first line:
```typescript
    const runId = await ipc.createRun(workspaceId, pipelineId, task, undefined, linkedIssueKey, stageOverrides);
```
(Update the `RunsState` interface type for `begin` to match. Keep the rest of `begin` unchanged.)

- [ ] **Step 2: Update the `begin` call in DirectCanvas**

In `src/components/DirectCanvas.tsx`, `PipelineSetup`'s `onBegin` now provides overrides. Change `PipelineSetup`'s `onBegin` prop type + the call:
- `onBegin: (pipelineId: string, task: string, stageOverrides: [number, string][]) => void`
- `onBegin={(pipelineId, task, overrides) => void begin(workspaceId, pipelineId, task, overrides, linkedIssueKey ?? undefined)}`

- [ ] **Step 3: Per-stage ModelPicker in PipelineSetup**

In `src/components/PipelineSetup.tsx`, reuse the existing `ModelPicker` (`import { ModelPicker } from "./ModelPicker";`, props `{ activeModel: string; onSelectModel: (m: string) => void }`). Add override state keyed by stage position:
```typescript
  const [overrides, setOverrides] = useState<Record<number, string>>({});
```
In the per-stage row (where it currently shows `<span ...>{s.agentModel}</span>`), replace the static model text with a picker bound to the override-or-default model:
```tsx
              <div className="flex-1">
                <ModelPicker
                  activeModel={overrides[s.position] ?? s.agentModel}
                  onSelectModel={(m) =>
                    setOverrides((prev) => ({ ...prev, [s.position]: m }))
                  }
                />
              </div>
```
Update the Begin handler to build the override tuples (only positions that differ from the template) and pass them:
```typescript
  const overrideTuples = (): [number, string][] =>
    selected
      ? selected.stages
          .filter((s) => overrides[s.position] && overrides[s.position] !== s.agentModel)
          .map((s) => [s.position, overrides[s.position]] as [number, string])
      : [];
```
CTA `onClick`: `onBegin(selected.pipeline.id, task.trim(), overrideTuples())`.
Reset `overrides` to `{}` when the selected template changes (add `selectedId` to a small effect or reset in the template-select handler) so a switch doesn't carry stale per-position overrides.

- [ ] **Step 4: (Optional) reflect overrides in the estimate**

The estimate (`ipc.estimateRunCost(pipelineId)`) is template-based and does not take overrides. Leave it as a template estimate for 2c (note: a model-aware estimate is a fast-follow). Do NOT block on this.

- [ ] **Step 5: Verify + commit**

Run: `npm run typecheck 2>&1 | tail -3` and `npm run build 2>&1 | tail -4` (clean). Visual: in Direct setup, each stage row shows a model dropdown; changing it and beginning a run creates `run_stages` with the chosen models (verify in the track header models).
```bash
git add src/components/PipelineSetup.tsx src/components/DirectCanvas.tsx src/stores/runsStore.ts
git commit -m "feat(direct): per-stage model picker at run setup"
```

---

## Task 3: Extract a read-only `DiffViewer`

**Files:** `src/components/DiffViewer.tsx` (new); Test: `npm run typecheck` + `npm run build`

- [ ] **Step 1: Inspect the reusable diff pieces**

Read `src/components/ReviewCanvas.tsx` and `src/lib/diffParser.ts`. Identify `parseFullDiff(diff: string)` (returns files/hunks) and the per-hunk/per-line render (the `HunkCard`/`FileDiffSection`/`DiffLine` functions). The goal is a self-contained read-only renderer — NO accept/reject/why buttons, NO `ipc.stageHunk`/`revertHunk` calls.

- [ ] **Step 2: Implement `DiffViewer`**

Create `src/components/DiffViewer.tsx`. Use `parseFullDiff` from `../lib/diffParser` and render files → hunks → lines with the same token classes ReviewCanvas uses for add/remove/context (reuse the existing color tokens — `text-octo-verdigris` for additions, `text-octo-rouge` for deletions, `text-octo-sage` for context; match what `DiffLine` in ReviewCanvas uses). Skeleton:
```tsx
import { useMemo } from "react";
import { parseFullDiff } from "../lib/diffParser";

interface Props {
  diff: string;
}

export function DiffViewer({ diff }: Props) {
  const files = useMemo(() => parseFullDiff(diff), [diff]);
  if (!diff.trim() || files.length === 0) {
    return (
      <div className="p-4 font-mono text-xs text-octo-mute">No changes in the worktree yet.</div>
    );
  }
  return (
    <div className="flex flex-col gap-3 p-3 octo-fade-in">
      {files.map((file) => (
        <div key={file.path} className="overflow-hidden rounded-lg border border-octo-hairline">
          <div className="border-b border-octo-hairline bg-octo-panel-2 px-3 py-1.5 font-mono text-[11px] text-octo-ivory">
            {file.path}
          </div>
          <div className="overflow-x-auto font-mono text-[11px] leading-relaxed">
            {file.hunks.map((hunk, hi) => (
              <div key={hi}>
                <div className="bg-octo-panel px-3 py-1 text-octo-mute">{hunk.header}</div>
                {hunk.lines.map((line, li) => (
                  <div
                    key={li}
                    className={`whitespace-pre px-3 ${
                      line.type === "add"
                        ? "bg-[rgba(143,201,168,0.08)] text-octo-verdigris"
                        : line.type === "remove"
                        ? "bg-[rgba(209,139,139,0.08)] text-octo-rouge"
                        : "text-octo-sage"
                    }`}
                  >
                    {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
                    {line.content}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```
ADAPT the field names (`file.path`, `file.hunks`, `hunk.header`, `hunk.lines`, `line.type`, `line.content`) to the ACTUAL shapes returned by `parseFullDiff` (read `diffParser.ts` and match exactly — types likely `DiffFile`/`DiffHunk`/`DiffLine`). The inline `rgba(...)` row-tints mirror ReviewCanvas's diff line backgrounds; if ReviewCanvas uses named token classes for these, use those instead (no new hex — match the existing diff styling).

- [ ] **Step 3: Verify + commit**

Run: `npm run typecheck 2>&1 | tail -3` and `npm run build 2>&1 | tail -4`.
```bash
git add src/components/DiffViewer.tsx
git commit -m "feat(direct): read-only DiffViewer extracted from ReviewCanvas"
```

---

## Task 4: Embed the diff in the focus pane for code stages

**Files:** `src/components/StageFocus.tsx`, `src/components/DirectCanvas.tsx`; Test: `npm run typecheck` + visual

- [ ] **Step 1: Pass `workspacePath` to StageFocus**

In `src/components/DirectCanvas.tsx`, `DirectCanvas` already has `workspaceId`; add a `workspacePath` (App passes `activeWorkspace.worktreePath ?? ""` — thread a new `workspacePath: string` prop through `DirectCanvas` from App, like `defaultTask`). Pass `workspacePath` to `<StageFocus stage={...} workspacePath={workspacePath} />`. (App.tsx supplies it: `workspacePath={activeWorkspace.worktreePath ?? ""}` on the `<DirectCanvas>` element.)

- [ ] **Step 2: StageFocus fetches + shows the diff for code stages**

In `src/components/StageFocus.tsx`, add `workspacePath: string` to Props. When the selected stage's parsed artifact has `refsWorktree === true` (code stages: implement/test), fetch the worktree diff and render `<DiffViewer>` BELOW the artifact text. Use a small effect:
```tsx
import { useEffect, useState } from "react";
import { ipc } from "../lib/ipc";
import { DiffViewer } from "./DiffViewer";
// ...
  const [diff, setDiff] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    if (stage && artifact?.refsWorktree && workspacePath) {
      ipc.getGitDiff(workspacePath).then((d) => { if (!cancelled) setDiff(d); }).catch(() => {});
    } else {
      setDiff("");
    }
    return () => { cancelled = true; };
  }, [stage?.id, artifact?.refsWorktree, workspacePath]);
```
Render `{artifact?.refsWorktree && <DiffViewer diff={diff} />}` after the artifact-text block (inside the scrollable body). Keep the existing text/tool/error rendering. Confirm `ipc.getGitDiff(path)` exists and returns the raw diff string (it's used by App for Review mode).

- [ ] **Step 3: Verify + commit**

Run: `npm run typecheck 2>&1 | tail -3` and `npm run build 2>&1 | tail -4`. Visual: select an `implement`/`test` stage after it ran → the worktree diff renders under the summary.
```bash
git add src/components/StageFocus.tsx src/components/DirectCanvas.tsx
git commit -m "feat(direct): embed worktree diff in focus pane for code stages"
```

---

## Task 5: Cost meter card

**Files:** `src/components/RunCostMeter.tsx` (new), `src/components/DirectCanvas.tsx`; Test: typecheck + visual

- [ ] **Step 1: Implement `RunCostMeter`**

Create `src/components/RunCostMeter.tsx` — a compact card reading the active run + stages (props, not store, to stay presentational):
```tsx
import type { Run, RunStage } from "../lib/ipc";

interface Props {
  run: Run;
  stages: RunStage[];
}

export function RunCostMeter({ run, stages }: Props) {
  const saved = Math.max(0, run.baselineUsd - run.costUsd);
  const pct = run.baselineUsd > 0 ? Math.round((saved / run.baselineUsd) * 100) : 0;
  const fillPct = run.baselineUsd > 0 ? Math.min(100, (run.costUsd / run.baselineUsd) * 100) : 0;
  return (
    <div className="m-4 rounded-lg border border-octo-hairline bg-octo-panel-2 p-4 octo-rise-in">
      <div className="mb-2 flex items-baseline gap-4">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-octo-mute">spent</div>
          <div className="font-serif text-2xl text-octo-brass">${run.costUsd.toFixed(2)}</div>
        </div>
        {run.baselineUsd > 0 && (
          <div className="font-mono text-xs text-octo-verdigris">
            ↓ saved ${saved.toFixed(2)} ({pct}%) vs all-premium
          </div>
        )}
      </div>
      <div className="h-2 overflow-hidden rounded bg-octo-onyx">
        <div className="h-full rounded bg-octo-brass" style={{ width: `${fillPct}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-octo-mute">
        {stages.filter((s) => s.costUsd > 0).map((s) => (
          <span key={s.id}>{s.role} <b className="text-octo-sage">${s.costUsd.toFixed(2)}</b></span>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount in DirectCanvas (run state)**

In `src/components/DirectCanvas.tsx`, render `<RunCostMeter run={run} stages={stages} />` in the run-state view — between `<StageFocus>` and `<CheckpointBar>` (or just above the CheckpointBar). Keep it only in the run state (where `run` exists).

- [ ] **Step 3: Verify + commit**

`npm run typecheck` + `npm run build` clean.
```bash
git add src/components/RunCostMeter.tsx src/components/DirectCanvas.tsx
git commit -m "feat(direct): live cost meter card"
```

---

## Task 6: Motion polish

**Files:** `src/components/RunTrack.tsx`, `src/components/StageFocus.tsx`; Test: typecheck + build

- [ ] **Step 1: Apply motion primitives**

- `RunTrack.tsx`: the stage buttons already carry `octo-rise-in` (from Plan 2a) — confirm; the track meta header can get `octo-fade-in`.
- `StageFocus.tsx`: the detail body already uses `octo-fade-in`; ensure the embedded `DiffViewer` (which has its own `octo-fade-in`) doesn't double-animate awkwardly (if it does, drop the inner one).
- Do NOT hand-roll keyframes; only apply existing `.octo-*` classes. `prefers-reduced-motion` is already globally handled in `styles.css` — no per-component work.

This task is small; if everything already animates calmly from 2a, make only the minimal additions and note "no change needed" where appropriate.

- [ ] **Step 2: Verify + commit**

`npm run build 2>&1 | tail -4` clean.
```bash
git add src/components/RunTrack.tsx src/components/StageFocus.tsx
git commit -m "polish(direct): calm motion on track + focus pane"
```

---

## Task 7: Document the 4th mode in the design system

**Files:** `docs/superpowers/specs/2026-05-16-octopus-ux-redesign-design.md`, `docs/design-system.md`; Test: prose review

> CLAUDE.md requires that a new top-level mode is a spec-level change. This task makes Direct canonical.

- [ ] **Step 1: Canonical spec**

In `docs/superpowers/specs/2026-05-16-octopus-ux-redesign-design.md`: in the mode-semantics section (where Talk/Run/Review are defined), add a **Direct** entry — one paragraph: "the conductor / 4th altitude" — a pipeline of agents across the SDLC, per-workspace and optional, Canvas = assembly-line track + focus pane, Companion = Runs + Jira context, the cost-vs-baseline meter, checkpoints. Cross-reference `docs/superpowers/specs/2026-06-07-direct-mode-agent-orchestration-design.md` for the full design. Add `⌘⇧D` to the keyboard-shortcuts list. In the Screens section, add a short "Workspace · Direct" description (setup state + run state). Keep it ~40–50 lines, matching the doc's voice.

- [ ] **Step 2: Cheatsheet**

In `docs/design-system.md`: in the layout-grammar/modes section, add **Direct** to the mode list and describe its canvas (track + focus pane + cost meter). Add the new **signature patterns** introduced by Direct: substrate pills (`API` blue / `CLI` purple, `--color-octo-state-*`), the run-track with roman numerals + `⟶`/`⟜` connectors, the checkpoint bar, and the `§ ROLE` focus header. ~25–35 lines.

- [ ] **Step 3: Self-review + commit**

Re-read both edits: no contradictions with existing text, English, no invented tokens. 
```bash
git add docs/superpowers/specs/2026-05-16-octopus-ux-redesign-design.md docs/design-system.md
git commit -m "docs: document Direct as the 4th mode in the design system"
```

---

## Task 8: Final verification

- [ ] `cd src-tauri && cargo test 2>&1 | tail -6` (all pass) and `cargo build 2>&1 | tail -4` (clean).
- [ ] `npm run typecheck 2>&1 | tail -3` (clean), `npm test 2>&1 | grep -E "Tests "` (all pass), `npm run build 2>&1 | tail -4` (clean).
- [ ] `git log --oneline main..HEAD` — review the commit stack.

---

## Self-Review

**Spec coverage (Phase C-frontend + D):**
- Per-stage model swap (the cost knob) → Tasks 1–2. ✓ (run-scoped overrides; template immutable.)
- Focus pane embeds the native diff surface for code stages → Tasks 3–4. ✓ (plan/review stages keep the text view from 2a; the implement/test "native surface" is the worktree diff — there is no live terminal for a headless stage, so the diff IS the right native surface.)
- Live cost meter → Task 5. ✓
- Motion polish → Task 6. ✓
- Design-system docs document the 4th mode → Task 7. ✓ (satisfies the CLAUDE.md "new mode = spec-level change" rule.)

**Deferred (not 2c):** template editing / `clonePipeline`, linear builder (reorder/add stages), model-aware pre-run estimate, Codex CLI, budget enforcement.

**Placeholder scan:** none — the one "ADAPT field names" note (Task 3) is a deliberate instruction to match `diffParser`'s real types, not a placeholder; the implementer reads `diffParser.ts` and uses exact names.

**Type consistency:** `create_run`'s new `stage_model_overrides: &[(i64, String)]` (db) ↔ command `stage_overrides: Option<Vec<(i64,String)>>` ↔ ipc `stageOverrides?: [number,string][]` ↔ `runsStore.begin(..., stageOverrides, ...)` ↔ `PipelineSetup.onBegin(pipelineId, task, stageOverrides)` — the position→model tuple shape is consistent end to end. `DiffViewer` props `{ diff: string }`; `RunCostMeter` props `{ run, stages }`; `StageFocus` gains `workspacePath: string`.

---

## Execution Handoff

(Filled in by the writing-plans flow after approval.)
