# Contextual Issue Tracker (v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorient the Jira integration around the active workspace — Active Ticket card + project-scoped Backlog + cross-project footer — lifted out of RUN into a cross-mode Companion block (visible in TALK, RUN, REVIEW).

**Architecture:** Two SQLite columns persist the new linkage (workspace.linked_issue_key, project.jira_project_key + workspace.issue_link_dismissed). A pure selectors module derives Active Ticket key, project key, project-scoped backlog and cross-project counts from the existing global `issuesStore`. New React components (`ActiveTicketPanel`, `InlineTicketPicker`, `ElsewhereFooter`, `ElsewhereModal`) plus a rewired `BacklogPanel`, a `Companion` restructure, and a Settings sub-section finish the surface.

**Tech Stack:** Rust + rusqlite (Tauri 2 backend), React 19 + TypeScript + Zustand + Vitest + Tailwind v4 (Atelier in Onyx & Brass tokens).

**Authoritative spec:** `docs/superpowers/specs/2026-05-30-issue-tracker-contextual-design.md`

**Branch:** Create `feat/issue-tracker-contextual` (from `main`) before T1; commit on it; do NOT push between tasks.

---

## Task 1: Backend migrations — three new columns

**Files:**
- Modify: `src-tauri/src/db.rs` (add three `add_column_if_missing` calls inside `migrate()` near the existing v0.1.x column adds at `src-tauri/src/db.rs:157-159`)

- [ ] **Step 1: Write the failing test**

Create or extend an existing migration test in `src-tauri/src/tests.rs`:

```rust
#[test]
fn migrate_adds_contextual_issue_tracker_columns() {
    let db = crate::db::Db::open_in_memory().expect("open in-memory db");
    // After migrate() the new columns must exist on their tables.
    let conn = db.conn_for_tests();
    let has_col = |table: &str, col: &str| -> bool {
        let q = format!("PRAGMA table_info({})", table);
        let mut stmt = conn.prepare(&q).unwrap();
        let mut rows = stmt.query([]).unwrap();
        while let Some(row) = rows.next().unwrap() {
            let name: String = row.get(1).unwrap();
            if name == col {
                return true;
            }
        }
        false
    };
    assert!(has_col("projects", "jira_project_key"), "projects.jira_project_key missing");
    assert!(has_col("workspaces", "linked_issue_key"), "workspaces.linked_issue_key missing");
    assert!(has_col("workspaces", "issue_link_dismissed"), "workspaces.issue_link_dismissed missing");
}
```

If `Db::open_in_memory()` or `conn_for_tests()` don't exist, search the existing `src-tauri/src/tests.rs` for the closest pattern (one of the existing tests already opens a `Db` — mirror that). If the existing pattern wraps `Db` differently (e.g. via a temp file), mirror that. Do NOT introduce new test infrastructure.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test migrate_adds_contextual_issue_tracker_columns`
Expected: FAIL — at least one column missing.

- [ ] **Step 3: Add the three column-add calls in `migrate()`**

In `src-tauri/src/db.rs`, locate `fn migrate(&self) -> AppResult<()>` (around line 45). Find the existing block of `add_column_if_missing` calls near line 157 (the ones adding `glyph`, `tint`, `test_command`). Add immediately after that block:

```rust
        // ── v2 contextual issue tracker ────────────────────────────
        add_column_if_missing(
            &self.conn,
            "ALTER TABLE projects ADD COLUMN jira_project_key TEXT",
        )?;
        add_column_if_missing(
            &self.conn,
            "ALTER TABLE workspaces ADD COLUMN linked_issue_key TEXT",
        )?;
        add_column_if_missing(
            &self.conn,
            "ALTER TABLE workspaces ADD COLUMN issue_link_dismissed INTEGER NOT NULL DEFAULT 0",
        )?;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test migrate_adds_contextual_issue_tracker_columns`
Expected: PASS.

- [ ] **Step 5: Run full backend test suite to confirm no regression**

Run: `cd src-tauri && cargo test --lib`
Expected: all existing tests still pass (150 from v1 baseline plus the new one).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/db.rs src-tauri/src/tests.rs
git commit -m "feat(jira-v2): add migration columns for contextual linkage"
```

---

## Task 2: Backend — Workspace linkage fields + `update_workspace_link` command

**Files:**
- Modify: `src-tauri/src/db.rs` — extend `WorkspaceRow` struct at `src-tauri/src/db.rs:1052-1068`; update the SELECT lists for `list_workspaces` and `get_workspace` (search for `SELECT id, project_id, name, task, branch` in `db.rs`)
- Modify: `src-tauri/src/commands.rs` — add `update_workspace_link` command
- Modify: `src-tauri/src/lib.rs` — register `update_workspace_link` in `generate_handler!`
- Test: `src-tauri/src/tests.rs` — round-trip test

- [ ] **Step 1: Write the failing test**

In `src-tauri/src/tests.rs`, add:

```rust
#[test]
fn workspace_link_round_trip() {
    let db = crate::db::Db::open_in_memory().expect("open in-memory db");
    // Seed: create a project + workspace using whatever existing helpers
    // db.rs / tests.rs already use (look at any existing test that creates
    // a workspace — mirror that exactly).
    let project_id = db.create_project_for_tests("/tmp/repo", "Test").unwrap();
    let ws_id = db
        .create_workspace_for_tests(&project_id, "feat/x", "test task")
        .unwrap();

    // New behavior: round-trip both fields.
    db.update_workspace_link(&ws_id, Some("PROJ-42".into()), false).unwrap();
    let ws = db.get_workspace(&ws_id).unwrap();
    assert_eq!(ws.linked_issue_key.as_deref(), Some("PROJ-42"));
    assert!(!ws.issue_link_dismissed);

    db.update_workspace_link(&ws_id, None, true).unwrap();
    let ws = db.get_workspace(&ws_id).unwrap();
    assert_eq!(ws.linked_issue_key, None);
    assert!(ws.issue_link_dismissed);
}
```

If `create_project_for_tests` / `create_workspace_for_tests` don't exist with those exact names, search `tests.rs` for the existing fixture helpers and use those (or inline the seed SQL the way other tests do it).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test workspace_link_round_trip`
Expected: FAIL (compilation error or missing fields).

- [ ] **Step 3: Extend `WorkspaceRow` struct**

In `src-tauri/src/db.rs` (around line 1052), replace the `WorkspaceRow` struct with:

```rust
#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRow {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub task: String,
    pub branch: String,
    pub worktree_path: Option<String>,
    pub setup_script: String,
    pub status: String,
    pub created_at: String,
    pub last_active: String,
    pub glyph: Option<String>,
    pub tint: Option<String>,
    pub test_command: Option<String>,
    pub linked_issue_key: Option<String>,
    pub issue_link_dismissed: bool,
}
```

- [ ] **Step 4: Update workspace SELECT queries to read the new columns**

Search `src-tauri/src/db.rs` for `SELECT id, project_id, name, task, branch` (likely two occurrences — `list_workspaces` and `get_workspace`). For each, append `, linked_issue_key, issue_link_dismissed` to the column list and the corresponding `row.get` indices in the mapper. Example mapper diff (the exact line numbers depend on the surrounding code — adjust):

```rust
            WorkspaceRow {
                id: row.get(0)?,
                project_id: row.get(1)?,
                name: row.get(2)?,
                task: row.get(3)?,
                branch: row.get(4)?,
                worktree_path: row.get(5)?,
                setup_script: row.get(6)?,
                status: row.get(7)?,
                created_at: row.get(8)?,
                last_active: row.get(9)?,
                glyph: row.get(10)?,
                tint: row.get(11)?,
                test_command: row.get(12)?,
                linked_issue_key: row.get(13)?,
                issue_link_dismissed: row.get::<_, i64>(14)? != 0,
            }
```

If the existing mapper uses named columns or a different style, mirror that style — don't unilaterally change it.

- [ ] **Step 5: Add the `update_workspace_link` method on `Db`**

In `src-tauri/src/db.rs`, inside `impl Db`, add:

```rust
    pub fn update_workspace_link(
        &self,
        workspace_id: &str,
        linked_issue_key: Option<String>,
        dismissed: bool,
    ) -> AppResult<()> {
        self.conn.execute(
            "UPDATE workspaces SET linked_issue_key = ?1, issue_link_dismissed = ?2 WHERE id = ?3",
            rusqlite::params![linked_issue_key, dismissed as i64, workspace_id],
        )?;
        Ok(())
    }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd src-tauri && cargo test workspace_link_round_trip`
Expected: PASS.

- [ ] **Step 7: Add the Tauri command in `commands.rs`**

In `src-tauri/src/commands.rs`, alongside the existing workspace commands (search for `pub async fn list_workspaces` or `pub async fn rename_workspace` for the surrounding pattern), add:

```rust
#[tauri::command]
pub async fn update_workspace_link(
    state: State<'_, AppState>,
    workspace_id: String,
    linked_issue_key: Option<String>,
    dismissed: bool,
) -> AppResult<()> {
    let db = state.db.lock().await;
    db.update_workspace_link(&workspace_id, linked_issue_key, dismissed)
}
```

If `state.db` is `Mutex<Db>` (sync) instead of async, mirror the locking pattern of the nearest existing command — don't change it. If the project uses `tokio::sync::Mutex` everywhere, use `.lock().await`; if `std::sync::Mutex`, use `.lock().unwrap()`.

- [ ] **Step 8: Register the command in `lib.rs`**

Open `src-tauri/src/lib.rs`. Find the `tauri::generate_handler![...]` macro call (it lists every command). Add `commands::update_workspace_link,` to the list, in the same area where other Jira commands are registered (search for `list_my_issues`).

- [ ] **Step 9: Confirm clean build and full lib tests pass**

Run: `cd src-tauri && cargo build`
Expected: clean compile, no NEW warnings beyond the existing 5 advisory ones from v1.

Run: `cd src-tauri && cargo test --lib`
Expected: all tests pass (151 + new ones).

- [ ] **Step 10: Commit**

```bash
git add src-tauri/src/db.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/src/tests.rs
git commit -m "feat(jira-v2): workspace.linkedIssueKey + issueLinkDismissed + update_workspace_link command"
```

---

## Task 3: Backend — Project Jira mapping field + `update_project_jira_key` command

**Files:**
- Modify: `src-tauri/src/commands.rs` — extend `ProjectInfo` struct (`src-tauri/src/commands.rs:376-380`); add `update_project_jira_key` command
- Modify: `src-tauri/src/db.rs` — update `list_projects` / `get_project` to SELECT the new column; add `update_project_jira_key` Db method
- Modify: `src-tauri/src/lib.rs` — register the new command
- Test: `src-tauri/src/tests.rs`

- [ ] **Step 1: Write the failing test**

In `src-tauri/src/tests.rs`:

```rust
#[test]
fn project_jira_key_round_trip() {
    let db = crate::db::Db::open_in_memory().expect("open in-memory db");
    let project_id = db.create_project_for_tests("/tmp/repo", "Test").unwrap();

    db.update_project_jira_key(&project_id, Some("CLPNSNS".into())).unwrap();
    let p = db.get_project(&project_id).unwrap();
    assert_eq!(p.jira_project_key.as_deref(), Some("CLPNSNS"));

    db.update_project_jira_key(&project_id, None).unwrap();
    let p = db.get_project(&project_id).unwrap();
    assert_eq!(p.jira_project_key, None);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test project_jira_key_round_trip`
Expected: FAIL.

- [ ] **Step 3: Extend `ProjectInfo` struct**

In `src-tauri/src/commands.rs`, around line 376, replace:

```rust
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub jira_project_key: Option<String>,
}
```

- [ ] **Step 4: Update Project SELECTs and add Db methods**

Search `db.rs` for `SELECT id, name, path FROM projects` (or similar). Append `, jira_project_key` to the column list and add the `jira_project_key: row.get(3)?` to the mapper.

Also in `db.rs` `impl Db`, add:

```rust
    pub fn update_project_jira_key(
        &self,
        project_id: &str,
        jira_project_key: Option<String>,
    ) -> AppResult<()> {
        self.conn.execute(
            "UPDATE projects SET jira_project_key = ?1 WHERE id = ?2",
            rusqlite::params![jira_project_key, project_id],
        )?;
        Ok(())
    }
```

If a `get_project(id)` method doesn't exist on `Db`, add one that mirrors `list_projects` but with a `WHERE id = ?` and returns a single `ProjectInfo`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd src-tauri && cargo test project_jira_key_round_trip`
Expected: PASS.

- [ ] **Step 6: Add the Tauri command**

In `src-tauri/src/commands.rs`:

```rust
#[tauri::command]
pub async fn update_project_jira_key(
    state: State<'_, AppState>,
    project_id: String,
    jira_project_key: Option<String>,
) -> AppResult<()> {
    let db = state.db.lock().await;
    db.update_project_jira_key(&project_id, jira_project_key)
}
```

(Match the locking pattern of the nearby existing commands.)

- [ ] **Step 7: Register in `lib.rs`**

Add `commands::update_project_jira_key,` to the `generate_handler!` list near `update_workspace_link`.

- [ ] **Step 8: Build + full tests**

Run: `cd src-tauri && cargo build && cargo test --lib`
Expected: clean build; all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/db.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/src/tests.rs
git commit -m "feat(jira-v2): project.jiraProjectKey + update_project_jira_key command"
```

---

## Task 4: Frontend types + ipc bindings

**Files:**
- Modify: `src/lib/types.ts:116-120` (extend `ProjectInfo`), `src/lib/types.ts:126-140` (extend `Workspace`)
- Modify: `src/lib/ipc.ts` — two new bindings

- [ ] **Step 1: Extend `ProjectInfo` in `types.ts`**

At `src/lib/types.ts:116`, replace:

```ts
export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  jiraProjectKey: string | null;
}
```

- [ ] **Step 2: Extend `Workspace` in `types.ts`**

At `src/lib/types.ts:126`, in the existing `Workspace` interface, add the two new fields at the bottom (above the closing brace):

```ts
  linkedIssueKey: string | null;
  issueLinkDismissed: boolean;
```

- [ ] **Step 3: Add ipc bindings in `ipc.ts`**

In `src/lib/ipc.ts`, in the Issue Tracker section, add:

```ts
  updateWorkspaceLink: (workspaceId: string, linkedIssueKey: string | null, dismissed: boolean) =>
    invoke<void>("update_workspace_link", { workspaceId, linkedIssueKey, dismissed }),

  updateProjectJiraKey: (projectId: string, jiraProjectKey: string | null) =>
    invoke<void>("update_project_jira_key", { projectId, jiraProjectKey }),
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: clean. (Any callers that destructure `Workspace` without these new fields may need to be updated — but since they're new fields added at the bottom, TypeScript will accept the existing reads. Only writes/constructions of `Workspace` need to include them.)

If typecheck fails because somewhere builds a literal `Workspace` object inline, add the two new fields with appropriate defaults (`linkedIssueKey: null`, `issueLinkDismissed: false`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/ipc.ts
git commit -m "feat(jira-v2): frontend types + ipc bindings for contextual linkage"
```

---

## Task 5: Pure selectors module (`issueTrackerSelectors.ts`)

**Files:**
- Create: `src/lib/issueTrackerSelectors.ts`
- Create: `src/lib/issueTrackerSelectors.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/issueTrackerSelectors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  resolveLinkage,
  resolveJiraProjectKey,
  selectBacklog,
  selectElsewhereCount,
} from "./issueTrackerSelectors";
import type { Issue, ProjectInfo, Workspace } from "./types";

function ws(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "w1",
    projectId: "p1",
    name: "ws",
    task: "",
    branch: "main",
    worktreePath: null,
    setupScript: "",
    status: "active",
    createdAt: "",
    lastActive: "",
    glyph: null,
    tint: null,
    testCommand: null,
    linkedIssueKey: null,
    issueLinkDismissed: false,
    ...overrides,
  };
}

function proj(overrides: Partial<ProjectInfo> = {}): ProjectInfo {
  return { id: "p1", name: "Test", path: "/tmp/repo", jiraProjectKey: null, ...overrides };
}

function issue(key: string, statusCategory: Issue["statusCategory"] = "todo", priority: string | null = null): Issue {
  return {
    key,
    summary: "summary " + key,
    statusName: statusCategory === "inProgress" ? "In Progress" : "To Do",
    statusCategory,
    issueType: "Story",
    priority,
    url: "https://x/browse/" + key,
    parentKey: null,
  };
}

describe("resolveLinkage", () => {
  it("manual link wins over branch detection", () => {
    expect(resolveLinkage(ws({ linkedIssueKey: "ABC-1" }), "feat/XYZ-9")).toEqual({
      kind: "linked", key: "ABC-1", source: "manual",
    });
  });

  it("detected from branch when no manual link", () => {
    expect(resolveLinkage(ws(), "feat/PROJ-42-foo")).toEqual({
      kind: "linked", key: "PROJ-42", source: "detected",
    });
  });

  it("dismissed only when no manual + no branch key", () => {
    expect(resolveLinkage(ws({ issueLinkDismissed: true }), "main")).toEqual({ kind: "dismissed" });
  });

  it("dismissed is overridden by branch key (rename reactivates card)", () => {
    expect(
      resolveLinkage(ws({ issueLinkDismissed: true }), "feat/PROJ-7-go"),
    ).toEqual({ kind: "linked", key: "PROJ-7", source: "detected" });
  });

  it("unlinked when nothing else applies", () => {
    expect(resolveLinkage(ws(), "main")).toEqual({ kind: "unlinked" });
  });
});

describe("resolveJiraProjectKey", () => {
  it("project override wins over branch", () => {
    expect(
      resolveJiraProjectKey(proj({ jiraProjectKey: "FORCED" }), ws(), "feat/OTHER-1"),
    ).toBe("FORCED");
  });

  it("falls back to linkage prefix when no override", () => {
    expect(
      resolveJiraProjectKey(proj(), ws({ linkedIssueKey: "CLPNSNS-92" }), "main"),
    ).toBe("CLPNSNS");
  });

  it("falls back to branch detection when no override + no manual link", () => {
    expect(
      resolveJiraProjectKey(proj(), ws(), "feat/PROJ-1"),
    ).toBe("PROJ");
  });

  it("returns null when nothing resolves", () => {
    expect(resolveJiraProjectKey(proj(), ws(), "main")).toBeNull();
  });
});

describe("selectBacklog", () => {
  const issues = [
    issue("CLPNSNS-92", "inProgress", "High"),
    issue("CLPNSNS-105", "todo", "Medium"),
    issue("CLPNSNS-99", "done", "Low"),
    issue("OTHER-1", "todo"),
  ];

  it("filters by project prefix and excludes active key", () => {
    const result = selectBacklog(issues, "CLPNSNS", "CLPNSNS-92");
    expect(result.map((i) => i.key)).toEqual(["CLPNSNS-105", "CLPNSNS-99"]);
  });

  it("returns [] when projectKey is null", () => {
    expect(selectBacklog(issues, null, null)).toEqual([]);
  });

  it("sorts by statusCategory (inProgress, todo, unknown, done) then priority then key", () => {
    const mixed = [
      issue("P-3", "todo", "Low"),
      issue("P-1", "done"),
      issue("P-2", "inProgress", "High"),
      issue("P-4", "todo", "High"),
    ];
    const result = selectBacklog(mixed, "P", null);
    expect(result.map((i) => i.key)).toEqual(["P-2", "P-4", "P-3", "P-1"]);
  });
});

describe("selectElsewhereCount", () => {
  it("counts only inProgress outside the active project", () => {
    const issues = [
      issue("HERE-1", "inProgress"),
      issue("OTHER-1", "inProgress"),
      issue("OTHER-2", "todo"),
      issue("FAR-1", "inProgress"),
    ];
    expect(selectElsewhereCount(issues, "HERE")).toBe(2);
  });

  it("returns 0 when projectKey is null (nothing is 'elsewhere')", () => {
    expect(selectElsewhereCount([issue("A-1", "inProgress")], null)).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/issueTrackerSelectors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `src/lib/issueTrackerSelectors.ts`:

```ts
import type { Issue, ProjectInfo, Workspace } from "./types";
import { detectIssueKey } from "./detectIssueKey";

export type LinkageState =
  | { kind: "linked"; key: string; source: "manual" | "detected" }
  | { kind: "dismissed" }
  | { kind: "unlinked" };

export function resolveLinkage(ws: Workspace, branch: string): LinkageState {
  if (ws.linkedIssueKey) {
    return { kind: "linked", key: ws.linkedIssueKey, source: "manual" };
  }
  const detected = detectIssueKey(branch);
  if (detected) {
    return { kind: "linked", key: detected, source: "detected" };
  }
  if (ws.issueLinkDismissed) {
    return { kind: "dismissed" };
  }
  return { kind: "unlinked" };
}

export function resolveJiraProjectKey(
  project: ProjectInfo,
  workspace: Workspace,
  branch: string,
): string | null {
  if (project.jiraProjectKey) return project.jiraProjectKey;
  const linkage = resolveLinkage(workspace, branch);
  if (linkage.kind === "linked") {
    return linkage.key.split("-")[0];
  }
  return null;
}

// Order maps the spec's "inProgress → todo → unknown → done" rule.
const STATUS_RANK: Record<Issue["statusCategory"], number> = {
  inProgress: 0,
  todo: 1,
  unknown: 2,
  done: 3,
};

// Jira priorities normalized to a numeric rank; absent or unknown -> 99 (last).
const PRIORITY_RANK: Record<string, number> = {
  Highest: 0,
  High: 1,
  Medium: 2,
  Low: 3,
  Lowest: 4,
};
function priorityRank(p: string | null): number {
  return p != null && PRIORITY_RANK[p] !== undefined ? PRIORITY_RANK[p] : 99;
}

export function selectBacklog(
  allIssues: Issue[],
  projectKey: string | null,
  activeKey: string | null,
): Issue[] {
  if (projectKey == null) return [];
  const prefix = projectKey + "-";
  return allIssues
    .filter((i) => i.key.startsWith(prefix) && i.key !== activeKey)
    .sort((a, b) => {
      const s = STATUS_RANK[a.statusCategory] - STATUS_RANK[b.statusCategory];
      if (s !== 0) return s;
      const p = priorityRank(a.priority) - priorityRank(b.priority);
      if (p !== 0) return p;
      return a.key.localeCompare(b.key);
    });
}

export function selectElsewhereCount(
  allIssues: Issue[],
  projectKey: string | null,
): number {
  if (projectKey == null) return 0;
  const prefix = projectKey + "-";
  return allIssues.filter(
    (i) => !i.key.startsWith(prefix) && i.statusCategory === "inProgress",
  ).length;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/issueTrackerSelectors.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/issueTrackerSelectors.ts src/lib/issueTrackerSelectors.test.ts
git commit -m "feat(jira-v2): pure selectors for linkage, project key, backlog, elsewhere count"
```

---

## Task 6: `parentIssuesStore` (tiny cache for epic/parent issues)

**Files:**
- Create: `src/stores/parentIssuesStore.ts`
- Create: `src/stores/parentIssuesStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/stores/parentIssuesStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const getIssueMock = vi.fn();
vi.mock("../lib/ipc", () => ({
  ipc: { getIssue: getIssueMock },
}));

import { useParentIssuesStore } from "./parentIssuesStore";

beforeEach(() => {
  vi.clearAllMocks();
  // Reset store between tests.
  useParentIssuesStore.setState({ parents: {}, loading: {} });
});

describe("parentIssuesStore", () => {
  it("loads a parent on first request and caches it", async () => {
    const issue = {
      key: "EPIC-1",
      summary: "Notifications",
      statusName: "In Progress",
      statusCategory: "inProgress" as const,
      issueType: "Epic",
      priority: null,
      url: "https://x/browse/EPIC-1",
      parentKey: null,
    };
    getIssueMock.mockResolvedValue(issue);

    await useParentIssuesStore.getState().loadParent("EPIC-1");
    expect(useParentIssuesStore.getState().parents["EPIC-1"]).toEqual(issue);
    expect(getIssueMock).toHaveBeenCalledTimes(1);

    // Second call must hit cache — no extra ipc call.
    await useParentIssuesStore.getState().loadParent("EPIC-1");
    expect(getIssueMock).toHaveBeenCalledTimes(1);
  });

  it("survives a getIssue failure without crashing", async () => {
    getIssueMock.mockRejectedValue(new Error("404"));
    await useParentIssuesStore.getState().loadParent("MISSING-1");
    expect(useParentIssuesStore.getState().parents["MISSING-1"]).toBeUndefined();
    // The failed load is not marked as in-flight after settling.
    expect(useParentIssuesStore.getState().loading["MISSING-1"]).toBeFalsy();
  });

  it("guards against concurrent loads for the same key", async () => {
    let resolveOne!: (v: unknown) => void;
    getIssueMock.mockImplementation(
      () => new Promise((res) => { resolveOne = res; }),
    );
    const p1 = useParentIssuesStore.getState().loadParent("E-1");
    const p2 = useParentIssuesStore.getState().loadParent("E-1");
    resolveOne({
      key: "E-1", summary: "x", statusName: "x", statusCategory: "todo",
      issueType: "Epic", priority: null, url: "u", parentKey: null,
    });
    await Promise.all([p1, p2]);
    expect(getIssueMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/stores/parentIssuesStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create `src/stores/parentIssuesStore.ts`:

```ts
import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { Issue } from "../lib/types";

interface State {
  parents: Record<string, Issue>;
  loading: Record<string, boolean>;
  loadParent: (key: string) => Promise<void>;
}

export const useParentIssuesStore = create<State>((set, get) => ({
  parents: {},
  loading: {},
  async loadParent(key: string) {
    const s = get();
    if (s.parents[key] || s.loading[key]) return;
    set((cur) => ({ loading: { ...cur.loading, [key]: true } }));
    try {
      const issue = await ipc.getIssue(key);
      set((cur) => ({
        parents: { ...cur.parents, [key]: issue },
        loading: { ...cur.loading, [key]: false },
      }));
    } catch {
      // Quiet failure: do not populate cache; clear loading so a retry is possible.
      set((cur) => ({ loading: { ...cur.loading, [key]: false } }));
    }
  },
}));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/stores/parentIssuesStore.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/stores/parentIssuesStore.ts src/stores/parentIssuesStore.test.ts
git commit -m "feat(jira-v2): parentIssuesStore (tiny cache for epic/parent issues)"
```

---

## Task 7: `InlineTicketPicker` component (standalone, headless of any panel)

**Files:**
- Create: `src/components/InlineTicketPicker.tsx`
- Create: `src/components/InlineTicketPicker.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/InlineTicketPicker.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InlineTicketPicker } from "./InlineTicketPicker";
import type { Issue } from "../lib/types";

const getIssueMock = vi.fn();
vi.mock("../lib/ipc", () => ({
  ipc: { getIssue: getIssueMock },
}));

function issue(key: string, summary: string, statusCategory: Issue["statusCategory"] = "todo"): Issue {
  return {
    key, summary,
    statusName: statusCategory === "inProgress" ? "In Progress" : "To Do",
    statusCategory, issueType: "Story", priority: null,
    url: "https://x/browse/" + key, parentKey: null,
  };
}

const SAMPLE: Issue[] = [
  issue("CLPNSNS-92", "Consumir notificaciones", "inProgress"),
  issue("CLPNSNS-105", "Diseñar bandeja"),
  issue("CLPNSNS-110", "Push para móvil"),
  issue("OTHER-7", "Algo más"),
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("InlineTicketPicker", () => {
  it("renders results filtered by query within the project scope by default", () => {
    render(
      <InlineTicketPicker
        candidates={SAMPLE}
        projectKey="CLPNSNS"
        onPick={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // Default scope is the project; type "notif" -> only CLPNSNS-92 matches.
    fireEvent.change(screen.getByPlaceholderText(/busca/i), { target: { value: "notif" } });
    expect(screen.getByText("CLPNSNS-92")).toBeInTheDocument();
    expect(screen.queryByText("OTHER-7")).not.toBeInTheDocument();
  });

  it("scope toggle 'Todos' includes other-project matches", () => {
    render(
      <InlineTicketPicker
        candidates={SAMPLE}
        projectKey="CLPNSNS"
        onPick={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /todos/i }));
    fireEvent.change(screen.getByPlaceholderText(/busca/i), { target: { value: "algo" } });
    expect(screen.getByText("OTHER-7")).toBeInTheDocument();
  });

  it("Enter picks the highlighted (first) row", () => {
    const onPick = vi.fn();
    render(
      <InlineTicketPicker
        candidates={SAMPLE}
        projectKey="CLPNSNS"
        onPick={onPick}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/busca/i), { target: { value: "" } });
    fireEvent.keyDown(screen.getByPlaceholderText(/busca/i), { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("CLPNSNS-92");
  });

  it("ArrowDown then Enter picks the second row", () => {
    const onPick = vi.fn();
    render(
      <InlineTicketPicker
        candidates={SAMPLE}
        projectKey="CLPNSNS"
        onPick={onPick}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.keyDown(screen.getByPlaceholderText(/busca/i), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByPlaceholderText(/busca/i), { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("CLPNSNS-105");
  });

  it("Escape calls onCancel", () => {
    const onCancel = vi.fn();
    render(
      <InlineTicketPicker
        candidates={SAMPLE}
        projectKey="CLPNSNS"
        onPick={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(screen.getByPlaceholderText(/busca/i), { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("shows the exact-key fallback when query matches the regex and no results match", async () => {
    getIssueMock.mockResolvedValue(issue("CLPNSNS-555", "Recién creado"));
    const onPick = vi.fn();
    render(
      <InlineTicketPicker
        candidates={SAMPLE}
        projectKey="CLPNSNS"
        onPick={onPick}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/busca/i), { target: { value: "CLPNSNS-555" } });
    // The fallback row shows the key and a USE → affordance.
    const useBtn = await screen.findByRole("button", { name: /use clpnsns-555/i });
    fireEvent.click(useBtn);
    expect(getIssueMock).toHaveBeenCalledWith("CLPNSNS-555");
    expect(onPick).toHaveBeenCalledWith("CLPNSNS-555");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/InlineTicketPicker.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement the component**

Create `src/components/InlineTicketPicker.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { Issue, StatusCategory } from "../lib/types";
import { ipc } from "../lib/ipc";

const STATUS_DOT: Record<StatusCategory, string> = {
  todo: "text-octo-mute",
  inProgress: "text-octo-brass",
  done: "text-octo-verdigris",
  unknown: "text-octo-sage",
};

const KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;

interface Props {
  candidates: Issue[];
  projectKey: string | null;
  onPick: (key: string) => void;
  onCancel: () => void;
}

export function InlineTicketPicker({ candidates, projectKey, onPick, onCancel }: Props) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"project" | "all">(projectKey ? "project" : "all");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const results = useMemo(() => {
    const scoped =
      scope === "project" && projectKey
        ? candidates.filter((i) => i.key.startsWith(projectKey + "-"))
        : candidates;
    if (!query) return scoped.slice(0, 8);
    const q = query.toLowerCase();
    return scoped
      .filter((i) => i.key.toLowerCase().includes(q) || i.summary.toLowerCase().includes(q))
      .slice(0, 8);
  }, [candidates, scope, projectKey, query]);

  useEffect(() => { setHighlight(0); }, [query, scope]);

  const showFallback = results.length === 0 && KEY_RE.test(query);

  async function pickFallback() {
    try {
      await ipc.getIssue(query);
      onPick(query);
    } catch {
      // Quiet — surface remains the picker; user can clear and retry.
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") { e.preventDefault(); onCancel(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (showFallback) { void pickFallback(); return; }
      const picked = results[highlight];
      if (picked) onPick(picked.key);
    }
  }

  return (
    <div
      className="rounded-r p-3"
      style={{ background: "var(--brass-ghost)", borderLeft: "1px solid var(--brass-dim)" }}
    >
      {/* Scope toggle */}
      <div className="mb-2 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.15em] text-octo-mute">
        <span>Scope:</span>
        <button
          type="button"
          onClick={() => setScope("project")}
          className={`rounded-full border px-2 py-[2px] ${
            scope === "project"
              ? "border-octo-brass text-octo-brass"
              : "border-octo-hairline text-octo-mute"
          }`}
          style={scope === "project" ? { background: "var(--brass-ghost)" } : undefined}
          disabled={!projectKey}
          title={projectKey ?? ""}
        >
          {projectKey ?? "—"}
        </button>
        <button
          type="button"
          onClick={() => setScope("all")}
          className={`rounded-full border px-2 py-[2px] ${
            scope === "all"
              ? "border-octo-brass text-octo-brass"
              : "border-octo-hairline text-octo-mute"
          }`}
          style={scope === "all" ? { background: "var(--brass-ghost)" } : undefined}
        >
          Todos
        </button>
      </div>

      {/* Input */}
      <div className="relative">
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 font-mono text-octo-brass">
          ⟶
        </span>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="busca por clave o resumen…"
          className="w-full rounded border border-octo-hairline bg-octo-onyx py-1 pl-7 pr-12 font-mono text-[12px] text-octo-ivory outline-none focus:border-octo-brass"
        />
        <button
          type="button"
          onClick={onCancel}
          className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[9px] uppercase tracking-[0.15em] text-octo-mute hover:text-octo-brass"
        >
          ESC
        </button>
      </div>

      {/* Hints */}
      <div className="mt-1 flex gap-3 font-mono text-[9px] tracking-[0.1em] text-octo-mute">
        <span>↑↓ navegar</span>
        <span>↵ seleccionar</span>
        <span>ESC cancelar</span>
      </div>

      {/* Results */}
      <div className="mt-2 border-t border-octo-hairline pt-1">
        {results.map((r, idx) => (
          <button
            key={r.key}
            type="button"
            onClick={() => onPick(r.key)}
            onMouseEnter={() => setHighlight(idx)}
            className={`flex w-full items-center gap-2 rounded px-1 py-[5px] text-left ${
              idx === highlight ? "" : ""
            }`}
            style={idx === highlight ? { background: "rgba(212,165,116,0.12)" } : undefined}
          >
            <span aria-hidden className={`h-[6px] w-[6px] rounded-full ${STATUS_DOT[r.statusCategory]}`} style={{ background: "currentColor" }} />
            <span className="font-mono text-[11px] text-octo-brass">{r.key}</span>
            <span className="flex-1 truncate text-[12px] text-octo-sage">{r.summary}</span>
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-octo-mute">{r.statusName}</span>
          </button>
        ))}

        {showFallback && (
          <div className="mt-1 border-t border-dashed border-octo-hairline pt-2">
            <button
              type="button"
              onClick={() => void pickFallback()}
              aria-label={`Use ${query}`}
              className="flex w-full items-center gap-2 rounded px-1 py-[5px] text-left"
              style={{ background: "rgba(212,165,116,0.12)" }}
            >
              <span aria-hidden className="h-[6px] w-[6px] rounded-full text-octo-mute" style={{ background: "currentColor" }} />
              <span className="font-mono text-[11px] text-octo-brass">{query}</span>
              <span className="flex-1 truncate text-[12px] text-octo-sage">(no asignado a ti — se verificará al vincular)</span>
              <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-octo-brass">USE →</span>
            </button>
          </div>
        )}

        {results.length === 0 && !showFallback && (
          <p className="px-1 py-1 font-mono text-[10px] tracking-[0.1em] text-octo-mute">
            Sin matches en tus tickets asignados.
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/InlineTicketPicker.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/InlineTicketPicker.tsx src/components/InlineTicketPicker.test.tsx
git commit -m "feat(jira-v2): InlineTicketPicker (scope toggle, keyboard nav, exact-key fallback)"
```

---

## Task 8: `ActiveTicketPanel` component

**Files:**
- Create: `src/components/ActiveTicketPanel.tsx`
- Create: `src/components/ActiveTicketPanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/ActiveTicketPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { ActiveTicketPanel } from "./ActiveTicketPanel";
import type { Issue } from "../lib/types";

const openFileInSystemMock = vi.fn();
const updateWorkspaceLinkMock = vi.fn();
vi.mock("../lib/ipc", () => ({
  ipc: {
    openFileInSystem: openFileInSystemMock,
    updateWorkspaceLink: updateWorkspaceLinkMock,
    getIssue: vi.fn(),
  },
}));

const issue: Issue = {
  key: "CLPNSNS-92",
  summary: "Consumir el servicio de notificaciones del backend",
  statusName: "In Progress",
  statusCategory: "inProgress",
  issueType: "Story",
  priority: "High",
  url: "https://acme.atlassian.net/browse/CLPNSNS-92",
  parentKey: "EPIC-1",
};

beforeEach(() => { vi.clearAllMocks(); });

describe("ActiveTicketPanel", () => {
  it("linked state: shows key + status + summary + meta + open-in-Jira", () => {
    render(
      <ActiveTicketPanel
        state={{ kind: "linked", key: "CLPNSNS-92", source: "detected" }}
        activeIssue={issue}
        candidates={[issue]}
        projectKey="CLPNSNS"
        workspaceId="w1"
      />,
    );
    expect(screen.getByText("CLPNSNS-92")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText(/notificaciones/i)).toBeInTheDocument();
    expect(screen.getByText(/STORY · HIGH/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /open in jira/i }));
    expect(openFileInSystemMock).toHaveBeenCalledWith(issue.url);
  });

  it("unlinked state: shows two affordances and 'No usar' triggers dismiss", async () => {
    render(
      <ActiveTicketPanel
        state={{ kind: "unlinked" }}
        activeIssue={null}
        candidates={[]}
        projectKey={null}
        workspaceId="w1"
      />,
    );
    expect(screen.getByText(/sin ticket vinculado/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /vincular/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /no usar ticket aqu/i }));
    await waitFor(() => {
      expect(updateWorkspaceLinkMock).toHaveBeenCalledWith("w1", null, true);
    });
  });

  it("'Vincular →' swaps the unlinked body for the picker", () => {
    render(
      <ActiveTicketPanel
        state={{ kind: "unlinked" }}
        activeIssue={null}
        candidates={[issue]}
        projectKey="CLPNSNS"
        workspaceId="w1"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /vincular/i }));
    expect(screen.getByPlaceholderText(/busca por clave o resumen/i)).toBeInTheDocument();
  });

  it("dismissed state: shows the eyebrow + a compact 'Vincular' resurface row", () => {
    render(
      <ActiveTicketPanel
        state={{ kind: "dismissed" }}
        activeIssue={null}
        candidates={[]}
        projectKey={null}
        workspaceId="w1"
      />,
    );
    expect(screen.getByText(/active ticket/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /\+ vincular ticket/i })).toBeInTheDocument();
  });

  it("linked but activeIssue is null: shows error card with Desvincular", async () => {
    render(
      <ActiveTicketPanel
        state={{ kind: "linked", key: "CLPNSNS-X", source: "manual" }}
        activeIssue={null}
        candidates={[]}
        projectKey="CLPNSNS"
        workspaceId="w1"
      />,
    );
    expect(screen.getByText(/no se pudo cargar/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /desvincular/i }));
    await waitFor(() => {
      expect(updateWorkspaceLinkMock).toHaveBeenCalledWith("w1", null, false);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/ActiveTicketPanel.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement the component**

Create `src/components/ActiveTicketPanel.tsx`:

```tsx
import { useEffect, useState } from "react";
import { ipc } from "../lib/ipc";
import { useIssuesStore } from "../stores/issuesStore";
import { useParentIssuesStore } from "../stores/parentIssuesStore";
import type { Issue } from "../lib/types";
import type { LinkageState } from "../lib/issueTrackerSelectors";
import { InlineTicketPicker } from "./InlineTicketPicker";

interface Props {
  state: LinkageState;
  activeIssue: Issue | null;
  candidates: Issue[];
  projectKey: string | null;
  workspaceId: string;
}

export function ActiveTicketPanel({ state, activeIssue, candidates, projectKey, workspaceId }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [picking, setPicking] = useState(false);
  const parents = useParentIssuesStore((s) => s.parents);
  const loadParent = useParentIssuesStore((s) => s.loadParent);

  useEffect(() => {
    if (activeIssue?.parentKey) void loadParent(activeIssue.parentKey);
  }, [activeIssue?.parentKey, loadParent]);

  async function dismiss() {
    await ipc.updateWorkspaceLink(workspaceId, null, true);
  }
  async function undismiss() {
    await ipc.updateWorkspaceLink(workspaceId, null, false);
  }
  async function unlink() {
    await ipc.updateWorkspaceLink(workspaceId, null, false);
  }
  async function confirmPick(key: string) {
    await ipc.updateWorkspaceLink(workspaceId, key, false);
    setPicking(false);
    // The picked ticket may not be in the global issues list (e.g. it was
    // confirmed via the exact-key fallback for a ticket not assigned to the
    // user). Trigger a single refresh so the card has data immediately.
    void useIssuesStore.getState().load();
  }

  return (
    <div className="border-b border-octo-hairline px-3 py-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex flex-1 items-center justify-between font-mono text-[9px] uppercase tracking-[0.25em] text-octo-mute"
        >
          <span>§ Active Ticket</span>
          <span className="mr-1">{collapsed ? "▸" : "▾"}</span>
        </button>
      </div>

      {!collapsed && state.kind === "linked" && activeIssue && (
        <div
          className="mt-2 rounded-r p-3"
          style={{ background: "var(--brass-ghost)", borderLeft: "1px solid var(--brass-dim)" }}
        >
          <div className="flex items-center gap-2">
            <span className="text-octo-brass" aria-hidden>◈</span>
            <span className="font-mono text-[12px] text-octo-brass">{activeIssue.key}</span>
            <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.15em] text-octo-mute">
              {activeIssue.statusName}
            </span>
            <button
              type="button"
              aria-label="Open in Jira"
              title="Open in Jira"
              onClick={() => ipc.openFileInSystem(activeIssue.url).catch(() => {})}
              className="ml-1 font-mono text-[10px] text-octo-mute hover:text-octo-brass"
            >
              ↗
            </button>
          </div>
          <div className="mt-1 text-[13px] leading-tight text-octo-ivory">
            {activeIssue.summary}
          </div>
          <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-octo-mute">
            {activeIssue.issueType.toUpperCase()}
            {activeIssue.priority ? ` · ${activeIssue.priority.toUpperCase()}` : ""}
            {activeIssue.parentKey && parents[activeIssue.parentKey] && (
              <>
                {" · "}
                <span className="text-octo-brass">Epic: {parents[activeIssue.parentKey].summary}</span>
              </>
            )}
          </div>
        </div>
      )}

      {!collapsed && state.kind === "linked" && !activeIssue && (
        <div
          className="mt-2 rounded-r p-3"
          style={{ background: "rgba(212,165,116,0.08)", borderLeft: "1px solid var(--brass-dim)" }}
        >
          <div className="flex items-center gap-2 font-mono text-[12px] text-octo-mute">
            <span className="text-octo-brass">{state.key}</span>
            <span className="text-[10px]">· no se pudo cargar este ticket</span>
            <button
              type="button"
              onClick={() => void unlink()}
              className="ml-auto font-mono text-[9px] uppercase tracking-[0.15em] text-octo-brass"
            >
              Desvincular
            </button>
          </div>
        </div>
      )}

      {!collapsed && state.kind === "unlinked" && !picking && (
        <div className="mt-2 flex items-center gap-3 text-[12px] text-octo-sage">
          <span>Sin ticket vinculado.</span>
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="font-mono text-[10px] uppercase tracking-[0.15em] text-octo-brass"
          >
            Vincular →
          </button>
          <button
            type="button"
            onClick={() => void dismiss()}
            className="font-mono text-[10px] uppercase tracking-[0.15em] text-octo-mute hover:text-octo-brass"
          >
            No usar ticket aquí
          </button>
        </div>
      )}

      {!collapsed && state.kind === "unlinked" && picking && (
        <div className="mt-2">
          <InlineTicketPicker
            candidates={candidates}
            projectKey={projectKey}
            onPick={(key) => void confirmPick(key)}
            onCancel={() => setPicking(false)}
          />
        </div>
      )}

      {!collapsed && state.kind === "dismissed" && (
        <div className="mt-1">
          <button
            type="button"
            onClick={() => void undismiss()}
            className="font-mono text-[10px] tracking-[0.1em] text-octo-mute hover:text-octo-brass"
          >
            ↳ + Vincular ticket
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/ActiveTicketPanel.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/ActiveTicketPanel.tsx src/components/ActiveTicketPanel.test.tsx
git commit -m "feat(jira-v2): ActiveTicketPanel (linked/unlinked/dismissed/error states)"
```

---

## Task 9: `BacklogPanel` rewire — project-scoped eyebrow + empty states

**Files:**
- Modify: `src/components/BacklogPanel.tsx`
- Modify: `src/components/BacklogPanel.test.tsx`

- [ ] **Step 1: Update the test fixtures to assert the new behavior**

Open `src/components/BacklogPanel.test.tsx`. Locate the existing 9 tests. Update the import and the `Props` accepted by render to include the new ones; add three new test cases. Final test file should match:

(Read the existing file first; the changes are: (a) the component now accepts `projectKey: string | null` and `activeKey: string | null`; (b) it filters via the selector at module level; (c) the eyebrow embeds project + count.)

Replace the relevant `render(...)` calls in existing tests so they pass `projectKey="CLPNSNS"` and an `activeKey` matching the previous expectations. Then append the following three tests (inside the existing `describe`):

```tsx
  it("eyebrow shows project key + count when configured + projectKey set", () => {
    useIssuesStore.setState({
      issues: [
        { key: "CLPNSNS-92", summary: "x", statusName: "To Do", statusCategory: "todo", issueType: "Story", priority: null, url: "u", parentKey: null },
        { key: "CLPNSNS-105", summary: "y", statusName: "To Do", statusCategory: "todo", issueType: "Story", priority: null, url: "u", parentKey: null },
        { key: "OTHER-1", summary: "z", statusName: "To Do", statusCategory: "todo", issueType: "Story", priority: null, url: "u", parentKey: null },
      ],
      loading: false, error: null, load: vi.fn().mockResolvedValue(undefined),
    });
    render(<BacklogPanel configured projectKey="CLPNSNS" activeKey={null} />);
    expect(screen.getByText(/CLPNSNS · 2/)).toBeInTheDocument();
  });

  it("excludes the active key from the list", () => {
    useIssuesStore.setState({
      issues: [
        { key: "CLPNSNS-92", summary: "active", statusName: "In Progress", statusCategory: "inProgress", issueType: "Story", priority: null, url: "u", parentKey: null },
        { key: "CLPNSNS-105", summary: "queued", statusName: "To Do", statusCategory: "todo", issueType: "Story", priority: null, url: "u", parentKey: null },
      ],
      loading: false, error: null, load: vi.fn().mockResolvedValue(undefined),
    });
    render(<BacklogPanel configured projectKey="CLPNSNS" activeKey="CLPNSNS-92" />);
    expect(screen.queryByText("active")).not.toBeInTheDocument();
    expect(screen.getByText("queued")).toBeInTheDocument();
  });

  it("when projectKey is null, shows 'Vincular proyecto →' empty state", () => {
    useIssuesStore.setState({
      issues: [], loading: false, error: null, load: vi.fn().mockResolvedValue(undefined),
    });
    render(<BacklogPanel configured projectKey={null} activeKey={null} />);
    expect(screen.getByText(/sin proyecto jira/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /vincular proyecto/i })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/BacklogPanel.test.tsx`
Expected: FAIL — at least the new tests fail (existing tests may also fail because props changed).

- [ ] **Step 3: Update the component signature + filtering**

Open `src/components/BacklogPanel.tsx`. Replace the existing implementation with:

```tsx
import { useEffect, useState } from "react";
import { useIssuesStore } from "../stores/issuesStore";
import { ipc } from "../lib/ipc";
import type { Issue, StatusCategory } from "../lib/types";
import { selectBacklog } from "../lib/issueTrackerSelectors";

const STATUS_DOT_COLOR: Record<StatusCategory, string> = {
  todo: "text-octo-mute",
  inProgress: "text-octo-brass",
  done: "text-octo-verdigris",
  unknown: "text-octo-sage",
};

interface Props {
  configured: boolean;
  projectKey: string | null;
  activeKey: string | null;
  /** Called when the empty-state "Vincular proyecto →" CTA is clicked. */
  onLinkProject?: () => void;
}

export function BacklogPanel({ configured, projectKey, activeKey, onLinkProject }: Props) {
  const { issues, loading, error, load } = useIssuesStore();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (configured) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured]);

  const filtered: Issue[] = selectBacklog(issues ?? [], projectKey, activeKey);

  return (
    <div className="border-b border-octo-hairline px-3 py-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex flex-1 items-center justify-between font-mono text-[9px] uppercase tracking-[0.25em] text-octo-mute"
        >
          <span>
            § Backlog
            {projectKey ? (
              <>
                {" · "}<span className="text-octo-brass">{projectKey}</span>
                {" · "}
                {filtered.length}
              </>
            ) : (
              <> · <span className="text-octo-mute">(sin proyecto)</span></>
            )}
          </span>
          <span className="mr-1">{collapsed ? "▸" : "▾"}</span>
        </button>
        {configured && !collapsed && (
          <button
            type="button"
            onClick={() => void load()}
            className="font-mono text-[10px] text-octo-mute transition hover:text-octo-brass"
            title="Refresh backlog"
            aria-label="Refresh backlog"
          >
            ↺
          </button>
        )}
      </div>

      {!collapsed && !configured && (
        <p className="mt-2 text-[12px] text-octo-mute">Conecta Jira en Settings →</p>
      )}

      {!collapsed && configured && projectKey == null && (
        <div className="mt-2 flex items-center gap-2 text-[12px] text-octo-sage">
          <span>Sin proyecto Jira vinculado para este Octopush Project.</span>
          <button
            type="button"
            onClick={onLinkProject}
            className="font-mono text-[10px] uppercase tracking-[0.15em] text-octo-brass"
          >
            Vincular proyecto →
          </button>
        </div>
      )}

      {!collapsed && configured && projectKey != null && (
        <>
          {error && (
            <p className="mt-1 font-mono text-[10px] tracking-[0.1em] text-octo-mute">
              no se pudo refrescar
            </p>
          )}
          {loading && !issues && (
            <p className="mt-2 font-mono text-[10px] text-octo-mute">loading…</p>
          )}
          {filtered.length === 0 && !loading && !error && (
            <p className="mt-2 text-[12px] text-octo-verdigris">
              Backlog limpio en este proyecto ✓
            </p>
          )}
          <div className="mt-1">
            {filtered.map((it) => (
              <button
                key={it.key}
                type="button"
                role="button"
                onClick={() => ipc.openFileInSystem(it.url).catch(() => {})}
                className="flex w-full items-center gap-2 rounded px-1 py-[5px] text-left transition-colors duration-[220ms] ease-[cubic-bezier(0.2,0.8,0.3,1)]"
                style={{ borderLeft: "1px solid transparent" }}
              >
                <span
                  aria-label={it.statusCategory}
                  className={`h-[6px] w-[6px] rounded-full ${STATUS_DOT_COLOR[it.statusCategory]}`}
                  style={{ background: "currentColor" }}
                />
                <span className="flex-shrink-0 font-mono text-[11px] text-octo-ivory">{it.key}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-octo-sage">{it.summary}</span>
                <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-octo-mute">
                  {it.statusName}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/BacklogPanel.test.tsx`
Expected: PASS (existing 9 + new 3 = 12 tests).

If existing tests still fail because their `render(...)` doesn't pass the new props, update them to pass `projectKey` and `activeKey` matching the previous behavior (most can use `projectKey="CLPNSNS"` with sample issues that match).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean. If a caller of `<BacklogPanel ... />` in `Companion.tsx` or `App.tsx` breaks because the props changed, leave that broken — Task 12 wires the new props through.

- [ ] **Step 6: Commit**

```bash
git add src/components/BacklogPanel.tsx src/components/BacklogPanel.test.tsx
git commit -m "feat(jira-v2): BacklogPanel rewired to project-scoped + new empty states"
```

---

## Task 10: `ElsewhereFooter` + `ElsewhereModal`

**Files:**
- Create: `src/components/ElsewhereFooter.tsx`
- Create: `src/components/ElsewhereFooter.test.tsx`
- Create: `src/components/ElsewhereModal.tsx`
- Create: `src/components/ElsewhereModal.test.tsx`

- [ ] **Step 1: Write the failing tests for ElsewhereFooter**

Create `src/components/ElsewhereFooter.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ElsewhereFooter } from "./ElsewhereFooter";

describe("ElsewhereFooter", () => {
  it("renders nothing when count is 0", () => {
    const { container } = render(<ElsewhereFooter count={0} onOpen={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders count and calls onOpen on click", () => {
    const onOpen = vi.fn();
    render(<ElsewhereFooter count={3} onOpen={onOpen} />);
    expect(screen.getByText(/3 tickets in-progress en otros proyectos/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/ElsewhereFooter.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `ElsewhereFooter`**

Create `src/components/ElsewhereFooter.tsx`:

```tsx
interface Props {
  count: number;
  onOpen: () => void;
}

export function ElsewhereFooter({ count, onOpen }: Props) {
  if (count <= 0) return null;
  return (
    <div className="border-b border-octo-hairline px-3 py-2">
      <button
        type="button"
        onClick={onOpen}
        className="font-mono text-[10px] tracking-[0.1em] text-octo-mute hover:text-octo-brass"
      >
        ↳ {count} tickets in-progress en otros proyectos
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/ElsewhereFooter.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing tests for ElsewhereModal**

Create `src/components/ElsewhereModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ElsewhereModal } from "./ElsewhereModal";
import type { Issue } from "../lib/types";

const openFileInSystemMock = vi.fn();
vi.mock("../lib/ipc", () => ({
  ipc: { openFileInSystem: openFileInSystemMock },
}));

const issues: Issue[] = [
  { key: "A-1", summary: "a one", statusName: "In Progress", statusCategory: "inProgress", issueType: "Story", priority: null, url: "https://x/A-1", parentKey: null },
  { key: "A-2", summary: "a two", statusName: "To Do",       statusCategory: "todo",       issueType: "Bug",   priority: null, url: "https://x/A-2", parentKey: null },
  { key: "B-1", summary: "b one", statusName: "In Progress", statusCategory: "inProgress", issueType: "Story", priority: null, url: "https://x/B-1", parentKey: null },
];

describe("ElsewhereModal", () => {
  it("groups by project prefix and excludes the active project", () => {
    render(
      <ElsewhereModal issues={issues} activeProjectKey="HERE" onClose={vi.fn()} />,
    );
    // Both A-* and B-* are 'elsewhere' (active project is HERE).
    expect(screen.getByText(/^A$/)).toBeInTheDocument();
    expect(screen.getByText(/^B$/)).toBeInTheDocument();
    expect(screen.getByText("A-1")).toBeInTheDocument();
    expect(screen.getByText("B-1")).toBeInTheDocument();
  });

  it("clicking a row opens the issue url", () => {
    render(
      <ElsewhereModal issues={issues} activeProjectKey="HERE" onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("A-1").closest("button")!);
    expect(openFileInSystemMock).toHaveBeenCalledWith("https://x/A-1");
  });

  it("close button calls onClose", () => {
    const onClose = vi.fn();
    render(<ElsewhereModal issues={issues} activeProjectKey="HERE" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx vitest run src/components/ElsewhereModal.test.tsx`
Expected: FAIL.

- [ ] **Step 7: Implement `ElsewhereModal`**

Create `src/components/ElsewhereModal.tsx`:

```tsx
import { useMemo } from "react";
import { ipc } from "../lib/ipc";
import type { Issue, StatusCategory } from "../lib/types";

const STATUS_DOT: Record<StatusCategory, string> = {
  todo: "text-octo-mute",
  inProgress: "text-octo-brass",
  done: "text-octo-verdigris",
  unknown: "text-octo-sage",
};

interface Props {
  issues: Issue[];
  activeProjectKey: string | null;
  onClose: () => void;
}

export function ElsewhereModal({ issues, activeProjectKey, onClose }: Props) {
  const grouped = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const it of issues) {
      const prefix = it.key.split("-")[0];
      if (activeProjectKey && prefix === activeProjectKey) continue;
      const list = map.get(prefix) ?? [];
      list.push(it);
      map.set(prefix, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [issues, activeProjectKey]);

  return (
    <div
      role="dialog"
      aria-label="Tickets en otros proyectos"
      className="fixed inset-0 z-50 flex items-center justify-center bg-octo-onyx/80 p-6"
    >
      <div className="flex max-h-[80vh] w-[640px] flex-col rounded-md border border-octo-hairline bg-octo-panel">
        <div className="flex items-center justify-between border-b border-octo-hairline px-4 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-octo-mute">
            Tickets en otros proyectos
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="font-mono text-[10px] uppercase tracking-[0.15em] text-octo-mute hover:text-octo-brass"
          >
            ESC
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-3">
          {grouped.length === 0 && (
            <p className="text-[12px] text-octo-mute">Nada in-progress fuera de este proyecto.</p>
          )}
          {grouped.map(([prefix, items]) => (
            <div key={prefix} className="mb-4">
              <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.25em] text-octo-brass">
                {prefix}
              </div>
              {items.map((it) => (
                <button
                  key={it.key}
                  type="button"
                  onClick={() => ipc.openFileInSystem(it.url).catch(() => {})}
                  className="flex w-full items-center gap-2 rounded px-1 py-[5px] text-left hover:bg-octo-panel-2"
                >
                  <span
                    aria-label={it.statusCategory}
                    className={`h-[6px] w-[6px] rounded-full ${STATUS_DOT[it.statusCategory]}`}
                    style={{ background: "currentColor" }}
                  />
                  <span className="font-mono text-[11px] text-octo-brass">{it.key}</span>
                  <span className="flex-1 truncate text-[12px] text-octo-sage">{it.summary}</span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-octo-mute">
                    {it.statusName}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/components/ElsewhereModal.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add src/components/ElsewhereFooter.tsx src/components/ElsewhereFooter.test.tsx src/components/ElsewhereModal.tsx src/components/ElsewhereModal.test.tsx
git commit -m "feat(jira-v2): ElsewhereFooter + ElsewhereModal (cross-project overflow)"
```

---

## Task 11: `ContextHeader` — consume `resolveLinkage` for the chip

**Files:**
- Modify: `src/components/ContextHeader.tsx`
- Modify: `src/components/ContextHeader.test.tsx`

- [ ] **Step 1: Update tests to cover the new behavior**

Open `src/components/ContextHeader.test.tsx`. The new contract: the chip is shown when `resolveLinkage(workspace, branch)` resolves to `linked` AND `issueTrackerConfigured` is true; hidden otherwise. The chip's key text comes from the linkage (manual link wins over detected).

First, the v1 chip tests passed `activeIssueKey` directly. The new component derives that from a `workspace` prop. Before adding new tests, update the existing 4 chip tests to construct a `Workspace` object instead of passing `activeIssueKey`:

For each existing chip test, replace `activeIssueKey="PROJ-123"` (or similar) with:
```tsx
workspace={{
  id: "w1", projectId: "p1", name: "ws", task: "", branch: "feat/PROJ-123-foo",
  worktreePath: null, setupScript: "", status: "active",
  createdAt: "", lastActive: "", glyph: null, tint: null, testCommand: null,
  linkedIssueKey: null, issueLinkDismissed: false,
}}
```

(For the "no key" negative test, set `branch: "main"`. For the "not configured" test, set `issueTrackerConfigured={false}` and leave the workspace as-is.)

Then append three new tests inside the existing `describe`:

```tsx
  it("uses linkedIssueKey override when both manual link and branch key are present", async () => {
    const workspace = {
      id: "w1", projectId: "p1", name: "ws", task: "",
      branch: "feat/IGNORED-9-foo",
      worktreePath: null, setupScript: "", status: "active",
      createdAt: "", lastActive: "", glyph: null, tint: null, testCommand: null,
      linkedIssueKey: "FORCED-1", issueLinkDismissed: false,
    };
    // The store-stub from the existing chip tests has the issue with key "FORCED-1"
    // (mirror the existing pre-seed pattern of `useIssuesStore.setState({issues: [...]})`).
    useIssuesStore.setState({
      issues: [
        { key: "FORCED-1", summary: "force", statusName: "In Progress", statusCategory: "inProgress", issueType: "Story", priority: null, url: "https://x/FORCED-1", parentKey: null },
      ],
      loading: false, error: null, load: vi.fn().mockResolvedValue(undefined),
    });
    renderHeader({ workspace, issueTrackerConfigured: true });
    expect(await screen.findByText("FORCED-1")).toBeInTheDocument();
  });

  it("hides the chip when the linkage is dismissed", () => {
    const workspace = {
      id: "w1", projectId: "p1", name: "ws", task: "", branch: "main",
      worktreePath: null, setupScript: "", status: "active",
      createdAt: "", lastActive: "", glyph: null, tint: null, testCommand: null,
      linkedIssueKey: null, issueLinkDismissed: true,
    };
    renderHeader({ workspace, issueTrackerConfigured: true });
    expect(screen.queryByText(/◈/)).not.toBeInTheDocument();
  });

  it("hides the chip when the linkage is unlinked (no manual, no branch key, not dismissed)", () => {
    const workspace = {
      id: "w1", projectId: "p1", name: "ws", task: "", branch: "main",
      worktreePath: null, setupScript: "", status: "active",
      createdAt: "", lastActive: "", glyph: null, tint: null, testCommand: null,
      linkedIssueKey: null, issueLinkDismissed: false,
    };
    renderHeader({ workspace, issueTrackerConfigured: true });
    expect(screen.queryByText(/◈/)).not.toBeInTheDocument();
  });
```

`renderHeader(...)` is the helper the existing tests use (or a fresh `render(<ContextHeader ... />)` with all required props — mirror the existing chip tests verbatim and only swap `activeIssueKey` → `workspace`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/ContextHeader.test.tsx`
Expected: at least the 3 new tests FAIL.

- [ ] **Step 3: Update `ContextHeader.tsx` to consume `resolveLinkage`**

In `src/components/ContextHeader.tsx`, replace whichever line currently computes `activeIssueKey` from `detectIssueKey(branch)` with a call to `resolveLinkage(workspace, branch)`. The chip is shown when the linkage resolves to `linked`. Concrete:

- Add prop `workspace: Workspace | null`.
- Replace `detectIssueKey(branch)` usage with:
  ```ts
  const linkage = workspace ? resolveLinkage(workspace, branch) : { kind: "unlinked" as const };
  const activeIssueKey =
    linkage.kind === "linked" && issueTrackerConfigured ? linkage.key : null;
  ```
- Hide the chip when `activeIssueKey === null`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/ContextHeader.test.tsx`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Update `App.tsx` to pass `workspace` to ContextHeader**

Open `src/App.tsx`. Find the `<ContextHeader ...>` render. Add `workspace={activeWorkspace ?? null}` to its props. If `activeWorkspace` isn't named exactly that, mirror whatever the existing `activeIssueKey={... activeWorkspace?.branch ...}` block uses.

If TypeScript complains in App.tsx because `activeIssueKey` and `workspace` are now both passed and the prop signature has both, that's fine — keep `activeIssueKey` if it's still used by another caller, otherwise drop it from the ContextHeader call site since the new resolver computes it internally.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/ContextHeader.tsx src/components/ContextHeader.test.tsx src/App.tsx
git commit -m "feat(jira-v2): ContextHeader chip consumes resolveLinkage (manual link, dismiss, detected)"
```

---

## Task 12: `Companion` restructure — lift issue tracker block above mode-specific content

**Files:**
- Modify: `src/components/Companion.tsx`
- Modify: `src/App.tsx` (wire the new props through)
- Modify: `src/components/Companion.test.tsx` (or create if absent)

- [ ] **Step 1: Write the failing test (cross-mode visibility)**

Create or extend `src/components/Companion.test.tsx`. If the file doesn't exist, create it; mirror the test setup style from `BacklogPanel.test.tsx` for `vi.mock("../stores/issuesStore", ...)`.

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Companion } from "./Companion";

// Minimal stubs for child components so the test focuses on structure.
vi.mock("./CompanionContext",   () => ({ CompanionContext:   () => <div data-testid="ctx" />   }));
vi.mock("./CompanionHistory",   () => ({ CompanionHistory:   () => <div data-testid="hist" />  }));
vi.mock("./CompanionTerminals", () => ({ CompanionTerminals: () => <div data-testid="term" />  }));
vi.mock("./CompanionFileTree",  () => ({ CompanionFileTree:  () => <div data-testid="tree" />  }));
vi.mock("./ActiveTicketPanel",  () => ({ ActiveTicketPanel:  () => <div data-testid="active" /> }));
vi.mock("./BacklogPanel",       () => ({ BacklogPanel:       () => <div data-testid="backlog" /> }));
vi.mock("./ElsewhereFooter",    () => ({ ElsewhereFooter:    () => <div data-testid="else" />  }));

const baseProps = {
  workspaceId: "w1",
  contextProps: { tokensUsed: 0, tokensLimit: 0, unstaged: 0, toolCalls: 0 },
  historyProps: { chats: [], activeChatId: null, onSelectChat: vi.fn(), onNewChat: vi.fn() },
  issueTrackerConfigured: true,
  workspace: {
    id: "w1", projectId: "p1", name: "x", task: "", branch: "feat/CLPNSNS-1",
    worktreePath: null, setupScript: "", status: "active",
    createdAt: "", lastActive: "", glyph: null, tint: null, testCommand: null,
    linkedIssueKey: null, issueLinkDismissed: false,
  },
  project: { id: "p1", name: "Test", path: "/tmp/repo", jiraProjectKey: null },
};

describe("Companion cross-mode visibility of issue tracker block", () => {
  it("renders ActiveTicketPanel + BacklogPanel in TALK", () => {
    render(<Companion mode="talk" {...baseProps} />);
    expect(screen.getByTestId("active")).toBeInTheDocument();
    expect(screen.getByTestId("backlog")).toBeInTheDocument();
  });

  it("renders them in RUN", () => {
    render(<Companion mode="run" {...baseProps} />);
    expect(screen.getByTestId("active")).toBeInTheDocument();
    expect(screen.getByTestId("backlog")).toBeInTheDocument();
  });

  it("renders them in REVIEW", () => {
    render(<Companion mode="review" {...baseProps} fileTree={{ rootPath: "/", rootLabel: "/", changedPaths: new Set() }} />);
    expect(screen.getByTestId("active")).toBeInTheDocument();
    expect(screen.getByTestId("backlog")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Companion.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Replace `Companion.tsx`**

Open `src/components/Companion.tsx` and replace its entire contents with:

```tsx
import { useState } from "react";
import type { WorkspaceMode } from "../lib/modes";
import type { Budget, SpendSnapshot, Issue, ProjectInfo, Workspace } from "../lib/types";
import { CompanionContext } from "./CompanionContext";
import { CompanionHistory, type CompanionHistoryChat } from "./CompanionHistory";
import { CompanionTerminals } from "./CompanionTerminals";
import { CompanionFileTree } from "./CompanionFileTree";
import { ActiveTicketPanel } from "./ActiveTicketPanel";
import { BacklogPanel } from "./BacklogPanel";
import { ElsewhereFooter } from "./ElsewhereFooter";
import { ElsewhereModal } from "./ElsewhereModal";
import { useIssuesStore } from "../stores/issuesStore";
import {
  resolveLinkage,
  resolveJiraProjectKey,
  selectElsewhereCount,
} from "../lib/issueTrackerSelectors";

interface ContextProps {
  tokensUsed: number;
  tokensLimit: number;
  unstaged: number;
  toolCalls: number;
  budgets?: Budget[];
  spend?: Record<string, SpendSnapshot>;
}

interface HistoryProps {
  chats: CompanionHistoryChat[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
}

interface FileTreeProps {
  rootPath: string;
  rootLabel: string;
  changedPaths: Set<string>;
  onFileClick?: (absPath: string) => void;
}

interface Props {
  mode: WorkspaceMode;
  workspaceId: string | null;
  contextProps: ContextProps;
  historyProps: HistoryProps;
  fileTree?: FileTreeProps;
  workspace: Workspace | null;
  project: ProjectInfo | null;
  issueTrackerConfigured: boolean;
  onLinkProject?: () => void;
}

export function Companion({
  mode,
  workspaceId,
  contextProps,
  historyProps,
  fileTree,
  workspace,
  project,
  issueTrackerConfigured,
  onLinkProject,
}: Props) {
  const { issues } = useIssuesStore();
  const [elsewhereOpen, setElsewhereOpen] = useState(false);

  const branch = workspace?.branch ?? "";
  const linkage = workspace ? resolveLinkage(workspace, branch) : { kind: "unlinked" as const };
  const projectKey =
    workspace && project ? resolveJiraProjectKey(project, workspace, branch) : null;
  const activeKey = linkage.kind === "linked" ? linkage.key : null;
  const activeIssue =
    activeKey ? (issues ?? []).find((i) => i.key === activeKey) ?? null : null;
  const elsewhereCount = selectElsewhereCount(issues ?? [], projectKey);

  return (
    <aside
      className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-xl border border-octo-hairline bg-octo-panel"
      aria-label="Companion"
    >
      {issueTrackerConfigured && workspace && (
        <>
          <ActiveTicketPanel
            state={linkage}
            activeIssue={activeIssue}
            candidates={issues ?? []}
            projectKey={projectKey}
            workspaceId={workspace.id}
          />
          <BacklogPanel
            configured={issueTrackerConfigured}
            projectKey={projectKey}
            activeKey={activeKey}
            onLinkProject={onLinkProject}
          />
          <ElsewhereFooter count={elsewhereCount} onOpen={() => setElsewhereOpen(true)} />
        </>
      )}

      {/* Mode-specific content (unchanged behavior) */}
      {mode === "talk" && (
        <div className="flex flex-col gap-4 p-4">
          <CompanionContext {...contextProps} workspaceId={workspaceId ?? undefined} />
          <CompanionHistory {...historyProps} />
        </div>
      )}
      {mode === "run" && workspaceId && (
        <div className="p-4">
          <CompanionTerminals workspaceId={workspaceId} />
        </div>
      )}
      {mode === "review" && fileTree && <CompanionFileTree {...fileTree} />}

      {elsewhereOpen && (
        <ElsewhereModal
          issues={issues ?? []}
          activeProjectKey={projectKey}
          onClose={() => setElsewhereOpen(false)}
        />
      )}
    </aside>
  );
}
```

- [ ] **Step 4: Wire props through `App.tsx`**

In `src/App.tsx`, find the `<Companion ... />` render call. Replace its props block with:

```tsx
<Companion
  mode={mode}
  workspaceId={activeWorkspaceId}
  contextProps={/* existing object */}
  historyProps={/* existing object */}
  fileTree={/* existing or undefined */}
  workspace={activeWorkspace ?? null}
  project={activeProject ?? null}
  issueTrackerConfigured={issueTrackerConfigured}
  onLinkProject={() => setSettingsOpen(true)}
/>
```

If `activeProject` doesn't exist as a derived value yet, add it next to the existing `activeWorkspace` derivation:

```ts
const activeProject = projects.find((p) => p.id === activeWorkspace?.projectId) ?? null;
```

`setSettingsOpen(true)` should match however the project Settings panel opens today (the v1 commit `eda5502` wired Settings open/close — grep `App.tsx` for `Settings` / `settingsOpen` and reuse that setter). If you cannot find a single setter, pass `() => {}` for `onLinkProject` — clicking the empty-state CTA will simply do nothing for v2 (acceptable because the path through Settings → Integrations is documented in the spec; deep-link to the row is a v3 improvement).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/Companion.test.tsx`
Expected: PASS (3 tests).

Also run the full suite to catch regressions:
Run: `npx vitest run`
Expected: all suites pass.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/Companion.tsx src/components/Companion.test.tsx src/App.tsx
git commit -m "feat(jira-v2): lift issue tracker block above mode-specific content (cross-mode visibility)"
```

---

## Task 13: Settings → Integrations → Project Mappings sub-section

**Files:**
- Modify: `src/components/Settings.tsx` (extend `IntegrationsPane`)
- Modify: `src/components/Settings.issuetracker.test.tsx` (extend with mapping tests)

- [ ] **Step 1: Write the failing test**

Append to `src/components/Settings.issuetracker.test.tsx` (inside the existing `describe`, AFTER the existing tests):

```tsx
  it("renders a Project Mappings row per Octopush Project with the saved jiraProjectKey", async () => {
    // Mock listProjects to return two rows: one with a saved key, one without.
    const listProjectsMock = vi.fn().mockResolvedValue([
      { id: "p1", name: "Octopush", path: "/p1", jiraProjectKey: "CLPNSNS" },
      { id: "p2", name: "Sandbox",  path: "/p2", jiraProjectKey: null },
    ]);
    // Update the ipc mock to include listProjects + updateProjectJiraKey.
    // (Adjust the `vi.mock("../lib/ipc", ...)` block at the top of this file
    // to include both. If the mock block doesn't already include listProjects,
    // add it; this is a one-line addition in the shared mock object.)

    // Render the pane (use the existing renderIntegrationsPane helper).
    await renderIntegrationsPane();

    // Both project names appear under "Project Mappings".
    expect(await screen.findByText(/project mappings/i)).toBeInTheDocument();
    expect(screen.getByText("Octopush")).toBeInTheDocument();
    expect(screen.getByText("Sandbox")).toBeInTheDocument();

    // The CLPNSNS row's input is pre-filled.
    const inputs = screen.getAllByPlaceholderText(/jira project key/i) as HTMLInputElement[];
    expect(inputs[0].value).toBe("CLPNSNS");
    expect(inputs[1].value).toBe("");
  });

  it("saving a Project Mappings row calls updateProjectJiraKey with the right args", async () => {
    // (Set up same mocks as above plus updateProjectJiraKey: vi.fn().mockResolvedValue(undefined))
    await renderIntegrationsPane();

    const inputs = screen.getAllByPlaceholderText(/jira project key/i) as HTMLInputElement[];
    fireEvent.change(inputs[1], { target: { value: "SANDBOX" } });

    // There are per-row save buttons; click the one paired with the second row.
    const saveButtons = screen.getAllByRole("button", { name: /save mapping/i });
    fireEvent.click(saveButtons[1]);

    await waitFor(() => {
      expect(updateProjectJiraKeyMock).toHaveBeenCalledWith("p2", "SANDBOX");
    });
  });
```

(Above pseudo-code names `updateProjectJiraKeyMock` and `listProjectsMock`; declare them at the top of the test file with `const ... = vi.fn()` and add them to the existing ipc mock object. Mirror exactly how the existing 7 tests in this file declare and use `getIssueTrackerConfigMock`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/Settings.issuetracker.test.tsx`
Expected: at least the 2 new tests FAIL.

- [ ] **Step 3: Extend `IntegrationsPane` in `Settings.tsx`**

In `src/components/Settings.tsx`, inside the existing `IntegrationsPane` function (the one added in v1), add — below the existing "Issue Tracker" credentials block — a new "Project Mappings" sub-section.

Add to the imports at the top of the file (already there for v1) if not already present:
```ts
import type { ProjectInfo } from "../lib/types";
```

Add state hooks inside `IntegrationsPane`:

```tsx
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [mapDrafts, setMapDrafts] = useState<Record<string, string>>({});
  const [mapSaving, setMapSaving] = useState<Record<string, boolean>>({});
  const [mapSaved, setMapSaved] = useState<Record<string, boolean>>({});

  useEffect(() => {
    ipc.listProjects()
      .then((rows) => {
        setProjects(rows);
        const drafts: Record<string, string> = {};
        for (const p of rows) drafts[p.id] = p.jiraProjectKey ?? "";
        setMapDrafts(drafts);
      })
      .catch(() => { /* quiet — pane still renders the credentials section */ });
  }, []);

  async function saveMapping(projectId: string) {
    const value = (mapDrafts[projectId] ?? "").trim();
    setMapSaving((s) => ({ ...s, [projectId]: true }));
    try {
      await ipc.updateProjectJiraKey(projectId, value === "" ? null : value);
      setMapSaved((s) => ({ ...s, [projectId]: true }));
      setTimeout(() => setMapSaved((s) => ({ ...s, [projectId]: false })), 2000);
    } catch (e) {
      pushToast({ level: "error", title: "Save mapping failed", body: String(e) });
    } finally {
      setMapSaving((s) => ({ ...s, [projectId]: false }));
    }
  }
```

Then in the JSX, BELOW the existing credentials section (still inside `IntegrationsPane`), add:

```tsx
      {/* ── Project Mappings sub-section ── */}
      <div className="mt-8 max-w-[640px]">
        <SectionLabel>Project Mappings</SectionLabel>
        <p className="mb-4 text-[12px] leading-[1.55] text-octo-mute">
          Vincula cada Octopush Project a su clave de proyecto Jira. Vacío = se infiere desde la branch del workspace.
        </p>
        <div className="space-y-3">
          {projects.map((p) => (
            <div key={p.id} className="flex items-center gap-3">
              <div className="w-[180px] truncate text-[13px] text-octo-ivory">{p.name}</div>
              <input
                type="text"
                value={mapDrafts[p.id] ?? ""}
                onChange={(e) => setMapDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                placeholder="Jira project key"
                className="flex-1 rounded-md border border-octo-hairline bg-octo-onyx px-3 py-2 font-mono text-[12px] text-octo-ivory outline-none placeholder:text-octo-mute focus:border-octo-brass"
              />
              <button
                type="button"
                onClick={() => void saveMapping(p.id)}
                disabled={mapSaving[p.id]}
                aria-label="Save mapping"
                className="min-w-[120px] rounded-md px-3 py-2 text-center font-serif text-[12px] text-octo-brass transition-colors disabled:opacity-50"
                style={{ background: "var(--brass-ghost)", border: "1px solid var(--brass-dim)" }}
              >
                {mapSaved[p.id] ? "✓ Saved" : mapSaving[p.id] ? "Saving…" : "Save mapping"}
              </button>
            </div>
          ))}
          {projects.length === 0 && (
            <p className="text-[12px] text-octo-mute">No hay proyectos abiertos todavía.</p>
          )}
        </div>
      </div>
```

If `pushToast` and `SectionLabel` aren't already imported in `Settings.tsx`, they are (per the v1 code) — confirm by reading the file's imports first; do not duplicate.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/Settings.issuetracker.test.tsx`
Expected: PASS (existing 7 + new 2 = 9 tests).

- [ ] **Step 5: Typecheck + full suite**

Run: `npm run typecheck && npx vitest run`
Expected: clean; all suites pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings.tsx src/components/Settings.issuetracker.test.tsx
git commit -m "feat(jira-v2): Settings → Project Mappings sub-section (per-project Jira key override)"
```

---

## After all tasks

- [ ] **Step 1: Run the full backend + frontend suites**

```bash
cd src-tauri && cargo test --lib && cd ..
npx vitest run
npm run typecheck
```
Expected: every test green; typecheck clean.

- [ ] **Step 2: Manual smoke test on a real Jira tenant**

Build with `npm run tauri:build` and launch the .app. Verify:
- Card del ticket activo aparece en TALK + RUN + REVIEW.
- Backlog filtra al proyecto activo y excluye el activo.
- `Vincular →` abre el picker; `Use exact key` funciona con un ticket no asignado a ti.
- `No usar ticket aquí` oculta la sección; `↳ + Vincular ticket` la trae de vuelta.
- Cambiar `jiraProjectKey` en Settings cambia el filtro del Backlog en vivo (próximo refresh).
- Footer "↳ N en otros proyectos" abre el modal con el grouping correcto.

- [ ] **Step 3: Use `superpowers:finishing-a-development-branch` to ship**

Merge / PR per project convention, bump to `0.1.25`, release via `npm run release -- 0.1.25` (signing key at `~/.octopush-keys/updater_key`).
