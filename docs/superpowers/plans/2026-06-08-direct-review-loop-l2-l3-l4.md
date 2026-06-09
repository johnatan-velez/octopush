# Review Feedback Loop — L2 (gated UX) + L3 (auto mode) + L4 (templates) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the Direct review-loop fully usable: ship loop defaults on the seeded templates (L4), the "Send back" gated UX in the checkpoint bar (L2), and the automatic `auto`-mode loop driven by a parsed review verdict (L3). Builds on L1 (already on main: loop columns, `LoopMode`, `StageSpec` loop fields, retired-cost, `SendBack` action + gated-loop pause).

**Architecture:** L4 extends the seeder tuple with `(loop_target, loop_max, loop_mode)` + a one-shot backfill. L2 adds `send_back` to the IPC contract, the loop fields to the TS `RunStage`/`PipelineStage`, and a "Send back to {target}" action + iteration meter to `CheckpointBar`. L3 adds a `ReviewVerdict` parsed from a `VERDICT:` sentinel the auto-review emits, surfaces it on `StageOutcome`, and branches `drive_inner` to loop back automatically (no human) until pass or cap, falling back to a gated checkpoint on an unparseable verdict. The gated `SendBack` reset and the auto loop-back share one `Orchestrator::loop_back` helper (DRY).

**Tech Stack:** Rust (rusqlite, tokio) backend; React 19 + TS + Zustand + Tailwind frontend. Atelier design system (no italics; English copy; brass accents; `⟶`/`§` glyphs).

---

## File map
- `src-tauri/src/db.rs` — L4 seeder tuple + backfill.
- `src-tauri/src/orchestrator/types.rs` — L3 `ReviewVerdict`, `StageOutcome.verdict`.
- `src-tauri/src/orchestrator/runner.rs` — L3 verdict parser, verdict instruction, parse in `ApiRunner`.
- `src-tauri/src/orchestrator/cli_runner.rs` — L3 parse verdict in `CliRunner`.
- `src-tauri/src/orchestrator/mod.rs` — L3 `loop_back` helper, `run_stage_once` returns verdict, `drive_inner` auto branch, `SendBack` refactor to use `loop_back`.
- `src/lib/ipc.ts` — L2 `CheckpointActionName += "send_back"`, loop fields on `RunStage`/`PipelineStage`.
- `src/components/CheckpointBar.tsx`, `src/components/DirectCanvas.tsx` — L2 UX.
- tests: `src-tauri/src/tests.rs`, `src/components/CheckpointBar.test.tsx`.

---

## PHASE L4 — Template loop defaults

### Task 1: Seed loop config on builtins + backfill existing installs

**Files:** Modify `src-tauri/src/db.rs` (`seed_builtin_pipelines` ~1429). Test: `src-tauri/src/tests.rs`.

- [ ] **Step 1 — Failing test** (in `mod run_crud_tests`):
```rust
    #[test]
    fn builtins_seed_gated_loop_on_review_stages() {
        let db = test_db();
        db.seed_builtin_pipelines().unwrap();
        let ff = db.list_pipelines().unwrap().into_iter().find(|p| p.name == "Feature Factory").unwrap();
        let stages = db.get_pipeline_stages(&ff.id).unwrap();
        let cr = stages.iter().find(|s| s.role == "code_review").unwrap();
        assert_eq!(cr.loop_target_position, Some(2));        // back to implement
        assert_eq!(cr.loop_max_iterations, 2);
        assert_eq!(cr.loop_mode.as_deref(), Some("gated"));
        // A non-review stage stays linear.
        let imp = stages.iter().find(|s| s.role == "implement").unwrap();
        assert_eq!(imp.loop_target_position, None);
    }
```
- [ ] **Step 2 — Run, confirm FAIL:** `cd src-tauri && cargo test --lib builtins_seed_gated_loop 2>&1 | tail -15`
- [ ] **Step 3 — Extend the seeder tuple type + data.** In `seed_builtin_pipelines`, change the tuple element type from `(&str, &str, &str, bool)` to `(&str, &str, &str, bool, Option<i64>, i64, Option<&str>)` and add loop config to the review stages (others get `None, 0, None`). Concretely the `defs` array becomes (only the loop columns differ per the spec §3.6):
  - **Feature Factory** stages: `plan(…,None,0,None)`, `plan_review(…,None,0,None)`, `implement(…,None,0,None)`, `code_review(…, Some(2), 2, Some("gated"))`, `test(…,None,0,None)`.
  - **Bugfix relay**: `repro(…,None,0,None)`, `fix(…,None,0,None)`, `verify(…, Some(1), 2, Some("gated"))`.
  - **Plan & review**: all three `…,None,0,None` (stays linear).
  - **Claude Code build**: `plan(…,None,0,None)`, `implement(…,None,0,None)`, `code_review(…, Some(1), 2, Some("gated"))`, `test(…,None,0,None)`.
  Update the destructuring in the insert loop to `for (i, (role, model, substrate, checkpoint, lt, lm, lmode)) in stages.iter().enumerate()` and call `self.insert_pipeline_stage(&pid, i as i64, role, model, substrate, *checkpoint, *lt, *lm, *lmode)?;`.
- [ ] **Step 4 — Backfill existing installs.** Existing DBs already seeded the builtins (idempotent seeding skips them), so their review stages have NULL loop config. After the seeding loop (still inside `seed_builtin_pipelines`, before `Ok(())`), add a guarded one-shot backfill that only touches builtin review stages that are still linear:
```rust
        // Backfill: existing installs seeded the builtins before loop config existed.
        // Set the gated default on builtin review stages that are still linear. The
        // `loop_mode IS NULL` guard makes this idempotent and never overrides a config.
        self.conn.execute(
            "UPDATE pipeline_stages
             SET loop_target_position =
                   (SELECT MAX(prev.position) FROM pipeline_stages prev
                    WHERE prev.pipeline_id = pipeline_stages.pipeline_id
                      AND prev.role IN ('implement','fix')
                      AND prev.position < pipeline_stages.position),
                 loop_max_iterations = 2,
                 loop_mode = 'gated'
             WHERE loop_mode IS NULL
               AND role IN ('code_review','verify')
               AND pipeline_id IN (SELECT id FROM pipelines WHERE is_builtin = 1)
               AND EXISTS (SELECT 1 FROM pipeline_stages prev
                           WHERE prev.pipeline_id = pipeline_stages.pipeline_id
                             AND prev.role IN ('implement','fix')
                             AND prev.position < pipeline_stages.position)",
            [],
        )?;
```
  (This sets the target to the nearest preceding `implement`/`fix` stage; the `EXISTS` guard avoids setting a loop on a review with no code stage before it.)
- [ ] **Step 5 — Run the new test (PASS) + full suite:** `cd src-tauri && cargo test --lib 2>&1 | tail -8`. Fix any builtin-stage-count assertions if affected (counts are unchanged; only loop columns change). Note: 5 `pty_*` `PermissionDenied` failures are a known sandbox artifact — ignore.
- [ ] **Step 6 — Add a backfill test** (in `mod run_crud_tests`):
```rust
    #[test]
    fn backfill_sets_loop_on_pre_existing_builtin_review_stages() {
        let db = test_db();
        // Simulate an old install: seed a builtin-shaped pipeline with NO loop config.
        let pid = db.insert_pipeline("Feature Factory", "d", true).unwrap();
        db.insert_pipeline_stage(&pid, 0, "plan", "m", "api", false, None, 0, None).unwrap();
        db.insert_pipeline_stage(&pid, 1, "implement", "m", "api", true, None, 0, None).unwrap();
        db.insert_pipeline_stage(&pid, 2, "code_review", "m", "api", true, None, 0, None).unwrap();
        // Running the seeder backfills the review stage (seeding itself is skipped — name exists).
        db.seed_builtin_pipelines().unwrap();
        let stages = db.get_pipeline_stages(&pid).unwrap();
        let cr = stages.iter().find(|s| s.role == "code_review").unwrap();
        assert_eq!(cr.loop_target_position, Some(1));
        assert_eq!(cr.loop_mode.as_deref(), Some("gated"));
    }
```
- [ ] **Step 7 — Commit:** `git add src-tauri/src/db.rs src-tauri/src/tests.rs && git commit -m "feat(direct/L4): seed gated loop on builtin review stages + backfill existing installs"`

---

## PHASE L2 — Gated "Send back" UX

### Task 2: IPC contract — `send_back` action + loop fields on the TS types

**Files:** Modify `src/lib/ipc.ts`. Verify with `npm run typecheck`.

- [ ] **Step 1** — `CheckpointActionName` (line 66): add `"send_back"`:
```ts
export type CheckpointActionName = "approve" | "reject" | "edit" | "abort" | "send_back";
```
- [ ] **Step 2** — `RunStage` interface (after `finishedAt`): add the four serialized loop fields (camelCase, matching the Rust `RunStageRow`):
```ts
  loopTargetPosition: number | null;
  loopMaxIterations: number;
  loopMode: "gated" | "auto" | null;
  loopIterations: number;
```
- [ ] **Step 3** — `PipelineStage` interface (after `checkpoint`): add the three template loop fields:
```ts
  loopTargetPosition: number | null;
  loopMaxIterations: number;
  loopMode: "gated" | "auto" | null;
```
- [ ] **Step 4** — `npm run typecheck` must pass (no callers break; these are additive). Commit: `git add src/lib/ipc.ts && git commit -m "feat(direct/L2): send_back action + loop fields in the IPC contract"`

### Task 3: CheckpointBar — "Send back to {target}" action + iteration meter

**Files:** Modify `src/components/CheckpointBar.tsx`, `src/components/DirectCanvas.tsx`. Test: `src/components/CheckpointBar.test.tsx` (new).

Read the current `CheckpointBar.tsx` and `DirectCanvas.tsx` first. Design:
- `CheckpointBar` gains props: `loopTargetRole: string | null` (the human label target, or null if the stage has no usable loop), `loopState: { iteration: number; max: number } | null`, and `onSendBack: (feedback: string) => void`.
- When `loopTargetRole` is set and not at cap (`loopState.iteration < loopState.max`), render a **primary** action `⟶ Send back to {loopTargetRole}` (brass, upright serif phrase — NO italics per the repo's no-italic rule) beside **Approve & continue** / **Reject** / **Abort**. Reuse the existing `rejecting` textarea flow so the human can attach feedback to the send-back too (a "Send back ⟶" submit in that panel, distinct from "Re-run the stage ⟶").
- Show the iteration meta when `loopState` is set: `Reviewed {iteration} of {max} — changes requested` in `font-mono text-[9px] uppercase tracking-[0.12em] text-octo-mute` (brass-mono meta voice). At the cap, hide/disable Send back and show `Loop exhausted ({max}/{max}) — approve or abort`.
- All copy English. No new colors. Use `octo-rise-in`/existing motion classes already in the file.

- [ ] **Step 1 — Failing test** `src/components/CheckpointBar.test.tsx` (Vitest + @testing-library/react). Mirror the structure of existing component tests (e.g. `ModelPicker.test.tsx`). Cover:
  - Renders "Send back to Implement" when `loopTargetRole="Implement"` and `loopState={iteration:0,max:2}`; clicking it (then submitting feedback) calls `onSendBack` with the feedback.
  - Does NOT render a Send back action when `loopTargetRole={null}`.
  - At cap (`loopState={iteration:2,max:2}`) the Send back action is absent/disabled and the "Loop exhausted" text shows.
  - The existing Approve/Reject/Abort still render for a normal checkpoint (`loopTargetRole={null}`).
  Use `labelForRole` is already imported in the component; tests pass roles via the props as plain strings.
- [ ] **Step 2 — Run, confirm FAIL:** `npx vitest run src/components/CheckpointBar 2>&1 | tail -20`
- [ ] **Step 3 — Implement** the CheckpointBar changes above.
- [ ] **Step 4 — Wire DirectCanvas.** Compute from the run's `stages` (in `DirectCanvas.tsx`, where `blockedStage` is derived): if `blockedStage` has a gated loop (`blockedStage.loopMode === "gated" && blockedStage.loopTargetPosition !== null`), find the target stage `stages.find(s => s.position === blockedStage.loopTargetPosition)`, pass `loopTargetRole={labelForRole(target.role)}` and `loopState={{ iteration: blockedStage.loopIterations, max: blockedStage.loopMaxIterations }}`; else pass `loopTargetRole={null} loopState={null}`. Wire `onSendBack={(fb) => void resolve(run.id, "send_back", fb || undefined)}`. `labelForRole` is exported from `RunTrack`.
- [ ] **Step 5 — Run tests + typecheck:** `npx vitest run src/components/CheckpointBar 2>&1 | tail -10` then `npm run typecheck`. Commit: `git add src/components/CheckpointBar.tsx src/components/DirectCanvas.tsx src/components/CheckpointBar.test.tsx && git commit -m "feat(direct/L2): Send back to {target} checkpoint action + iteration meter"`

---

## PHASE L3 — Auto mode (verdict-driven automatic loop)

### Task 4: `ReviewVerdict` + verdict parser + `StageOutcome.verdict`

**Files:** Modify `src-tauri/src/orchestrator/types.rs`, `src-tauri/src/orchestrator/runner.rs`. Test: `src-tauri/src/tests.rs`.

- [ ] **Step 1 — Failing test** (new module `mod verdict_tests` in tests.rs):
```rust
#[cfg(test)]
mod verdict_tests {
    use crate::orchestrator::runner::parse_verdict;
    use crate::orchestrator::types::ReviewVerdict;

    #[test]
    fn parses_pass_and_changes_and_handles_noise() {
        assert_eq!(parse_verdict("looks good\nVERDICT: PASS"), Some(ReviewVerdict::Pass));
        assert_eq!(parse_verdict("issues found\nVERDICT: CHANGES_REQUESTED\n"), Some(ReviewVerdict::ChangesRequested));
        // last verdict line wins
        assert_eq!(parse_verdict("VERDICT: PASS\n...\nVERDICT: CHANGES_REQUESTED"), Some(ReviewVerdict::ChangesRequested));
        // case/space tolerant
        assert_eq!(parse_verdict("  verdict:  pass  "), Some(ReviewVerdict::Pass));
        // missing / malformed → None (caller gates)
        assert_eq!(parse_verdict("no verdict here"), None);
        assert_eq!(parse_verdict("VERDICT: maybe"), None);
    }
}
```
- [ ] **Step 2 — Run, confirm FAIL:** `cd src-tauri && cargo test --lib verdict_tests 2>&1 | tail -15`
- [ ] **Step 3 — Add `ReviewVerdict`** to types.rs (near `LoopMode`):
```rust
/// A review stage's structured pass/changes-requested signal (auto mode).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ReviewVerdict {
    Pass,
    ChangesRequested,
}
```
  And add `pub verdict: Option<ReviewVerdict>,` to `StageOutcome` (after `error`).
- [ ] **Step 4 — Add `parse_verdict`** (pure) to runner.rs:
```rust
/// Parse the LAST `VERDICT: PASS|CHANGES_REQUESTED` line from a review stage's
/// output (case/space tolerant). `None` when absent or malformed — the caller
/// then falls back to a gated checkpoint rather than looping blindly.
pub fn parse_verdict(text: &str) -> Option<crate::orchestrator::types::ReviewVerdict> {
    use crate::orchestrator::types::ReviewVerdict;
    let mut found = None;
    for line in text.lines() {
        let l = line.trim();
        if let Some(rest) = l.strip_prefix("VERDICT:").or_else(|| l.strip_prefix("verdict:")) {
            match rest.trim().to_ascii_uppercase().as_str() {
                "PASS" => found = Some(ReviewVerdict::Pass),
                "CHANGES_REQUESTED" => found = Some(ReviewVerdict::ChangesRequested),
                _ => {}
            }
        }
    }
    found
}
```
  (The `strip_prefix` lowercase branch handles a lowercase `verdict:`; the value is upcased before matching.)
- [ ] **Step 5 — Set `verdict` on both runners' success outcome.** In `ApiRunner::run` (runner.rs) the `Ok(r)` arm builds `StageOutcome { … }` — add `verdict: parse_verdict(&r.text),`. In the failure arm add `verdict: None,`. In `cli_runner.rs` `parse_cli_result` (the Done outcome) add `verdict: parse_verdict(&parsed.result),` and `verdict: None` on the failed/error outcomes and in the `failed_stage` helper. Search for every `StageOutcome {` literal (incl. tests' `MockRunner`) and add `verdict: None` where not otherwise set so it compiles.
- [ ] **Step 6 — Run verdict tests + suite:** `cd src-tauri && cargo test --lib verdict 2>&1 | tail -10` then `cargo test --lib 2>&1 | tail -8`. Commit: `git add -A && git commit -m "feat(direct/L3): ReviewVerdict + VERDICT: sentinel parser on StageOutcome"`

### Task 5: Auto-verdict system-prompt instruction (runners)

**Files:** Modify `src-tauri/src/orchestrator/runner.rs` (a `VERDICT_INSTRUCTION` const + append in `ApiRunner`), `src-tauri/src/orchestrator/cli_runner.rs` (append in `CliRunner`). Test: `src-tauri/src/tests.rs`.

- [ ] **Step 1 — Failing test** (in `runner_helpers_tests`):
```rust
    #[test]
    fn auto_review_prompt_requests_a_verdict() {
        use crate::orchestrator::runner::system_prompt_with_loop;
        use crate::orchestrator::types::LoopMode;
        let auto = system_prompt_with_loop("code_review", Some(LoopMode::Auto));
        assert!(auto.contains("VERDICT:"));
        let gated = system_prompt_with_loop("code_review", Some(LoopMode::Gated));
        assert!(!gated.contains("VERDICT:"));
        let plain = system_prompt_with_loop("implement", None);
        assert!(!plain.contains("VERDICT:"));
    }
```
- [ ] **Step 2 — Run, confirm FAIL.**
- [ ] **Step 3 — Add** to runner.rs a const + a wrapper that both runners call instead of `system_prompt_for` directly:
```rust
const VERDICT_INSTRUCTION: &str = "\n\nThis is an automated review. After your findings, end your \
    response with EXACTLY ONE line, on its own line: `VERDICT: PASS` if the changes are acceptable, \
    or `VERDICT: CHANGES_REQUESTED` if they must be revised. Emit nothing after that line.";

/// `system_prompt_for(role)` plus the auto-mode verdict instruction when this is
/// an auto-loop stage.
pub fn system_prompt_with_loop(role: &str, loop_mode: Option<crate::orchestrator::types::LoopMode>) -> String {
    let base = system_prompt_for(role);
    if matches!(loop_mode, Some(crate::orchestrator::types::LoopMode::Auto)) {
        format!("{base}{VERDICT_INSTRUCTION}")
    } else {
        base
    }
}
```
- [ ] **Step 4 — Use it in both runners.** In `ApiRunner::run`, replace `let system = system_prompt_for(&stage.role);` with `let system = system_prompt_with_loop(&stage.role, stage.loop_mode.clone());`. Same in `CliRunner::run`. (`StageSpec.loop_mode` is `Option<LoopMode>`, added in L1.)
- [ ] **Step 5 — Run + suite. Commit:** `git add -A && git commit -m "feat(direct/L3): auto-review stages request a VERDICT in their system prompt"`

### Task 6: `loop_back` helper + `run_stage_once` surfaces the verdict + `SendBack` refactor

**Files:** Modify `src-tauri/src/orchestrator/mod.rs`. Test: `src-tauri/src/tests.rs`.

- [ ] **Step 1 — Add the shared `loop_back` helper** on `impl Orchestrator` (extracts the SendBack range-reset; `feedback` is the human text for SendBack or the review's findings for auto):
```rust
    /// Reset the contiguous [target..=review] range to pending (re-running the
    /// target + intervening stages with `feedback` on the target), retiring the
    /// erased cost and bumping the loop counter. Shared by gated SendBack and the
    /// auto loop. Caller guarantees `review` has a valid `loop_target_position`
    /// strictly before `review.position` and iterations remaining.
    fn loop_back(&self, run_id: &str, review: &crate::db::RunStageRow, feedback: Option<&str>) -> AppResult<()> {
        let target_pos = review.loop_target_position.expect("loop_back requires a target");
        let stages = self.db.lock().list_run_stages(run_id)?;
        for s in &stages {
            if s.position >= target_pos && s.position <= review.position {
                self.db.lock().retire_stage_cost(run_id, s.cost_usd, s.input_tokens, s.output_tokens)?;
                let fb = if s.position == target_pos { feedback } else { None };
                self.db.lock().reset_run_stage(&s.id, None, fb)?;
            }
        }
        self.db.lock().increment_loop_iteration(&review.id)?;
        self.recompute_run_cost(run_id)?;
        Ok(())
    }
```
- [ ] **Step 2 — Refactor the `SendBack` arm** in `resolve_checkpoint` to call `loop_back` (keeps the L1 guards: `review.status == "awaiting_checkpoint"`, `target_pos < review.position`, `loop_iterations < loop_max_iterations`). Replace the inline `for s in &stages { … } increment … recompute` block with `self.loop_back(run_id, review, feedback.as_deref())?;`. Run `cargo test --lib send_back 2>&1 | tail` — the L1 SendBack tests must still pass unchanged.
- [ ] **Step 3 — Make `run_stage_once` surface the verdict.** Change its return type from `AppResult<StageStatus>` to `AppResult<(StageStatus, Option<ReviewVerdict>)>`. On the `Done` path return `Ok((StageStatus::Done, outcome.verdict.clone()))`; on every `Failed`/error path return `Ok((StageStatus::Failed, None))` (and the early-substrate-error returns). Update the single caller in `drive_inner` to `let (status, verdict) = self.run_stage_once(&run, &stage).await?;`.
- [ ] **Step 4 — Compile-check** (no behavior change yet): `cd src-tauri && cargo test --lib 2>&1 | tail -8` — all L1 tests still pass.
- [ ] **Step 5 — Commit:** `git add -A && git commit -m "feat(direct/L3): extract loop_back helper + thread review verdict out of run_stage_once"`

### Task 7: Auto loop branch in `drive_inner`

**Files:** Modify `src-tauri/src/orchestrator/mod.rs`. Test: `src-tauri/src/tests.rs`.

- [ ] **Step 1 — Failing tests** (in `mod orchestrator_tests`). Add a runner that emits a configurable verdict, and a helper to build an auto-loop run:
```rust
    /// A runner whose review-role output carries a verdict; everything else Done.
    struct VerdictRunner { verdict: &'static str } // "PASS" | "CHANGES_REQUESTED" | "" (none)
    #[async_trait::async_trait]
    impl AgentRunner for VerdictRunner {
        async fn run(&self, stage: &StageSpec, _i: &StageArtifact, _c: &StageContext)
            -> crate::error::AppResult<StageOutcome> {
            let is_review = matches!(stage.role.as_str(), "code_review" | "verify");
            let text = if is_review && !self.verdict.is_empty() { format!("findings\nVERDICT: {}", self.verdict) } else { "did it".into() };
            Ok(StageOutcome {
                artifact: StageArtifact { kind: ArtifactKind::Note, text: text.clone(), payload: None, refs_worktree: false },
                input_tokens: 10, output_tokens: 2, cost_usd: 0.01,
                status: StageStatus::Done, tool_calls: vec![],
                error: None,
                verdict: crate::orchestrator::runner::parse_verdict(&text),
            })
        }
    }

    fn auto_run(verdict: &'static str, max_iter: i64) -> (Orchestrator, String, Arc<Mutex<Db>>) {
        let (db, ws) = db_with_workspace();
        let pid = db.lock().insert_pipeline("Auto", "d", false).unwrap();
        db.lock().insert_pipeline_stage(&pid, 0, "implement", "m", "api", false, None, 0, None).unwrap();
        db.lock().insert_pipeline_stage(&pid, 1, "code_review", "m", "api", false, Some(0), max_iter, Some("auto")).unwrap();
        let run_id = db.lock().create_run(&ws, &pid, "t", None, None, &[]).unwrap();
        let sink = Arc::new(CollectingSink { events: Mutex::new(vec![]) });
        let orch = Orchestrator::new_with_runner(Arc::clone(&db), sink, Box::new(VerdictRunner { verdict }));
        (orch, run_id, db)
    }

    #[tokio::test]
    async fn auto_pass_completes_without_pausing() {
        let (orch, run_id, db) = auto_run("PASS", 2);
        let status = orch.run_to_pause(&run_id).await.unwrap();
        assert_eq!(status, RunStatus::Completed);
        assert_eq!(db.lock().list_run_stages(&run_id).unwrap()[1].status, "done");
    }

    #[tokio::test]
    async fn auto_changes_requested_loops_until_cap_then_gates() {
        // Review always asks for changes; after `max_iter` auto loop-backs it stops
        // looping and gates for a human (awaiting_checkpoint), never infinite.
        let (orch, run_id, db) = auto_run("CHANGES_REQUESTED", 2);
        let status = orch.run_to_pause(&run_id).await.unwrap();
        assert_eq!(status, RunStatus::Paused);
        let stages = db.lock().list_run_stages(&run_id).unwrap();
        assert_eq!(stages[1].status, "awaiting_checkpoint");
        assert_eq!(stages[1].loop_iterations, 2); // looped exactly `max_iter` times
    }

    #[tokio::test]
    async fn auto_unparseable_verdict_gates_instead_of_looping() {
        let (orch, run_id, db) = auto_run("", 2); // no VERDICT line
        let status = orch.run_to_pause(&run_id).await.unwrap();
        assert_eq!(status, RunStatus::Paused);
        assert_eq!(db.lock().list_run_stages(&run_id).unwrap()[1].status, "awaiting_checkpoint");
        assert_eq!(db.lock().list_run_stages(&run_id).unwrap()[1].loop_iterations, 0);
    }
```
- [ ] **Step 2 — Run, confirm FAIL** (auto stages currently just complete/pause via gated logic, not verdict-driven).
- [ ] **Step 3 — Add `stage_has_auto_loop`** (mirror `stage_has_gated_loop` with `Some(LoopMode::Auto)`), and branch the `Done` handling in `drive_inner`. The loop decision must run BEFORE the existing `Done if stage.checkpoint || stage_has_gated_loop` arm. Restructure the post-run handling like:
```rust
            match status {
                StageStatus::Failed => { /* unchanged: paused + checkpoint */ }
                StageStatus::Done => {
                    if Self::stage_has_auto_loop(&stage) {
                        let remaining = stage.loop_iterations < stage.loop_max_iterations;
                        match verdict {
                            Some(ReviewVerdict::Pass) => { /* fall through to checkpoint/continue below */ }
                            Some(ReviewVerdict::ChangesRequested) if remaining => {
                                // Re-read the review's findings to feed the target as feedback.
                                let findings = stage.artifact.as_deref()
                                    .and_then(|j| serde_json::from_str::<serde_json::Value>(j).ok())
                                    .and_then(|v| v.get("text").and_then(|t| t.as_str()).map(str::to_string));
                                self.loop_back(run_id, &stage, findings.as_deref())?;
                                self.emit_run_update(run_id);
                                continue;
                            }
                            _ => {
                                // ChangesRequested at cap, or unparseable verdict → gate.
                                self.db.lock().set_run_stage_status(&stage.id, "awaiting_checkpoint")?;
                                self.db.lock().set_run_status(run_id, "paused", false)?;
                                self.emit_checkpoint(run_id, &stage.id);
                                return Ok(RunStatus::Paused);
                            }
                        }
                    }
                    // existing gated/checkpoint handling:
                    if stage.checkpoint || Self::stage_has_gated_loop(&stage) {
                        self.db.lock().set_run_stage_status(&stage.id, "awaiting_checkpoint")?;
                        self.db.lock().set_run_status(run_id, "paused", false)?;
                        self.emit_checkpoint(run_id, &stage.id);
                        return Ok(RunStatus::Paused);
                    }
                    // else continue to next stage
                }
            }
```
  Note: `stage.artifact` here is the pre-run snapshot (None). After `run_stage_once` persisted the artifact, re-read it: replace the `stage.artifact` read with a fresh `self.db.lock().list_run_stages(run_id)?` lookup of `stage.id` to get the just-written artifact JSON, then extract `.text`. Implement that re-read so `findings` is the actual review output.
- [ ] **Step 4 — Run the auto tests + full suite:** `cd src-tauri && cargo test --lib 2>&1 | tail -8`. All gated L1 tests + the new auto tests pass. Watch for an infinite loop in `auto_changes_requested_…` — the cap (`loop_iterations < loop_max_iterations` + `increment_loop_iteration` in `loop_back`) guarantees termination; if it hangs, the counter isn't incrementing (check `loop_back`).
- [ ] **Step 5 — Commit:** `git add -A && git commit -m "feat(direct/L3): drive_inner auto loop — verdict-driven loop-back, cap gates to a human"`

---

## Self-review (against spec §3.2–§3.6, L2–L4)

- L4 templates + backfill → Task 1 (gated defaults on FF/Bugfix/Claude-Code review stages; Plan&review stays linear). ✓
- L2 IPC contract (`send_back` + loop fields) → Task 2; CheckpointBar Send-back + iteration meter + cap state + DirectCanvas wiring → Task 3. ✓
- L3 verdict (`VERDICT:` sentinel, parsed, gate-on-unparseable) → Tasks 4–5; auto loop-back + cap→gate → Tasks 6–7; shared `loop_back` (DRY with SendBack) → Task 6. ✓
- Backward-compat: linear + gated paths untouched; auto is a new branch gated on `stage_has_auto_loop`; `parse_verdict` only affects auto review stages' routing. ✓
- Termination: auto loop bounded by `loop_iterations < loop_max_iterations` + `increment_loop_iteration`; unparseable/at-cap → gate (never infinite). ✓

**Type consistency:** `ReviewVerdict { Pass, ChangesRequested }` (types.rs) ↔ `parse_verdict` (runner.rs) ↔ `StageOutcome.verdict` ↔ `run_stage_once` return tuple ↔ `drive_inner` match. `system_prompt_with_loop(role, Option<LoopMode>)` wraps `system_prompt_for`. `loop_back(run_id, &RunStageRow, Option<&str>)` shared by SendBack + auto. TS `loopMode: "gated"|"auto"|null` ↔ Rust `loop_mode` TEXT.

**Harness:** DB tests → `mod run_crud_tests` (`test_db`/`seed_workspace`). Orchestrator tests → `mod orchestrator_tests` (`db_with_workspace`, `CollectingSink`, `Orchestrator::new_with_runner`, the L1 `looped_run` helper). Frontend → Vitest mirroring `ModelPicker.test.tsx`. The 5 `pty_*` `PermissionDenied` failures are a known sandbox artifact in this worktree — ignore them; everything else must pass.
