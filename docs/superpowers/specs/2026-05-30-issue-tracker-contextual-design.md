# Contextual Issue Tracker — design (v2)

**Date:** 2026-05-30
**Status:** Approved (pending spec review)
**Supersedes (extends):** `2026-05-29-issue-tracker-jira-design.md` (v1)

## Motivation

v1 shipped a global backlog: every assigned, not-done ticket across every Jira
project, identical regardless of where the developer is working. In daily use
the list is noise — the same 30+ rows whether you're in workspace
`feat/CLPNSNS-92` or `experiment/refactor-auth`. The ticket chip in the header
is the one signal that already feels contextual; the panel below it does not.

The v2 redesign reorients the issue tracker around the **active workspace**.
The panel should answer, at a glance:

1. *What ticket am I implementing right now?* → an Active Ticket card.
2. *What's next in this project?* → a backlog filtered to the workspace's Jira
   project, with the active ticket excluded.

The cross-project view is not deleted — it moves to a quiet footer line that
opens a modal on demand. Contextual flow first; global view available, not
imposed.

A second motivation is structural. Today the panel lives only in the RUN
Companion (below `CompanionTerminals`). In TALK or REVIEW the user loses the
ticket context entirely — but the question "what am I working on?" is just as
relevant when reading conversation history or reviewing diffs. v2 lifts the
issue tracker block to the **top of the Companion**, always visible across all
modes.

## Goals (v2)

- **Active Ticket card** at the top of the Companion: key, status, summary,
  meta line (`STORY · HIGH · Epic: <name>`), open-in-Jira affordance. Compact
  density.
- **Project-scoped Backlog**: assigned-not-done tickets filtered to the
  workspace's Jira project, with the active ticket excluded.
- **Cross-mode visibility**: the issue tracker block is rendered above the
  mode-specific Companion content in TALK, RUN, **and** REVIEW.
- **Workspace ↔ ticket linkage** with three states (linked, auto-detected,
  dismissed) plus an unlinked default. Explicit manual link wins; dismissal
  hides the section but can be undone in a single click.
- **Per-Octopush-Project Jira mapping** stored explicitly so workspaces whose
  branch has no Jira key can still resolve the project (refactors,
  experiments, fixes).
- **Inline ticket picker** for "Vincular →" — no modal, store-first fuzzy
  match, fallback to an exact-key `get_issue` call.
- **Quiet error/empty states** — never a toast or modal for a read failure;
  last good list survives transient errors.

## Non-goals (v2)

- Writes to Jira (status transitions, comments, assignment changes).
- Multiple Jira accounts / multi-tenant.
- Sprint/board views, custom JQL editor.
- Cross-project bulk operations.
- Dependency graph (blocks / blocked-by).
- Ticket creation from Octopush.
- Drag-to-reorder of the backlog.
- Additional tracker adapters (Linear, GitHub Issues) — the `IssueTracker`
  seam still permits them.
- Auto-mapping by learning from past branches (explicit override only).

## Architecture

### Data model

Two SQLite tables gain a column each; the frontend types pick up the same
fields in camelCase.

```
projects:    + jira_project_key TEXT NULL
workspaces:  + linked_issue_key TEXT NULL
             + issue_link_dismissed INTEGER NOT NULL DEFAULT 0
```

Frontend types (`src/lib/types.ts`):

```ts
interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  jiraProjectKey: string | null;   // NEW — explicit override
}

interface Workspace {
  // existing fields…
  linkedIssueKey: string | null;        // NEW — manual link
  issueLinkDismissed: boolean;          // NEW — "no ticket here"
}
```

### Linkage state machine

A single pure resolver decides how to interpret a workspace's linkage. It
runs in the frontend and (later) the MCP backend; both consume the same
inputs.

```ts
type LinkageState =
  | { kind: "linked";    key: string; source: "manual" }
  | { kind: "linked";    key: string; source: "detected" }
  | { kind: "dismissed" }
  | { kind: "unlinked" };

function resolveLinkage(ws: Workspace, branch: string): LinkageState {
  if (ws.linkedIssueKey)          return { kind: "linked", key: ws.linkedIssueKey, source: "manual" };
  const detected = detectIssueKey(branch);
  if (detected)                    return { kind: "linked", key: detected, source: "detected" };
  if (ws.issueLinkDismissed)       return { kind: "dismissed" };
  return { kind: "unlinked" };
}
```

`dismissed` is checked **after** `detectIssueKey` so a branch rename that
introduces a key reactivates the card without forcing the user to undismiss.

### Project resolver

```ts
function resolveJiraProjectKey(
  project: ProjectInfo,
  workspace: Workspace,
  branch: string,
): string | null {
  if (project.jiraProjectKey) return project.jiraProjectKey;
  const linkage = resolveLinkage(workspace, branch);
  if (linkage.kind === "linked") {
    return linkage.key.split("-")[0]; // "CLPNSNS-92" → "CLPNSNS"
  }
  return null;
}
```

Order matters: a per-project explicit override beats inference from the
branch, because the override is the user's stated truth.

### Companion structure (cross-mode)

The Companion sidebar moves from "everything is mode-conditional" to "issue
tracker block lives at the top; mode-specific content sits below":

```
┌──────────────────────────────┐
│ § ACTIVE TICKET   [collapsible]   ← always rendered
├──────────────────────────────┤
│ § BACKLOG · <PROJECT> · N   [collapsible]   ← always rendered
├──────────────────────────────┤
│ ↳ N en otros proyectos       ← always rendered (when N > 0)
├══════════════════════════════┤
│ Mode-specific content:       │
│   RUN, TALK, REVIEW          │
│   (existing per-mode content │
│    rendered below, unchanged)│
└──────────────────────────────┘
```

The mode-specific content keeps whatever each mode renders today (RUN has
`CompanionTerminals` plus any other RUN-only blocks; TALK and REVIEW keep
their current internals). The change is structural: the issue tracker block
is **lifted out** of the `mode === "run"` conditional and rendered above the
mode-specific block in every mode.

Sections are independently collapsible; the existing `BacklogPanel` collapse
behavior is preserved and `ActiveTicketPanel` gains the same affordance.

### UI — `ActiveTicketPanel` (new)

Component file: `src/components/ActiveTicketPanel.tsx`.

States and what they render:

- **linked** (manual or detected): the card.
  - Header row: `◈` (brass) · `KEY` (`text-octo-brass font-mono`) · status name (`text-octo-mute`, right-aligned) · open-in-Jira icon (`↗`).
  - Summary line: `text-octo-ivory`, single line, can wrap to 2 if needed.
  - Meta line: `font-mono text-[9px] uppercase tracking-[0.1em] text-octo-mute`.
    Format: `TYPE · PRIORITY · Epic: <parentSummary>` — `Epic:` value is brass.
    The parent summary is resolved via `parentIssuesStore` (one
    `get_issue(parentKey)` per unique parent, cached).
  - Background uses the active-row idiom from `CompanionTerminals`:
    `border-left: 1px solid var(--brass-dim)`, `background: var(--brass-ghost)`.
- **unlinked**: empty state inside the section body.
  - Two inline affordances: `[Vincular →]` (brass) and `[No usar ticket aquí]` (mute).
- **dismissed**: section eyebrow stays, body collapses to a single mute line
  `↳ + Vincular ticket` which un-dismisses on click.
- **error** (linked but `get_issue` failed): error card `KEY · no se pudo cargar  [Desvincular]`.

### UI — Inline ticket picker (replaces unlinked body when invoked)

When the user clicks `Vincular →`, the empty state is replaced in place by:

- Scope toggle (mono pills): `<PROJECT>` (default — fuzzy-matches only
  tickets in the resolved project) · `Todos` (fuzzy-matches across every
  assigned-not-done ticket in `issuesStore`). Both modes search the cached
  list — no network call per keystroke.
- Input row: `⟶` glyph (brass) · text input (mono, hairline border, brass on focus) · `ESC` cancel.
- Keyboard hint line: `↑↓ navegar · ↵ seleccionar · ESC cancelar`.
- Results: up to 8 rows of cached assigned tickets fuzzy-matched on `key + summary`. First row pre-highlighted. Rows mirror the Backlog row idiom (dot, key brass mono, summary sage truncated, status mute mono).
- **Exact-key fallback**: when the query matches `^[A-Z][A-Z0-9]+-\d+$` and no result matches, a single fallback row appears under a dashed divider: `KEY · (no asignado a ti — se verificará al vincular) · USE →`. Confirming triggers one `get_issue(key)` call before persisting the link.

Confirming the picker:
1. Persist `workspace.linkedIssueKey = key` via the backend command.
2. Close the picker (≤220ms fade); the card renders.
3. If the chosen ticket is not in `issuesStore.issues`, populate `parentIssuesStore` / a small per-key cache so the card has data immediately.

### UI — `BacklogPanel` (rewired, not rewritten)

The existing component stays. The changes:

- Eyebrow: `§ BACKLOG · <PROJECT> · <count>` when a project is resolved.
  When unresolved: `§ BACKLOG · (sin proyecto)`.
- Body filters via the `selectBacklog` selector (project-scoped, active
  ticket excluded). Sort: `statusCategory` first (`inProgress` → `todo` →
  `unknown` → `done`), then by `priority` if Jira provides it (Highest →
  High → Medium → Low → Lowest → none), then `key` ascending for stability.
  Honors v1's `ORDER BY status, priority` JQL intent on the client.
- Empty body when no project: `Sin proyecto Jira vinculado para este Octopush
  Project. [Vincular proyecto →]` (link opens Settings → Issue Tracker →
  Project Mappings focused on this project's row).
- Empty body when project resolved but list is empty:
  `Backlog limpio en este proyecto ✓` (verdigris check).
- Error state (refresh failed, last good list retained): a single mute
  `no se pudo refrescar` line above the list; refresh button stays visible.

### UI — Cross-project footer

A small mute row rendered below the BACKLOG section when
`selectElsewhereCount() > 0`:

```
↳ N tickets in-progress en otros proyectos
```

Click opens a modal (or full-screen panel) listing every assigned, not-done
ticket grouped by project. Reuses the same Issue row treatment. The modal
exists outside the Companion and is the only place the global view lives.
Hidden entirely when the count is zero.

### UI — `ContextHeader` chip (extended)

Visual unchanged. Behavior consumes `resolveLinkage`:

- `linked` (either source) → chip shown with that key.
- `dismissed` → chip hidden.
- `unlinked` → chip hidden.

### UI — Settings → Integrations → Issue Tracker → Project Mappings (new sub-section)

Below the existing credentials section, a new sub-section "Project Mappings":

- One row per Octopush Project: project name + monospace input for `Jira
  project key`.
- Pre-fills inferred values from the **most recent workspace's**
  branch-detected key in that Octopush Project (e.g. if the latest workspace
  was `feat/CLPNSNS-92-…`, the field pre-fills `CLPNSNS`). Inference is a
  hint — the field is editable and an empty value means "fall back to
  branch detection per workspace".
- Save persists each row independently via `update_project_jira_key(project_id, key)`.

## Data flow + caching

- **Single global query** for backlog: `list_my_issues()` (unchanged JQL, no
  project filter). Bumped `maxResults` from 50 → 100. Backend stays untouched
  on the search endpoint.
- `issuesStore` (existing) holds the full assigned-not-done list.
- `parentIssuesStore` (new, tiny): `Map<string, Issue>` with a single
  `loadParent(key)` that does one `get_issue` and caches.
- **No re-fetch on workspace switch** — selectors recompute over the same
  global list.
- **Refresh** is on Companion mount + manual refresh button. No polling.
- **After picker confirms a link**: no global re-fetch (the global list already
  has the issue if assigned; otherwise the fallback `get_issue` populated a
  per-key cache).

## Selectors (pure, testable, single source of truth)

All four live in `src/lib/issueTrackerSelectors.ts`:

```ts
function resolveLinkage(ws, branch): LinkageState;
function resolveJiraProjectKey(project, ws, branch): string | null;

function selectBacklog(
  allIssues: Issue[],
  projectKey: string | null,
  activeKey: string | null,
): Issue[];

function selectElsewhereCount(
  allIssues: Issue[],
  projectKey: string | null,
): number;
```

Properties:
- All pure: same inputs → same output, no IO.
- Backlog filter: `i.key.startsWith(projectKey + "-") && i.key !== activeKey`.
- Elsewhere count: `i => !i.key.startsWith(projectKey + "-") && i.statusCategory === "inProgress"`.
- When `projectKey === null`, `selectBacklog` returns `[]` (the panel renders
  the "no project" empty state from the section, not from the selector).

## Error + empty states

| Situation | Active Ticket section | Backlog section | Chip |
|---|---|---|---|
| No credentials | hidden | `Conecta Jira en Settings →` | hidden |
| `unlinked` | empty state with `[Vincular →] [No usar ticket aquí]` | normal (if project resolved) | hidden |
| `dismissed` | eyebrow + 1-line `↳ + Vincular ticket` | normal | hidden |
| No project resolved | depends on linkage | `Sin proyecto Jira vinculado [Vincular proyecto →]` | per linkage |
| `linked` but `get_issue` 4xx | error card `[Desvincular]` | normal | hidden |
| Refresh failed | last cached card | `no se pudo refrescar` above last good list; refresh stays | last good chip |
| Backlog empty (project resolved) | normal | `Backlog limpio en este proyecto ✓` | normal |
| `elsewhere` count = 0 | — | — (footer row not rendered) | — |

Cross-cutting: no toasts on read failures; the only toast remains Settings
Save. Errors in one section never blank out another.

## Backend — API surface

New Tauri commands (in `src-tauri/src/commands.rs`):

- `update_workspace_link(workspace_id: String, linked_issue_key: Option<String>, dismissed: bool) -> AppResult<()>`
- `update_project_jira_key(project_id: String, jira_project_key: Option<String>) -> AppResult<()>`

Unchanged:
- `list_my_issues() -> Vec<Issue>` (no project filter).
- `get_issue(key) -> Issue`.
- `get_issue_tracker_config()` / `save_issue_tracker_config()`.

Both new commands hit `db.rs` directly; no Jira round-trip.

## Migrations

A single migration in `src-tauri/src/db.rs` (or wherever the schema lives),
idempotent:

```sql
ALTER TABLE projects   ADD COLUMN jira_project_key       TEXT;
ALTER TABLE workspaces ADD COLUMN linked_issue_key       TEXT;
ALTER TABLE workspaces ADD COLUMN issue_link_dismissed   INTEGER NOT NULL DEFAULT 0;
```

Each column-add is wrapped in a "column exists?" check so re-running the
migration is safe. Existing rows get the column default (`NULL` / `0`),
which corresponds to "no override / not dismissed" — the v2 unlinked
default behavior.

## Design-system alignment (Atelier in Onyx & Brass)

- Tokens only (`text-octo-*`, `bg-octo-*`, `border-octo-*`, CSS vars `--brass-dim`, `--brass-ghost`). No new tokens.
- No italics anywhere — `em, i { font-style: normal }` in `styles.css` already enforces this; the user's persistent preference overrides the design system's italic-serif rule.
- Brass surgical: `◈`, ticket key, scope-pill active state, picker `⟶` glyph, focused input border, refresh affordance hover, `Vincular →` action text. Everything else is onyx/panel/sage/mute. Status dots map to existing tokens (Todo→mute, InProgress→brass, Done→verdigris, Unknown→sage) — same as v1.
- Motion calm: section collapse, picker open/close, error → recovered transitions all ≤280ms `cubic-bezier(0.2, 0.8, 0.3, 1)`.
- No new top-level chrome. The cross-project modal reuses the existing modal idiom (same wrapper styles as Settings).
- Eyebrow style across all three new sections matches the existing eyebrow class verbatim (`font-mono text-[9px] uppercase tracking-[0.25em] text-octo-mute`).

## Testing

**Selectors (vitest, pure):**
- `resolveLinkage` truth table: linked (manual) wins; detected when no manual + branch has key; dismissed only when nothing else applies; unlinked otherwise. Including: `dismissed` + branch with key → still `linked` (detected).
- `resolveJiraProjectKey`: override wins; falls back to linkage prefix; null when neither.
- `selectBacklog`: filters by project prefix, excludes active key, returns sorted by JQL-equivalent order (status, priority).
- `selectElsewhereCount`: counts only inProgress outside the active project.

**Components (vitest + Testing Library):**
- `ActiveTicketPanel`: linked / unlinked / dismissed / error states render correctly; `Vincular →` swaps to picker; `No usar ticket aquí` calls `update_workspace_link` with `dismissed: true`; open-in-Jira calls `ipc.openFileInSystem(url)`.
- `InlineTicketPicker`: keyboard nav (↑↓, ↵, ESC); exact-key fallback only when query matches the regex; scope toggle filters the candidate list; cancel returns to previous state without mutating.
- `BacklogPanel` (rewired): project-scoped eyebrow + count; active key excluded; empty/error/unresolved states; refresh button intact.
- `ElsewhereFooter`: renders only when count > 0; click opens the global modal.

**Backend (cargo test):**
- `update_workspace_link` round-trip via `db.rs`.
- `update_project_jira_key` round-trip.
- Migrations: schema after `migrate()` contains the new columns; running `migrate()` twice doesn't error.

**Cross-mode integration:**
- The new Companion structure renders the issue tracker block in TALK, RUN, and REVIEW (a single test that switches modes via the store and asserts the block is present each time).

## MCP synergy

The contextual model the v2 design defines — `(workspace.linkedIssueKey,
resolvedProjectKey, activeIssue, backlogForThisProject)` — is the exact
shape the Octopush MCP server will expose to the terminal agent as
resources/tools. The selectors and resolver functions live in pure modules
that the MCP can reuse without touching the UI layer.

Concretely, the MCP will expose:
- `current_ticket` resource → `resolveLinkage(currentWorkspace, branch)`.
- `current_project_backlog` tool → `selectBacklog(allIssues, projectKey, activeKey)`.
- `elsewhere_in_progress` tool → assigned-not-done in other projects.

No additional design work needed when the MCP lands — the seams already match.

## Out of scope / future

- Status transitions (`Move to In Review`, `Move to Done`) — first natural
  write surface; likely v3.
- Last 1-2 comment previews in the active card.
- Refresh on detected activity (PR merged, status change) — needs webhooks
  or smart polling.
- Conflict warning: branch key `CLPNSNS-92` vs manual link `CLPNSNS-105`.
- Auto-mapping by learning from past branches (deferred; explicit-only for now).
