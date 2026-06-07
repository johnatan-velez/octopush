# Perf — Unbounded Review diff on large untracked sets — Plan 10

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Fix the residual lag on a workspace with a large untracked/changed set (`colpensiones-api-rest` `main`: a 21 MB / 807-file untracked `documentacion/`). Root cause: `get_diff_text` (behind `getGitDiff`) sets `include_untracked + recurse_untracked_dirs + show_untracked_content` with **no size cap**, so the Review diff for `main` is multiple MB (the full content of every untracked file). Each poll builds + serializes + JSON-parses + renders that multi-MB string → UI block. (`get_status` already collapses untracked dirs to ~13 entries, so the file list is NOT the problem — the diff is.)

**Evidence (measured):** 19.3 MB of untracked content; `get_diff_text` has no cap; clean worktrees (empty diff) are fluid; Plan 9's change-detection helped the idle case but the diff build/parse on a dirty branch remains.

**Architecture:** (1) Backend — cap `get_diff_text` output (~1 MiB) by aborting the diff print once the buffer is full, with a truncation marker; this also stops libgit2 from reading the remaining files' content (bounded build, IPC, parse, render — universal). (2) Frontend — only fetch the diff in **review** mode (it's the only place the diff is displayed), so Talk/Run never build the multi-MB diff.

**Tech Stack:** Rust + git2, React 19 + TS, Vitest, cargo test.

---

## Task 1: Backend — cap `get_diff_text` output (abort at ~1 MiB)

**Files:**
- Modify: `src-tauri/src/git_ops.rs` (`get_diff_text`, lines ~353-379)
- Test: `git_ops` test module

- [ ] **Step 1: cap the diff buffer + abort early**

Replace the `get_diff_text` body's print loop + return so it stops at a cap. The print callback returns `false` once the buffer reaches the cap (which aborts libgit2's generation — `git_diff_print` then returns `Err(GIT_EUSER)`, which we ignore *only* when we intentionally truncated):

```rust
pub fn get_diff_text(path: &Path) -> AppResult<String> {
    /// Cap the Review diff payload. Beyond this, building/serializing/parsing/
    /// rendering the diff blocks the UI (e.g. a worktree with a large untracked
    /// folder synthesizes MBs of "new file" content). 1 MiB is far more than a
    /// human reviews; the rest is truncated.
    const MAX_DIFF_BYTES: usize = 1_048_576;

    let repo = open_repo(path)?;
    let mut opts = git2::DiffOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .show_untracked_content(true);
    let diff = repo
        .diff_index_to_workdir(None, Some(&mut opts))
        .map_err(|e| AppError::Other(format!("diff: {e}")))?;

    let mut buf = Vec::new();
    let mut truncated = false;
    let print_result = diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        if buf.len() >= MAX_DIFF_BYTES {
            truncated = true;
            return false; // abort generation — stops reading remaining file content
        }
        let origin = line.origin();
        if matches!(origin, '+' | '-' | ' ') {
            buf.push(origin as u8);
        }
        buf.extend_from_slice(line.content());
        true
    });
    if let Err(e) = print_result {
        // A `false` return from our callback aborts with GIT_EUSER; that's the
        // intended truncation, not a real failure. Propagate any other error.
        if !truncated {
            return Err(AppError::Other(format!("diff print: {e}")));
        }
    }

    let mut out = String::from_utf8_lossy(&buf).to_string();
    if truncated {
        out.push_str("\n... diff truncated (too large to display fully) ...\n");
    }
    Ok(out)
}
```

- [ ] **Step 2: test the cap**

In the `git_ops` `#[cfg(test)] mod tests`, add a test that a worktree with a large untracked file yields a capped diff. (`get_diff_text` includes untracked content, so a single big untracked file triggers truncation.)

```rust
#[test]
fn get_diff_text_caps_large_untracked_content() {
    use std::fs;
    let dir = tempfile::tempdir().unwrap();
    init_repo(dir.path()).unwrap();
    // 3 MiB untracked text file → diff would be ~3 MiB without the cap.
    let big = "x".repeat(3 * 1024 * 1024);
    fs::write(dir.path().join("big.txt"), &big).unwrap();

    let diff = get_diff_text(dir.path()).unwrap();
    assert!(diff.len() < 1_300_000, "diff should be capped near 1 MiB, got {}", diff.len());
    assert!(diff.contains("diff truncated"), "should carry the truncation marker");
}
```
(If `get_diff_text` on a no-HEAD freshly-`init_repo`'d repo errors, first create+commit a small file so HEAD exists, then add the big untracked file. Read `init_repo`/`ensure_initial_commit` and adapt so the test exercises the cap path. The other git_ops tests show the temp-repo setup.)

- [ ] **Step 3: run + commit**

Run `cd src-tauri && cargo test get_diff_text_caps_large_untracked_content` then full `cargo test`.
```bash
git add src-tauri/src/git_ops.rs
git commit -m "perf(git): cap get_diff_text output at 1 MiB (bound Review diff payload)"
```

---

## Task 2: Frontend — fetch the diff only when it's shown (review mode)

**Why:** The diff is only displayed in review mode (ReviewCanvas / the Changes view). Fetching it in Talk/Run builds the (now-capped, but still non-trivial) diff for nothing. Skip it outside review.

**Files:**
- Modify: `src/App.tsx` (the git-status effect from Plan 9)

- [ ] **Step 1: gate the diff fetch on review mode**

In the `refresh` of the git-status effect, only call `getGitDiff` when `activeMode === "review"`:

```tsx
    const refresh = async () => {
      try {
        const needDiff = activeMode === "review";
        const [s, d] = await Promise.all([
          ipc.getGitStatus(path),
          needDiff ? ipc.getGitDiff(path).catch(() => "") : Promise.resolve(""),
        ]);
        if (cancelled) return;
        const sig = /* unchanged status signature */ ...;
        if (sig !== gitSigRef.current) { gitSigRef.current = sig; setGitStatus(s); }
        if (d !== gitDiffRef.current) { gitDiffRef.current = d; setGitDiff(d); }
      } catch { /* non-fatal */ }
    };
```
(Keep the existing signature/refs from Plan 9; only add `needDiff` and make the diff promise conditional. `activeMode` is already in the effect deps, so switching to review re-runs the effect and fetches the diff.)

VERIFY: confirm the diff (`gitDiff` state) is consumed ONLY by review-mode surfaces. Read where `gitDiff` is passed (e.g. to `ReviewCanvas` and `ChangesPanel`). If `ChangesPanel` is mounted only within the review/changes canvas, review-gating is correct. If `ChangesPanel` (which shows a +/- summary derived from the diff) can be visible OUTSIDE review mode, broaden the gate to also include whatever mode shows it (e.g. `activeMode !== "talk"`), so its summary isn't blanked. Choose the gate that keeps every visible diff consumer fed while skipping the fetch when nothing shows the diff. Document which you chose.

- [ ] **Step 2: verify + commit**

Run `npm run typecheck` → clean. `npm test` → green. `git diff -- src | grep -nE "#[0-9a-fA-F]{3,8}"` → empty.
```bash
git add src/App.tsx
git commit -m "perf(rail): fetch Review diff only when the diff is shown (review mode)"
```

---

## Task 3: Verification

- [ ] `npm run typecheck && npm test && (cd src-tauri && cargo test)` — all green.
- [ ] Manual on `colpensiones-api-rest` `main`: Talk/Run navigation is fluid (no diff build); entering Review shows the diff (capped, with the truncation marker for the huge untracked set) without a long block; switching workspaces is responsive. Clean workspaces unchanged.

---

## Self-Review (during planning)

- **Coverage:** backend diff cap (T1 — universal, bounds build/IPC/parse/render and stops reading remaining content via early abort), frontend diff-only-in-review (T2 — removes the cost entirely outside review). Together they target the confirmed cost (multi-MB untracked-content diff), not the file list (already collapsed by libgit2).
- **Risk:** T1 only changes diffs > 1 MiB (normal repos unaffected); the `false`-abort/GIT_EUSER handling distinguishes intentional truncation from real errors. T2 must keep every visible diff consumer fed — the implementer verifies ChangesPanel's mount mode and broadens the gate if needed.
- **Note:** the `show_untracked_content(true)` flag (added for a real "Nothing to review" fix) is preserved — the cap makes it safe at scale rather than removing it.
