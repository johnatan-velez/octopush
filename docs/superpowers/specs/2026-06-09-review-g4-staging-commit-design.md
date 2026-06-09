# G4 · Staging & Commit Workflow — Slice I design

> Part of the REVIEW-mode overhaul (master tracker:
> `docs/superpowers/plans/2026-06-07-review-mode-master-grouping.md`, stream **G4**,
> priority rank 5 — after G3/G5/G1/G2, all merged). Branch `feat/review-g4-staging`
> off `main`, worktree `octopus-sh-review`. Status: **spec'd** (slice 1 of 3).

## Goal

Complete the commit experience in Review: amend the last commit, discard a file's
changes, draft a commit message with AI, surface *why* a git operation failed, and wire
the `c` (focus commit) key. Built on the staging backend that already exists — this slice
is mostly additive commands + commit-area UI, and it ships the `git diff --cached`
command that Slice II's staged-hunk dimming will reuse.

## Why slice (the 3-slice plan)

- **Slice I — Commit power & safety (this spec).** Amend, discard-file, AI commit
  message (+ `get_staged_diff`), parsed git-apply errors, commit UX polish + Tier-0,
  wire `c`.
- **Slice II — Unified staging model + staged dimming (future).** Make the Review diff
  include staged changes so an accepted hunk dims in place (the `HunkRail.staged` hook)
  instead of vanishing; reconcile the per-file toggle with G3's per-hunk Accept;
  discard-hunk; the `/` file-filter; rename-display polish.
- **Slice III — Per-line staging (future).** `git add -p` line granularity.

## Current state (verified, for a fresh implementer)

- **`src-tauri/src/commands.rs`** already has (reuse, don't recreate): `stage_file`
  (`git add -- <f>`), `unstage_file` (`git restore --staged` → fallback `git reset HEAD`),
  `stage_hunk`/`apply_hunk`/`revert_hunk` (`git apply [--cached|--reverse] -p1 <tmp>`,
  each captures and returns `stderr`), `stage_all_changes` (`git add -A`),
  `unstage_all_changes` (`git reset HEAD --`), `commit_changes(workspace_path, message)
  → short SHA` (runs `git commit -m '<msg>'` via a **login shell** `$SHELL -l -c` so
  signing config applies; returns `git rev-parse --short HEAD`). All are
  `#[tauri::command] pub async fn ... -> AppResult<...>`; all call `expand_tilde(&path)`.
  Errors are `AppError::Other(String)`.
- **`src-tauri/src/lib.rs`** — commands registered in `tauri::generate_handler![...]`.
- **The Review diff** comes from `get_git_diff(path, ignore_whitespace)` →
  `git_ops::get_diff_text` which uses git2 `repo.diff_index_to_workdir(...)` —
  **unstaged changes only** (no `--cached` diff exists yet).
- **`src/lib/types.ts`** — `GitStatus { branch, changedFiles: FileChange[], ahead,
  behind, hasUpstream }`; `FileChange { path, status: "new"|"modified"|"deleted"|
  "renamed"|"unknown", staged: boolean, unstaged: boolean }`.
- **`src/components/ChangesPanel.tsx`** (448 lines) — renders Staged/Unstaged sections
  of `FileRow`s with a per-file stage/unstage toggle, a commit `<textarea>` +
  Commit/Push buttons, and rename glyphs. Reads `ipc.getGitStatus(projectPath)` on mount
  + every 5s. `handleCommit` validates `message.trim()` + `staged.length > 0`, calls
  `ipc.commitChanges`, toasts the SHA, clears the box, calls `onChange?.()`. Props:
  `{ projectPath, diff?, onFileClick?, onChange? }`.
- **`src/App.tsx`** mounts `<ChangesPanel projectPath diff onFileClick onChange>` and,
  on `onChange`, refetches `getGitStatus` + `getGitDiff` into `gitStatus`/`gitDiff`.
- **Keyboard** (`src/components/review/useDiffKeyboard.ts`) maps `c → actions.focusCommit`
  and `/ → actions.focusFilter`; ReviewCanvas accepts `onFocusCommit`/`onFocusFilter`
  props but **App passes neither** (the G3 hand-off).
- **Reusable**: `pushToast({level,title,body?,timeout?})`; `<ConfirmDialog
  title/body/destructiveLabel/cancelLabel?/requireInput?/onConfirm/onCancel>`;
  `ipc.aiComplete(model, system, prompt, maxTokens?) → {text,inputTokens,outputTokens,
  costUsd}` (G5). The app's default chat model is `claude-sonnet-4-6`.

## Architecture

### A. Backend — new commands (`commands.rs` + register in `lib.rs`)

```rust
// 1. Staged diff (git2: HEAD-tree → index). Reuses the same unified-diff printer
//    get_diff_text uses. Returns "" when nothing is staged.
#[tauri::command]
pub async fn get_staged_diff(path: String) -> AppResult<String> { /* diff_tree_to_index */ }

// 2. Amend the last commit's message (and fold in staged changes). Login shell, like
//    commit_changes. Returns the new short SHA.
#[tauri::command]
pub async fn amend_commit(workspace_path: String, message: String) -> AppResult<String> {
    // reject empty message; `git commit --amend -m '<escaped>'` via $SHELL -l -c;
    // on failure return friendly_git_error(stderr); else return `git rev-parse --short HEAD`.
}

// 3. Last commit metadata for the amend toggle's pre-fill + hint.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastCommit { pub short_sha: String, pub subject: String, pub body: String }
#[tauri::command]
pub async fn get_last_commit(workspace_path: String) -> AppResult<Option<LastCommit>> {
    // `git log -1 --format=%h%n%s%n%b`; None if the repo has no commits yet.
}

// 4. Discard a file's local changes.
#[tauri::command]
pub async fn discard_file(workspace_path: String, file_path: String) -> AppResult<()> {
    // tracked (git cat-file -e HEAD:<f> succeeds): `git restore --staged --worktree -- <f>`
    // untracked: remove the file from disk (std::fs::remove_file on the joined path).
}
```

`friendly_git_error(stderr: &str) -> String` — pure helper mapping common `git apply`
stderr to plain English:
- contains "patch does not apply" / "while searching for" → "This change no longer
  matches the file — it may have changed since. Refresh the diff and try again."
- contains "already exists in working directory" → "That file already exists — can't
  apply the change."
- otherwise → the trimmed stderr (fallback).
Wrap the error returns of `stage_hunk`, `apply_hunk`, `revert_hunk` with it (replace
`format!("git apply ... failed: {stderr}")` with `friendly_git_error(&stderr)`).

### B. Frontend IPC (`ipc.ts`)

```ts
getStagedDiff: (path: string) => invoke<string>("get_staged_diff", { path }),
amendCommit: (workspacePath: string, message: string) =>
  invoke<string>("amend_commit", { workspacePath, message }),
getLastCommit: (workspacePath: string) =>
  invoke<{ shortSha: string; subject: string; body: string } | null>("get_last_commit", { workspacePath }),
discardFile: (workspacePath: string, filePath: string) =>
  invoke<void>("discard_file", { workspacePath, filePath }),
```

### C. AI commit message (`src/lib/commitMessage.ts`, new)

```ts
export const COMMIT_SYSTEM = `You write concise git commit messages from a staged diff.
Output ONLY the message — a <=50-char imperative subject line, then (if the change
warrants it) a blank line and 1-3 short body lines explaining the why. No backticks,
no "Here is", no trailing notes.`;
export function buildCommitPrompt(stagedDiff: string): string {
  return `Write a commit message for this staged diff:\n\n${stagedDiff}`;
}
```
Used one-shot with the default model `claude-sonnet-4-6` (no model picker). `aiComplete`'s
`text` fills the message textarea (the user edits freely). On error → toast; no message
change.

### D. ChangesPanel changes

State additions: `amend: boolean`, `lastCommit: LastCommit | null`, `drafting: boolean`.

- **✨ Draft button** in the commit area, enabled only when `staged.length > 0 &&
  !drafting`. onClick: `drafting=true` → `const d = await ipc.getStagedDiff(projectPath)`
  → `const r = await ipc.aiComplete("claude-sonnet-4-6", COMMIT_SYSTEM, buildCommitPrompt(d))`
  → `setCommitMessage(r.text.trim())` → `drafting=false`. Catch → toast + `drafting=false`.
  Shows a small spinner while drafting.
- **Amend toggle** (checkbox + "Amend last commit" label) under the textarea. onChange:
  - turning ON: `const lc = await ipc.getLastCommit(projectPath)`; if `lc`, set
    `lastCommit=lc` and, **only if `commitMessage.trim() === ""`**, pre-fill
    `setCommitMessage(lc.subject + (lc.body ? "\n\n" + lc.body : ""))`. Show the hint
    `↳ folds staged into <shortSha> "<subject>"` and, when `gitStatus.ahead === 0 &&
    gitStatus.hasUpstream`, a warning line "Last commit is pushed — amending rewrites
    history."
  - turning OFF: if `commitMessage` still equals the pre-filled message, clear it; drop
    `lastCommit`.
  - If `getLastCommit` returns `null` (no commits yet), keep the toggle disabled.
- **Commit button**: label is `amend ? "Amend" : "Commit"`. `canCommit = message.trim() !==
  "" && (amend || staged.length > 0)`. onClick: `amend ? ipc.amendCommit(projectPath,
  msg) : ipc.commitChanges(projectPath, msg)` → toast SHA → clear message + `amend=false`
  → `onChange?.()`. Errors → toast (now friendly).
- **Discard file**: each `FileRow` gets a hover-revealed discard button (`aria-label=
  "Discard changes to <name>"`, rouge hover, like the editor-tab close). onClick (stop
  propagation) → opens a `ConfirmDialog` ("Discard changes to `<name>`? This can't be
  undone.", destructive "Discard") → on confirm `ipc.discardFile(projectPath, file.path)`
  → refresh + success toast.
- **Tier-0**: focus-visible brass rings + `aria-label`s on the stage toggle, commit/amend,
  draft, push, and discard controls.

### E. `c` key wiring (App.tsx)

ChangesPanel exposes a `commitFocusRef` (a `useImperativeHandle` or a forwarded ref to
the textarea) — simplest: add an optional `focusCommitSignal` prop is overkill; instead
ChangesPanel accepts an optional `registerFocusCommit?: (fn: () => void) => void` it calls
on mount with a function that focuses its textarea. App stores that fn and passes
`onFocusCommit={() => focusCommitFn.current?.()}` to ReviewCanvas. (`/` / `onFocusFilter`
is deferred to Slice II — leave it unwired; the cheatsheet keeps omitting `/`.)

## Data flow

```
✨ Draft  → getStagedDiff → aiComplete(default model, COMMIT_SYSTEM) → fill textarea (editable)
Amend ON  → getLastCommit → pre-fill (if empty) + hint + pushed-warning
Commit    → amend ? amendCommit : commitChanges → toast SHA → clear + onChange()
Discard   → ConfirmDialog → discardFile (restore tracked / delete untracked) → refresh + toast
hunk op   → stage/apply/revert_hunk → on fail: friendly_git_error → toast
c (key)   → onFocusCommit → focus the commit textarea
```

## Error handling

All git writes surface failures via `pushToast` with the *parsed* reason. Empty commit
messages are rejected (button disabled + backend guard). Discard is always confirmed and
never silently no-ops. Amend with no prior commit is impossible (toggle disabled when
`getLastCommit` is null).

## Testing

- **Rust** (`tests.rs`, `tempfile` + a `git init` helper): `get_staged_diff` returns the
  cached diff after `git add`; `amend_commit` changes HEAD's subject and returns a new
  short SHA; `get_last_commit` returns subject/body/sha (and `None` on an empty repo);
  `discard_file` restores a tracked modified file to HEAD and deletes an untracked file;
  `friendly_git_error` maps the three known stderr patterns (pure unit test, no git).
- **Front** (vitest, `ipc` mocked): Draft button calls `aiComplete` with the staged diff
  and fills the textarea; amend toggle pre-fills only when empty + shows the pushed
  warning when `ahead===0 && hasUpstream` + commit routes to `amendCommit`; discard opens
  the confirm and calls `discardFile`; `canCommit` validation; the registered focus-commit
  fn focuses the textarea.

## Scope guardrails (YAGNI / out of scope for Slice I)

Staged-hunk dimming + per-hunk staged model + discard-hunk + the `/` file-filter (Slice
II); per-line staging (Slice III); AI model picker for the commit message (one-shot
default model only); auto-push after commit; interactive rebase / reword of older commits.

## Design-system compliance

Tokens only (no hardcoded hex/rgba). English-only UI copy. No italics. The amend toggle,
draft button, discard affordance, and the AI-draft spinner reuse existing Atelier
primitives (brass accents, `§` eyebrow, mono meta, `ConfirmDialog`, toast). No new
top-level chrome — everything lives inside the existing ChangesPanel.
