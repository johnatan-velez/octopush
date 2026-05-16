# Phase 2 — Atelier Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current `ProjectSidebar` + two-level `WorkspaceBar` navigation with the new Atelier layout grammar: a slim icon **WorkspaceRail** (left), a floating **ContextHeader** (top), a **ModeSwitcher** (Talk/Run/Review pills, top right), a **Canvas** that swaps content per mode, and a permanent **Companion** panel (right) with per-mode sub-panels — all while migrating multi-chat-tab and multi-terminal-tab data into Companion sections.

**Architecture:** Five fixed surfaces composed via flexbox in `App.tsx`. State that previously lived as `tabsPerWorkspace` / `activeView` / `activeTabId` collapses to `modePerWorkspace: Record<string, "talk" | "run" | "review">` plus per-workspace lists of chats and terminals. Workspace data model extends with optional `glyph?` and `tint?` (7 curated presets) for customizable rail monograms. The current `ChatView`, `TerminalPane`, and `ChangesPanel` components are reused as canvas content — only their containers change.

**Tech stack:** React 19 hooks (functional components), Zustand stores, Tailwind v4 classes referencing the Onyx & Brass tokens shipped in Phase 1, Vitest + React Testing Library for component behavior tests, Rust + rusqlite for backend persistence.

---

## Spec reference

Source of truth: [`docs/superpowers/specs/2026-05-16-octopus-ux-redesign-design.md`](../specs/2026-05-16-octopus-ux-redesign-design.md). Phase 2 implements §3 (Architecture), §3.3 (replacement table), §3.4 (new components), §3.5 (monogram + tints), §3.6 (keyboard shortcuts), §4.3 partial (the Workspace chrome — actual canvas polish per mode is Phase 4 onward).

The cheatsheet at [`docs/design-system.md`](../../design-system.md) has copy-paste component recipes (button, input, pill, etc.) — components below use those patterns.

---

## File structure

**Created**

| Path | Responsibility |
|------|----------------|
| `src/lib/monogram.ts` | Pure functions: derive glyph + tint preset values from a `Workspace`. Exports `TINTS`, `TINT_NAMES`, `resolveMonogram`. |
| `src/lib/monogram.test.ts` | Vitest tests for monogram resolution + tint preset table. |
| `src/lib/modes.ts` | `WorkspaceMode` type + constants. Tiny — kept separate for clarity since several components reference it. |
| `src/components/WorkspaceRail.tsx` | Left vertical rail. Renders workspace monograms. Brass vertical indicator on active. Right-click → opens `WorkspaceCustomizeMenu`. |
| `src/components/WorkspaceRail.test.tsx` | Tests: renders one row per workspace, fires `onSelect` on click, fires `onCustomize` on right-click. |
| `src/components/ContextHeader.tsx` | Floating card displaying workspace name (italic serif), branch + git status. Reads from props. |
| `src/components/ContextHeader.test.tsx` | Tests: renders workspace name and branch. |
| `src/components/ModeSwitcher.tsx` | 3-pill toggle. Active pill highlighted with brass-ghost fill + brass-dim border. |
| `src/components/ModeSwitcher.test.tsx` | Tests: renders 3 pills, fires `onChange` with correct mode. |
| `src/components/Companion.tsx` | Right-side container. Renders the appropriate sub-panel for the active mode. |
| `src/components/CompanionContext.tsx` | Talk-mode sub-panel: tokens used, files in flight, tool calls. |
| `src/components/CompanionHistory.tsx` | Talk-mode sub-panel: list of chats in this workspace, click to switch active chat, "new chat" affordance. |
| `src/components/CompanionTerminals.tsx` | Run-mode sub-panel: list of terminals in this workspace, click to switch, "new terminal" affordance. |
| `src/components/CompanionChanged.tsx` | Review-mode sub-panel: list of changed files (delegates to existing git status data). |
| `src/components/Companion.test.tsx` | Tests: renders correct sub-panel for each mode prop. |
| `src/components/WorkspaceCustomizeMenu.tsx` | Popover with glyph input + 7 tint preset swatches. Submit calls `onUpdate(glyph, tint)`. |
| `src/components/WorkspaceCustomizeMenu.test.tsx` | Tests: renders 7 swatches; clicking one selects it; typing in glyph input updates state; submit fires callback with chosen values. |

**Modified**

| Path | Why |
|------|-----|
| `src/lib/types.ts` | Add optional `glyph?: string` and `tint?: TintName` to `Workspace`. |
| `src/lib/ipc.ts` | Add `updateWorkspaceCustomization` wrapper. |
| `src/stores/workspaceStore.ts` | Add `updateCustomization(workspaceId, glyph, tint)` action. |
| `src-tauri/src/db.rs` | Add `glyph` and `tint` columns to `workspaces` table via idempotent `ALTER TABLE`. Extend `WorkspaceRow` struct. Add `update_workspace_customization` method. |
| `src-tauri/src/commands.rs` | Add `update_workspace_customization` Tauri command + register in `lib.rs`. |
| `src-tauri/src/lib.rs` | Register the new command in `invoke_handler!`. |
| `src/App.tsx` | Surgery: replace `view`/`viewPerWorkspace`/`tabsPerWorkspace`/`activeTabId` state with `modePerWorkspace` + chats/terminals lists. Render new layout (Rail / ContextHeader / ModeSwitcher / Canvas / Companion / Input). Keep existing `ChatView`, `TerminalPane`, `ChangesPanel` as canvas content. Map ⌘⇧1/2/3 to mode switching per spec §3.6. |

**Deleted (Task 11)**

| Path | Why |
|------|-----|
| `src/components/ProjectSidebar.tsx` | Replaced by `WorkspaceRail.tsx`. |
| `src/components/WorkspaceBar.tsx` | Replaced by `ContextHeader.tsx` + `ModeSwitcher.tsx`. |
| `src/components/WorkspaceHub.tsx` | No longer used (was a hub view; the new design has no hub equivalent). Verify it's unused before deletion. |

**Not touched in Phase 2**

- `src/components/ChatView.tsx`, `src/components/ChatMessage.tsx`, `src/components/ToolCallCard.tsx` — restyled in Phase 4 (Chat soul).
- `src/components/TerminalPane.tsx` — internals untouched; only the container that hosts it changes.
- `src/components/ChangesPanel.tsx` — internals untouched.
- `src/components/CommandPalette.tsx`, `SettingsDialog.tsx`, `TokenDashboard.tsx` — redesigned in Phase 6.
- `src/components/WelcomeScreen.tsx`, `NewProjectFlow.tsx`, `WorkspaceCreator.tsx` — Phase 5.
- Motion polish — Phase 7.

---

## Data model: tint presets

The 7 curated tint presets (per spec §3.5). Each preset shifts only the workspace monogram's icon — never the app's overall brass identity.

| Name        | Accent (text + border) | Background (8% alpha)               |
|-------------|------------------------|-------------------------------------|
| `brass`     | `#d4a574`              | `rgba(212, 165, 116, 0.08)`         |
| `verdigris` | `#8fc9a8`              | `rgba(143, 201, 168, 0.08)`         |
| `rouge`     | `#d18b8b`              | `rgba(209, 139, 139, 0.08)`         |
| `indigo`    | `#8a93c9`              | `rgba(138, 147, 201, 0.08)`         |
| `lavender`  | `#b59ac9`              | `rgba(181, 154, 201, 0.08)`         |
| `smoke`     | `#a8a8a8`              | `rgba(168, 168, 168, 0.06)`         |
| `bone`      | `#d8c9a8`              | `rgba(216, 201, 168, 0.07)`         |

---

## Tasks

### Task 1: Workspace data model — glyph + tint

**Files:**
- Modify: `src-tauri/src/db.rs` (schema migration, `WorkspaceRow`, query, new method)
- Modify: `src-tauri/src/commands.rs` (new command)
- Modify: `src-tauri/src/lib.rs` (register command in invoke handler)
- Modify: `src/lib/types.ts` (add fields to `Workspace`)
- Modify: `src/lib/ipc.ts` (wrapper)

- [ ] **Step 1: Add idempotent column migrations to `db.rs`**

Open `src-tauri/src/db.rs`. Find the `init` (or equivalent) function where `CREATE TABLE IF NOT EXISTS workspaces` is declared. **After** that `execute_batch` call, add idempotent `ALTER TABLE` statements that are safe to run repeatedly:

```rust
// Phase 2 — workspace customization columns (glyph + tint).
// SQLite doesn't support `ADD COLUMN IF NOT EXISTS`, so we swallow the
// duplicate-column error if the migration has already run.
let _ = self.conn.execute(
    "ALTER TABLE workspaces ADD COLUMN glyph TEXT",
    [],
);
let _ = self.conn.execute(
    "ALTER TABLE workspaces ADD COLUMN tint TEXT",
    [],
);
```

Place these immediately after the existing `execute_batch(r#"..."#)?;` that contains the `CREATE TABLE` statements (probably around line 110 — search for `CREATE INDEX IF NOT EXISTS idx_workspaces_project`).

- [ ] **Step 2: Extend `WorkspaceRow` struct**

In the same file, find `pub struct WorkspaceRow` (around line 564) and add two fields at the end:

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
}
```

- [ ] **Step 3: Update `list_workspaces` query**

Still in `db.rs`, find `pub fn list_workspaces` (around line 492). Update the SELECT and row mapping:

```rust
pub fn list_workspaces(&self, project_id: &str) -> AppResult<Vec<WorkspaceRow>> {
    let mut stmt = self.conn.prepare(
        "SELECT id, project_id, name, task, branch, worktree_path, setup_script, status, created_at, last_active, glyph, tint
         FROM workspaces WHERE project_id = ?1 ORDER BY last_active DESC",
    )?;
    let rows = stmt.query_map(params![project_id], |r| {
        Ok(WorkspaceRow {
            id: r.get(0)?,
            project_id: r.get(1)?,
            name: r.get(2)?,
            task: r.get(3)?,
            branch: r.get(4)?,
            worktree_path: r.get(5)?,
            setup_script: r.get(6)?,
            status: r.get(7)?,
            created_at: r.get(8)?,
            last_active: r.get(9)?,
            glyph: r.get(10)?,
            tint: r.get(11)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}
```

- [ ] **Step 4: Add `update_workspace_customization` method to `db.rs`**

Below `delete_workspace` (around line 514), add:

```rust
pub fn update_workspace_customization(
    &self,
    workspace_id: &str,
    glyph: Option<&str>,
    tint: Option<&str>,
) -> AppResult<()> {
    self.conn.execute(
        "UPDATE workspaces SET glyph = ?1, tint = ?2 WHERE id = ?3",
        params![glyph, tint, workspace_id],
    )?;
    Ok(())
}
```

- [ ] **Step 5: Add the Tauri command in `commands.rs`**

Open `src-tauri/src/commands.rs`. Find the workspace commands section (search for `// ─── Workspace commands`, around line 418). After `delete_workspace`, add:

```rust
#[tauri::command]
pub async fn update_workspace_customization(
    state: State<'_, AppState>,
    workspace_id: String,
    glyph: Option<String>,
    tint: Option<String>,
) -> AppResult<()> {
    state.db.lock().update_workspace_customization(
        &workspace_id,
        glyph.as_deref(),
        tint.as_deref(),
    )
}
```

- [ ] **Step 6: Register the command in `lib.rs`**

Open `src-tauri/src/lib.rs`. Find the `invoke_handler!` macro call. Add `commands::update_workspace_customization` to the list (matching the format of neighboring commands like `commands::delete_workspace`).

If you can't locate the invoke handler structure quickly, search for `delete_workspace` in `lib.rs` — the new command should be registered next to it.

- [ ] **Step 7: Write a Rust unit test for the new method**

In `src-tauri/src/db.rs`, find the `#[cfg(test)] mod tests` block (or the file `src-tauri/src/tests.rs` if tests live there — check both). Add a test:

```rust
#[test]
fn update_workspace_customization_persists_glyph_and_tint() {
    let db = Db::open_in_memory().unwrap();
    // Set up a project + workspace first
    db.insert_project("proj-1", "Test", "/tmp/test").unwrap();
    db.insert_workspace("ws-1", "proj-1", "Auth refactor", "fix auth", "feat/auth", Some("/tmp/wt"), "").unwrap();

    db.update_workspace_customization("ws-1", Some("§"), Some("verdigris")).unwrap();

    let workspaces = db.list_workspaces("proj-1").unwrap();
    assert_eq!(workspaces.len(), 1);
    assert_eq!(workspaces[0].glyph.as_deref(), Some("§"));
    assert_eq!(workspaces[0].tint.as_deref(), Some("verdigris"));
}

#[test]
fn update_workspace_customization_clears_with_none() {
    let db = Db::open_in_memory().unwrap();
    db.insert_project("proj-1", "Test", "/tmp/test").unwrap();
    db.insert_workspace("ws-1", "proj-1", "X", "", "main", None, "").unwrap();

    // First set, then clear
    db.update_workspace_customization("ws-1", Some("X"), Some("brass")).unwrap();
    db.update_workspace_customization("ws-1", None, None).unwrap();

    let workspaces = db.list_workspaces("proj-1").unwrap();
    assert_eq!(workspaces[0].glyph, None);
    assert_eq!(workspaces[0].tint, None);
}
```

If the project's test infrastructure exposes `Db::open_in_memory()`, use it. Otherwise, look at the existing tests in `src-tauri/src/tests.rs` for the pattern used to set up test DBs (the implementer may need to inspect existing tests and adapt — if `open_in_memory` doesn't exist but tests use a different bootstrap, use that).

If you find that the existing tests use a different signature for `insert_project` or `insert_workspace`, **adapt to the existing signature** rather than inventing one. Read the actual `Db` impl to confirm.

- [ ] **Step 8: Run the Rust tests**

```bash
cd /Users/jonathan/TYPEFY/octopus/octopus-sh/src-tauri
cargo test
```

Expected: all existing tests still pass + the 2 new tests pass.

- [ ] **Step 9: Extend the TS `Workspace` type**

Open `src/lib/types.ts`. Find the `Workspace` interface (around line 124). Update it to:

```typescript
export type TintName = "brass" | "verdigris" | "rouge" | "indigo" | "lavender" | "smoke" | "bone";

export interface Workspace {
  id: string;
  projectId: string;
  name: string;
  task: string;
  branch: string;
  worktreePath: string | null;
  setupScript: string;
  status: string;
  createdAt: string;
  lastActive: string;
  glyph: string | null;
  tint: TintName | null;
}
```

Note: `glyph` and `tint` are non-optional in the interface (always present) but their value is `null` when not customized — this matches the Rust `Option<String>` serialization to `null`.

- [ ] **Step 10: Add the IPC wrapper**

Open `src/lib/ipc.ts`. Find the Workspaces section (around line 104). Add after `deleteWorkspace`:

```typescript
  updateWorkspaceCustomization: (
    workspaceId: string,
    glyph: string | null,
    tint: string | null,
  ) =>
    invoke<void>("update_workspace_customization", { workspaceId, glyph, tint }),
```

- [ ] **Step 11: Run typecheck**

```bash
cd /Users/jonathan/TYPEFY/octopus/octopus-sh
npm run typecheck
```

Expected: no errors. (Existing components don't reference `glyph`/`tint`, so adding optional fields doesn't break anything.)

- [ ] **Step 12: Commit**

```bash
git add src-tauri/src/db.rs src-tauri/src/commands.rs src-tauri/src/lib.rs \
        src/lib/types.ts src/lib/ipc.ts
git commit -m "feat: workspace glyph + tint customization (Phase 2 data model)"
```

---

### Task 2: Monogram utility (TDD)

**Files:**
- Create: `src/lib/monogram.ts`
- Create: `src/lib/monogram.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/monogram.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { resolveMonogram, TINTS, TINT_NAMES } from "./monogram";
import type { Workspace } from "./types";

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws-1",
    projectId: "proj-1",
    name: "Auth refactor",
    task: "Fix the JWT validation",
    branch: "feat/auth",
    worktreePath: null,
    setupScript: "",
    status: "active",
    createdAt: "2026-05-16T00:00:00Z",
    lastActive: "2026-05-16T00:00:00Z",
    glyph: null,
    tint: null,
    ...overrides,
  };
}

describe("monogram resolution", () => {
  it("uses the first letter of the workspace name when no glyph is set", () => {
    const m = resolveMonogram(makeWorkspace({ name: "Auth refactor" }));
    expect(m.glyph).toBe("A");
    expect(m.isCustom).toBe(false);
  });

  it("uppercases the first letter", () => {
    const m = resolveMonogram(makeWorkspace({ name: "auth-refactor" }));
    expect(m.glyph).toBe("A");
  });

  it("uses the custom glyph when set", () => {
    const m = resolveMonogram(makeWorkspace({ glyph: "§" }));
    expect(m.glyph).toBe("§");
    expect(m.isCustom).toBe(true);
  });

  it("defaults tint to brass when not set", () => {
    const m = resolveMonogram(makeWorkspace({ tint: null }));
    expect(m.tint).toBe("brass");
  });

  it("uses the custom tint when set", () => {
    const m = resolveMonogram(makeWorkspace({ tint: "verdigris" }));
    expect(m.tint).toBe("verdigris");
    expect(m.isCustom).toBe(true);
  });

  it("falls back to '?' when the workspace name is empty", () => {
    const m = resolveMonogram(makeWorkspace({ name: "" }));
    expect(m.glyph).toBe("?");
  });

  it("considers either glyph OR tint customization as 'is custom'", () => {
    expect(resolveMonogram(makeWorkspace({ glyph: "X", tint: null })).isCustom).toBe(true);
    expect(resolveMonogram(makeWorkspace({ glyph: null, tint: "rouge" })).isCustom).toBe(true);
    expect(resolveMonogram(makeWorkspace({ glyph: null, tint: null })).isCustom).toBe(false);
  });
});

describe("tint preset table", () => {
  it("exposes 7 tint presets", () => {
    expect(TINT_NAMES).toEqual([
      "brass", "verdigris", "rouge", "indigo", "lavender", "smoke", "bone",
    ]);
  });

  it("each preset has accent and bg colors", () => {
    for (const name of TINT_NAMES) {
      expect(TINTS[name].accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(TINTS[name].bg).toMatch(/^rgba\(/);
    }
  });

  it("brass preset uses the Atelier accent color", () => {
    expect(TINTS.brass.accent).toBe("#d4a574");
  });

  it("rouge preset uses the design system rouge", () => {
    expect(TINTS.rouge.accent).toBe("#d18b8b");
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
cd /Users/jonathan/TYPEFY/octopus/octopus-sh
npm test -- src/lib/monogram.test.ts
```

Expected: fails with `Cannot find module './monogram'`.

- [ ] **Step 3: Create the implementation**

Create `src/lib/monogram.ts`:

```typescript
// Workspace monogram resolution — glyph + tint preset.
// See docs/superpowers/specs/2026-05-16-octopus-ux-redesign-design.md §3.5
// for the design rationale and color choices.

import type { Workspace, TintName } from "./types";

export interface MonogramConfig {
  /** Single character to render (Spectral italic). */
  glyph: string;
  /** Tint preset name — controls the icon's accent + background only. */
  tint: TintName;
  /** True iff the user has overridden glyph or tint (vs. defaults). */
  isCustom: boolean;
}

export const TINT_NAMES: TintName[] = [
  "brass",
  "verdigris",
  "rouge",
  "indigo",
  "lavender",
  "smoke",
  "bone",
];

export const TINTS: Record<TintName, { accent: string; bg: string }> = {
  brass:     { accent: "#d4a574", bg: "rgba(212, 165, 116, 0.08)" },
  verdigris: { accent: "#8fc9a8", bg: "rgba(143, 201, 168, 0.08)" },
  rouge:     { accent: "#d18b8b", bg: "rgba(209, 139, 139, 0.08)" },
  indigo:    { accent: "#8a93c9", bg: "rgba(138, 147, 201, 0.08)" },
  lavender:  { accent: "#b59ac9", bg: "rgba(181, 154, 201, 0.08)" },
  smoke:     { accent: "#a8a8a8", bg: "rgba(168, 168, 168, 0.06)" },
  bone:      { accent: "#d8c9a8", bg: "rgba(216, 201, 168, 0.07)" },
};

export function resolveMonogram(ws: Workspace): MonogramConfig {
  const glyph = ws.glyph ?? deriveFirstLetter(ws.name);
  const tint: TintName = ws.tint ?? "brass";
  const isCustom = ws.glyph !== null || ws.tint !== null;
  return { glyph, tint, isCustom };
}

function deriveFirstLetter(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "?";
  return trimmed.charAt(0).toUpperCase();
}
```

- [ ] **Step 4: Run the tests, verify they pass**

```bash
npm test -- src/lib/monogram.test.ts
```

Expected: all 11 tests pass.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/monogram.ts src/lib/monogram.test.ts
git commit -m "feat: monogram utility (glyph + tint resolution)"
```

---

### Task 3: Modes type module

**Files:**
- Create: `src/lib/modes.ts`

This is tiny — just a type and constants — but lives in its own file so multiple components can import without circular deps.

- [ ] **Step 1: Create the module**

Create `src/lib/modes.ts`:

```typescript
// Workspace mode — what the canvas is showing right now.
// Modes replace the previous tab system. Only one mode is active per workspace.

export type WorkspaceMode = "talk" | "run" | "review";

export const MODES: WorkspaceMode[] = ["talk", "run", "review"];

export const MODE_LABELS: Record<WorkspaceMode, string> = {
  talk: "Talk",
  run: "Run",
  review: "Review",
};

/** Keyboard shortcut letter shown in tooltips. Mapping: ⌘⇧1/2/3 → talk/run/review. */
export const MODE_SHORTCUTS: Record<WorkspaceMode, string> = {
  talk: "⌘⇧1",
  run: "⌘⇧2",
  review: "⌘⇧3",
};
```

No tests — it's three constants and a type alias.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: clean (no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add src/lib/modes.ts
git commit -m "feat: WorkspaceMode type + constants"
```

---

### Task 4: WorkspaceRail component

**Files:**
- Create: `src/components/WorkspaceRail.tsx`
- Create: `src/components/WorkspaceRail.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/WorkspaceRail.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkspaceRail } from "./WorkspaceRail";
import type { Workspace } from "../lib/types";

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws-1",
    projectId: "proj-1",
    name: "Auth refactor",
    task: "",
    branch: "feat/auth",
    worktreePath: null,
    setupScript: "",
    status: "active",
    createdAt: "2026-05-16T00:00:00Z",
    lastActive: "2026-05-16T00:00:00Z",
    glyph: null,
    tint: null,
    ...overrides,
  };
}

describe("WorkspaceRail", () => {
  it("renders one button per workspace", () => {
    const workspaces = [
      makeWorkspace({ id: "a", name: "Alpha" }),
      makeWorkspace({ id: "b", name: "Beta" }),
      makeWorkspace({ id: "c", name: "Gamma" }),
    ];
    render(
      <WorkspaceRail
        workspaces={workspaces}
        activeId="a"
        onSelect={vi.fn()}
        onCustomize={vi.fn()}
        onNewWorkspace={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(workspaces.length + 1); // +1 for "new"
  });

  it("renders the workspace monogram glyph", () => {
    const workspaces = [makeWorkspace({ name: "Hyperion" })];
    render(
      <WorkspaceRail
        workspaces={workspaces}
        activeId="ws-1"
        onSelect={vi.fn()}
        onCustomize={vi.fn()}
        onNewWorkspace={vi.fn()}
      />,
    );
    expect(screen.getByText("H")).toBeInTheDocument();
  });

  it("calls onSelect with the workspace id on click", () => {
    const workspaces = [
      makeWorkspace({ id: "a", name: "Alpha" }),
      makeWorkspace({ id: "b", name: "Beta" }),
    ];
    const onSelect = vi.fn();
    render(
      <WorkspaceRail
        workspaces={workspaces}
        activeId="a"
        onSelect={onSelect}
        onCustomize={vi.fn()}
        onNewWorkspace={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("B"));
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("calls onCustomize with the workspace id on right-click", () => {
    const workspaces = [makeWorkspace({ id: "a", name: "Alpha" })];
    const onCustomize = vi.fn();
    render(
      <WorkspaceRail
        workspaces={workspaces}
        activeId="a"
        onSelect={vi.fn()}
        onCustomize={onCustomize}
        onNewWorkspace={vi.fn()}
      />,
    );
    fireEvent.contextMenu(screen.getByText("A"));
    expect(onCustomize).toHaveBeenCalledWith("a");
  });

  it("calls onNewWorkspace when the + button is clicked", () => {
    const onNewWorkspace = vi.fn();
    render(
      <WorkspaceRail
        workspaces={[]}
        activeId={null}
        onSelect={vi.fn()}
        onCustomize={vi.fn()}
        onNewWorkspace={onNewWorkspace}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /new workspace/i }));
    expect(onNewWorkspace).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
npm test -- src/components/WorkspaceRail.test.tsx
```

Expected: fails with `Cannot find module './WorkspaceRail'`.

- [ ] **Step 3: Implement the component**

Create `src/components/WorkspaceRail.tsx`:

```tsx
import { resolveMonogram, TINTS } from "../lib/monogram";
import type { Workspace } from "../lib/types";

interface Props {
  workspaces: Workspace[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCustomize: (id: string) => void;
  onNewWorkspace: () => void;
}

export function WorkspaceRail({
  workspaces,
  activeId,
  onSelect,
  onCustomize,
  onNewWorkspace,
}: Props) {
  return (
    <aside
      className="flex h-full w-12 flex-col items-center gap-2 border-r border-octo-hairline bg-octo-panel py-3"
      aria-label="Workspaces"
    >
      {workspaces.map((ws) => (
        <MonogramButton
          key={ws.id}
          workspace={ws}
          active={ws.id === activeId}
          onSelect={() => onSelect(ws.id)}
          onCustomize={() => onCustomize(ws.id)}
        />
      ))}
      <button
        type="button"
        onClick={onNewWorkspace}
        title="New workspace (⌘N)"
        aria-label="New workspace"
        className="mt-1 flex h-6 w-6 items-center justify-center rounded-md border border-dashed border-octo-hairline font-mono text-sm text-octo-mute transition hover:border-octo-brass hover:text-octo-brass"
      >
        +
      </button>
    </aside>
  );
}

function MonogramButton({
  workspace,
  active,
  onSelect,
  onCustomize,
}: {
  workspace: Workspace;
  active: boolean;
  onSelect: () => void;
  onCustomize: () => void;
}) {
  const mono = resolveMonogram(workspace);
  const tint = TINTS[mono.tint];

  return (
    <div className="relative">
      {active && (
        <span
          aria-hidden
          className="absolute -left-3 top-1/2 h-6 w-[2px] -translate-y-1/2 rounded-r-sm bg-octo-brass"
        />
      )}
      <button
        type="button"
        onClick={onSelect}
        onContextMenu={(e) => {
          e.preventDefault();
          onCustomize();
        }}
        title={`${workspace.name} (right-click to customize)`}
        aria-label={workspace.name}
        aria-current={active ? "true" : undefined}
        className="flex h-7 w-7 items-center justify-center rounded-md border font-serif italic transition"
        style={{
          color: tint.accent,
          borderColor: active ? tint.accent : "transparent",
          background: active ? tint.bg : "transparent",
        }}
      >
        {mono.glyph}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests**

```bash
npm test -- src/components/WorkspaceRail.test.tsx
```

Expected: 5/5 pass.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/WorkspaceRail.tsx src/components/WorkspaceRail.test.tsx
git commit -m "feat: WorkspaceRail component with monogram + tint"
```

---

### Task 5: ContextHeader component

**Files:**
- Create: `src/components/ContextHeader.tsx`
- Create: `src/components/ContextHeader.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/ContextHeader.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContextHeader } from "./ContextHeader";

describe("ContextHeader", () => {
  it("renders the workspace name", () => {
    render(<ContextHeader workspaceName="auth-refactor" branch="feat/auth" gitStatus={null} />);
    expect(screen.getByText("auth-refactor")).toBeInTheDocument();
  });

  it("renders the branch", () => {
    render(<ContextHeader workspaceName="X" branch="feat/auth" gitStatus={null} />);
    expect(screen.getByText(/feat\/auth/)).toBeInTheDocument();
  });

  it("renders the unstaged count when git status is provided", () => {
    render(
      <ContextHeader
        workspaceName="X"
        branch="main"
        gitStatus={{ branch: "main", changedFiles: [{ path: "a.ts", status: "modified" }, { path: "b.ts", status: "new" }], ahead: 0, behind: 0 }}
      />,
    );
    expect(screen.getByText(/2 unstaged/)).toBeInTheDocument();
  });

  it("does not render the unstaged count when changedFiles is empty", () => {
    render(
      <ContextHeader
        workspaceName="X"
        branch="main"
        gitStatus={{ branch: "main", changedFiles: [], ahead: 0, behind: 0 }}
      />,
    );
    expect(screen.queryByText(/unstaged/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
npm test -- src/components/ContextHeader.test.tsx
```

Expected: `Cannot find module './ContextHeader'`.

- [ ] **Step 3: Implement**

Create `src/components/ContextHeader.tsx`:

```tsx
import type { GitStatus } from "../lib/types";

interface Props {
  workspaceName: string;
  branch: string;
  gitStatus: GitStatus | null;
}

export function ContextHeader({ workspaceName, branch, gitStatus }: Props) {
  const unstaged = gitStatus?.changedFiles.length ?? 0;

  return (
    <div className="m-4 flex items-center gap-4 rounded-xl border border-octo-hairline bg-octo-panel px-4 py-2">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-octo-brass">
          Workspace
        </div>
        <div className="font-serif italic text-[15px] leading-tight tracking-[-0.005em] text-octo-ivory">
          {workspaceName}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2 font-mono text-[10px] text-octo-mute">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-octo-verdigris" aria-hidden />
        <span>↳ {branch}</span>
        {unstaged > 0 && <span>· {unstaged} unstaged</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests**

```bash
npm test -- src/components/ContextHeader.test.tsx
```

Expected: 4/4 pass.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/ContextHeader.tsx src/components/ContextHeader.test.tsx
git commit -m "feat: ContextHeader component"
```

---

### Task 6: ModeSwitcher component

**Files:**
- Create: `src/components/ModeSwitcher.tsx`
- Create: `src/components/ModeSwitcher.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/ModeSwitcher.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModeSwitcher } from "./ModeSwitcher";

describe("ModeSwitcher", () => {
  it("renders all 3 mode buttons", () => {
    render(<ModeSwitcher mode="talk" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /talk/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /review/i })).toBeInTheDocument();
  });

  it("marks the active mode with aria-pressed", () => {
    render(<ModeSwitcher mode="run" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /talk/i })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /run/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /review/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onChange with the clicked mode", () => {
    const onChange = vi.fn();
    render(<ModeSwitcher mode="talk" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /review/i }));
    expect(onChange).toHaveBeenCalledWith("review");
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
npm test -- src/components/ModeSwitcher.test.tsx
```

Expected: `Cannot find module './ModeSwitcher'`.

- [ ] **Step 3: Implement**

Create `src/components/ModeSwitcher.tsx`:

```tsx
import { clsx } from "clsx";
import { MODES, MODE_LABELS, MODE_SHORTCUTS, type WorkspaceMode } from "../lib/modes";

interface Props {
  mode: WorkspaceMode;
  onChange: (next: WorkspaceMode) => void;
}

export function ModeSwitcher({ mode, onChange }: Props) {
  return (
    <div
      role="group"
      aria-label="Workspace mode"
      className="m-4 inline-flex items-center gap-1 rounded-lg border border-octo-hairline bg-octo-panel p-1"
    >
      {MODES.map((m) => {
        const active = m === mode;
        return (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            aria-pressed={active}
            title={`${MODE_LABELS[m]} (${MODE_SHORTCUTS[m]})`}
            className={clsx(
              "rounded-md px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] transition",
              active
                ? "border border-octo-brass-dim bg-octo-brass-ghost text-octo-brass"
                : "border border-transparent text-octo-mute hover:text-octo-sage",
            )}
          >
            {MODE_LABELS[m]}
          </button>
        );
      })}
    </div>
  );
}
```

**Note on Tailwind class `bg-octo-brass-ghost` and `border-octo-brass-dim`:** these refer to the brass alpha utilities. Tailwind v4 only generates utility classes for tokens declared inside `@theme`. The brass alphas live in the `:root` block, not `@theme`, so these classes won't resolve as Tailwind utilities. Use inline `style` instead:

Replace the className expression for the `active` branch with:

```tsx
className={clsx(
  "rounded-md px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] transition",
  active
    ? "border text-octo-brass"
    : "border border-transparent text-octo-mute hover:text-octo-sage",
)}
style={
  active
    ? {
        borderColor: "var(--brass-dim)",
        background: "var(--brass-ghost)",
      }
    : undefined
}
```

Use this pattern (`var(--brass-dim)` / `var(--brass-ghost)` via `style`) wherever a component needs the brass alpha utilities. Don't try to generate Tailwind classes for them.

- [ ] **Step 4: Run the tests**

```bash
npm test -- src/components/ModeSwitcher.test.tsx
```

Expected: 3/3 pass.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/ModeSwitcher.tsx src/components/ModeSwitcher.test.tsx
git commit -m "feat: ModeSwitcher (Talk / Run / Review)"
```

---

### Task 7: Companion shell + per-mode panels (skeletons)

**Files:**
- Create: `src/components/Companion.tsx`
- Create: `src/components/CompanionContext.tsx`
- Create: `src/components/CompanionHistory.tsx`
- Create: `src/components/CompanionTerminals.tsx`
- Create: `src/components/CompanionChanged.tsx`
- Create: `src/components/Companion.test.tsx`

This task creates the Companion shell + 4 sub-panel components as **skeletons**. Real wiring happens in Tasks 9 and 10. For now the panels accept stub props and render the right section headers.

- [ ] **Step 1: Write the test for Companion**

Create `src/components/Companion.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Companion } from "./Companion";

describe("Companion", () => {
  it("renders Context and History sections in talk mode", () => {
    render(
      <Companion
        mode="talk"
        contextProps={{ tokensUsed: 42000, tokensLimit: 200000, filesInFlight: 3, toolCalls: 7 }}
        historyProps={{ chats: [], activeChatId: null, onSelectChat: () => {}, onNewChat: () => {} }}
        terminalsProps={{ terminals: [], activeTerminalId: null, onSelectTerminal: () => {}, onNewTerminal: () => {} }}
        changedProps={{ changedFiles: [] }}
      />,
    );
    expect(screen.getByText(/context/i)).toBeInTheDocument();
    expect(screen.getByText(/history/i)).toBeInTheDocument();
  });

  it("renders Terminals section in run mode", () => {
    render(
      <Companion
        mode="run"
        contextProps={{ tokensUsed: 0, tokensLimit: 200000, filesInFlight: 0, toolCalls: 0 }}
        historyProps={{ chats: [], activeChatId: null, onSelectChat: () => {}, onNewChat: () => {} }}
        terminalsProps={{ terminals: [], activeTerminalId: null, onSelectTerminal: () => {}, onNewTerminal: () => {} }}
        changedProps={{ changedFiles: [] }}
      />,
    );
    expect(screen.getByText(/terminals/i)).toBeInTheDocument();
  });

  it("renders Changed section in review mode", () => {
    render(
      <Companion
        mode="review"
        contextProps={{ tokensUsed: 0, tokensLimit: 200000, filesInFlight: 0, toolCalls: 0 }}
        historyProps={{ chats: [], activeChatId: null, onSelectChat: () => {}, onNewChat: () => {} }}
        terminalsProps={{ terminals: [], activeTerminalId: null, onSelectTerminal: () => {}, onNewTerminal: () => {} }}
        changedProps={{ changedFiles: [] }}
      />,
    );
    expect(screen.getByText(/changed/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
npm test -- src/components/Companion.test.tsx
```

Expected: fails.

- [ ] **Step 3: Implement `CompanionContext.tsx`**

```tsx
interface Props {
  tokensUsed: number;
  tokensLimit: number;
  filesInFlight: number;
  toolCalls: number;
}

export function CompanionContext({ tokensUsed, tokensLimit, filesInFlight, toolCalls }: Props) {
  const pct = tokensLimit > 0 ? Math.min(100, (tokensUsed / tokensLimit) * 100) : 0;

  return (
    <section>
      <h3 className="border-b border-octo-hairline pb-2 font-mono text-[8px] uppercase tracking-[0.3em] text-octo-brass">
        Context
      </h3>
      <div className="mt-2 space-y-1.5 text-[11px] text-octo-sage">
        <Row label="tokens" value={`${formatThousands(tokensUsed)} / ${formatThousands(tokensLimit)}`} brass />
        <div
          className="h-[3px] rounded-sm"
          style={{ background: "var(--color-octo-hairline)" }}
        >
          <div
            className="h-full rounded-sm"
            style={{ width: `${pct}%`, background: "var(--color-octo-brass)" }}
          />
        </div>
        <Row label="files in flight" value={String(filesInFlight)} />
        <Row label="tool calls" value={String(toolCalls)} />
      </div>
    </section>
  );
}

function Row({ label, value, brass }: { label: string; value: string; brass?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <span>{label}</span>
      <span className={`font-mono text-[10px] ${brass ? "text-octo-brass" : "text-octo-ivory"}`}>
        {value}
      </span>
    </div>
  );
}

function formatThousands(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}
```

- [ ] **Step 4: Implement `CompanionHistory.tsx` (skeleton with click handlers)**

```tsx
export interface CompanionHistoryChat {
  id: string;
  title: string;
  meta: string;
}

interface Props {
  chats: CompanionHistoryChat[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
}

export function CompanionHistory({ chats, activeChatId, onSelectChat, onNewChat }: Props) {
  return (
    <section>
      <div className="flex items-center justify-between border-b border-octo-hairline pb-2">
        <h3 className="font-mono text-[8px] uppercase tracking-[0.3em] text-octo-brass">
          History
        </h3>
        <button
          type="button"
          onClick={onNewChat}
          className="font-mono text-[10px] text-octo-mute transition hover:text-octo-brass"
          title="New chat"
        >
          +
        </button>
      </div>
      <ul className="mt-2 space-y-1">
        {chats.length === 0 && (
          <li className="px-2 py-1 text-[11px] italic text-octo-mute">No previous chats.</li>
        )}
        {chats.map((c) => {
          const active = c.id === activeChatId;
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onSelectChat(c.id)}
                className="w-full rounded-md px-2 py-1.5 text-left transition"
                style={
                  active
                    ? { borderLeft: "1px solid var(--brass-dim)", background: "var(--brass-ghost)" }
                    : undefined
                }
              >
                <div className="font-serif italic text-[12px] leading-tight text-octo-ivory">
                  {c.title}
                </div>
                <div className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.15em] text-octo-mute">
                  {c.meta}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 5: Implement `CompanionTerminals.tsx` (skeleton)**

```tsx
export interface CompanionTerminal {
  id: string;
  label: string;
  meta: string;
}

interface Props {
  terminals: CompanionTerminal[];
  activeTerminalId: string | null;
  onSelectTerminal: (id: string) => void;
  onNewTerminal: () => void;
}

export function CompanionTerminals({
  terminals,
  activeTerminalId,
  onSelectTerminal,
  onNewTerminal,
}: Props) {
  return (
    <section>
      <div className="flex items-center justify-between border-b border-octo-hairline pb-2">
        <h3 className="font-mono text-[8px] uppercase tracking-[0.3em] text-octo-brass">
          Terminals
        </h3>
        <button
          type="button"
          onClick={onNewTerminal}
          className="font-mono text-[10px] text-octo-mute transition hover:text-octo-brass"
          title="New terminal"
        >
          +
        </button>
      </div>
      <ul className="mt-2 space-y-1">
        {terminals.length === 0 && (
          <li className="px-2 py-1 text-[11px] italic text-octo-mute">No active terminals.</li>
        )}
        {terminals.map((t) => {
          const active = t.id === activeTerminalId;
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onSelectTerminal(t.id)}
                className="w-full rounded-md px-2 py-1.5 text-left transition"
                style={
                  active
                    ? { borderLeft: "1px solid var(--brass-dim)", background: "var(--brass-ghost)" }
                    : undefined
                }
              >
                <div className="font-serif italic text-[12px] leading-tight text-octo-ivory">
                  {t.label}
                </div>
                <div className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.15em] text-octo-mute">
                  {t.meta}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 6: Implement `CompanionChanged.tsx` (skeleton)**

```tsx
import type { FileChange } from "../lib/types";

interface Props {
  changedFiles: FileChange[];
}

export function CompanionChanged({ changedFiles }: Props) {
  return (
    <section>
      <h3 className="border-b border-octo-hairline pb-2 font-mono text-[8px] uppercase tracking-[0.3em] text-octo-brass">
        Changed · {changedFiles.length}
      </h3>
      <ul className="mt-2 space-y-1">
        {changedFiles.length === 0 && (
          <li className="px-2 py-1 text-[11px] italic text-octo-mute">
            No unstaged changes.
          </li>
        )}
        {changedFiles.map((f) => (
          <li key={f.path} className="px-2 py-1 font-mono text-[10px] text-octo-sage">
            <span className="text-octo-brass">●</span> {f.path}
            <span className="ml-2 text-octo-mute">[{f.status}]</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 7: Implement the `Companion` shell**

Create `src/components/Companion.tsx`:

```tsx
import type { WorkspaceMode } from "../lib/modes";
import { CompanionContext } from "./CompanionContext";
import { CompanionHistory, type CompanionHistoryChat } from "./CompanionHistory";
import { CompanionTerminals, type CompanionTerminal } from "./CompanionTerminals";
import { CompanionChanged } from "./CompanionChanged";
import type { FileChange } from "../lib/types";

interface ContextProps {
  tokensUsed: number;
  tokensLimit: number;
  filesInFlight: number;
  toolCalls: number;
}

interface HistoryProps {
  chats: CompanionHistoryChat[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
}

interface TerminalsProps {
  terminals: CompanionTerminal[];
  activeTerminalId: string | null;
  onSelectTerminal: (id: string) => void;
  onNewTerminal: () => void;
}

interface ChangedProps {
  changedFiles: FileChange[];
}

interface Props {
  mode: WorkspaceMode;
  contextProps: ContextProps;
  historyProps: HistoryProps;
  terminalsProps: TerminalsProps;
  changedProps: ChangedProps;
}

export function Companion({
  mode,
  contextProps,
  historyProps,
  terminalsProps,
  changedProps,
}: Props) {
  return (
    <aside
      className="m-4 ml-0 flex w-[280px] flex-col gap-4 rounded-xl border border-octo-hairline bg-octo-panel p-4"
      aria-label="Companion"
    >
      {mode === "talk" && (
        <>
          <CompanionContext {...contextProps} />
          <CompanionHistory {...historyProps} />
        </>
      )}
      {mode === "run" && <CompanionTerminals {...terminalsProps} />}
      {mode === "review" && <CompanionChanged {...changedProps} />}
    </aside>
  );
}
```

- [ ] **Step 8: Run the tests**

```bash
npm test -- src/components/Companion.test.tsx
```

Expected: 3/3 pass.

- [ ] **Step 9: Typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add src/components/Companion.tsx src/components/CompanionContext.tsx \
        src/components/CompanionHistory.tsx src/components/CompanionTerminals.tsx \
        src/components/CompanionChanged.tsx src/components/Companion.test.tsx
git commit -m "feat: Companion shell + per-mode panel skeletons"
```

---

### Task 8: WorkspaceCustomizeMenu component (TDD)

**Files:**
- Create: `src/components/WorkspaceCustomizeMenu.tsx`
- Create: `src/components/WorkspaceCustomizeMenu.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/WorkspaceCustomizeMenu.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkspaceCustomizeMenu } from "./WorkspaceCustomizeMenu";

describe("WorkspaceCustomizeMenu", () => {
  function defaults() {
    return {
      initialGlyph: null as string | null,
      initialTint: null as
        | "brass" | "verdigris" | "rouge" | "indigo" | "lavender" | "smoke" | "bone"
        | null,
      defaultGlyph: "A",
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    };
  }

  it("renders 7 tint preset buttons", () => {
    render(<WorkspaceCustomizeMenu {...defaults()} />);
    expect(screen.getByRole("button", { name: /brass/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /verdigris/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /rouge/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /indigo/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /lavender/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /smoke/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /bone/i })).toBeInTheDocument();
  });

  it("prefills the glyph input with the initial glyph or default", () => {
    const { rerender } = render(
      <WorkspaceCustomizeMenu {...defaults()} initialGlyph={null} defaultGlyph="X" />,
    );
    expect(screen.getByLabelText(/glyph/i)).toHaveValue("X");

    rerender(<WorkspaceCustomizeMenu {...defaults()} initialGlyph="§" defaultGlyph="X" />);
    expect(screen.getByLabelText(/glyph/i)).toHaveValue("§");
  });

  it("calls onSubmit with the chosen glyph (or null if matches default) and tint", () => {
    const onSubmit = vi.fn();
    render(
      <WorkspaceCustomizeMenu
        {...defaults()}
        onSubmit={onSubmit}
        initialGlyph={null}
        defaultGlyph="A"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /verdigris/i }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSubmit).toHaveBeenCalledWith(null, "verdigris");
  });

  it("returns the user-typed glyph when it differs from default", () => {
    const onSubmit = vi.fn();
    render(
      <WorkspaceCustomizeMenu
        {...defaults()}
        onSubmit={onSubmit}
        initialGlyph={null}
        defaultGlyph="A"
      />,
    );
    const input = screen.getByLabelText(/glyph/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "§" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSubmit).toHaveBeenCalledWith("§", null);
  });

  it("calls onCancel when the cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(<WorkspaceCustomizeMenu {...defaults()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verify the tests fail**

```bash
npm test -- src/components/WorkspaceCustomizeMenu.test.tsx
```

Expected: `Cannot find module './WorkspaceCustomizeMenu'`.

- [ ] **Step 3: Implement the component**

Create `src/components/WorkspaceCustomizeMenu.tsx`:

```tsx
import { useState } from "react";
import { TINTS, TINT_NAMES } from "../lib/monogram";
import type { TintName } from "../lib/types";

interface Props {
  /** Existing glyph, or null if using default first letter. */
  initialGlyph: string | null;
  /** Existing tint, or null if using brass default. */
  initialTint: TintName | null;
  /** The default glyph (first letter of the workspace name). */
  defaultGlyph: string;
  /**
   * Submit handler. Glyph is null when the input matches the default
   * (so we don't persist redundant customization).
   */
  onSubmit: (glyph: string | null, tint: TintName | null) => void;
  onCancel: () => void;
}

export function WorkspaceCustomizeMenu({
  initialGlyph,
  initialTint,
  defaultGlyph,
  onSubmit,
  onCancel,
}: Props) {
  const [glyph, setGlyph] = useState<string>(initialGlyph ?? defaultGlyph);
  const [tint, setTint] = useState<TintName>(initialTint ?? "brass");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = glyph.trim().charAt(0) || defaultGlyph;
    const glyphOut = normalized === defaultGlyph ? null : normalized;
    const tintOut = tint === "brass" && initialTint === null ? null : tint;
    onSubmit(glyphOut, tintOut);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-[260px] rounded-xl border border-octo-hairline bg-octo-panel p-4 shadow-xl"
      aria-label="Customize workspace"
    >
      <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-octo-brass">
        Customize
      </div>

      <label htmlFor="glyph-input" className="mt-3 block font-mono text-[8px] uppercase tracking-[0.25em] text-octo-mute">
        Glyph
      </label>
      <input
        id="glyph-input"
        value={glyph}
        onChange={(e) => setGlyph(e.target.value)}
        maxLength={2}
        className="mt-1 w-full rounded-md border border-octo-hairline bg-octo-onyx px-3 py-2 font-serif italic text-[18px] text-octo-ivory outline-none focus:border-octo-brass"
      />

      <div className="mt-3 font-mono text-[8px] uppercase tracking-[0.25em] text-octo-mute">
        Tint
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1.5">
        {TINT_NAMES.map((name) => {
          const t = TINTS[name];
          const selected = name === tint;
          return (
            <button
              key={name}
              type="button"
              onClick={() => setTint(name)}
              title={name}
              aria-label={name}
              aria-pressed={selected}
              className="h-7 w-7 rounded-md border transition"
              style={{
                background: t.bg,
                borderColor: selected ? t.accent : "transparent",
                outline: selected ? `1px solid ${t.accent}` : "none",
                outlineOffset: "1px",
              }}
            >
              <span className="font-serif italic" style={{ color: t.accent }}>•</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="submit"
          className="rounded-md border border-octo-brass-dim px-3 py-1.5 font-serif italic text-[12px] text-octo-brass"
          style={{ background: "var(--brass-ghost)", borderColor: "var(--brass-dim)" }}
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 font-sans text-[12px] text-octo-mute hover:text-octo-sage"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Run the tests**

```bash
npm test -- src/components/WorkspaceCustomizeMenu.test.tsx
```

Expected: 5/5 pass.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/WorkspaceCustomizeMenu.tsx src/components/WorkspaceCustomizeMenu.test.tsx
git commit -m "feat: WorkspaceCustomizeMenu (glyph + tint picker)"
```

---

### Task 9: workspaceStore — updateCustomization action

**Files:**
- Modify: `src/stores/workspaceStore.ts`

- [ ] **Step 1: Add the action**

Open `src/stores/workspaceStore.ts`. The current `WorkspaceState` interface lists actions like `create`, `select`, `remove`. Add `updateCustomization` between `remove` and `notify`:

```typescript
interface WorkspaceState {
  workspaces: Workspace[];
  activeId: string | null;
  loading: boolean;
  notifications: Record<string, number>;

  load: (projectId: string) => Promise<void>;
  create: (projectId: string, projectPath: string, name: string, task: string,
           branch: string, fromBranch: string, setupScript: string) => Promise<Workspace>;
  select: (id: string | null) => void;
  remove: (workspaceId: string, projectPath: string, branch: string, worktreePath: string | null) => Promise<void>;
  updateCustomization: (workspaceId: string, glyph: string | null, tint: string | null) => Promise<void>;
  notify: (workspaceId: string) => void;
  clearNotification: (workspaceId: string) => void;
}
```

Then add the implementation in the `create((set, get) => ({ ... }))` body, between `remove` and `notify`:

```typescript
  updateCustomization: async (workspaceId, glyph, tint) => {
    await ipc.updateWorkspaceCustomization(workspaceId, glyph, tint);
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === workspaceId
          ? { ...w, glyph: glyph, tint: (tint as Workspace["tint"]) }
          : w,
      ),
    }));
  },
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/jonathan/TYPEFY/octopus/octopus-sh
npm run typecheck
```

Expected: clean.

- [ ] **Step 3: Run all frontend tests**

```bash
npm test
```

Expected: all pass (no test for this store yet — the action is exercised via integration in Task 10).

- [ ] **Step 4: Commit**

```bash
git add src/stores/workspaceStore.ts
git commit -m "feat: workspaceStore.updateCustomization action"
```

---

### Task 10: App.tsx — the integration (the big one)

**Files:**
- Modify: `src/App.tsx` (substantial rewrite)

This is the biggest task. We're replacing the entire layout in `App.tsx`. The existing chat / terminal / changes views stay — only the chrome around them changes.

- [ ] **Step 1: Read the current `App.tsx`**

Use the Read tool on `/Users/jonathan/TYPEFY/octopus/octopus-sh/src/App.tsx` so you understand the existing state machine before you replace it. In particular note: `view`, `viewPerWorkspace`, `tabsPerWorkspace`, `activeTabId`, `creatingSessionRef`, `showSidebar`, `showTokens`, `showPalette`, `showCreator`, `showSettings`, `layoutVersion`, `bumpLayout`, the keyboard handler, and the JSX layout.

- [ ] **Step 2: Plan the state replacements**

You will:

- **Remove**: `view`, `_setView`, `setView`, `viewPerWorkspace`, `setViewPerWorkspace`, `showSidebar`, `setShowSidebar`, `tabsPerWorkspace`, `setTabsPerWorkspace`, `activeTabId`, `setActiveTabId`, `creatingSessionRef`, `ensureTabs`, `ensureTerminalForTab`, `addChatTab`, `addTerminalTab`, `closeTab`, `renameTab`, `selectTab`, `openTerminal`, `openChat`, `openChanges`, and the related useEffects.

- **Add**: `modePerWorkspace: Record<string, WorkspaceMode>` (default `"talk"` when missing), `chatsPerWorkspace: Record<string, ChatRef[]>`, `terminalsPerWorkspace: Record<string, TerminalRef[]>`, `activeChatPerWorkspace: Record<string, string>`, `activeTerminalPerWorkspace: Record<string, string>`, plus `customizingWorkspaceId: string | null` (drives the WorkspaceCustomizeMenu popover).

The `ChatRef` and `TerminalRef` shapes (define them locally at the top of App.tsx):

```typescript
interface ChatRef {
  id: string;             // conversationId
  title: string;          // display title for History list
  meta: string;           // e.g. "NOW · 7 TURNS"
}

interface TerminalRef {
  id: string;             // matches PTY sessionId once created
  label: string;
  meta: string;           // e.g. "IDLE · 4M AGO" — start as "READY"
  sessionId: string | null; // null until first activation creates the PTY
}
```

For Phase 2, both lists start with **one entry per workspace** (the default chat, the default terminal). Tasks 9 and 10's panel sub-components display them.

- [ ] **Step 3: Replace the contents of `src/App.tsx`**

Write the new `App.tsx`. Use this exact content:

```tsx
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { NewProjectFlow } from "./components/NewProjectFlow";
import { WorkspaceRail } from "./components/WorkspaceRail";
import { ContextHeader } from "./components/ContextHeader";
import { ModeSwitcher } from "./components/ModeSwitcher";
import { Companion } from "./components/Companion";
import { WorkspaceCustomizeMenu } from "./components/WorkspaceCustomizeMenu";
import { WorkspaceCreator } from "./components/WorkspaceCreator";
import { ChatView } from "./components/ChatView";
import { ChangesPanel } from "./components/ChangesPanel";
import { TerminalPane } from "./components/TerminalPane";
import { TokenDashboard } from "./components/TokenDashboard";
import { CommandPalette } from "./components/CommandPalette";
import { ToastContainer } from "./components/Toasts";
import { SettingsDialog } from "./components/SettingsDialog";
import { useProjectStore } from "./stores/projectStore";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { useThemeStore } from "./stores/themeStore";
import { resolveMonogram } from "./lib/monogram";
import { type WorkspaceMode } from "./lib/modes";
import { ipc } from "./lib/ipc";
import type { GitStatus, TintName } from "./lib/types";

interface ChatRef {
  id: string;
  title: string;
  meta: string;
}

interface TerminalRef {
  id: string;
  label: string;
  meta: string;
  sessionId: string | null;
}

type AppView = "project" | "new-project";

function App() {
  const project = useProjectStore((s) => s.current);
  const loadTheme = useThemeStore((s) => s.load);
  const {
    workspaces,
    activeId: activeWorkspaceId,
    load: loadWorkspaces,
    updateCustomization,
    select: selectWorkspace,
  } = useWorkspaceStore();

  const [appView, setAppView] = useState<AppView>("project");

  // Per-workspace state — modes, chats, terminals.
  const [modePerWorkspace, setModePerWorkspace] = useState<Record<string, WorkspaceMode>>({});
  const [chatsPerWorkspace, setChatsPerWorkspace] = useState<Record<string, ChatRef[]>>({});
  const [terminalsPerWorkspace, setTerminalsPerWorkspace] = useState<Record<string, TerminalRef[]>>({});
  const [activeChatPerWorkspace, setActiveChatPerWorkspace] = useState<Record<string, string>>({});
  const [activeTerminalPerWorkspace, setActiveTerminalPerWorkspace] = useState<Record<string, string>>({});

  // Overlay/menu state
  const [showTokens, setShowTokens] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showCreator, setShowCreator] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [customizingWorkspaceId, setCustomizingWorkspaceId] = useState<string | null>(null);

  // Git status (refreshed on workspace change)
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);

  // Layout version (forces TerminalPane fit-resize when sidebar/companion toggle)
  const layoutVersionRef = useRef(0);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const bumpLayout = useCallback(() => {
    layoutVersionRef.current += 1;
    setLayoutVersion(layoutVersionRef.current);
  }, []);

  const creatingTerminalRef = useRef<Set<string>>(new Set());

  // ── Theme load ──
  useEffect(() => {
    loadTheme();
  }, [loadTheme]);

  // ── Project switch → load workspaces, reset view ──
  useEffect(() => {
    if (project) {
      setAppView("project");
      setShowCreator(false);
      loadWorkspaces(project.id);
    } else {
      setShowCreator(false);
    }
  }, [project, loadWorkspaces]);

  // ── Initialize per-workspace state when a new workspace becomes active ──
  useEffect(() => {
    if (!activeWorkspaceId) return;
    setChatsPerWorkspace((prev) => {
      if (prev[activeWorkspaceId]) return prev;
      const initial: ChatRef = {
        id: activeWorkspaceId, // first chat uses workspace id as conversationId
        title: "Conversation",
        meta: "NOW",
      };
      return { ...prev, [activeWorkspaceId]: [initial] };
    });
    setActiveChatPerWorkspace((prev) =>
      prev[activeWorkspaceId] ? prev : { ...prev, [activeWorkspaceId]: activeWorkspaceId },
    );
    setTerminalsPerWorkspace((prev) => {
      if (prev[activeWorkspaceId]) return prev;
      const initial: TerminalRef = {
        id: `term-${activeWorkspaceId}-1`,
        label: "Main",
        meta: "READY",
        sessionId: null,
      };
      return { ...prev, [activeWorkspaceId]: [initial] };
    });
    setActiveTerminalPerWorkspace((prev) =>
      prev[activeWorkspaceId]
        ? prev
        : { ...prev, [activeWorkspaceId]: `term-${activeWorkspaceId}-1` },
    );
  }, [activeWorkspaceId]);

  // ── Refresh git status on workspace change ──
  useEffect(() => {
    const ws = workspaces.find((w) => w.id === activeWorkspaceId);
    const path = ws?.worktreePath ?? project?.path;
    if (!path) {
      setGitStatus(null);
      return;
    }
    let cancelled = false;
    ipc.getGitStatus(path).then((s) => {
      if (!cancelled) setGitStatus(s);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, workspaces, project]);

  // ── Mode helpers ──
  const activeMode: WorkspaceMode =
    (activeWorkspaceId && modePerWorkspace[activeWorkspaceId]) || "talk";

  const setMode = useCallback(
    (next: WorkspaceMode) => {
      if (!activeWorkspaceId) return;
      setModePerWorkspace((p) => ({ ...p, [activeWorkspaceId]: next }));
    },
    [activeWorkspaceId],
  );

  // ── Lazily create a PTY session for the active terminal when entering Run mode ──
  const ensureTerminal = useCallback(async () => {
    if (!activeWorkspaceId) return;
    const list = terminalsPerWorkspace[activeWorkspaceId] ?? [];
    const activeTid = activeTerminalPerWorkspace[activeWorkspaceId];
    const term = list.find((t) => t.id === activeTid);
    if (!term || term.sessionId) return;
    if (creatingTerminalRef.current.has(term.id)) return;
    creatingTerminalRef.current.add(term.id);
    try {
      const ws = workspaces.find((w) => w.id === activeWorkspaceId);
      if (!ws || !project) return;
      const session = await ipc.createSession({
        name: `${ws.name} - ${term.label}`,
        projectRoot: ws.worktreePath || project.path,
      });
      setTerminalsPerWorkspace((prev) => ({
        ...prev,
        [activeWorkspaceId]: (prev[activeWorkspaceId] ?? []).map((t) =>
          t.id === term.id ? { ...t, sessionId: session.id } : t,
        ),
      }));
    } finally {
      creatingTerminalRef.current.delete(term.id);
    }
  }, [activeWorkspaceId, terminalsPerWorkspace, activeTerminalPerWorkspace, workspaces, project]);

  useEffect(() => {
    if (activeMode === "run") {
      ensureTerminal();
    }
  }, [activeMode, ensureTerminal]);

  // ── Chat / terminal handlers wired to Companion ──
  const handleNewChat = useCallback(() => {
    if (!activeWorkspaceId) return;
    const newId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? (crypto as { randomUUID: () => string }).randomUUID()
        : `chat-${Date.now()}`;
    const list = chatsPerWorkspace[activeWorkspaceId] ?? [];
    const chat: ChatRef = {
      id: newId,
      title: `Conversation ${list.length + 1}`,
      meta: "NOW",
    };
    setChatsPerWorkspace((p) => ({ ...p, [activeWorkspaceId]: [chat, ...list] }));
    setActiveChatPerWorkspace((p) => ({ ...p, [activeWorkspaceId]: newId }));
  }, [activeWorkspaceId, chatsPerWorkspace]);

  const handleSelectChat = useCallback(
    (id: string) => {
      if (!activeWorkspaceId) return;
      setActiveChatPerWorkspace((p) => ({ ...p, [activeWorkspaceId]: id }));
    },
    [activeWorkspaceId],
  );

  const handleNewTerminal = useCallback(() => {
    if (!activeWorkspaceId) return;
    const list = terminalsPerWorkspace[activeWorkspaceId] ?? [];
    const term: TerminalRef = {
      id: `term-${activeWorkspaceId}-${list.length + 1}`,
      label: `Terminal ${list.length + 1}`,
      meta: "READY",
      sessionId: null,
    };
    setTerminalsPerWorkspace((p) => ({ ...p, [activeWorkspaceId]: [...list, term] }));
    setActiveTerminalPerWorkspace((p) => ({ ...p, [activeWorkspaceId]: term.id }));
  }, [activeWorkspaceId, terminalsPerWorkspace]);

  const handleSelectTerminal = useCallback(
    (id: string) => {
      if (!activeWorkspaceId) return;
      setActiveTerminalPerWorkspace((p) => ({ ...p, [activeWorkspaceId]: id }));
    },
    [activeWorkspaceId],
  );

  // ── Keyboard shortcuts (spec §3.6) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // ⌘1..⌘9 → switch workspace N
      if (mod && !e.shiftKey && /^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        const ws = workspaces[idx];
        if (ws) {
          e.preventDefault();
          selectWorkspace(ws.id);
        }
        return;
      }

      // ⌘⇧1/2/3 → switch mode
      if (mod && e.shiftKey && ["1", "2", "3", "!", "@", "#"].includes(e.key)) {
        const key = e.key === "!" ? "1" : e.key === "@" ? "2" : e.key === "#" ? "3" : e.key;
        const mode: WorkspaceMode | null =
          key === "1" ? "talk" : key === "2" ? "run" : key === "3" ? "review" : null;
        if (mode) {
          e.preventDefault();
          setMode(mode);
        }
        return;
      }

      // ⌘N → new workspace
      if (mod && !e.shiftKey && e.key === "n") {
        e.preventDefault();
        if (project) setShowCreator(true);
        return;
      }

      // ⌘K → command palette
      if (mod && !e.shiftKey && e.key === "k") {
        e.preventDefault();
        setShowPalette((v) => !v);
        return;
      }

      // ⌘\ → toggle companion
      if (mod && e.key === "\\") {
        e.preventDefault();
        setShowTokens((v) => !v);
        bumpLayout();
        return;
      }

      // ⌘, → settings
      if (mod && e.key === ",") {
        e.preventDefault();
        setShowSettings(true);
        return;
      }

      // ⌘⇧T → Settings · Usage
      if (mod && e.shiftKey && (e.key === "T" || e.key === "t")) {
        e.preventDefault();
        setShowTokens((v) => !v);
        bumpLayout();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [workspaces, selectWorkspace, setMode, project, bumpLayout]);

  // ── Computed values ──
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
  const activeChatId = activeWorkspaceId
    ? activeChatPerWorkspace[activeWorkspaceId] ?? activeWorkspaceId
    : null;
  const activeTerminal = activeWorkspaceId
    ? (terminalsPerWorkspace[activeWorkspaceId] ?? []).find(
        (t) => t.id === activeTerminalPerWorkspace[activeWorkspaceId],
      ) ?? null
    : null;

  const companionContextProps = useMemo(
    () => ({
      tokensUsed: 0,        // wired to real data in Phase 6 (TokenDashboard migration)
      tokensLimit: 200_000,
      filesInFlight: gitStatus?.changedFiles.length ?? 0,
      toolCalls: 0,
    }),
    [gitStatus],
  );

  const companionHistoryProps = useMemo(
    () => ({
      chats: activeWorkspaceId ? chatsPerWorkspace[activeWorkspaceId] ?? [] : [],
      activeChatId,
      onSelectChat: handleSelectChat,
      onNewChat: handleNewChat,
    }),
    [activeWorkspaceId, chatsPerWorkspace, activeChatId, handleSelectChat, handleNewChat],
  );

  const companionTerminalsProps = useMemo(
    () => ({
      terminals: activeWorkspaceId ? terminalsPerWorkspace[activeWorkspaceId] ?? [] : [],
      activeTerminalId: activeWorkspaceId
        ? activeTerminalPerWorkspace[activeWorkspaceId] ?? null
        : null,
      onSelectTerminal: handleSelectTerminal,
      onNewTerminal: handleNewTerminal,
    }),
    [
      activeWorkspaceId,
      terminalsPerWorkspace,
      activeTerminalPerWorkspace,
      handleSelectTerminal,
      handleNewTerminal,
    ],
  );

  const companionChangedProps = useMemo(
    () => ({ changedFiles: gitStatus?.changedFiles ?? [] }),
    [gitStatus],
  );

  // ── Customize menu submit ──
  const handleCustomizeSubmit = useCallback(
    async (glyph: string | null, tint: TintName | null) => {
      if (!customizingWorkspaceId) return;
      await updateCustomization(customizingWorkspaceId, glyph, tint);
      setCustomizingWorkspaceId(null);
    },
    [customizingWorkspaceId, updateCustomization],
  );

  // ── Render: pre-project views ──
  if (!project) {
    if (appView === "new-project") {
      return (
        <div className="flex h-screen w-screen bg-octo-bg text-octo-ivory">
          <NewProjectFlow onBack={() => setAppView("project")} />
          <ToastContainer />
        </div>
      );
    }
    return (
      <div className="flex h-screen w-screen bg-octo-bg text-octo-ivory">
        <WelcomeScreen onNewProject={() => setAppView("new-project")} />
        <ToastContainer />
      </div>
    );
  }

  // ── Render: workspace shell ──
  const customizingWorkspace = workspaces.find((w) => w.id === customizingWorkspaceId) ?? null;

  return (
    <div className="flex h-screen w-screen bg-octo-bg text-octo-ivory">
      <WorkspaceRail
        workspaces={workspaces}
        activeId={activeWorkspaceId}
        onSelect={(id) => selectWorkspace(id)}
        onCustomize={(id) => setCustomizingWorkspaceId(id)}
        onNewWorkspace={() => setShowCreator(true)}
      />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {activeWorkspace ? (
          <>
            <div className="flex items-start">
              <div className="min-w-0 flex-1">
                <ContextHeader
                  workspaceName={activeWorkspace.name}
                  branch={activeWorkspace.branch}
                  gitStatus={gitStatus}
                />
              </div>
              <ModeSwitcher mode={activeMode} onChange={setMode} />
            </div>

            <div className="flex min-h-0 flex-1 overflow-hidden">
              <div className="relative min-w-0 flex-1 overflow-hidden">
                {showCreator && (
                  <WorkspaceCreator
                    projectId={project.id}
                    projectPath={project.path}
                    onCreated={() => setShowCreator(false)}
                    onCancel={() => setShowCreator(false)}
                  />
                )}
                {!showCreator && activeMode === "talk" && (
                  <ChatView
                    workspaceId={activeChatId!}
                    workspacePath={activeWorkspace.worktreePath || project.path}
                    onOpenSettings={() => setShowSettings(true)}
                  />
                )}
                {!showCreator && activeMode === "run" && (
                  <>
                    {!activeTerminal?.sessionId && (
                      <div className="flex h-full items-center justify-center text-sm text-octo-mute">
                        Starting terminal...
                      </div>
                    )}
                    {activeTerminal?.sessionId && (
                      <TerminalPane
                        sessionId={activeTerminal.sessionId}
                        visible={true}
                        layoutVersion={layoutVersion}
                      />
                    )}
                  </>
                )}
                {!showCreator && activeMode === "review" && (
                  <ChangesPanel projectPath={activeWorkspace.worktreePath || project.path} />
                )}
              </div>

              <Companion
                mode={activeMode}
                contextProps={companionContextProps}
                historyProps={companionHistoryProps}
                terminalsProps={companionTerminalsProps}
                changedProps={companionChangedProps}
              />
            </div>
          </>
        ) : (
          <WorkspaceCreator
            projectId={project.id}
            projectPath={project.path}
            onCreated={() => setShowCreator(false)}
            onCancel={() => setShowCreator(false)}
          />
        )}
      </main>

      {showTokens && <TokenDashboard />}

      {customizingWorkspace && (
        <div
          className="absolute inset-0 z-30 flex items-start justify-start bg-black/30 p-2"
          onClick={() => setCustomizingWorkspaceId(null)}
          role="dialog"
          aria-modal="true"
        >
          <div onClick={(e) => e.stopPropagation()} className="ml-14 mt-12">
            <WorkspaceCustomizeMenu
              initialGlyph={customizingWorkspace.glyph}
              initialTint={customizingWorkspace.tint}
              defaultGlyph={resolveMonogram({ ...customizingWorkspace, glyph: null, tint: null }).glyph}
              onSubmit={handleCustomizeSubmit}
              onCancel={() => setCustomizingWorkspaceId(null)}
            />
          </div>
        </div>
      )}

      <CommandPalette
        open={showPalette}
        onClose={() => setShowPalette(false)}
        onNewSession={() => {
          setShowPalette(false);
          setShowCreator(true);
        }}
        onToggleTokens={() => setShowTokens((v) => !v)}
      />

      <SettingsDialog
        open={showSettings}
        onClose={() => setShowSettings(false)}
      />

      <ToastContainer />
    </div>
  );
}

export default App;
```

**Important note about the existing `WelcomeScreen` interface:** the current welcome may use `bg-octo-bg text-zinc-100`. After Phase 1 the body uses `text-octo-ivory`, but the welcome screen itself still uses its existing classes. We are NOT redesigning the welcome here — Phase 5 owns that. Same for `NewProjectFlow`, `WorkspaceCreator`, `CommandPalette`, `SettingsDialog`, `TokenDashboard`. They render as-is for now.

- [ ] **Step 4: Run typecheck**

```bash
cd /Users/jonathan/TYPEFY/octopus/octopus-sh
npm run typecheck
```

Expected: no errors. If TypeScript complains about a missing import or type, fix it directly — don't disable type checks.

- [ ] **Step 5: Run all frontend tests**

```bash
npm test
```

Expected: all tests pass. The new component tests should pass; the existing store tests should still pass.

- [ ] **Step 6: Boot the dev server briefly to confirm no runtime crash**

```bash
cd /Users/jonathan/TYPEFY/octopus/octopus-sh
timeout 25 npm run dev 2>&1 | head -50
```

Expected: "VITE v6.x.x ready" line; no error stacks.

If you see Tailwind warnings about unknown classes (`bg-octo-brass-ghost`, `border-octo-brass-dim`), those are expected — components use `style={{ background: "var(--brass-ghost)" }}` inline for those tokens. The Tailwind utility forms (`bg-octo-brass-ghost`) are not generated. If a component you wrote accidentally uses the Tailwind form, replace it with the inline style version.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat: Atelier shell — rail / context / modes / canvas / companion (Phase 2)"
```

---

### Task 11: Cleanup — delete the old layout components

**Files:**
- Delete: `src/components/ProjectSidebar.tsx`
- Delete: `src/components/WorkspaceBar.tsx`
- Delete: `src/components/WorkspaceHub.tsx` (if unused — verify first)

- [ ] **Step 1: Confirm none of the deleted files are imported anywhere**

```bash
cd /Users/jonathan/TYPEFY/octopus/octopus-sh
grep -rn "from.*ProjectSidebar\|from.*WorkspaceBar\|from.*WorkspaceHub" src/ --include="*.ts" --include="*.tsx"
```

Expected: no matches (the only references should have been in `App.tsx`, which Task 10 rewrote). If a match appears, STOP and report — there's an import we missed.

- [ ] **Step 2: Delete the files**

```bash
rm src/components/ProjectSidebar.tsx
rm src/components/WorkspaceBar.tsx
rm src/components/WorkspaceHub.tsx
```

- [ ] **Step 3: Run typecheck and tests**

```bash
npm run typecheck
npm test
```

Expected: both pass. If a test or import depended on one of the deleted files, fix the consumer (likely a test referencing a type that should now be imported from elsewhere).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete ProjectSidebar/WorkspaceBar/WorkspaceHub (replaced by Atelier shell)"
```

---

### Task 12: End-to-end verification

**Files:** none (manual + automated verification; commit only if a small fix is required)

- [ ] **Step 1: Branch state**

```bash
cd /Users/jonathan/TYPEFY/octopus/octopus-sh
git log --oneline -15
```

Expected: 11 Phase 2 commits visible (data model, monogram, modes, rail, context header, mode switcher, companion, customize menu, workspaceStore, App integration, cleanup).

- [ ] **Step 2: Full test sweep**

```bash
npm run typecheck && npm test
cd src-tauri && cargo test
```

Expected: all green.

- [ ] **Step 3: Boot the full Tauri app**

```bash
cd /Users/jonathan/TYPEFY/octopus/octopus-sh
npm run tauri:dev
```

This is the visual verification step. Confirm by manual inspection:

| Surface | Expected |
|---------|----------|
| Welcome | Same as before (Phase 5 will redesign), but with onyx + brass colors via Phase 1 tokens. |
| Project sidebar | **GONE.** Replaced by the thin icon rail on the left. |
| Workspace bar | **GONE.** Replaced by the floating ContextHeader + ModeSwitcher pills. |
| Rail | Visible on the left, 48px wide, with one brass-monogram square per workspace. Active workspace has a vertical brass indicator on its left edge. |
| Mode pills | Top right of the workspace area, 3 pills: Talk / Run / Review. Active pill has brass-ghost background + brass-dim border. |
| Talk mode | Default. ChatView in the canvas; Companion on the right shows Context (tokens + meter) and History (the workspace's chat list, just the default conversation). |
| Run mode | Click "Run". Terminal appears in the canvas (with a brief "Starting terminal..." flash). Companion shows the Terminals list. |
| Review mode | Click "Review". ChangesPanel in the canvas. Companion shows the Changed file list. |
| Customize menu | Right-click any rail icon → popover with glyph input + 7 tint swatches. Save persists, monogram updates. |
| ⌘1/⌘2/… | Switches workspaces. |
| ⌘⇧1/⌘⇧2/⌘⇧3 | Switches modes. |
| ⌘N | Opens workspace creator. |
| ⌘K | Opens command palette. |
| ⌘, | Opens settings. |
| ⌘⇧T | Opens token dashboard overlay. |

- [ ] **Step 4: Verify glyph + tint customization round-trips through SQLite**

In the running app: right-click a workspace, set glyph to `§` and tint to `verdigris`, save. Restart the app (`Ctrl+C` then `npm run tauri:dev` again). The workspace monogram should still show `§` in verdigris green — persistence confirmed.

- [ ] **Step 5: Report any blockers**

If anything is broken (a missing piece of glue, a runtime error, a Tailwind class that didn't generate), surface it. Small fixes can be applied directly and committed:

```bash
git add <files>
git commit -m "fix: <surface> in Phase 2 shell"
```

Larger issues should be reported back rather than papered over.

- [ ] **Step 6: Mark Phase 2 complete**

All 12 tasks shipped. The new Atelier layout grammar is live. Chat / Terminal / Changes still work — their containers changed, their internals didn't. Phase 3 (Modes polish, mode-driven companion swap animation) and Phase 4 (Chat soul) are next.

---

## Self-review notes (recorded after writing this plan)

**Spec coverage:**

- §3.1 Five surfaces (Rail, ContextHeader, Modes, Canvas, Companion) → Tasks 4, 5, 6, 7, 10 ✓
- §3.2 Mode semantics → Task 6 (ModeSwitcher) + Task 10 (App wiring) ✓
- §3.3 Replacement table (delete sidebar/bar) → Task 11 ✓
- §3.4 New components → Tasks 4–8 ✓
- §3.5 Workspace monograms + 7 tints → Tasks 1, 2, 4, 8 ✓
- §3.6 Keyboard shortcuts → Task 10 (full table implemented) ✓
- Migration of multi-chat-tab into Companion → Task 7 (panel) + Task 10 (state) ✓
- Migration of multi-terminal-tab into Companion → Task 7 (panel) + Task 10 (state) ✓
- Rust schema migration (glyph + tint columns) → Task 1 ✓
- IPC + store action → Task 1, 9 ✓

**Type/name consistency check:**

- `Workspace` interface fields `glyph: string | null` and `tint: TintName | null` consistent across `types.ts`, `monogram.ts`, `WorkspaceCustomizeMenu`, store, and `App.tsx`.
- `WorkspaceMode` = `"talk" | "run" | "review"` consistent across `modes.ts`, `ModeSwitcher`, `Companion`, `App.tsx`.
- `TINT_NAMES` array order matches the spec's preset list.
- `resolveMonogram(ws).glyph` always returns a string; `resolveMonogram(ws).tint` always returns a valid `TintName`.

**Risks/known compromises:**

- The Companion's `Context` panel shows `tokensUsed: 0` for Phase 2 — real wiring to the token system comes in Phase 6 (when `TokenDashboard` migrates into the companion). This is in line with spec §7 Phase 6.
- Tailwind v4 only generates classes for `@theme`-declared tokens. The brass alpha utilities (`--brass-dim`, `--brass-ghost`) live in `:root`, so components use `style={{ background: "var(--brass-ghost)" }}` inline. This pattern is consistent across `ModeSwitcher`, `CompanionHistory`, `CompanionTerminals`, and `WorkspaceCustomizeMenu`. If Phase 7 polish wants to consolidate these into a utility, that's the right time.
- `WelcomeScreen`, `NewProjectFlow`, `WorkspaceCreator`, `CommandPalette`, `SettingsDialog`, `TokenDashboard` are mounted as-is — their internals don't match Atelier yet. Phase 5 and Phase 6 own those redesigns.
- The `WorkspaceCustomizeMenu` is rendered as a centered modal-with-backdrop in Task 10. A future iteration could anchor it to the right of the clicked rail icon for spatial directness; for Phase 2 the modal pattern is acceptable since `react-popper` or similar is not yet in deps.

**Phase 2 ships when:**
- All 11 commits land on the branch.
- `npm run typecheck && npm test && cargo test` pass.
- Visual smoke (Task 12 Step 3) confirms the layout matches the spec's intent.
