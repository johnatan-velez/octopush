# Octopush Workspace Rail Redesign

**Date:** 2026-05-25
**Status:** Design approved, ready for implementation planning
**Scope:** Redesign the left rail to show all projects + workspaces hierarchically with full names and color personalization

---

## 1. Problem Statement

The current rail shows only initials (monograms) of workspaces within a single active project. This creates two friction points:

1. **Ambiguity**: When multiple workspaces start with the same letter, the initials are indistinguishable (e.g., "A" for "Authentication Service", "API Core", "Auth Module").
2. **Context loss**: When switching projects, all other projects and their workspaces disappear visually, even though they still exist. Users lose the ability to see the full landscape at a glance.

---

## 2. Solution Overview

Replace the single-project icon rail with a **wide, always-visible rail** that displays:
- **All projects** as brass eyebrow labels (monospace, uppercase, with `— ` prefix)
- **All workspaces** under each project, with:
  - Color-customizable monogram (left)
  - Full workspace name (right, with ellipsis/fade-out on overflow)
  - Active state indicator (brass left border + brass dot on right)
  - Attention highlight (brass border + glow on monogram when workspace needs user attention)
  - Hover fade-out gradient to reveal truncated text

The rail becomes the source of truth for project + workspace navigation. No context loss when switching projects.

---

## 3. Architecture

### 3.1 Rail Structure

- **Width (Expanded)**: 280px (fixed)
- **Width (Collapsed)**: ~50px (fixed, includes padding)
- **Width transition**: 220ms cubic-bezier(0.2, 0.8, 0.3, 1)
- **Background**: `--onyx` (`#0c0a08`)
- **Scrollable**: Yes, vertically (when content exceeds viewport height)
- **Composition**: Projects (as section headers) + workspaces (as interactive rows)
- **Collapsible**: Via toggle button at bottom and `⌘\` keyboard shortcut

### 3.2 Project Section Header

**Styling:**
- Font: JetBrains Mono, 10px, uppercase, tracking 0.25em
- Color: `--brass` (`#d4a574`)
- Content: `"— Project Name"`
- Padding: 12px 8px 8px 8px (top-heavy spacing before first workspace of section)
- Margin-bottom: 0 (workspaces have 4px gap between each other)
- No interactive behavior (non-clickable)

**Spacing between project sections:**
- First project: No margin above
- Subsequent projects: 8px margin-top (visual breathing room)

### 3.3 Workspace Row

**Layout:**
- Height: 44px (fixed)
- Padding: 8px
- Border-radius: 6px
- Display: flex, gap 8px, align-items center

**Components (left to right):**

1. **Monogram** (leftmost)
   - Width: 24px
   - Height: 24px
   - Border-radius: 4px
   - Font: Serif, 11px, 600 weight
   - Color: `--onyx` (#0c0a08) — always dark on the customizable background
   - Background: User-customizable color (from `resolveMonogram(workspace).tint`)
   - Flex-shrink: 0 (never compress)

2. **Workspace Name** (center, grows)
   - Font: System sans, 13px, normal weight
   - Color: `--ivory` (#f4ecdb) when active, `--sage` (#95897a) when inactive
   - White-space: nowrap
   - Overflow: hidden
   - Text-overflow: ellipsis
   - Flex: 1 (takes available space)
   - **Fade-out on hover:** Linear gradient overlay (right edge), direction 90deg, from solid → transparent. Animated with 220ms ease-out when hover begins, after 500ms delay.

3. **Active Dot** (rightmost, only when active)
   - Width: 6px
   - Height: 6px
   - Border-radius: 50%
   - Background: `--brass` (#d4a574)
   - Flex-shrink: 0

**State: Default (inactive)**
- Background: transparent
- Border-left: 2px transparent (reserves space for border)
- Monogram: Default colors from tint
- Name color: `--sage`
- Cursor: pointer
- Hover: Background → `--panel-2` (#1a160f), rounded corners

**State: Active**
- Background: `--panel-2` (#1a160f)
- Border-left: 2px `--brass`
- Name color: `--ivory`
- Active dot: Visible on right
- Hover: Background stays `--panel-2`, fade-out gradient activates on name

**State: Needs Attention (override)**
- Monogram gets:
  - Border: 1px `--brass`
  - Box-shadow: 0 0 10px rgba(212, 165, 116, 0.4)
  - Animation: `attention-pulse` (same as current implementation)
- Row background: Subtle, can be same as active or slightly different
- Name color: `--sage` (or `--ivory` if also active)

**Interaction:**
- **Left-click**: Select the workspace (becomes active)
- **Right-click**: Open context menu for customization (color, rename, etc.) — reuse existing customization flow
- **Hover (on name)**: After 500ms delay, fade-out gradient animates over 220ms to reveal truncated text. Text does not scroll horizontally; the gradient overlay shifts to show more characters. On un-hover, gradient fades back to default.

### 3.4 Spacing & Gaps

- **Between workspace rows in same project**: 4px
- **Between project sections**: 8px margin-top on the next project's header
- **Padding within each row**: 8px
- **Project header padding-top**: 12px (extra breath before new section)

### 3.5 Transitions & Motion

All transitions use the design system's motion curve: **cubic-bezier(0.2, 0.8, 0.3, 1)** with **220ms** for standard interactions (fade-out gradient).

- **Fade-out gradient animation**: 220ms, on hover with 500ms delay
- **Active state change**: 220ms (border, background, text color)
- **Attention pulse**: Reuse existing `attention-pulse` animation (brass border + halo, infinite loop)
- **Rail collapse/expand**: 220ms width transition (280px ↔ ~50px)

### 3.6 Collapse/Expand Toggle

**When Expanded (280px):**
- Toggle button at bottom of rail (above new workspace button, if present)
- Label: "▼ Collapse" (text + icon)
- Width: Auto (fits text)
- Styling: Hairline border, `--mute` text, no background
- Hover: Border → `--brass-dim`, text → `--sage`

**When Collapsed (~50px):**
- Toggle button stays at bottom
- Label: "▲" (icon only, no text)
- Width: 28px, height: 28px, centered
- Styling: Same as expanded (hairline border, `--mute` text)
- Hover: Border → `--brass-dim`, text → `--sage`

**Behavior:**
- Click toggle to switch between expanded/collapsed
- Keyboard shortcut: `⌘\` (Command+Backslash) toggles state
- Default on app load: **Expanded**
- State persistence: **None** — refresh or reopen app always starts expanded
- Transition: Rail width animates over 220ms using cubic-bezier(0.2, 0.8, 0.3, 1)

**Collapsed Mode Details:**
- Width: ~50px (monogram 32px + padding)
- Monogram size: 32px (larger for better clickability vs. expanded 24px)
- Gap between workspaces in same project: 6px
- Project separators: 1px hairline, 24px width, centered, opacity 0.5
- Hover behavior: Tooltip shows "Project Name · Workspace Name"
- Active/attention states: Fully preserved (brass border, pulse glow, dot indicator if space allows)
- Right-click context menu: Still works (customize, etc.)

---

## 4. Behavior Details

### 4.1 Monogram Colors

Monogram colors are derived from the existing `resolveMonogram(workspace)` function and `TINTS` constant. Each tint provides:
- `accent` color (used as border/text color in current impl)
- `bg` color (will now be used as monogram background)

The tint system ensures visual distinctiveness across workspaces. Right-click to customize the tint assignment per workspace (existing feature, preserved).

### 4.2 Fade-Out Gradient (Text Overflow)

When workspace name is longer than available width:

1. **Default (no hover)**: Text is truncated with ellipsis (`text-overflow: ellipsis`)
2. **On hover** (after 500ms delay): A CSS gradient overlay (implemented as a `::after` pseudo-element on the row) animates in over 220ms:
   ```css
   ::after {
     content: '';
     position: absolute;
     right: 0;
     top: 0;
     bottom: 0;
     width: 40px;
     background: linear-gradient(to left, var(--onyx), transparent);
     pointer-events: none;
     opacity: 0;
     transition: opacity 220ms cubic-bezier(0.2, 0.8, 0.3, 1);
   }
   
   &:hover::after {
     opacity: 1;
   }
   ```
   The gradient obscures the ellipsis at the right edge and subtly reveals more text underneath. The effect is suggestive—the user can infer the text continues—without a hard scroll.

3. **On un-hover**: Gradient fades back out over 220ms.

Note: The text itself does not scroll; the gradient overlay creates the illusion of text continuation by selectively obscuring/revealing the ellipsis area.

### 4.3 Interactivity & Context Menu

- **Left-click workspace**: Call `onSelect(workspace.id)` (existing handler)
- **Right-click workspace**: Call `onContextMenu(workspace.id, x, y)` (existing handler) to open customization menu
- **Project header**: Non-interactive; serves as a visual landmark only

---

## 5. Responsive & Overflow Handling

- **Rail always 280px wide**: No responsive breakpoints. The rail is a fixed-width sidebar.
- **Workspace list**: Vertically scrollable if total height exceeds viewport. No horizontal scroll.
- **Text truncation**: Always uses ellipsis (`text-overflow: ellipsis`). Fade-out on hover is visual only, not a functional scroll.
- **Monogram**: Never truncated or hidden. Always visible on the left.

---

## 6. Accessibility

- **Semantic HTML**: Use `<aside>` for the rail container, `<button>` for interactive rows
- **ARIA labels**: Each workspace row has `aria-label` with full workspace name and project context
- **Title attribute**: Full name on hover (browser default tooltip), in addition to the fade-out gradient
- **Focus states**: Keyboard navigation supported (Tab to cycle through workspaces, Enter to select, Shift+F10 or right-click to customize)
- **Attention highlight**: Conveyed by border + glow, but also communicated via `aria-label` (e.g., "Authentication Service — needs your attention (high-cpu-usage)")

---

## 7. Design Tokens & Palette

Uses existing Atelier tokens (no new colors added):
- `--onyx`: #0c0a08 (background)
- `--panel`: #14110d (surfaces)
- `--panel-2`: #1a160f (active/hover surfaces)
- `--hairline`: #2a2419 (borders, not used here)
- `--brass`: #d4a574 (active state, monogram customization)
- `--brass-hi`: #e8c39a (not used here)
- `--ivory`: #f4ecdb (active text)
- `--sage`: #95897a (inactive text)
- `--mute`: #6d6354 (labels, meta)

---

## 8. Implementation Notes

### 8.1 Component Changes

**WorkspaceRail.tsx:**
- Expand to accept `projects: Project[]` array (instead of flat `workspaces: Workspace[]`)
- Each project has `id`, `name`, `workspaces: Workspace[]`
- Render project headers + workspace rows in a hierarchical loop
- Preserve existing `resolveMonogram()`, `TINTS`, `useAttentionStore` logic
- Add fade-out gradient behavior on hover (CSS + React state or CSS-only with `::after` pseudo-element)
- Add state: `isCollapsed: boolean` (React state, default false, no persistence)
- Render toggle button at bottom of rail with label text (expanded) or icon only (collapsed)
- Add keyboard listener for `⌘\` to toggle `isCollapsed` state
- Conditionally render workspace names/project headers based on `isCollapsed` state

**Styling:**
- Width (expanded): 280px
- Width (collapsed): ~50px
- Width transition: 220ms cubic-bezier(0.2, 0.8, 0.3, 1)
- Height per row (expanded): 44px
- Height per row (collapsed): 38px (monogram 32px + padding 6px)
- Gap between rows (expanded): 4px
- Gap between rows (collapsed): 6px
- Gap between projects (expanded): 8px margin-top on header
- Gap between projects (collapsed): 8px margin with 1px hairline separator (24px width, centered)
- Use Tailwind classes for most styling, custom CSS for fade-out gradient and width transition if needed
- Toggle button: Hairline border, `--mute` text, no background, 220ms transition on border color

### 8.2 Data Flow

1. `App.tsx` or the store (e.g., `projectStore`, `workspaceStore`) provides:
   - List of all projects
   - For each project: its workspaces
   - Current active workspace ID
2. `WorkspaceRail` renders the hierarchy and calls:
   - `onSelect(workspaceId)` → switch active workspace + potentially switch projects
   - `onContextMenu(workspaceId, x, y)` → open customization menu

### 8.3 Existing Features to Preserve

- **Monogram customization**: Right-click context menu, updates tint color. Preserved as-is.
- **Attention highlighting**: `useAttentionStore` provides `flagsByWs`. Monogram gets border + glow + pulse animation when flagged.
- **Keyboard shortcuts**: `⌘N` for new workspace (already bound).

---

## 9. Success Criteria

- ✓ All projects + workspaces visible in one rail, no context loss on project switch
- ✓ Full workspace names displayed by default in expanded mode, truncated only when longer than available space
- ✓ Monogram colors personalized per workspace; right-click customization works in both modes
- ✓ Attention highlight (pulse + glow) works as before in both modes
- ✓ Fade-out gradient appears on hover in expanded mode (500ms delay, 220ms animation)
- ✓ Active state clearly indicated (brass border + dot) in expanded mode; brass border in collapsed mode
- ✓ Toggle button functional (click or `⌘\` to collapse/expand)
- ✓ Collapsed mode shows monograms grouped by project with hairline separators
- ✓ Collapsed mode shows "Project Name · Workspace Name" tooltip on hover
- ✓ Rail width animates smoothly (220ms) between expanded/collapsed states
- ✓ Default state: Always expanded on app load (no persistence)
- ✓ No regressions to existing chat, tool call, or attention features
- ✓ Keyboard accessible (Tab, Enter, Shift+F10 for context menu, `⌘\` for toggle)

---

## 10. Out of Scope

- Backend changes: The rail is pure frontend.
- Project creation/deletion UI: Assume projects exist; focus only on display and selection.
- Custom project colors or naming from within the rail; use existing customization endpoints.
- Light theme: Stay dark-only (Onyx & Brass palette only).

---

## 11. Future Enhancements (Post-MVP)

- Drag-to-reorder workspaces within or across projects
- Pinned projects (always visible) vs. collapsible groups
- Workspace search/filter in the rail
- Keyboard shortcuts to jump directly to a project or workspace
