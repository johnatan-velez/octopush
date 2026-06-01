# Active Ticket in the header — design

**Date:** 2026-06-01
**Status:** Approved (pending spec review)
**Supersedes (partially):** `2026-05-30-issue-tracker-contextual-design.md` — moves the Active Ticket presentation from the Companion sidebar to the top header.

## Motivation

The current `ContextHeader` shows the project name and the workspace name as
its primary identity. Both are already in the left Rail (the project as a
section header, the workspace as a row). Beside them sits a small ticket chip
`◈ KEY · status`. The same ticket lives, with richer detail, in the Companion
sidebar's `ACTIVE TICKET` section. Two premium spaces — the header band and
the top of the Companion — duplicate each other while the workspace's real
identity ("what problem am I solving, on which ticket") stays compressed.

The redesign reorients the header around the **active ticket**. A single
horizontal row presents `◈ KEY · STATUS · summary` taking nearly the full
width to the left of the branch/PR/mode group. The `ACTIVE TICKET` section
leaves the Companion (the Backlog and Elsewhere footer stay). The project
identity disappears from the header — it is unambiguous in the Rail.

A secondary cleanup falls out of the change: the `ProjectSwitcher` modal
duplicated the Rail's listing of projects and added friction (open modal →
click → close). It is removed entirely. The Rail is the only project picker.

## Goals (v1)

- The `ContextHeader` shows `◈ KEY · STATUS · summary` in a single row when
  the active workspace has a resolved ticket. Same height as today.
- When no ticket is linked (`unlinked`, `dismissed`, or `activeIssue` not
  yet loaded), the header degrades to `WORKSPACE name` + branch/PR/mode —
  the workspace identity surfaces only when there is no ticket to display.
- Remove the project chip from the header. Remove the `ProjectSwitcher`
  modal entirely. The Rail covers project switching.
- Remove `ActiveTicketPanel` from the Companion. Backlog + Elsewhere
  footer stay.
- Click the ticket area in the header → open Jira (`ipc.openFileInSystem`).
- Tooltip on the ticket area carries the meta line lost in compact mode
  (`KEY · TYPE · PRIORITY · Epic: <parent> · <summary>`).

## Non-goals (v1)

- Inline "Change ticket / Unlink ticket" affordances in the header (these
  live in the workspace's right-click menu in the Rail, per the v0.1.30
  decision).
- Tooltip with multi-line summary or rich content beyond a `title` attr.
- Showing epic / parent ticket detail in the header beyond the tooltip.
- A keyboard-driven project picker (Cmd+P palette) to replace the removed
  switcher. Deferred until the Rail's project list grows past a single
  viewport in observed use.
- Reorganization of the Rail itself.

## Architecture

### `ContextHeader.tsx` — props and rendering branches

```ts
interface Props {
  workspaceName: string;                  // used in the degraded branch
  branch: string;
  gitStatus: GitStatus | null;
  openPr: OpenPr | null;
  onOpenPr?: (url: string) => void;
  workspace: Workspace | null;
  issueTrackerConfigured?: boolean;
  rightSlot?: ReactNode;
}
```

Removed props (versus today): `projectName`, `onOpenProjectSwitcher`.

Internal derivations (unchanged from v0.1.30):

```ts
const linkage = workspace
  ? resolveLinkage(workspace, branch)
  : { kind: "unlinked" as const };
const activeKey =
  linkage.kind === "linked" && issueTrackerConfigured ? linkage.key : null;
const activeIssue = useActiveIssue(activeKey);
```

The render branches on `activeIssue`:

- **`activeIssue` truthy** → ticket layout (Section "Ticket layout" below).
- **`activeIssue` null or undefined** → degraded layout (Section "Degraded
  layout" below). Covers `unlinked`, `dismissed`, `linked` while
  `useActiveIssue` is still resolving, and `linked + ticket not found`.

The wrapper stays `m-4 flex items-center gap-4 rounded-xl border border-octo-hairline bg-octo-panel px-4 py-2`.

### Ticket layout (active ticket present)

Single horizontal row, two flex groups:

**Left group** (flex 1, `min-w-0` so the summary can truncate):

```tsx
<button
  type="button"
  onClick={() => ipc.openFileInSystem(activeIssue.url).catch(() => {})}
  title={`${activeIssue.key} · ${activeIssue.issueType.toUpperCase()}` +
    (activeIssue.priority ? ` · ${activeIssue.priority.toUpperCase()}` : "") +
    (parentSummary ? ` · Epic: ${parentSummary}` : "") +
    ` · ${activeIssue.summary}`}
  className="flex min-w-0 flex-1 items-center gap-2.5 rounded px-1 -mx-1 transition hover:bg-[var(--brass-ghost)]"
>
  <span className="text-octo-brass" aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>◈</span>
  <span className="font-mono text-[12px] text-octo-brass">{activeIssue.key}</span>
  <span className={`font-mono text-[10px] uppercase tracking-[0.15em] ${statusToken(activeIssue.statusCategory)}`}>
    {activeIssue.statusName}
  </span>
  <span className="h-[14px] w-px bg-octo-hairline" aria-hidden />
  <span className="min-w-0 truncate font-serif text-[15px] leading-tight text-octo-ivory">
    {activeIssue.summary}
  </span>
</button>
```

Where `statusToken` maps:

```ts
const STATUS_TOKEN: Record<StatusCategory, string> = {
  inProgress: "text-octo-brass",
  todo: "text-octo-mute",
  done: "text-octo-verdigris",
  unknown: "text-octo-sage",
};
```

`parentSummary` resolves as `parents[activeIssue.parentKey]?.summary` from
`useParentIssuesStore`. The `useEffect` that triggers
`loadParent(activeIssue.parentKey)` moves from `ActiveTicketPanel` to
`ContextHeader` unchanged. When the parent has not loaded yet (or the
issue has no parent), the tooltip's `Epic: <…>` segment is omitted.

**Right group** (`flex-shrink-0`, `gap-4`):

- Branch line (mute mono, with verdigris status dot): unchanged from today.
- PR chip if `openPr`: unchanged from today.
- Hairline divider (`h-6 w-px bg-octo-hairline`).
- `ScratchpadIcon` + `rightSlot` (mode switcher).

### Degraded layout (no active ticket)

Same wrapper. Same right group. Left group becomes:

```tsx
<div className="flex min-w-0 flex-col gap-0.5">
  <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-octo-brass">
    Workspace
  </div>
  <div
    key={workspaceName}
    className="animate-name-in font-serif text-[15px] leading-tight tracking-[-0.005em] text-octo-ivory"
  >
    {workspaceName}
  </div>
</div>
```

This is the existing workspace block from today's header, kept intact (the
`animate-name-in` reaction on workspace switch is preserved). Not a button —
nothing to click; the workspace is already active.

### Companion changes

`src/components/Companion.tsx` stops rendering `<ActiveTicketPanel>`. The
`useIssuesStore` subscription, `resolveLinkage`, `resolveJiraProjectKey`, and
`selectElsewhereCount` selectors stay because `BacklogPanel` and
`ElsewhereFooter` still consume them.

The gate for the Companion's Jira block becomes
`issueTrackerConfigured && workspace && project && projectKey !== null`
(unchanged from v0.1.30) — and inside it: BacklogPanel + ElsewhereFooter
only.

### Files removed

- `src/components/ProjectSwitcher.tsx` + `.test.tsx`.
- `src/components/ActiveTicketPanel.tsx` + `.test.tsx`.

The `ActiveTicketPanel` removal is YAGNI: the header carries the same
information, the panel has no other call site, and the linked/unlinked/
dismissed/error state machine moves cleanly into the header's binary
branch (active vs degraded). The store hooks (`useParentIssuesStore`,
`useIssuesStore`) stay — they have other consumers.

### `App.tsx` changes

- Remove the import + `showProjectSwitcher` state + the `<ProjectSwitcher>`
  render block.
- Remove the `onOpenProjectSwitcher` prop from `<ContextHeader>` and the
  `projectName={project.name}` prop. The remaining call site keeps
  `workspaceName`, `branch`, `gitStatus`, `openPr`, `onOpenPr`, `workspace`,
  `issueTrackerConfigured`, `rightSlot`.
- Update `<EmptyProjectState>`: drop the `onSwitchProject` prop pass-through.

### `EmptyProjectState.tsx` changes

- Remove the `onSwitchProject` prop + the "Switch project" button.
- Replace with a single mute footer line: `Or pick another project from
  the rail`.

## Data flow

- The header reads `workspace` and derives the linkage via
  `resolveLinkage(workspace, branch)`. No new IPC calls.
- `useActiveIssue(activeKey)` (the existing hook) prefers the global
  `issuesStore.issues` and falls back to a single `ipc.getIssue(key)` call
  per key change. Unchanged.
- `useParentIssuesStore.loadParent(parentKey)` runs in a `useEffect` keyed
  on `activeIssue?.parentKey` to fill the tooltip's Epic value when present.
- Companion still pulls `issues` from `useIssuesStore()` to feed
  `BacklogPanel` and to compute `elsewhereCount`.

## Edge cases

| Situation | Header renders |
|---|---|
| `issueTrackerConfigured === false` | Degraded (workspace name + branch). |
| `workspace === null` | Degraded with `workspaceName` from the prop (could be empty if no workspace selected; the existing higher-level gate `activeWorkspace && <ContextHeader …>` prevents this). |
| `linkage.kind === "unlinked"` | Degraded. |
| `linkage.kind === "dismissed"` | Degraded. |
| `linkage.kind === "linked"` and `useActiveIssue` returns `null` (first paint, store loading, or `get_issue` failure) | Degraded. The header never flashes an error card — the failure surface lives in the workspace's right-click affordances. |
| `linkage.kind === "linked"` and issue loaded | Ticket layout. |

## Design-system alignment (Atelier in Onyx & Brass)

- Tokens only. No new colors. No italics. No `Spectral` font. UI strings in
  English (the only new strings are `Workspace` eyebrow text — same as today
  — and the tooltip body).
- Brass is surgical: `◈` glyph, the `KEY` text, the `STATUS_NAME` only when
  `inProgress`, the hover background on the ticket button. The summary uses
  `text-octo-ivory` (content, not accent). The right-group brass usage (PR
  chip, mode switcher active state, eyebrow) is unchanged from today.
- Motion: existing 220ms transition on hover background.
- No new top-level chrome. The header band remains the same single rounded
  card.
- `--brass-glow` (introduced for the inline picker highlight) is not used
  by the header — `--brass-ghost` is the hover token, consistent with the
  rest of the chip family.

## Testing

**`ContextHeader.test.tsx`** — adapt the existing 13 tests by dropping
`projectName` and `onOpenProjectSwitcher` from their render arguments. Add
the following tests:

1. With `activeIssue` set, the header renders `◈`, the key, the status, and
   the summary; no `WORKSPACE` eyebrow.
2. With `linkage.kind === "linked"` but `activeIssue === null`, the header
   renders the degraded layout (workspace name + branch).
3. With `linkage.kind === "unlinked"`, the header renders the degraded
   layout.
4. Click on the ticket button calls `ipc.openFileInSystem` with
   `activeIssue.url`.
5. The status span carries `text-octo-brass` when `inProgress`,
   `text-octo-verdigris` when `done`, `text-octo-mute` when `todo`,
   `text-octo-sage` when `unknown`. Four sub-cases or one parametric test.

**`Companion.test.tsx`** — drop the `ActiveTicketPanel` test-id assertion
from the 3 cross-mode tests. The block still asserts `BacklogPanel` +
`ElsewhereFooter` are present per mode.

**`EmptyProjectState.test.tsx`** — adjust to assert the "Switch project"
button is absent and the "pick another project from the rail" footer is
present.

**Deletions** — `ProjectSwitcher.test.tsx`, `ActiveTicketPanel.test.tsx`
(13 tests gone).

**Expected suite delta:** roughly `+5 (new ContextHeader) - 13 (deletions)
= -8` tests in absolute count. No behavioral regression: the deleted tests
covered the `ActiveTicketPanel` linkage state machine, which now lives in
the binary branch of `ContextHeader` and is covered by tests 1–3 above.

## Out of scope / future

- Inline ticket-change controls in the header.
- Multi-line rich tooltip (Floating UI-based hover card with summary +
  description preview + comments count).
- Keyboard-driven project picker (Cmd+P palette) to replace the removed
  switcher.
- Showing epic / parent ticket detail in the header beyond the `title` attr.
- Header redesign for workspaces whose ticket changes status while open
  (the status text re-renders on the next `issuesStore` refresh — already
  works; just noting it's not animated specifically).
