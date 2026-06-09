# G4 · Staging & Commit Workflow — Slice I Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add amend, discard-file, AI-drafted commit messages, parsed git-apply errors, and the `c` focus key to Review's commit workflow — reusing the staging backend that already exists.

**Architecture:** New git2 helpers (`get_staged_diff_text`, `last_commit`) in `git_ops.rs`; thin Tauri command wrappers + `friendly_git_error` + `amend_commit`/`discard_file` in `commands.rs`; `ipc.ts` bindings; a `commitMessage.ts` prompt; and ChangesPanel UI (Draft button, amend toggle, discard affordance) + a `c`-key wire in App.

**Tech Stack:** Rust (Tauri 2 commands, git2, `tempfile`), React 19 + TypeScript, Vitest + Testing Library, `cargo test`.

**Spec:** `docs/superpowers/specs/2026-06-09-review-g4-staging-commit-design.md`

**Branch:** `feat/review-g4-staging` (worktree `octopus-sh-review`, off `main`).

---

## File structure

| File | Responsibility | Task |
|------|----------------|------|
| `src-tauri/src/git_ops.rs` *(modify)* | extract `diff_to_text`; add `get_staged_diff_text` + `last_commit` (git2) + tests | 1 |
| `src-tauri/src/commands.rs` *(modify)* | `friendly_git_error`; wrap hunk errors; commands `get_staged_diff`/`get_last_commit`/`amend_commit`/`discard_file`; tests | 2 |
| `src-tauri/src/lib.rs` *(modify)* | register the 4 new commands | 2 |
| `src/lib/ipc.ts` *(modify)* | `getStagedDiff`/`amendCommit`/`getLastCommit`/`discardFile` + `LastCommit` type | 3 |
| `src/lib/commitMessage.ts` *(new)* + test | `COMMIT_SYSTEM` + `buildCommitPrompt` | 4 |
| `src/components/ChangesPanel.tsx` *(modify)* + test | Draft button, amend toggle, discard, validation, Tier-0, focus-commit registration | 5 |
| `src/App.tsx` *(modify)* | wire `c` → focus commit textarea | 6 |

> **Reuse, do not recreate** (verified present in `commands.rs` ~2062-2256): `stage_file`,
> `unstage_file`, `stage_hunk`/`apply_hunk`/`revert_hunk`, `stage_all_changes`,
> `unstage_all_changes`, `commit_changes`. The Review diff is `git_ops::get_diff_text`
> (git2 `diff_index_to_workdir`).

---

## Task 1: git_ops — staged diff + last commit (git2)

**Files:**
- Modify: `src-tauri/src/git_ops.rs`
- Test: `src-tauri/src/git_ops.rs` (`#[cfg(test)] mod tests` at the bottom)

- [ ] **Step 1: Write the failing tests**

Add these tests inside the existing `mod tests` in `git_ops.rs` (it already has `init_repo`
+ `tempfile`). Add `use git2::{Repository, Signature};` at the top of the test module if not
present. A small commit helper (git2, no global config needed):

```rust
    // ── G4 helpers/tests ──────────────────────────────────────────
    fn commit_file(dir: &std::path::Path, name: &str, content: &str, msg: &str) -> git2::Oid {
        let repo = Repository::open(dir).unwrap();
        std::fs::write(dir.join(name), content).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new(name)).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = Signature::now("Test", "test@example.com").unwrap();
        let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        let parents: Vec<&git2::Commit> = parent.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &parents).unwrap()
    }

    #[test]
    fn staged_diff_shows_only_index_changes() {
        let dir = tempfile::tempdir().unwrap();
        init_repo(dir.path()).unwrap();
        commit_file(dir.path(), "a.txt", "one\n", "first");
        // Modify + stage; modify again unstaged.
        std::fs::write(dir.path().join("a.txt"), "two\n").unwrap();
        let repo = Repository::open(dir.path()).unwrap();
        let mut idx = repo.index().unwrap();
        idx.add_path(std::path::Path::new("a.txt")).unwrap();
        idx.write().unwrap();
        std::fs::write(dir.path().join("a.txt"), "three\n").unwrap();

        let staged = get_staged_diff_text(dir.path()).unwrap();
        assert!(staged.contains("+two"), "staged diff shows the staged line: {staged}");
        assert!(!staged.contains("+three"), "staged diff must NOT include the unstaged line");
    }

    #[test]
    fn staged_diff_empty_when_nothing_staged() {
        let dir = tempfile::tempdir().unwrap();
        init_repo(dir.path()).unwrap();
        commit_file(dir.path(), "a.txt", "one\n", "first");
        assert_eq!(get_staged_diff_text(dir.path()).unwrap(), "");
    }

    #[test]
    fn last_commit_returns_subject_and_body() {
        let dir = tempfile::tempdir().unwrap();
        init_repo(dir.path()).unwrap();
        commit_file(dir.path(), "a.txt", "one\n", "feat: thing\n\nbody line 1\nbody line 2");
        let lc = last_commit(dir.path()).unwrap().expect("a commit exists");
        assert_eq!(lc.1, "feat: thing");
        assert!(lc.2.contains("body line 1"));
        assert_eq!(lc.0.len(), 7, "short sha is 7 chars: {}", lc.0);
    }

    #[test]
    fn last_commit_none_on_empty_repo() {
        let dir = tempfile::tempdir().unwrap();
        init_repo(dir.path()).unwrap();
        assert!(last_commit(dir.path()).unwrap().is_none());
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd /Users/jonathan/TYPEFY/octopus/octopus-sh-review/src-tauri && cargo test --lib staged_diff last_commit 2>&1 | tail -20`
Expected: compile error — `get_staged_diff_text` / `last_commit` not found.

- [ ] **Step 3: Refactor `get_diff_text` to share a printer, add the two functions**

In `git_ops.rs`, extract the diff→text printing (the `buf`/`truncated`/`diff.print(...)`
block in `get_diff_text`, lines ~376-415) into a reusable helper, then have `get_diff_text`
call it, and add the two new functions. Replace the body of `get_diff_text` after the
`let diff = repo.diff_index_to_workdir(...)?;` line with `diff_to_text(&diff)`, and add:

```rust
/// Render a git2 Diff to a unified-diff string, capped at MAX_DIFF_BYTES with a
/// truncation marker. Shared by the working-tree and staged diff producers.
fn diff_to_text(diff: &git2::Diff) -> AppResult<String> {
    const MAX_DIFF_BYTES: usize = 1_048_576;
    let mut buf = Vec::new();
    let mut truncated = false;
    let print_result = diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        if buf.len() >= MAX_DIFF_BYTES { truncated = true; return false; }
        let origin = line.origin();
        if matches!(origin, '+' | '-' | ' ') { buf.push(origin as u8); }
        let remaining = MAX_DIFF_BYTES.saturating_sub(buf.len());
        let content = line.content();
        let take = remaining.min(content.len());
        buf.extend_from_slice(&content[..take]);
        if take < content.len() { truncated = true; return false; }
        true
    });
    if let Err(e) = print_result {
        if !truncated { return Err(AppError::Other(format!("diff print: {e}"))); }
    }
    let mut out = String::from_utf8_lossy(&buf).to_string();
    if truncated { out.push_str("\n... diff truncated (too large to display fully) ...\n"); }
    Ok(out)
}

/// Staged diff: HEAD tree → index (what `git diff --cached` shows). "" when nothing
/// is staged. On an empty repo (no HEAD), diffs the empty tree → index.
pub fn get_staged_diff_text(path: &Path) -> AppResult<String> {
    let repo = open_repo(path)?;
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let mut opts = git2::DiffOptions::new();
    let diff = repo
        .diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))
        .map_err(|e| AppError::Other(format!("staged diff: {e}")))?;
    diff_to_text(&diff)
}

/// (short_sha, subject, body) of HEAD, or None if the repo has no commits yet.
pub fn last_commit(path: &Path) -> AppResult<Option<(String, String, String)>> {
    let repo = open_repo(path)?;
    let commit = match repo.head().ok().and_then(|h| h.peel_to_commit().ok()) {
        Some(c) => c,
        None => return Ok(None),
    };
    let short_sha = commit.id().to_string()[..7].to_string();
    let msg = commit.message().unwrap_or("");
    // Subject = first line; body = everything after the first blank line, trimmed.
    let mut lines = msg.splitn(2, '\n');
    let subject = lines.next().unwrap_or("").trim().to_string();
    let body = lines.next().unwrap_or("").trim_start_matches('\n').trim_end().to_string();
    Ok(Some((short_sha, subject, body)))
}
```

> Confirm `get_diff_text` now ends with `diff_to_text(&diff)` and no longer has its own
> inline printer (remove the duplicated block). `open_repo` and `AppError` are already in
> scope in this file.

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test --lib staged_diff last_commit 2>&1 | tail -15`
Expected: 4 new tests pass. Also run `cargo test --lib get_diff_text 2>&1 | tail -6` to
confirm the refactor didn't break the existing diff tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/jonathan/TYPEFY/octopus/octopus-sh-review && git add src-tauri/src/git_ops.rs && git commit -m "feat(g4): git_ops staged-diff + last-commit (shared diff printer)"
```

---

## Task 2: commands — amend, discard, last-commit/staged-diff wrappers, friendly errors

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/tests.rs`

- [ ] **Step 1: Write the failing tests**

Append to `src-tauri/src/tests.rs`:

```rust
#[cfg(test)]
mod g4_staging_tests {
    use crate::commands::{discard_file_inner, friendly_git_error};
    use std::process::Command;
    use tempfile::tempdir;

    fn git(dir: &std::path::Path, args: &[&str]) {
        let ok = Command::new("git").args(args).current_dir(dir).status().unwrap().success();
        assert!(ok, "git {args:?} failed");
    }

    fn init_with_commit(dir: &std::path::Path) {
        git(dir, &["init", "-q"]);
        git(dir, &["config", "user.email", "t@t.dev"]);
        git(dir, &["config", "user.name", "T"]);
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "-qm", "first"]);
    }

    #[test]
    fn friendly_git_error_maps_known_failures() {
        assert!(friendly_git_error("error: patch does not apply").contains("no longer matches"));
        assert!(friendly_git_error("error: while searching for:\n...").contains("no longer matches"));
        assert!(friendly_git_error("already exists in working directory").contains("already exists"));
        // Unknown stderr falls through (trimmed).
        assert_eq!(friendly_git_error("  boom  "), "boom");
    }

    #[test]
    fn discard_restores_tracked_file() {
        let dir = tempdir().unwrap();
        init_with_commit(dir.path());
        std::fs::write(dir.path().join("a.txt"), "modified\n").unwrap();
        discard_file_inner(dir.path().to_str().unwrap(), "a.txt").unwrap();
        assert_eq!(std::fs::read_to_string(dir.path().join("a.txt")).unwrap(), "one\n");
    }

    #[test]
    fn discard_deletes_untracked_file() {
        let dir = tempdir().unwrap();
        init_with_commit(dir.path());
        std::fs::write(dir.path().join("new.txt"), "x").unwrap();
        discard_file_inner(dir.path().to_str().unwrap(), "new.txt").unwrap();
        assert!(!dir.path().join("new.txt").exists(), "untracked file should be deleted");
    }
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd /Users/jonathan/TYPEFY/octopus/octopus-sh-review/src-tauri && cargo test g4_staging_tests 2>&1 | tail -20`
Expected: compile error — `friendly_git_error` / `discard_file_inner` not found.

- [ ] **Step 3: Implement in `commands.rs`**

Add near the hunk-operations section:

```rust
/// Map common `git apply` stderr to a plain-English message; fall back to the
/// trimmed stderr for anything unrecognized.
pub fn friendly_git_error(stderr: &str) -> String {
    let s = stderr.to_lowercase();
    if s.contains("patch does not apply") || s.contains("while searching for") {
        "This change no longer matches the file — it may have changed since. Refresh the diff and try again.".to_string()
    } else if s.contains("already exists in working directory") {
        "That file already exists — can't apply the change.".to_string()
    } else {
        stderr.trim().to_string()
    }
}
```

In `stage_hunk`, `apply_hunk`, and `revert_hunk`, replace the error-return line
`return Err(AppError::Other(format!("git apply ... failed: {stderr}")));` (and the
`apply_hunk` one-liner variant) with:

```rust
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Other(friendly_git_error(&stderr)));
```

Add the staged-diff + last-commit + amend + discard commands:

```rust
#[tauri::command]
pub async fn get_staged_diff(path: String) -> AppResult<String> {
    let path = expand_tilde(&path);
    crate::git_ops::get_staged_diff_text(std::path::Path::new(&path))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastCommit { pub short_sha: String, pub subject: String, pub body: String }

#[tauri::command]
pub async fn get_last_commit(workspace_path: String) -> AppResult<Option<LastCommit>> {
    let workspace_path = expand_tilde(&workspace_path);
    Ok(crate::git_ops::last_commit(std::path::Path::new(&workspace_path))?
        .map(|(short_sha, subject, body)| LastCommit { short_sha, subject, body }))
}

#[tauri::command]
pub async fn amend_commit(workspace_path: String, message: String) -> AppResult<String> {
    if message.trim().is_empty() {
        return Err(AppError::Other("commit message cannot be empty".into()));
    }
    let workspace_path = expand_tilde(&workspace_path);
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
    let msg_escaped = message.replace('\'', "'\\''");
    let cmd = format!("git commit --amend -m '{}'", msg_escaped);
    let output = std::process::Command::new(&shell)
        .arg("-l").arg("-c").arg(&cmd)
        .current_dir(&workspace_path)
        .output()
        .map_err(|e| AppError::Other(format!("failed to spawn git commit --amend: {e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = if !stderr.trim().is_empty() { stderr } else { stdout };
        return Err(AppError::Other(format!("git commit --amend failed: {}", detail.trim())));
    }
    let head = std::process::Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .current_dir(&workspace_path)
        .output()
        .map_err(|e| AppError::Other(format!("failed to read HEAD: {e}")))?;
    Ok(String::from_utf8_lossy(&head.stdout).trim().to_string())
}

/// Sync core of `discard_file` (testable). Tracked → restore to HEAD; untracked → delete.
pub(crate) fn discard_file_inner(workspace_path: &str, file_path: &str) -> AppResult<()> {
    // Is the file tracked (exists in HEAD)?
    let tracked = std::process::Command::new("git")
        .args(["cat-file", "-e", &format!("HEAD:{file_path}")])
        .current_dir(workspace_path)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if tracked {
        let output = std::process::Command::new("git")
            .args(["restore", "--staged", "--worktree", "--", file_path])
            .current_dir(workspace_path)
            .output()
            .map_err(|e| AppError::Other(format!("failed to run git restore: {e}")))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Other(format!("discard failed: {}", stderr.trim())));
        }
    } else {
        // Untracked: delete the file from disk.
        let full = std::path::Path::new(workspace_path).join(file_path);
        if full.exists() {
            std::fs::remove_file(&full)
                .map_err(|e| AppError::Other(format!("discard (delete) failed: {e}")))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn discard_file(workspace_path: String, file_path: String) -> AppResult<()> {
    let workspace_path = expand_tilde(&workspace_path);
    discard_file_inner(&workspace_path, &file_path)
}
```

- [ ] **Step 4: Register the 4 commands in `lib.rs`**

In `src-tauri/src/lib.rs`'s `generate_handler![...]`, add (near the other staging
commands like `commands::commit_changes`):

```rust
            commands::get_staged_diff,
            commands::get_last_commit,
            commands::amend_commit,
            commands::discard_file,
```

- [ ] **Step 5: Run tests + build**

Run: `cargo test g4_staging_tests 2>&1 | tail -12`
Expected: 3 tests pass (`friendly_git_error_maps_known_failures`, `discard_restores_tracked_file`, `discard_deletes_untracked_file`).

Run: `cargo build 2>&1 | tail -5`
Expected: builds (warnings ok).

> **Note on amend_commit testing:** its happy path uses a login shell + signing config
> and is verified manually (see Final verification). The empty-message guard is covered by
> the frontend `canCommit` gate (Task 5) and the backend `if message.trim().is_empty()`.

- [ ] **Step 6: Commit**

```bash
cd /Users/jonathan/TYPEFY/octopus/octopus-sh-review && git add src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/src/tests.rs && git commit -m "feat(g4): amend, discard-file, staged-diff/last-commit commands + friendly git errors"
```

---

## Task 3: IPC bindings

**Files:**
- Modify: `src/lib/ipc.ts`

- [ ] **Step 1: Add the type + functions**

Near the other type exports at the top of `ipc.ts`, add:

```ts
export interface LastCommit { shortSha: string; subject: string; body: string }
```

In the ipc object (near `commitChanges`), add:

```ts
  getStagedDiff: (path: string) => invoke<string>("get_staged_diff", { path }),
  amendCommit: (workspacePath: string, message: string) =>
    invoke<string>("amend_commit", { workspacePath, message }),
  getLastCommit: (workspacePath: string) =>
    invoke<LastCommit | null>("get_last_commit", { workspacePath }),
  discardFile: (workspacePath: string, filePath: string) =>
    invoke<void>("discard_file", { workspacePath, filePath }),
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/jonathan/TYPEFY/octopus/octopus-sh-review && npm run typecheck 2>&1 | tail -4`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ipc.ts && git commit -m "feat(g4): ipc getStagedDiff/amendCommit/getLastCommit/discardFile"
```

---

## Task 4: commit-message prompt

**Files:**
- Create: `src/lib/commitMessage.ts`
- Test: `src/lib/commitMessage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/commitMessage.test.ts
import { describe, it, expect } from "vitest";
import { COMMIT_SYSTEM, buildCommitPrompt } from "./commitMessage";

describe("commitMessage", () => {
  it("system prompt asks for message-only, subject + optional body", () => {
    expect(COMMIT_SYSTEM).toMatch(/ONLY the message/i);
    expect(COMMIT_SYSTEM).toMatch(/subject/i);
  });
  it("buildCommitPrompt embeds the staged diff", () => {
    expect(buildCommitPrompt("DIFFX")).toContain("DIFFX");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/commitMessage.test.ts`
Expected: FAIL — Cannot find module.

- [ ] **Step 3: Implement**

```ts
// src/lib/commitMessage.ts
export const COMMIT_SYSTEM = `You write concise git commit messages from a staged diff. Output ONLY the message — a <=50-character imperative subject line, then (only if the change warrants it) a blank line and 1-3 short body lines explaining the why. No backticks, no "Here is", no quotes around the message, no trailing notes.`;

export function buildCommitPrompt(stagedDiff: string): string {
  return `Write a commit message for this staged diff:\n\n${stagedDiff}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/commitMessage.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/commitMessage.ts src/lib/commitMessage.test.ts && git commit -m "feat(g4): commit-message AI prompt"
```

---

## Task 5: ChangesPanel — Draft, amend toggle, discard, validation, Tier-0

**Files:**
- Modify: `src/components/ChangesPanel.tsx`
- Test: `src/components/ChangesPanel.test.tsx` *(new)*

**Context:** Current relevant code (`ChangesPanel.tsx`): state at lines 46-51 (`gitStatus`,
`commitMessage`, `busyPath`, `committing`, `pushing`); `staged`/`unstaged`/`ahead`/
`hasUpstream` derived at 68-72; `handleCommit` at 113-130; `canCommit` at 150. The commit
`<textarea>` + Commit button live in the JSX after line 174 (the staged/unstaged sections,
then the commit box). `pushToast` and `ipc` are imported; `FileChange` from `../lib/types`.
Default AI model string: `"claude-sonnet-4-6"`.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/ChangesPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const ipcMock = {
  getGitStatus: vi.fn(),
  stageFile: vi.fn(), unstageFile: vi.fn(), unstageAllChanges: vi.fn(),
  commitChanges: vi.fn(), amendCommit: vi.fn(), pushBranch: vi.fn(),
  getStagedDiff: vi.fn(), getLastCommit: vi.fn(), discardFile: vi.fn(),
  aiComplete: vi.fn(),
};
vi.mock("../lib/ipc", () => ({ ipc: ipcMock }));
const pushToast = vi.fn();
vi.mock("./Toasts", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));
// Stores referenced by handleCommit — IMPORTANT: match the ACTUAL import paths used
// in ChangesPanel.tsx (open the file and copy them; adjust these two mock paths/exports
// if they differ, e.g. a different module name or a hook vs object shape).
vi.mock("../stores/projectStore", () => ({ useProjectStore: { getState: () => ({ current: null }) } }));
vi.mock("../stores/workspaceStore", () => ({ useWorkspaceStore: { getState: () => ({ loadGitSummaries: vi.fn() }) } }));

import { ChangesPanel } from "./ChangesPanel";

const STATUS = {
  branch: "main", ahead: 0, behind: 0, hasUpstream: true,
  changedFiles: [
    { path: "a.ts", status: "modified", staged: true, unstaged: false },
    { path: "b.ts", status: "modified", staged: false, unstaged: true },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  ipcMock.getGitStatus.mockResolvedValue(STATUS);
});

describe("ChangesPanel G4", () => {
  it("Draft fills the message from the staged diff via aiComplete", async () => {
    ipcMock.getStagedDiff.mockResolvedValue("DIFF");
    ipcMock.aiComplete.mockResolvedValue({ text: "feat: drafted", inputTokens: 1, outputTokens: 1, costUsd: 0 });
    render(<ChangesPanel projectPath="/repo" />);
    await screen.findByText("a.ts");
    await userEvent.click(screen.getByRole("button", { name: /draft/i }));
    await waitFor(() => expect(ipcMock.aiComplete).toHaveBeenCalled());
    expect(ipcMock.getStagedDiff).toHaveBeenCalledWith("/repo");
    expect((screen.getByPlaceholderText(/describe the change/i) as HTMLTextAreaElement).value)
      .toBe("feat: drafted");
  });

  it("amend toggle pre-fills the last commit message and shows the pushed warning", async () => {
    ipcMock.getLastCommit.mockResolvedValue({ shortSha: "a3f12c8", subject: "fix: bug", body: "" });
    render(<ChangesPanel projectPath="/repo" />);
    await screen.findByText("a.ts");
    await userEvent.click(screen.getByLabelText(/amend last commit/i));
    await waitFor(() => expect(ipcMock.getLastCommit).toHaveBeenCalledWith("/repo"));
    expect((screen.getByPlaceholderText(/describe the change/i) as HTMLTextAreaElement).value)
      .toBe("fix: bug");
    expect(screen.getByText(/rewrites history/i)).toBeInTheDocument();
  });

  it("committing with amend on routes to amendCommit", async () => {
    ipcMock.getLastCommit.mockResolvedValue({ shortSha: "a3f12c8", subject: "fix: bug", body: "" });
    ipcMock.amendCommit.mockResolvedValue("b4c5d6e");
    render(<ChangesPanel projectPath="/repo" />);
    await screen.findByText("a.ts");
    await userEvent.click(screen.getByLabelText(/amend last commit/i));
    await screen.findByDisplayValue("fix: bug");
    await userEvent.click(screen.getByRole("button", { name: /^amend$/i }));
    await waitFor(() => expect(ipcMock.amendCommit).toHaveBeenCalledWith("/repo", "fix: bug"));
    expect(ipcMock.commitChanges).not.toHaveBeenCalled();
  });

  it("discard opens a confirm and calls discardFile", async () => {
    ipcMock.discardFile.mockResolvedValue(undefined);
    render(<ChangesPanel projectPath="/repo" />);
    await screen.findByText("b.ts");
    await userEvent.click(screen.getByLabelText(/discard changes to b\.ts/i));
    await userEvent.click(await screen.findByRole("button", { name: /^discard$/i }));
    await waitFor(() => expect(ipcMock.discardFile).toHaveBeenCalledWith("/repo", "b.ts"));
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/ChangesPanel.test.tsx`
Expected: FAIL (no Draft/amend/discard UI yet).

- [ ] **Step 3: Implement the UI in `ChangesPanel.tsx`**

Add imports at the top:
```ts
import { useState } from "react"; // already imported — keep
import { ConfirmDialog } from "./ConfirmDialog";
import { COMMIT_SYSTEM, buildCommitPrompt } from "../lib/commitMessage";
```
Add `import type { LastCommit } from "../lib/ipc";`

Add state (next to the other `useState`s, ~line 51):
```ts
  const [amend, setAmend] = useState(false);
  const [lastCommit, setLastCommit] = useState<LastCommit | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [discardTarget, setDiscardTarget] = useState<string | null>(null);
```

> The old `handleCommit` (lines 113-130) is **superseded** by `handleCommitOrAmend`
> below — the Commit/Amend button calls the new handler; delete the old `handleCommit`
> to avoid dead code.

Add the handlers (near where `handleCommit` was):
```ts
  async function handleDraft() {
    setDrafting(true);
    try {
      const d = await ipc.getStagedDiff(projectPath);
      const r = await ipc.aiComplete("claude-sonnet-4-6", COMMIT_SYSTEM, buildCommitPrompt(d));
      setCommitMessage(r.text.trim());
    } catch (e) {
      pushToast({ level: "error", title: "Couldn't draft message", body: String(e) });
    } finally {
      setDrafting(false);
    }
  }

  async function toggleAmend(next: boolean) {
    setAmend(next);
    if (next) {
      try {
        const lc = await ipc.getLastCommit(projectPath);
        setLastCommit(lc);
        if (lc && commitMessage.trim() === "") {
          setCommitMessage(lc.subject + (lc.body ? "\n\n" + lc.body : ""));
        }
      } catch {
        setLastCommit(null);
      }
    } else {
      const prefill = lastCommit ? lastCommit.subject + (lastCommit.body ? "\n\n" + lastCommit.body : "") : "";
      if (commitMessage === prefill) setCommitMessage("");
      setLastCommit(null);
    }
  }

  async function handleCommitOrAmend() {
    const msg = commitMessage.trim();
    if (!msg || (!amend && staged.length === 0)) return;
    setCommitting(true);
    try {
      const sha = amend ? await ipc.amendCommit(projectPath, msg) : await ipc.commitChanges(projectPath, msg);
      const pid = useProjectStore.getState().current?.id;
      if (pid) void useWorkspaceStore.getState().loadGitSummaries(pid);
      pushToast({ level: "success", title: amend ? "Amended" : "Committed", body: sha });
      setCommitMessage(""); setAmend(false); setLastCommit(null);
      await refresh(); onChange?.();
    } catch (e) {
      pushToast({ level: "error", title: amend ? "Amend failed" : "Commit failed", body: String(e) });
    } finally {
      setCommitting(false);
    }
  }

  async function confirmDiscard() {
    const path = discardTarget;
    if (!path) return;
    setDiscardTarget(null);
    try {
      await ipc.discardFile(projectPath, path);
      pushToast({ level: "success", title: "Changes discarded", body: path });
      await refresh(); onChange?.();
    } catch (e) {
      pushToast({ level: "error", title: "Discard failed", body: String(e) });
    }
  }
```

Update `canCommit` (line ~150) to honor amend:
```ts
  const canCommit = commitMessage.trim().length > 0 && (amend || staged.length > 0) && !committing;
```

In the commit-area JSX (after the file sections), wire the textarea, the Draft button, the
amend toggle + hint/warning, and the Commit/Amend button. Replace the existing commit
`<textarea>` + Commit button block with:

```tsx
      <div className="shrink-0 border-t border-octo-hairline p-3">
        <div className="relative">
          <textarea
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Describe the change…"
            rows={3}
            ref={commitRef}
            className="w-full resize-none rounded-md border border-octo-hairline bg-octo-onyx p-2 pr-16 text-[12px] text-octo-ivory focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-octo-brass"
          />
          <button
            type="button"
            onClick={handleDraft}
            disabled={staged.length === 0 || drafting}
            aria-label="Draft commit message with AI"
            className="absolute right-2 top-2 rounded font-mono text-[9px] uppercase tracking-[0.12em] text-octo-brass disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-octo-brass"
            style={{ border: "1px solid var(--brass-dim)", padding: "1px 6px" }}
          >
            {drafting ? "…" : "✨ Draft"}
          </button>
        </div>

        <label className="mt-2 flex items-center gap-2 text-[11px] text-octo-sage">
          <input
            type="checkbox"
            checked={amend}
            disabled={committing}
            onChange={(e) => toggleAmend(e.target.checked)}
            aria-label="Amend last commit"
            className="accent-octo-brass focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-octo-brass"
          />
          Amend last commit
        </label>
        {amend && lastCommit && (
          <div className="mt-1 font-mono text-[9px] text-octo-mute">
            ↳ folds staged into {lastCommit.shortSha} "{lastCommit.subject}"
          </div>
        )}
        {amend && ahead === 0 && hasUpstream && (
          <div className="mt-1 font-mono text-[9px] text-octo-rouge">
            Last commit is pushed — amending rewrites history.
          </div>
        )}

        <button
          type="button"
          onClick={handleCommitOrAmend}
          disabled={!canCommit}
          className="mt-2 w-full rounded-md py-1.5 text-[12px] font-semibold text-octo-onyx disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-octo-brass"
          style={{ background: "var(--color-octo-brass)" }}
        >
          {amend ? "Amend" : "Commit"}
        </button>
      </div>

      {discardTarget && (
        <ConfirmDialog
          title="Discard changes"
          body={`Discard changes to ${discardTarget.split("/").pop()}? This can't be undone.`}
          destructiveLabel="Discard"
          cancelLabel="Cancel"
          onConfirm={confirmDiscard}
          onCancel={() => setDiscardTarget(null)}
        />
      )}
```

Add a `commitRef` near the state: `const commitRef = useRef<HTMLTextAreaElement>(null);`
(import `useRef`). Register a focus hook for the `c` key (Task 6 consumes it): accept an
optional prop and call it on mount —

In `Props` add: `registerFocusCommit?: (fn: () => void) => void;` and in the component
signature destructure it; then:
```ts
  useEffect(() => {
    registerFocusCommit?.(() => commitRef.current?.focus());
  }, [registerFocusCommit]);
```

Add the discard affordance to each `FileRow` (the unstaged/all file rows). In the
`FileRow` render, add a hover-revealed discard button (mirror the editor-tab close
pattern), calling `onDiscard(file.path)`; thread an `onDiscard` prop from the panel that
does `setDiscardTarget(path)`. Concretely, in the `FileRow` component add:
```tsx
        <button
          type="button"
          aria-label={`Discard changes to ${file.path.split("/").pop()}`}
          onClick={(e) => { e.stopPropagation(); onDiscard(file.path); }}
          className="ml-1 shrink-0 rounded px-1 text-[12px] leading-none text-octo-sage opacity-0 transition group-hover:opacity-70 hover:!text-octo-rouge focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-octo-brass"
        >×</button>
```
and pass `onDiscard={(p) => setDiscardTarget(p)}` where `<FileRow>` is rendered (ensure the
row container has the `group` class for `group-hover`).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/components/ChangesPanel.test.tsx 2>&1 | tail -10`
Expected: 4 tests pass.

Run: `npm run typecheck 2>&1 | tail -4` → clean. Run `grep -nE '#[0-9a-fA-F]{3,8}|rgba\(' src/components/ChangesPanel.tsx` → only `var(--…)` tokens (no raw colors).

- [ ] **Step 5: Commit**

```bash
git add src/components/ChangesPanel.tsx src/components/ChangesPanel.test.tsx && git commit -m "feat(g4): ChangesPanel — AI draft, amend toggle, discard file, Tier-0"
```

---

## Task 6: App — wire the `c` key to focus the commit box

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Wire the focus callback**

In `App.tsx`, add a ref to hold ChangesPanel's focus function and pass both
`registerFocusCommit` (to ChangesPanel) and `onFocusCommit` (to ReviewCanvas):

```tsx
  const focusCommitFn = useRef<(() => void) | null>(null);
```
On the `<ChangesPanel ...>` element add:
```tsx
    registerFocusCommit={(fn) => { focusCommitFn.current = fn; }}
```
On the `<ReviewCanvas ...>` (or wherever `onFocusCommit`/`onFocusFilter` are accepted) add:
```tsx
    onFocusCommit={() => focusCommitFn.current?.()}
```
(Leave `onFocusFilter` unset — `/` is deferred to Slice II.)

- [ ] **Step 2: Typecheck + build + full suite**

Run: `npm run typecheck 2>&1 | tail -4` → clean.
Run: `npm run build 2>&1 | tail -4` → Vite build succeeds.
Run: `npx vitest run 2>&1 | tail -6` → all tests pass (pre-existing unrelated jsdom "errors" acceptable).

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx && git commit -m "feat(g4): wire the c key to focus the commit message box"
```

---

## Final verification (after all tasks)

- [ ] `cd src-tauri && cargo test 2>&1 | tail -6` — all Rust tests pass (incl. git_ops staged/last-commit + g4_staging_tests). (Ignore any pre-existing PTY-sandbox failures.)
- [ ] `npm run typecheck` clean; `npx vitest run` all pass; `npm run build` succeeds.
- [ ] `git diff main...HEAD | grep -nE '#[0-9a-fA-F]{3,8}|rgba\(' | grep -v '\.rs:'` — empty (TS/TSX use tokens only).
- [ ] Manual (`npm run tauri:dev`): stage a file → **✨ Draft** fills a sensible message → Commit shows the SHA toast; check **Amend** → message pre-fills from the last commit, hint + (if pushed) warning show, button says **Amend**, committing rewrites HEAD; hover an unstaged file → **×** → confirm → file restored/deleted; a failing hunk apply shows the friendly message; press **c** in Review → the commit box focuses.

---

## Spec coverage check

| Spec requirement | Task |
|---|---|
| `get_staged_diff` (git2 HEAD→index) | 1, 2 |
| `amend_commit` (login shell, short SHA) | 2 |
| `get_last_commit` (Option, subject/body/sha) | 1, 2 |
| `discard_file` (tracked restore / untracked delete) | 2 |
| `friendly_git_error` + wrap hunk errors | 2 |
| commands registered in lib.rs | 2 |
| ipc bindings + LastCommit type | 3 |
| `commitMessage.ts` (COMMIT_SYSTEM + buildCommitPrompt) | 4 |
| ✨ Draft (staged diff → aiComplete default model → fill) | 5 |
| Amend toggle (pre-fill-if-empty, hint, pushed warning, route) | 5 |
| Discard-file affordance + confirm | 5 |
| canCommit validation; Tier-0 focus/aria | 5 |
| Wire `c` (focus commit) | 6 |

Deferred (correctly absent): staged-hunk dimming + per-hunk staged model + discard-hunk + `/` filter (Slice II); per-line staging (Slice III); AI model picker for commit message.
