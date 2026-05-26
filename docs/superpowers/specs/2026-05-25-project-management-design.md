# Project Management Feature — Design Spec

**Date:** 2026-05-25  
**Status:** Design Approved  
**Scope:** Close/delete projects from UI; add projects from WorkspaceRail

---

## Problem Statement

Currently, Octopush allows users to:
- **Create** projects (via NewProjectFlow)
- **Delete** workspaces (within projects)
- Switch between recent projects (via ProjectSwitcher modal)

But users **cannot:**
- Remove/close a project from the recent list (projects accumulate)
- Delete a project from disk
- Customize project properties (name alias, visual tint)
- Add projects directly from the WorkspaceRail

This creates friction: projects pile up in the switcher, and there's no lightweight way to hide projects you're not using.

---

## Solution Overview

Implement **project-level management** mirroring workspace management:

1. **Add projects** via a button in the WorkspaceRail (bottom, above collapse)
2. **Customize projects** via right-click context menu (rename, tint)
3. **Close projects** (remove from recent list, keep on disk)
4. **Delete projects** (destructive, remove from disk entirely, requires confirmation with manual name entry)

Visual consistency: Same interaction model as workspace management (right-click → customize/delete).

---

## UI Design

### 1. WorkspaceRail — Bottom Section

**New Button: "◉ Add project"**
- Position: Bottom of rail, above "Collapse/Expand" button
- Expanded: Shows "◉ Add project"
- Collapsed: Shows only "◉" icon
- Action: Triggers `onAddProject()` → opens NewProjectFlow
- Styling: Same as existing "New workspace" button for consistency

**Example layout (expanded):**
```
┌─────────────────────────────────┐
│ — Project 1                    │ ← project header (right-clickable)
│  • Workspace A                 │
│  • Workspace B                 │
├─────────────────────────────────┤
│ — Project 2                    │
│  • Workspace C                 │
├─────────────────────────────────┤
│ ◉ Add project                  │ ← NEW
├─────────────────────────────────┤
│  ▼ Collapse                    │ ← existing
└─────────────────────────────────┘
```

### 2. Project Context Menu

**Right-click on project header** (e.g., "— My Project") shows menu with 8 options:

**Active options (Level 1 — Implemented):**
1. "Rename project"
2. "Change tint"

**Disabled (Coming soon):**
3. "Project settings"
4. "Default agent model"
5. "Tool permissions"
6. "Workspace presets"

**Destructive options:**
7. --------separator--------
8. "Close project" (removes from recent list)
9. "Delete project from disk" (destructive)

Styling: Disabled items show grayed-out text + "Coming soon" tooltip on hover.

### 3. Project Customize Modal

**Triggered by:** Right-click → "Rename project" OR "Change tint"

**Layout:** Same as `WorkspaceCustomizeMenu`
- Text input: Project name (for alias/rename)
- Tint picker: 9 color options (same palette as workspaces)
- Buttons: "Save", "Cancel"

**Behavior:**
- Input pre-filled with current project name
- Tint shows current selection
- "Save" updates project and closes modal
- "Cancel" closes without saving

### 4. Delete Confirmation Dialog

**Triggered by:** Right-click → "Delete project from disk"

**Layout:**
```
╔════════════════════════════════════╗
║  Delete Project Permanently?       ║
╟────────────────────────────────────╢
║  ⚠️  This will permanently delete   ║
║  "My Project" and ALL its          ║
║  workspaces from disk.             ║
║                                    ║
║  Type the project name to confirm: ║
║  [____________] (input required)   ║
║                                    ║
║  [Cancel]          [Delete] (x)    ║
║                                    ║
║  x = disabled until user types     ║
║      exact project name            ║
╚════════════════════════════════════╝
```

**Behavior:**
- Input initially empty
- "Delete" button disabled until user types **exact** project name
- If user types wrong name, button stays disabled
- "Cancel" closes dialog (no changes)
- "Delete" triggers destructive action

---

## Data Flow

### Load Phase (App startup)
1. `loadRecentProjects()` fetches project list from backend
2. Frontend loads customizations from localStorage (name, tint)
3. If localStorage and backend diverge, localStorage wins (assumed more recent)
4. WorkspaceRail renders with customized names/tints

### Rename/Tint Update
1. User opens modal, edits name/tint, clicks "Save"
2. Frontend saves to localStorage **immediately** (optimistic UI)
3. Parallel: IPC call `updateProjectCustomization(projectId, name, tint)` to backend
4. Backend persists to DB
5. If IPC fails: localStorage is still source of truth for this session
6. Rail re-renders with updated values

### Close Project
1. User right-clicks → "Close project"
2. Confirmation: "Remove from recent list?" (lightweight, no extra dialog)
3. IPC call: `closeProject(projectId)`
4. Backend removes from recent projects DB
5. Frontend updates `projectStore.recent` list
6. Rail re-renders, project disappears

### Delete Project from Disk
1. User right-clicks → "Delete project from disk"
2. ConfirmDialog appears with warning + manual name entry
3. User types exact project name
4. User clicks "Delete"
5. IPC call: `deleteProject(projectId)` 
6. Backend:
   - Deletes project directory from disk
   - Removes all associated worktrees
   - Removes from recent projects DB
7. Frontend:
   - Updates `projectStore.recent` list
   - If deleted project was current: redirect to WelcomeScreen (via `projectStore.close()`)
   - Rail re-renders
8. User sees confirmation toast: "Project deleted"

---

## State Management

### App.tsx New State
```typescript
const [showProjectCustomizer, setShowProjectCustomizer] = useState(false);
const [customizingProjectId, setCustomizingProjectId] = useState<string | null>(null);
const [customizingMode, setCustomizingMode] = useState<'rename' | 'tint'>('rename');
const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
```

### ProjectStore Updates
- No changes to existing state
- New methods will be in backend (via IPC)

### localStorage Schema
```json
{
  "projectCustomizations": {
    "project-id-1": {
      "name": "My Alias",
      "tint": "brass"
    },
    "project-id-2": {
      "name": "Another Project",
      "tint": "sage"
    }
  }
}
```

---

## Backend (Rust) IPC Methods

### 1. `updateProjectCustomization(projectId, name?, tint?)`
- Updates project name and/or tint in database
- If `name` is null: only update tint
- If `tint` is null: only update name
- Returns: Updated project info
- Error: Project not found

### 2. `closeProject(projectId)`
- Removes project from recent projects list
- Does NOT delete from disk
- Returns: void
- Error: Project not found

### 3. `deleteProject(projectId)`
- **Destructive:** Deletes project directory and all workspaces
- Removes from recent projects DB
- Returns: void
- Error: Project not found, cannot delete (permission error, etc.)

---

## Component Changes

### New Components

**`ProjectContextMenu.tsx`**
- Similar to `WorkspaceContextMenu`
- Props: `projectId`, `x`, `y`, `onRename`, `onChangeTint`, `onClose`, `onDelete`
- Renders menu with 8 options (2 active, 6 disabled with "Coming soon")
- Click handlers call parent callbacks

**`ProjectCustomizeMenu.tsx`**
- Similar to `WorkspaceCustomizeMenu`
- Props: `projectId`, `mode` ('rename' | 'tint'), `onCustomized`, `onCancel`
- State: `name`, `tint` (pre-filled from current project)
- Save handler: calls `ipc.updateProjectCustomization()` + localStorage update

### Modified Components

**`WorkspaceRail.tsx`**
- New prop: `onAddProject()` callback
- New prop: `onProjectContextMenu(projectId, x, y)` callback
- New button: "◉ Add project" (bottom, above collapse)
- Right-click handler on project headers → calls `onProjectContextMenu()`

**`App.tsx`**
- New state: `showProjectCustomizer`, `customizingProjectId`, `customizingMode`, `deletingProjectId`
- New handlers: `handleAddProject()`, `handleProjectContextMenu()`, `handleRenameProject()`, `handleChangeTint()`, `handleCloseProject()`, `handleDeleteProject()`, `handleProjectCustomized()`
- Pass new callbacks to WorkspaceRail
- Render ProjectContextMenu, ProjectCustomizeMenu, ConfirmDialog for delete

**`ConfirmDialog.tsx`**
- New optional prop: `requireInput?: string` (exact text user must type to enable confirm)
- If provided, show input field and disable confirm button until match
- Used for delete confirmation

---

## Error Handling

| Error | UI Response |
|-------|------------|
| IPC `updateProjectCustomization` fails | Toast: "Failed to save project changes". Keep localStorage value. |
| IPC `closeProject` fails | Toast: "Failed to close project". Project remains in list. |
| IPC `deleteProject` fails | Toast: "Failed to delete project". Reason in error message. |
| Project not found (stale projectId) | Toast: "Project no longer exists". Remove from UI. |

---

## Testing Strategy

### Unit Tests
- `ProjectContextMenu`: renders correct options, disabled state for "Coming soon"
- `ProjectCustomizeMenu`: form validation, save callback, localStorage integration
- Handlers in `App.tsx`: state updates, IPC calls, error handling

### Integration Tests
- Right-click on project → menu appears at correct position
- Click "Rename" → modal opens with current name pre-filled
- Edit name → click "Save" → localStorage updated, rail re-renders
- Click "Close project" → project removed from recent list
- Click "Delete project" → confirmation dialog, require name entry, delete on confirm

### Manual Testing
- Add project from rail (via ◉ button)
- Rename project (verify localStorage + rail)
- Change project tint (verify affects all workspaces in that project)
- Close project (verify removed from switcher, but folder still exists on disk)
- Delete project (verify deleted from disk + rail, confirmation with name entry works)

---

## Rollout & Level 2/3 Expansion

This spec implements **Level 1 only** (Rename + Tint).

**Level 2 & 3 are stubbed** (disabled menu items with "Coming soon" tooltips):
- "Project settings"
- "Default agent model"
- "Tool permissions"
- "Workspace presets"

When implementing Level 2/3, add handlers to those menu items + corresponding IPC methods. No UI restructuring needed.

---

## Open Questions Resolved

✅ **Location of controls:** WorkspaceRail bottom  
✅ **Icon for "Add project":** Circled dot (◉)  
✅ **Customization options:** Rename + Tint (Level 1)  
✅ **Delete confirmation:** Manual name entry required  
✅ **Data persistence:** localStorage + backend DB  

---

## Success Criteria

- [ ] User can add projects from rail (◉ button works)
- [ ] User can rename project (right-click → "Rename" → modal → save → localStorage + DB)
- [ ] User can change project tint (right-click → "Change tint" → picker → save → all workspaces reflect tint)
- [ ] User can close project (right-click → "Close project" → removed from recent list, disk untouched)
- [ ] User can delete project (right-click → "Delete" → confirmation with manual name entry → deleted from disk + DB)
- [ ] Disabled menu items show "Coming soon" tooltip
- [ ] WorkspaceRail collapses to just "◉" icon for "Add project"
- [ ] All error cases handled with toasts

---

## References

- Existing: `WorkspaceCustomizeMenu.tsx` (styling/pattern reference)
- Existing: `WorkspaceContextMenu.tsx` (context menu pattern)
- Existing: `ConfirmDialog.tsx` (base for delete confirmation)
- Design System: Tint palette from `src/lib/tokens.ts` (use same 9 colors as workspaces)
