# Rail Git Signal — Pulse, Status Dots & Key Detection — Implementation Plan (Plan 3 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the left rail quiet, at-a-glance git signal — a per-project "pulse" (count of workspaces with uncommitted changes) and per-workspace status dots (uncommitted = brass dot, ahead/behind counts, linked ticket key) — backed by a cheap batch git-summary command, and tighten Jira-key auto-detection so only keys matching a project's configured key are shown (C5).

**Architecture:** A new backend `workspaces_git_summary(project_id)` command computes `{dirty, ahead, behind}` per worktree using the existing libgit2 `git_ops::get_status` (local, fast — no network, no shelling). The frontend caches results in `workspaceStore.gitSummaryByWs` keyed by workspace id, refreshed on an event basis (project set changes, window focus, after commit) — never on a tight timer. The rail renders the pulse on each project header and status dots in each workspace row. C5 adds a project-key-gated `detectIssueKeyForProject` used by the rail so branch names like `fix/UTF-8` no longer surface as fake tickets.

**Tech Stack:** Rust + git2 (libgit2), Tauri 2; React 19 + TypeScript, Zustand, Tailwind v4 (theme tokens), Vitest, `cargo test`.

**Spec:** `docs/superpowers/specs/2026-06-05-rail-robustness-design.md` — covers §4.2 (project git pulse), §4.3 (workspace status dots — dirty + ahead/behind + ticket key), §6.3 (git status for the rail), and C5 (detectIssueKey false positives).

**Deliberate scope decision — PR indicators deferred.** Spec §4.2/§4.3 also call for an "open PR" indicator (verdigris keyline square + PR count). Today PR state is fetched **only for the active workspace** (`openPrByWs` in `App.tsx:234`, one `gh` API call per active branch every 60s). A per-row PR square that can only ever appear on the single active row is misleading, and fetching PR state for every workspace on every refresh is expensive and out of scope for a "calm" pass. **Plan 3 therefore ships the dirty/ahead-behind pulse + dots + ticket key only**; the PR indicator is deferred until a batch PR-state source exists (documented for continuity, candidate for a later wave). The project pulse counts only uncommitted-changes workspaces (comprehensive via the batch command), so no aggregate is misleading.

**Deferred to Plan 4 (noted so nothing is lost):** pin + reorder projects (§9), archive workspace (§10), rename workspace (§5.2), quick filter / jump (§4 navigation).

---

## File Structure

**Modified — backend**
- `src-tauri/src/git_ops.rs` — new `dirty_ahead_behind(path)` helper (wraps `get_status`) + a unit test module.
- `src-tauri/src/commands.rs` — new `workspaces_git_summary` command + `WorkspaceGitSummary` struct.
- `src-tauri/src/lib.rs` — register the command.

**Modified — frontend**
- `src/lib/types.ts` — `WorkspaceGitSummary` interface.
- `src/lib/ipc.ts` — wire `workspacesGitSummary`.
- `src/lib/detectIssueKey.ts` — new `detectIssueKeyForProject(branch, projectKey)` (C5).
- `src/lib/detectIssueKey.test.ts` — tests for the gated detector.
- `src/stores/workspaceStore.ts` — `gitSummaryByWs` cache + `loadGitSummaries(projectId)` action + drop entry on `remove`.
- `src/stores/workspaceStore.test.ts` — tests for the cache + drop.
- `src/App.tsx` — load summaries (project-set effect + window focus), pass `gitSummaryByWs` + per-project `jiraProjectKey` to the rail.
- `src/components/ChangesPanel.tsx` — refresh the active project's summaries after a successful commit.
- `src/components/WorkspaceRail.tsx` — project pulse on the header; status dots + ticket key in each workspace row.

---

## Task 1: Backend — `git_ops::dirty_ahead_behind` helper (+ test)

**Why:** The batch command needs a small, testable function that reduces a worktree's full `GitStatus` to the three numbers the rail shows. `get_status` already exists (uses libgit2, includes untracked files via `opts.include_untracked(true)`).

**Files:**
- Modify: `src-tauri/src/git_ops.rs` (add helper near `get_status` ~line 185; add a `#[cfg(test)]` module at end of file)

- [ ] **Step 1: Add the helper**

In `src-tauri/src/git_ops.rs`, directly after `get_status` (after its closing `}` ~line 185), add:

```rust
/// Compact git signal for the rail: `(dirty, ahead, behind)`.
/// `dirty` is true when the worktree has any staged/unstaged/untracked change.
/// Thin wrapper over [`get_status`]; lives here so it can be unit-tested
/// against a temp repo without the Tauri command/DB layer.
pub fn dirty_ahead_behind(path: &Path) -> AppResult<(bool, usize, usize)> {
    let status = get_status(path)?;
    Ok((!status.changed_files.is_empty(), status.ahead, status.behind))
}
```

- [ ] **Step 2: Add the test module**

At the END of `src-tauri/src/git_ops.rs`, add:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn dirty_ahead_behind_reports_clean_then_dirty() {
        let dir = tempfile::tempdir().unwrap();
        init_repo(dir.path()).unwrap();

        // Freshly initialized repo, no files → clean, no upstream → 0/0.
        let (dirty, ahead, behind) = dirty_ahead_behind(dir.path()).unwrap();
        assert!(!dirty, "empty repo should be clean");
        assert_eq!((ahead, behind), (0, 0));

        // An untracked file makes it dirty (get_status includes untracked).
        fs::write(dir.path().join("a.txt"), "hello").unwrap();
        let (dirty2, _, _) = dirty_ahead_behind(dir.path()).unwrap();
        assert!(dirty2, "untracked file should mark the worktree dirty");
    }
}
```

- [ ] **Step 3: Run the test**

Run: `cd src-tauri && cargo test dirty_ahead_behind_reports_clean_then_dirty`
Expected: PASS. (`init_repo`, `tempfile`, and `git2` are all already available.)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/git_ops.rs
git commit -m "feat(backend): git_ops::dirty_ahead_behind helper for rail signal"
```

---

## Task 2: Backend — `workspaces_git_summary` command

**Why:** One IPC round-trip per project returns the signal for all its worktrees, avoiding N calls. Missing/never-created worktrees are skipped gracefully (one bad worktree must not fail the batch).

**Files:**
- Modify: `src-tauri/src/commands.rs` (add struct + command near `get_git_status` ~line 567)
- Modify: `src-tauri/src/lib.rs` (register, in the Workspaces/git block ~line 157)

- [ ] **Step 1: Add the struct + command**

In `src-tauri/src/commands.rs`, directly after the `get_git_status` command (~line 570), add:

```rust
/// Compact per-workspace git signal for the rail (one entry per worktree that
/// exists and is a git repo). Workspaces whose worktree is missing/archived
/// are omitted rather than erroring the whole batch.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGitSummary {
    pub workspace_id: String,
    pub dirty: bool,
    pub ahead: usize,
    pub behind: usize,
}

#[tauri::command]
pub async fn workspaces_git_summary(
    state: State<'_, AppState>,
    project_id: String,
) -> AppResult<Vec<WorkspaceGitSummary>> {
    let rows = state.db.lock().list_workspaces(&project_id)?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let Some(wt) = row.worktree_path else { continue };
        let path = std::path::Path::new(&wt);
        if !crate::git_ops::is_git_repo(path) {
            continue;
        }
        // A single unreadable worktree shouldn't sink the whole project's
        // summary — default it to clean and keep going.
        let (dirty, ahead, behind) =
            crate::git_ops::dirty_ahead_behind(path).unwrap_or((false, 0, 0));
        out.push(WorkspaceGitSummary {
            workspace_id: row.id,
            dirty,
            ahead,
            behind,
        });
    }
    Ok(out)
}
```

(`State`, `AppState`, `AppResult` are already in scope — used by the adjacent `list_workspaces`/`get_git_status`.)

- [ ] **Step 2: Register the command**

In `src-tauri/src/lib.rs`, in the invoke_handler list near `commands::get_git_status,` (and `get_git_diff`), add:

```rust
            commands::workspaces_git_summary,
```

- [ ] **Step 3: Build + test**

Run: `cd src-tauri && cargo build` (must compile) then `cargo test` (full suite stays green).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(backend): workspaces_git_summary batch command (§6.3)"
```

---

## Task 3: Frontend types + IPC

**Files:**
- Modify: `src/lib/types.ts` (add interface)
- Modify: `src/lib/ipc.ts` (wire command)

- [ ] **Step 1: Add the type**

In `src/lib/types.ts`, add (near the other small DTO interfaces, e.g. after `EditorChoice` or `Pr`):

```ts
/** Compact per-workspace git signal for the rail (from workspaces_git_summary). */
export interface WorkspaceGitSummary {
  workspaceId: string;
  dirty: boolean;
  ahead: number;
  behind: number;
}
```

- [ ] **Step 2: Wire IPC**

In `src/lib/ipc.ts`, near the other workspace commands (after `listWorkspaces`, ~line 155), add:

```ts
  workspacesGitSummary: (projectId: string) =>
    invoke<WorkspaceGitSummary[]>("workspaces_git_summary", { projectId }),
```

Ensure `WorkspaceGitSummary` is added to the type import list from `./types` at the top of `ipc.ts`.

- [ ] **Step 3: Verify**

Run: `npm run typecheck` → no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/lib/ipc.ts
git commit -m "feat(ipc): workspacesGitSummary + WorkspaceGitSummary type"
```

---

## Task 4: workspaceStore — git-summary cache

**Why:** The rail reads the signal from the store, keyed by workspace id. `loadGitSummaries(projectId)` fetches one project's summaries and merges them in. Deleting a workspace drops its cached entry.

**Files:**
- Modify: `src/stores/workspaceStore.ts`
- Test: `src/stores/workspaceStore.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/stores/workspaceStore.test.ts`, add `WorkspaceGitSummary` to the `mockIpc` (add `workspacesGitSummary: vi.fn()` to the mock object) and add a `gitSummaryByWs: {}` line to the state reset in `resetStore()`. Then add:

```ts
describe("workspaceStore — git summary cache", () => {
  beforeEach(() => resetStore());

  it("merges fetched summaries into gitSummaryByWs keyed by workspace id", async () => {
    mockIpc.workspacesGitSummary.mockResolvedValueOnce([
      { workspaceId: "w1", dirty: true, ahead: 2, behind: 0 },
      { workspaceId: "w2", dirty: false, ahead: 0, behind: 1 },
    ]);

    await useWorkspaceStore.getState().loadGitSummaries("proj-1");

    const map = useWorkspaceStore.getState().gitSummaryByWs;
    expect(map.w1).toEqual({ workspaceId: "w1", dirty: true, ahead: 2, behind: 0 });
    expect(map.w2.behind).toBe(1);
  });

  it("preserves summaries from other projects when merging", async () => {
    useWorkspaceStore.setState({
      gitSummaryByWs: { other: { workspaceId: "other", dirty: true, ahead: 0, behind: 0 } },
    });
    mockIpc.workspacesGitSummary.mockResolvedValueOnce([
      { workspaceId: "w1", dirty: false, ahead: 0, behind: 0 },
    ]);

    await useWorkspaceStore.getState().loadGitSummaries("proj-1");

    const map = useWorkspaceStore.getState().gitSummaryByWs;
    expect(map.other).toBeDefined();
    expect(map.w1).toBeDefined();
  });

  it("drops a workspace's summary on remove", async () => {
    const a = makeWorkspace("proj-1", "alpha");
    useWorkspaceStore.setState({
      workspaces: [a],
      workspacesByProjectId: { "proj-1": [a] },
      gitSummaryByWs: { [a.id]: { workspaceId: a.id, dirty: true, ahead: 0, behind: 0 } },
    });
    mockIpc.deleteWorkspace.mockResolvedValueOnce(undefined);

    await useWorkspaceStore.getState().remove(a.id, "/repo", a.branch, a.worktreePath);

    expect(useWorkspaceStore.getState().gitSummaryByWs[a.id]).toBeUndefined();
  });
});
```

Run `npm test -- src/stores/workspaceStore.test.ts` → confirm FAIL (no `gitSummaryByWs` / `loadGitSummaries`; remove doesn't drop the entry).

- [ ] **Step 2: Implement**

In `src/stores/workspaceStore.ts`:

(a) Add `WorkspaceGitSummary` to the type import: change the import on line 3 to
```ts
import type { Workspace, WorkspaceGitSummary } from "../lib/types";
```

(b) Add to the `WorkspaceState` interface (after `workspacesByProjectId`):
```ts
  /** Per-workspace git signal for the rail, keyed by workspace id. */
  gitSummaryByWs: Record<string, WorkspaceGitSummary>;
```
and the action signature (after `pruneProject`):
```ts
  /** Fetch + merge a project's per-workspace git summaries into the cache. */
  loadGitSummaries: (projectId: string) => Promise<void>;
```

(c) Add `gitSummaryByWs: {},` to the initial state (after `workspacesByProjectId: {},`).

(d) Add the action (after `pruneProject`):
```ts
  loadGitSummaries: async (projectId) => {
    try {
      const summaries = await ipc.workspacesGitSummary(projectId);
      set((s) => {
        const next = { ...s.gitSummaryByWs };
        for (const sum of summaries) next[sum.workspaceId] = sum;
        return { gitSummaryByWs: next };
      });
    } catch {
      // Non-critical — the rail just shows no signal for this project.
    }
  },
```

(e) In `remove`, also drop the cached summary. The `remove` action's `set((s) => {...})` returns an object — add a pruned `gitSummaryByWs`:
```ts
    set((s) => {
      const nextByProject: Record<string, Workspace[]> = {};
      for (const [pid, wss] of Object.entries(s.workspacesByProjectId)) {
        nextByProject[pid] = wss.filter((w) => w.id !== workspaceId);
      }
      const { [workspaceId]: _droppedSummary, ...nextSummaries } = s.gitSummaryByWs;
      return {
        workspaces: s.workspaces.filter((w) => w.id !== workspaceId),
        workspacesByProjectId: nextByProject,
        gitSummaryByWs: nextSummaries,
        activeId: s.activeId === workspaceId ? null : s.activeId,
      };
    });
```

- [ ] **Step 3: Run tests**

Run: `npm test -- src/stores/workspaceStore.test.ts` → all PASS. Then `npm run typecheck` → clean.

- [ ] **Step 4: Commit**

```bash
git add src/stores/workspaceStore.ts src/stores/workspaceStore.test.ts
git commit -m "feat(rail): workspaceStore git-summary cache + drop on remove"
```

---

## Task 5: C5 — project-key-gated issue detection

**Why:** The raw `detectIssueKey` matches any Jira-shaped token, so branch names like `fix/UTF-8-encoding` or `docs/RFC-2616` surface as fake tickets. The rail should only show a detected key when it matches the project's configured Jira key prefix. (The raw extractor is unchanged — manual links and existing callers keep working; only the rail uses the gated form. The `ContextHeader` active-ticket path keeps its current behavior — tightening that is a documented follow-up to avoid widening this plan.)

**Files:**
- Modify: `src/lib/detectIssueKey.ts`
- Test: `src/lib/detectIssueKey.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/lib/detectIssueKey.test.ts`, add:

```ts
import { detectIssueKey, detectIssueKeyForProject } from "./detectIssueKey";

describe("detectIssueKeyForProject", () => {
  it("accepts a detected key that matches the project prefix", () => {
    expect(detectIssueKeyForProject("feat/OCT-12-login", "OCT")).toBe("OCT-12");
    expect(detectIssueKeyForProject("oct/OCT-5", "OCT")).toBe("OCT-5");
  });
  it("rejects Jira-shaped tokens that are not the project key (C5)", () => {
    expect(detectIssueKeyForProject("fix/UTF-8-encoding", "OCT")).toBeNull();
    expect(detectIssueKeyForProject("docs/RFC-2616", "OCT")).toBeNull();
  });
  it("returns null when the project has no configured key", () => {
    expect(detectIssueKeyForProject("feat/OCT-12", null)).toBeNull();
    expect(detectIssueKeyForProject("feat/OCT-12", "")).toBeNull();
  });
  it("does not detect lowercase keys", () => {
    expect(detectIssueKeyForProject("feat/oct-12", "OCT")).toBeNull();
  });
});
```

(Keep the existing `import { detectIssueKey } from "./detectIssueKey";` line — or merge it into the combined import above; do not duplicate the import.)

Run `npm test -- src/lib/detectIssueKey.test.ts` → FAIL (`detectIssueKeyForProject` not exported).

- [ ] **Step 2: Implement**

In `src/lib/detectIssueKey.ts`, add below the existing `detectIssueKey`:

```ts
/** Like {@link detectIssueKey} but only returns a key that belongs to the
 *  project's configured Jira key (e.g. "OCT" → accepts "OCT-12", rejects
 *  "UTF-8"). Returns null when the project has no configured key, so we never
 *  surface a guessed ticket we can't validate (C5). */
export function detectIssueKeyForProject(
  branch: string,
  projectKey: string | null,
): string | null {
  if (!projectKey) return null;
  const key = detectIssueKey(branch);
  return key && key.startsWith(projectKey + "-") ? key : null;
}
```

- [ ] **Step 3: Run tests**

Run: `npm test -- src/lib/detectIssueKey.test.ts` → all PASS (including the pre-existing `detectIssueKey` tests). Then `npm run typecheck` → clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/detectIssueKey.ts src/lib/detectIssueKey.test.ts
git commit -m "feat(rail): project-key-gated issue detection (C5)"
```

---

## Task 6: App.tsx + ChangesPanel — load summaries & pass to the rail

**Why:** Wire the cache: fetch summaries for every project shown in the rail when the project set changes and on window focus (event-driven, never a tight timer), refresh after a commit, and pass the cache + each project's Jira key down to the rail.

**Files:**
- Modify: `src/App.tsx` (selectors; `projectGroups`; the loadAllWorkspaces effect ~line 389-398; a new focus effect; the `<WorkspaceRail>` render)
- Modify: `src/components/ChangesPanel.tsx` (refresh after commit, ~line 113)

- [ ] **Step 1: Add the store selector**

In `src/App.tsx`, add `loadGitSummaries` and `gitSummaryByWs` to the `useWorkspaceStore()` destructure (after `pruneProject,`):

```tsx
    pruneProject,
    gitSummaryByWs,
    loadGitSummaries,
  } = useWorkspaceStore();
```

- [ ] **Step 2: Load summaries alongside workspaces**

Find the effect that builds `projectIds` and calls `loadAllWorkspaces` (around line 389-398). Inside it, after the `loadAllWorkspaces(...)` call, also fetch summaries for each project id. For example, if it currently reads:

```tsx
    loadAllWorkspaces(Array.from(projectIds));
  }, [project, recentProjects, loadAllWorkspaces]);
```

change it to:

```tsx
    const ids = Array.from(projectIds);
    loadAllWorkspaces(ids);
    ids.forEach((id) => void loadGitSummaries(id));
  }, [project, recentProjects, loadAllWorkspaces, loadGitSummaries]);
```

(Match the actual current code — keep whatever `projectIds` construction exists; only add the `forEach` + the dep. If `loadAllWorkspaces` is already passed `Array.from(projectIds)` inline, introduce the `ids` const as shown.)

- [ ] **Step 3: Refresh on window focus**

Add a new effect in `App.tsx` (near the other top-level effects, e.g. after the startup effect):

```tsx
  // Refresh the rail's git signal when the window regains focus — calm,
  // event-driven (no polling). Summaries are cheap (local libgit2).
  useEffect(() => {
    const onFocus = () => {
      const ids = new Set<string>();
      if (project) ids.add(project.id);
      recentProjects.forEach((p) => ids.add(p.id));
      ids.forEach((id) => void loadGitSummaries(id));
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [project, recentProjects, loadGitSummaries]);
```

- [ ] **Step 4: Add each project's Jira key to `projectGroups`**

In `projectGroups` (the IIFE ~line 1102-1133), the final `.map` builds `{ id, name, tint, workspaces }`. Add `jiraProjectKey`. Build a lookup from the available project objects and read it in the map. Replace the final `return ordered.map(...)` with:

```tsx
    const jiraKeyById: Record<string, string | null> = {};
    recentProjects.forEach((p) => {
      jiraKeyById[p.id] = p.jiraProjectKey;
    });
    if (project) jiraKeyById[project.id] = project.jiraProjectKey;

    return ordered.map((p) => ({
      id: p.id,
      name: p.name,
      tint: p.tint,
      jiraProjectKey: jiraKeyById[p.id] ?? null,
      workspaces: workspacesByProjectId[p.id] || [],
    }));
```

- [ ] **Step 5: Pass the cache to the rail**

In the `<WorkspaceRail ... />` render, add (e.g. after `onReopenProject={handleReopenProject}`):

```tsx
        gitSummaryByWs={gitSummaryByWs}
```

(The per-project `jiraProjectKey` now rides inside `projectGroups`, so no extra prop is needed for it.)

- [ ] **Step 6: Refresh after a commit (ChangesPanel)**

In `src/components/ChangesPanel.tsx`, after the successful `ipc.commitChanges(...)` call (line ~113) — once the commit has succeeded — refresh the active project's summaries. Add the imports if missing (`useWorkspaceStore`, `useProjectStore`) and, right after the commit succeeds:

```tsx
      const sha = await ipc.commitChanges(projectPath, commitMessage.trim());
      // A commit changes the worktree's dirty state — refresh the rail signal.
      const pid = useProjectStore.getState().current?.id;
      if (pid) void useWorkspaceStore.getState().loadGitSummaries(pid);
```

(Read ChangesPanel to confirm the exact post-commit location and that `useProjectStore`/`useWorkspaceStore` are importable there — they are standard store hooks; use `getState()` so no re-render subscription is added.)

- [ ] **Step 7: Verify**

Run: `npm run typecheck` → FAILS until Task 7 adds `gitSummaryByWs` + `jiraProjectKey` to the rail's types. That's expected (cross-file loop, same pattern as Plan 2's T6/T7). If you want a green checkpoint, commit after Task 7's Step 1. Otherwise run `npm test` to confirm no test regressed by the App logic.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/components/ChangesPanel.tsx
git commit -m "feat(rail): load git summaries (focus + project set + post-commit); pass to rail"
```

---

## Task 7: Rail rendering — project pulse + workspace status dots

**Why:** Render the signal. Project header gets a compact pulse (brass `●N` when N workspaces are dirty, else a quiet low-opacity verdigris all-clear dot). Each workspace row gets, in its trailing area: the linked ticket key (sage mono), `↑N`/`↓N` (mute mono, omitted when zero), and a brass dirty dot (shown when dirty and not the active row, to avoid doubling the existing active brass dot).

**Files:**
- Modify: `src/components/WorkspaceRail.tsx`

READ the file first — it was edited in Plan 2 (collapse, drawer, empty states, lucide chevrons). Anchor on content, not line numbers.

- [ ] **Step 1: Extend types + imports**

In `src/components/WorkspaceRail.tsx`:

(a) Import the gated detector and the summary type. Add to the existing `../lib/types` import: `WorkspaceGitSummary`. Add:
```tsx
import { detectIssueKeyForProject } from "../lib/detectIssueKey";
```

(b) Add `jiraProjectKey` to the `ProjectGroup` interface:
```ts
export interface ProjectGroup {
  id: string;
  name: string;
  tint?: string;
  jiraProjectKey?: string | null;
  workspaces: Workspace[];
}
```

(c) Add a rail prop for the cache (optional, like the Plan-2 props):
```tsx
  /** Per-workspace git signal, keyed by workspace id (§4.2/§4.3). */
  gitSummaryByWs?: Record<string, WorkspaceGitSummary>;
```
and destructure `gitSummaryByWs,` in the component params.

(d) Extend `WorkspaceRowProps` with the per-row signal (all optional):
```tsx
interface WorkspaceRowProps {
  workspace: Workspace;
  active: boolean;
  isCollapsed: boolean;
  ticketKey?: string | null;
  dirty?: boolean;
  ahead?: number;
  behind?: number;
  onSelect: () => void;
  onCustomize: () => void;
  onContextMenu?: (x: number, y: number) => void;
}
```
and add `ticketKey, dirty, ahead, behind,` to the `WorkspaceRow({ ... })` destructure.

- [ ] **Step 2: Project pulse on the header**

In the project header's right-side group (the `<div className="flex items-center gap-1">` that holds the `+` and chevron), insert a pulse element as its FIRST child (before the `+` button). Just above the header's right group, compute the dirty count from the workspaces + cache. Inside the header IIFE (where `tint` is computed), add:

```tsx
              const dirtyCount = (project.workspaces || []).filter(
                (w) => gitSummaryByWs?.[w.id]?.dirty,
              ).length;
```

Then as the first child of the right-side `<div className="flex items-center gap-1">`:

```tsx
                  {/* Git pulse: brass count when work is uncommitted, else a
                      quiet verdigris all-clear dot (§4.2). */}
                  {dirtyCount > 0 ? (
                    <span
                      className="flex items-center gap-1 font-mono text-[10px] text-octo-brass"
                      title={`${dirtyCount} workspace${dirtyCount === 1 ? "" : "s"} with uncommitted changes`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-octo-brass" />
                      {dirtyCount}
                    </span>
                  ) : (
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-octo-verdigris opacity-40"
                      title="All workspaces clean"
                    />
                  )}
```

- [ ] **Step 3: Pass per-row signal to `WorkspaceRow`**

Where the rail maps `project.workspaces` to `<WorkspaceRow .../>`, compute and pass the ticket key + summary. Replace the `<WorkspaceRow ... />` props block to add:

```tsx
                <WorkspaceRow
                  key={ws?.id || `ws-${projectIndex}`}
                  workspace={ws}
                  active={ws?.id === activeWorkspaceId}
                  isCollapsed={isCollapsed}
                  ticketKey={
                    ws?.linkedIssueKey ??
                    detectIssueKeyForProject(ws?.branch ?? "", project.jiraProjectKey ?? null)
                  }
                  dirty={gitSummaryByWs?.[ws?.id ?? ""]?.dirty}
                  ahead={gitSummaryByWs?.[ws?.id ?? ""]?.ahead}
                  behind={gitSummaryByWs?.[ws?.id ?? ""]?.behind}
                  onSelect={() => ws?.id && onSelect(ws.id)}
                  onCustomize={() => ws?.id && onCustomize(ws.id)}
                  onContextMenu={
                    onContextMenu && ws?.id
                      ? (x, y) => onContextMenu(ws.id, x, y)
                      : undefined
                  }
                />
```

(Keep the surrounding `(isCollapsed || !collapsedProjects[project.id]) && (...).map(...)` gate from Plan 2 unchanged.)

- [ ] **Step 4: Render the status dots in the expanded row**

In `WorkspaceRow`'s EXPANDED return, find the trailing active dot:
```tsx
      {/* Active dot (6px, brass, visible only when active) */}
      {active && (
        <div className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-octo-brass" />
      )}
```
Replace it with a trailing cluster (ticket key + ahead/behind + dirty dot + the unchanged active dot):

```tsx
      {/* Trailing signal: ticket key · ahead/behind · dirty · active (§4.3) */}
      {ticketKey && (
        <span className="flex-shrink-0 font-mono text-[10px] text-octo-sage">
          {ticketKey}
        </span>
      )}
      {!!ahead && (
        <span className="flex-shrink-0 font-mono text-[10px] text-octo-mute">↑{ahead}</span>
      )}
      {!!behind && (
        <span className="flex-shrink-0 font-mono text-[10px] text-octo-mute">↓{behind}</span>
      )}
      {dirty && !active && (
        <div
          className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-octo-brass"
          title="Uncommitted changes"
        />
      )}
      {active && (
        <div className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-octo-brass" />
      )}
```

(The workspace-name container keeps `flex-1`, so the trailing cluster sits at the right; the existing fade-out gradient on the name handles overflow. Do not add status dots to the collapsed (icon-only) row — calm by default.)

- [ ] **Step 5: Verify**

Run: `npm run typecheck` → no errors (resolves Task 6's pending props). Then `npm test` → green (the WorkspaceRail test filters workspace buttons by aria-label, so added spans don't affect it — confirm). Then `git diff -- src | grep -nE "#[0-9a-fA-F]{3,8}"` → empty.

- [ ] **Step 6: Commit**

```bash
git add src/components/WorkspaceRail.tsx
git commit -m "feat(rail): project git pulse + workspace status dots (§4.2/§4.3)"
```

---

## Task 8: Full-plan verification

- [ ] **Step 1: Typecheck + tests + Rust**

Run, expecting all green:
```bash
npm run typecheck
npm test
cd src-tauri && cargo test && cd ..
```

- [ ] **Step 2: Manual smoke test (`npm run tauri:dev`)**

Verify:
- A project header shows `● N` in brass when N of its workspaces have uncommitted changes; a quiet verdigris dot when all are clean.
- A workspace with uncommitted changes shows a brass dot (when it isn't the active row); editing files and returning focus to the window updates it.
- `↑N`/`↓N` appear for workspaces ahead/behind their upstream; absent when zero / no upstream.
- A branch like `feat/OCT-12-x` shows `OCT-12` only when the project's Jira key is `OCT`; `fix/UTF-8-x` shows no ticket.
- Committing in a workspace clears its dirty dot (and decrements the project pulse) without a manual refresh.
- The icon-collapsed rail shows only monograms (no dots) — calm.

- [ ] **Step 3: Design-system check**

```bash
git diff main -- src | grep -nE "#[0-9a-fA-F]{3,8}" || echo "clean"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** §4.2 pulse ✓ (T7, dirty count + all-clear; PR count deferred — documented), §4.3 dots ✓ (T7: ticket key + ahead/behind + dirty dot; PR square deferred — documented), §6.3 git status for the rail ✓ (T1/T2 batch command, event-driven cache in T4/T6, no tight polling), C5 ✓ (T5 + rail consumption in T7). PR indicators explicitly deferred with rationale (per-active-only data source).
- **Placeholder scan:** none — every step has concrete code/commands. Task 6 Step 7 documents the intentional transient typecheck failure resolved by Task 7 (same cross-file pattern as Plan 2).
- **Type consistency:** Rust `WorkspaceGitSummary {workspace_id,dirty,ahead,behind}` (serde camelCase) ↔ TS `WorkspaceGitSummary {workspaceId,dirty,ahead,behind}` ↔ store `gitSummaryByWs: Record<string, WorkspaceGitSummary>` ↔ ipc `workspacesGitSummary(projectId): WorkspaceGitSummary[]` ↔ command `workspaces_git_summary(project_id)`. `detectIssueKeyForProject(branch, projectKey)` signature matches its test and the rail call. `ProjectGroup.jiraProjectKey` set in App's `projectGroups` and read in the rail. `WorkspaceRowProps` (ticketKey/dirty/ahead/behind) match what the rail passes.
- **Calm/design:** new signal is monochrome by default (mute/sage), brass only for "needs you" (dirty/active), one quiet verdigris all-clear dot; no new polling timer (event-driven: project-set change, window focus, post-commit); no rows grow taller (trailing cluster reuses the existing active-dot slot); icon-collapsed rail unchanged.
