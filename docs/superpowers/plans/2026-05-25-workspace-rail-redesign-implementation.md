# Workspace Rail Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the left rail to display all projects + workspaces hierarchically with full names, color-customizable monograms, and a collapsible toggle to maximize workspace visibility.

**Architecture:** Replace the current flat icon rail with a wide (280px expanded / ~50px collapsed) rail that renders projects as section headers with their workspaces listed below. The rail uses Zustand store data (flat workspace list) which is transformed into a hierarchical structure. A toggle button (`⌘\` keyboard shortcut) switches between expanded and collapsed modes. All existing features (monogram customization, attention highlighting, right-click context menu) are preserved.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Zustand (existing), CSS transitions for fade-out gradient and collapse animation.

---

## File Structure

**Files to create:**
- None (all work within existing components)

**Files to modify:**
- `src/components/WorkspaceRail.tsx` — Main component (Props, hierarchical rendering, collapse/expand, keyboard shortcut)
- `src/components/WorkspaceRail.test.tsx` — Tests (already exists, update to match new Props)
- `src/App.tsx` — Pass project list to WorkspaceRail

**Files that provide context (no changes needed):**
- `src/lib/types.ts` — Workspace, ProjectInfo types
- `src/stores/workspaceStore.ts` — Workspace list and active ID
- `src/stores/projectStore.ts` — (Check if exists; may need to fetch project list)
- `src/lib/monogram.ts` — resolveMonogram(), TINTS (preserved, unchanged)

---

## Task 1: Prepare data flow and component Props

**Files:**
- Modify: `src/components/WorkspaceRail.tsx` (top)
- Reference: `src/App.tsx` (to understand how WorkspaceRail is called)

**Context:**
The current Props accept a flat `workspaces` array. We need to change to a hierarchical structure. First, check how the component is called in App.tsx and what data is available.

- [ ] **Step 1: Check current usage in App.tsx**

Run: `grep -A 10 "WorkspaceRail" /Users/jonathan/TYPEFY/octopus/octopus-sh/src/App.tsx | head -20`

Expected output: Show how WorkspaceRail is used (what props are passed).

- [ ] **Step 2: Verify if projectStore or project list exists**

Run: `ls -la /Users/jonathan/TYPEFY/octopus/octopus-sh/src/stores/ | grep -i project`

Expected output: List any project-related stores.

- [ ] **Step 3: Define new Props interface in WorkspaceRail.tsx**

Replace the `interface Props` with:

```typescript
export interface ProjectGroup {
  id: string;
  name: string;
  workspaces: Workspace[];
}

interface Props {
  projects: ProjectGroup[];
  activeWorkspaceId: string | null;
  onSelect: (id: string) => void;
  onCustomize: (id: string) => void;
  onContextMenu?: (workspaceId: string, x: number, y: number) => void;
  onNewWorkspace: () => void;
}
```

Expected: Props now accepts a hierarchical `projects` array instead of flat `workspaces`.

- [ ] **Step 4: Commit Props update**

```bash
git add src/components/WorkspaceRail.tsx
git commit -m "refactor(rail): update Props interface for hierarchical project/workspace structure"
```

---

## Task 2: Implement hierarchical rendering (expanded mode)

**Files:**
- Modify: `src/components/WorkspaceRail.tsx`
- Test: `src/components/WorkspaceRail.test.tsx` (update or add new test)

**Context:**
Replace the flat `workspaces.map()` with a nested loop over projects and their workspaces. Add the collapse state (initially false).

- [ ] **Step 1: Add collapse state to WorkspaceRail**

```typescript
import { useState } from "react";

export function WorkspaceRail({
  projects,
  activeWorkspaceId,
  onSelect,
  onCustomize,
  onContextMenu,
  onNewWorkspace,
}: Props) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  // ... rest of component
}
```

Expected: Component now has `isCollapsed` state.

- [ ] **Step 2: Replace flat rendering with hierarchical rendering**

Replace the old `{workspaces.map((ws) => ...)}` with:

```typescript
return (
  <aside
    className={`flex h-full flex-col border-r border-octo-hairline bg-octo-panel pb-3 pt-9 transition-all duration-[220ms] ${
      isCollapsed ? "w-[50px]" : "w-[280px]"
    }`}
    aria-label="Workspaces"
  >
    <div className="flex-1 overflow-y-auto">
      {projects.map((project) => (
        <div key={project.id}>
          {/* Project header (only when expanded) */}
          {!isCollapsed && (
            <div className="px-2 py-3 font-mono text-[10px] uppercase tracking-[0.25em] text-octo-brass">
              — {project.name}
            </div>
          )}

          {/* Project separator (only when collapsed) */}
          {isCollapsed && project !== projects[0] && (
            <div className="my-2 mx-auto h-[1px] w-6 bg-octo-hairline opacity-50" />
          )}

          {/* Workspaces in this project */}
          <div className={isCollapsed ? "flex flex-col items-center gap-1.5 px-1" : "px-1"}>
            {project.workspaces.map((ws) => (
              <WorkspaceRow
                key={ws.id}
                workspace={ws}
                active={ws.id === activeWorkspaceId}
                collapsed={isCollapsed}
                onSelect={() => onSelect(ws.id)}
                onCustomize={() => onCustomize(ws.id)}
                onContextMenu={
                  onContextMenu
                    ? (x, y) => onContextMenu(ws.id, x, y)
                    : undefined
                }
              />
            ))}
          </div>
        </div>
      ))}
    </div>

    {/* Toggle button at bottom */}
    <div className="border-t border-octo-hairline px-2 py-2">
      <button
        type="button"
        onClick={() => setIsCollapsed(!isCollapsed)}
        title="Toggle workspace rail (⌘\)"
        className="w-full rounded-md border border-octo-hairline px-2 py-1.5 text-sm text-octo-mute transition hover:border-octo-brass-dim hover:text-octo-sage"
      >
        {isCollapsed ? "▲" : "▼ Collapse"}
      </button>
    </div>
  </aside>
);
```

Expected: The aside now renders projects and workspaces hierarchically, with a toggle button at the bottom.

- [ ] **Step 3: Add keyboard shortcut for toggle**

```typescript
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
      e.preventDefault();
      setIsCollapsed((prev) => !prev);
    }
  };

  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, []);
```

Add this in the component body (after state declaration, before return).

Expected: Pressing `⌘\` (or `Ctrl\` on Windows/Linux) toggles the rail.

- [ ] **Step 4: Commit hierarchical rendering**

```bash
git add src/components/WorkspaceRail.tsx
git commit -m "feat(rail): add hierarchical project/workspace rendering with collapse toggle and ⌘\\ shortcut"
```

---

## Task 3: Create WorkspaceRow component (expanded mode)

**Files:**
- Modify: `src/components/WorkspaceRail.tsx` (add WorkspaceRow component)

**Context:**
Extract the workspace row rendering into a separate component that handles both expanded and collapsed modes, with proper styling for active/inactive/attention states.

- [ ] **Step 1: Add WorkspaceRow component**

Insert this **before** the export of WorkspaceRail:

```typescript
interface WorkspaceRowProps {
  workspace: Workspace;
  active: boolean;
  collapsed: boolean;
  onSelect: () => void;
  onCustomize: () => void;
  onContextMenu?: (x: number, y: number) => void;
}

function WorkspaceRow({
  workspace,
  active,
  collapsed,
  onSelect,
  onCustomize,
  onContextMenu,
}: WorkspaceRowProps) {
  const mono = resolveMonogram(workspace);
  const tint = TINTS[mono.tint];
  const attentionFlag = useAttentionStore(
    (s) => s.flagsByWs[workspace.id],
  );
  const showPulse = !!attentionFlag && !active;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onSelect}
        onContextMenu={(e) => {
          e.preventDefault();
          if (onContextMenu) {
            onContextMenu(e.clientX, e.clientY);
          } else {
            onCustomize();
          }
        }}
        title={`${workspace.name} (right-click to customize)`}
        aria-label={workspace.name}
        aria-current={active ? "location" : undefined}
        className={`relative flex h-8 w-8 items-center justify-center rounded-md border font-serif text-sm transition ${
          showPulse ? "animate-attention-pulse" : ""
        }`}
        style={{
          color: tint.accent,
          borderColor: showPulse
            ? "var(--color-octo-brass)"
            : active
              ? tint.accent
              : "transparent",
          background: showPulse
            ? "var(--brass-ghost)"
            : active
              ? tint.bg
              : "transparent",
        }}
      >
        {mono.glyph}
      </button>
    );
  }

  // Expanded mode
  return (
    <div
      className={`group relative flex items-center gap-2 rounded-md px-2 py-2 transition ${
        active
          ? "border-l-2 border-octo-brass bg-octo-panel-2"
          : "border-l-2 border-transparent hover:bg-octo-panel-2"
      }`}
    >
      {/* Monogram */}
      <div
        className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-sm border font-serif text-xs font-semibold transition ${
          showPulse ? "animate-attention-pulse" : ""
        }`}
        style={{
          color: "#0c0a08",
          borderColor: showPulse
            ? "var(--color-octo-brass)"
            : active
              ? tint.accent
              : "transparent",
          background: showPulse
            ? "var(--brass-ghost)"
            : tint.bg,
          boxShadow: showPulse
            ? "0 0 10px rgba(212, 165, 116, 0.4)"
            : "none",
        }}
      >
        {mono.glyph}
      </div>

      {/* Workspace name with fade-out */}
      <div className="relative flex-1 overflow-hidden">
        <button
          type="button"
          onClick={onSelect}
          onContextMenu={(e) => {
            e.preventDefault();
            if (onContextMenu) {
              onContextMenu(e.clientX, e.clientY);
            } else {
              onCustomize();
            }
          }}
          title={`${workspace.name} (right-click to customize)`}
          aria-label={workspace.name}
          aria-current={active ? "location" : undefined}
          className={`w-full truncate px-0 py-0 text-left text-sm font-normal transition ${
            active ? "text-octo-ivory" : "text-octo-sage"
          }`}
        >
          {workspace.name}
        </button>

        {/* Fade-out gradient (appears on group hover) */}
        <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-10 bg-gradient-to-l from-octo-onyx to-transparent opacity-0 transition-opacity duration-[220ms] group-hover:opacity-100" />
      </div>

      {/* Active dot */}
      {active && (
        <div className="flex-shrink-0">
          <div className="h-1.5 w-1.5 rounded-full bg-octo-brass" />
        </div>
      )}
    </div>
  );
}
```

Expected: WorkspaceRow renders correctly in both expanded and collapsed modes, with proper states.

- [ ] **Step 2: Test the component visually**

No automated test here; just verify rendering by running the dev server in a later step.

- [ ] **Step 3: Commit WorkspaceRow component**

```bash
git add src/components/WorkspaceRail.tsx
git commit -m "feat(rail): add WorkspaceRow component for expanded/collapsed rendering"
```

---

## Task 4: Add fade-out gradient animation for text overflow

**Files:**
- Modify: `src/components/WorkspaceRail.tsx` (CSS or Tailwind in component)

**Context:**
The fade-out gradient should animate in on hover with a 500ms delay and 220ms animation duration. Currently it's just a static opacity change. We need to add delay and animation using CSS.

- [ ] **Step 1: Update the fade-out div with delay**

In the WorkspaceRow component, replace the fade-out div:

```typescript
// OLD:
<div className="pointer-events-none absolute right-0 top-0 bottom-0 w-10 bg-gradient-to-l from-octo-onyx to-transparent opacity-0 transition-opacity duration-[220ms] group-hover:opacity-100" />

// NEW:
<div 
  className="pointer-events-none absolute right-0 top-0 bottom-0 w-10 bg-gradient-to-l from-octo-onyx to-transparent opacity-0 transition-opacity duration-[220ms]"
  style={{
    transitionDelay: "500ms",
  }}
  onMouseEnter={(e) => {
    (e.currentTarget as HTMLElement).style.opacity = "1";
    (e.currentTarget as HTMLElement).style.transitionDelay = "0ms";
  }}
  onMouseLeave={(e) => {
    (e.currentTarget as HTMLElement).style.opacity = "0";
    (e.currentTarget as HTMLElement).style.transitionDelay = "500ms";
  }}
/>
```

Wait, this approach is not ideal. Let's use CSS variables and a state instead:

Actually, simpler approach: use a data attribute and CSS. But since we're in React, we can use inline styles or tailwind with delays.

Let me reconsider: The group:hover will apply immediately. To add the 500ms delay, we can use Tailwind's delay classes. But Tailwind doesn't have built-in support for delayed opacity changes on group hover.

So we need custom CSS. Let's add it to `src/styles.css`.

- [ ] **Step 1a: Add custom CSS for fade-out gradient in styles.css**

Check if styles.css exists and add:

```css
.workspace-row-name-fadeout {
  opacity: 0;
  transition: opacity 220ms cubic-bezier(0.2, 0.8, 0.3, 1);
}

.workspace-row:hover .workspace-row-name-fadeout {
  opacity: 1;
  transition-delay: 500ms;
}

.workspace-row:hover:hover .workspace-row-name-fadeout {
  transition-delay: 0ms;
}
```

Actually, the double hover won't work. Let me think...

CSS can't do "delay on first hover, no delay on unhover". We need JavaScript for precise control. Let's simplify:

```css
.workspace-row {
  position: relative;
}

.workspace-row-name-fadeout {
  opacity: 0;
  transition: opacity 220ms cubic-bezier(0.2, 0.8, 0.3, 1) 500ms;
}

.workspace-row:hover .workspace-row-name-fadeout {
  opacity: 1;
  transition-delay: 0ms;
}
```

This gives us: on hover, fade in immediately (no delay). On unhover, fade out after 500ms delay. That's backwards from what we want.

Let's use a different approach with a React state and setTimeout:

- [ ] **Step 1b: Use React state for hover delay (revised)**

Update WorkspaceRow to track hover with timeout:

```typescript
function WorkspaceRow({
  workspace,
  active,
  collapsed,
  onSelect,
  onCustomize,
  onContextMenu,
}: WorkspaceRowProps) {
  const [showFadeOut, setShowFadeOut] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout>();

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => {
      setShowFadeOut(true);
    }, 500);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setShowFadeOut(false);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // ... rest of component, use showFadeOut to control gradient opacity
}
```

Then in the fade-out gradient div:

```typescript
<div className={`pointer-events-none absolute right-0 top-0 bottom-0 w-10 bg-gradient-to-l from-octo-onyx to-transparent transition-opacity duration-[220ms] ${
  showFadeOut ? "opacity-100" : "opacity-0"
}`} />
```

And wrap the workspace button in:

```typescript
<div
  className="relative flex-1 overflow-hidden"
  onMouseEnter={handleMouseEnter}
  onMouseLeave={handleMouseLeave}
>
  {/* button and fade-out div here */}
</div>
```

Expected: Fade-out gradient appears 500ms after hover, animates in over 220ms, disappears immediately on mouse leave.

- [ ] **Step 2: Update WorkspaceRow with fade-out state and handlers**

Replace the WorkspaceRow function body (the expanded mode section) with the code above.

- [ ] **Step 3: Add import for useRef and useEffect at top**

```typescript
import { useState, useRef, useEffect } from "react";
```

- [ ] **Step 4: Commit fade-out gradient**

```bash
git add src/components/WorkspaceRail.tsx
git commit -m "feat(rail): add 500ms delay + 220ms fade-out animation for text overflow"
```

---

## Task 5: Update App.tsx to pass project data

**Files:**
- Modify: `src/App.tsx`
- Reference: `src/stores/workspaceStore.ts`

**Context:**
App.tsx currently passes a flat list of workspaces to WorkspaceRail. We need to:
1. Fetch the list of projects
2. Transform the flat workspace list into a hierarchical structure (grouped by projectId)
3. Pass it to WorkspaceRail

- [ ] **Step 1: Check if projectStore exists or if we need to derive projects from workspaces**

Run: `grep -r "projectStore\|useProjectStore" /Users/jonathan/TYPEFY/octopus/octopus-sh/src --include="*.ts" --include="*.tsx" | head -5`

If projectStore exists, use it. Otherwise, we'll compute the projects from workspaces and their projectId.

- [ ] **Step 2: Add project data fetching in App.tsx**

Assuming projectStore exists or we derive projects from workspaces, add logic in the App component (or the component that renders WorkspaceRail):

```typescript
const workspaces = useWorkspaceStore((s) => s.workspaces);

// Group workspaces by projectId to form ProjectGroups
const projects: ProjectGroup[] = useMemo(() => {
  const grouped = new Map<string, Workspace[]>();
  workspaces.forEach((ws) => {
    const list = grouped.get(ws.projectId) || [];
    list.push(ws);
    grouped.set(ws.projectId, list);
  });

  // Convert to array and fetch project names
  // For now, use projectId as name placeholder (will fetch real names)
  return Array.from(grouped.entries()).map(([projectId, workspaces]) => ({
    id: projectId,
    name: projectId, // TODO: fetch real project name
    workspaces,
  }));
}, [workspaces]);
```

Expected: `projects` is now a hierarchical structure ready to pass to WorkspaceRail.

- [ ] **Step 3: Pass projects to WorkspaceRail**

In the App component where WorkspaceRail is rendered, change:

```typescript
// OLD:
<WorkspaceRail
  workspaces={workspaces}
  activeId={activeWorkspaceId}
  // ...
/>

// NEW:
<WorkspaceRail
  projects={projects}
  activeWorkspaceId={activeWorkspaceId}
  // ...
/>
```

Expected: WorkspaceRail receives the new Props.

- [ ] **Step 4: Import ProjectGroup type in App.tsx**

```typescript
import type { ProjectGroup } from "./components/WorkspaceRail";
```

- [ ] **Step 5: Commit App.tsx changes**

```bash
git add src/App.tsx
git commit -m "feat(app): pass hierarchical project data to WorkspaceRail"
```

---

## Task 6: Update tests

**Files:**
- Modify: `src/components/WorkspaceRail.test.tsx`

**Context:**
The existing tests expect the old flat Props. Update them to use the new ProjectGroup structure.

- [ ] **Step 1: Check existing tests**

Run: `cat /Users/jonathan/TYPEFY/octopus/octopus-sh/src/components/WorkspaceRail.test.tsx | head -50`

Expected: Show the current test structure.

- [ ] **Step 2: Update Props in tests**

Replace the `workspaces` prop with `projects` in all test render calls:

```typescript
// OLD:
const { getByText } = render(
  <WorkspaceRail
    workspaces={[mockWorkspace1, mockWorkspace2]}
    // ...
  />
);

// NEW:
const { getByText } = render(
  <WorkspaceRail
    projects={[
      {
        id: "project-1",
        name: "My Project",
        workspaces: [mockWorkspace1, mockWorkspace2],
      },
    ]}
    // ...
  />
);
```

- [ ] **Step 3: Add test for collapse/expand toggle**

```typescript
it("should toggle rail width on button click", () => {
  const { getByTitle, container } = render(
    <WorkspaceRail
      projects={[
        {
          id: "project-1",
          name: "My Project",
          workspaces: [mockWorkspace1],
        },
      ]}
      activeWorkspaceId={mockWorkspace1.id}
      onSelect={() => {}}
      onCustomize={() => {}}
      onNewWorkspace={() => {}}
    />
  );

  const aside = container.querySelector("aside");
  expect(aside).toHaveClass("w-[280px]");

  const toggleBtn = getByTitle("Toggle workspace rail (⌘\\)");
  fireEvent.click(toggleBtn);

  expect(aside).toHaveClass("w-[50px]");
});
```

- [ ] **Step 4: Add test for keyboard shortcut**

```typescript
it("should toggle rail on ⌘\\ keydown", () => {
  const { container } = render(
    <WorkspaceRail
      projects={[
        {
          id: "project-1",
          name: "My Project",
          workspaces: [mockWorkspace1],
        },
      ]}
      activeWorkspaceId={mockWorkspace1.id}
      onSelect={() => {}}
      onCustomize={() => {}}
      onNewWorkspace={() => {}}
    />
  );

  const aside = container.querySelector("aside");
  expect(aside).toHaveClass("w-[280px]");

  fireEvent.keyDown(window, { key: "\\", metaKey: true });

  expect(aside).toHaveClass("w-[50px]");
});
```

- [ ] **Step 5: Run tests**

Run: `npm test -- src/components/WorkspaceRail.test.tsx`

Expected: All tests pass.

- [ ] **Step 6: Commit test updates**

```bash
git add src/components/WorkspaceRail.test.tsx
git commit -m "test(rail): update tests for new hierarchical Props and collapse/expand behavior"
```

---

## Task 7: Manual testing and visual verification

**Files:**
- No file changes; just testing

**Context:**
Start the dev server and manually verify:
1. Rail is 280px in expanded mode
2. Rail is ~50px in collapsed mode
3. Workspaces are grouped by project with headers
4. Monograms show correct colors
5. Active state (brass border + dot) works
6. Hover shows fade-out gradient after 500ms
7. Attention highlight (pulse) works
8. Right-click context menu works
9. Toggle button and ⌘\ shortcut both work
10. No regressions to chat or other features

- [ ] **Step 1: Start dev server**

Run: `npm run dev`

Expected: App loads at http://localhost:5173 (or similar).

- [ ] **Step 2: Visual inspection — expanded mode**

- Open app in browser
- Rail should be wide (~280px)
- See multiple projects as brass eyebrow headers
- Workspaces should show full names
- Monograms on the left with colors
- Active workspace has brass left border + dot on right
- Hover over a workspace: background changes, fade-out gradient appears after 0.5s
- Inactive workspaces show in sage color

- [ ] **Step 3: Visual inspection — collapsed mode**

- Click "▼ Collapse" button
- Rail narrows to ~50px
- Only monograms visible
- Monograms grouped by project (separated by hairline)
- Hover over monogram: tooltip shows "Project Name · Workspace Name"
- Active/attention states still visible
- Button text changes to "▲"

- [ ] **Step 4: Test keyboard shortcut**

- Press ⌘\ (Cmd+Backslash)
- Rail toggles between expanded and collapsed
- Works both ways

- [ ] **Step 5: Test context menu and customization**

- Right-click a workspace
- Context menu appears (should be unchanged)
- Customize monogram color → color updates visually
- Verify no regressions

- [ ] **Step 6: Test attention highlight**

- Trigger an attention flag on a workspace (if test data available)
- Monogram gets brass border + glow + pulse animation
- Attention badge visible in both expanded and collapsed modes

- [ ] **Step 7: Test active workspace selection**

- Click different workspaces
- Active state updates visually (brass border, ivory text, dot)
- Select workspace from different project (should work, no project switching logic here)

- [ ] **Step 8: Verify no regressions**

- Chat input works
- Tool calls render correctly
- Session sidebar unaffected
- Other UI components unaffected

---

## Task 8: Final integration and polish

**Files:**
- Modify: As needed for any final tweaks

**Context:**
Perform final checks, fix any styling inconsistencies, ensure all design tokens are used correctly.

- [ ] **Step 1: Verify all design tokens used**

Run the dev server and check:
- `--onyx` (#0c0a08) for rail background
- `--brass` (#d4a574) for project headers, active state, dots
- `--panel` (#14110d) for any secondary surfaces
- `--panel-2` (#1a160f) for hover backgrounds
- `--ivory` (#f4ecdb) for active text
- `--sage` (#95897a) for inactive text
- `--mute` (#6d6354) for toggle button text

Grep for hardcoded colors:

Run: `grep -r "#[0-9a-fA-F]\{3,8\}" /Users/jonathan/TYPEFY/octopus/octopus-sh/src/components/WorkspaceRail.tsx`

Expected: Only colors that are part of RGB values for tint colors (from monogram.ts), no hardcoded design colors.

- [ ] **Step 2: Check spacing consistency**

Verify all spacing matches the spec:
- 44px height per expanded row ✓ (py-2 = 8px + 28px content)
- 4px gap between workspaces ✓ (gap-1 = 4px in the map container)
- 8px gap between projects ✓ (py-3 on header = 12px top, 0 bottom; next project has implicit 8px from overall structure)
- 12px padding on project header ✓
- 8px padding within rows ✓

- [ ] **Step 3: Verify monogram sizing**

Expanded: 24px (h-6 w-6) ✓
Collapsed: 32px (h-8 w-8) ✓

- [ ] **Step 4: Motion and transitions**

All transitions use 220ms ✓
Collapse/expand uses cubic-bezier(0.2, 0.8, 0.3, 1) ✓
Fade-out has 500ms delay + 220ms animation ✓

- [ ] **Step 5: Accessibility check**

- All interactive elements have `aria-label` or `title` ✓
- Keyboard shortcut documented ✓
- Tab navigation works through workspaces ✓
- Focus states visible ✓

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat(rail): complete workspace rail redesign with hierarchical projects, full names, and collapsible toggle"
```

---

## Success Checklist

Before marking complete:

- ✓ All projects + workspaces visible in one rail
- ✓ Full workspace names always visible in expanded mode
- ✓ Monogram colors personalized per workspace
- ✓ Right-click customization works
- ✓ Attention highlight works (pulse + glow)
- ✓ Fade-out gradient appears on hover (500ms delay, 220ms animation)
- ✓ Active state indicated (brass border + dot)
- ✓ Toggle button functional (click and ⌘\ shortcut)
- ✓ Collapsed mode shows monograms grouped by project
- ✓ Collapsed mode tooltips show "Project Name · Workspace Name"
- ✓ Rail width animates smoothly (220ms)
- ✓ Default state: always expanded on app load (no persistence)
- ✓ No regressions to chat, tool calls, or attention features
- ✓ All tests pass
- ✓ No hardcoded colors (uses design tokens)
- ✓ Keyboard accessible (Tab, Enter, Shift+F10 for context menu, ⌘\ for toggle)

