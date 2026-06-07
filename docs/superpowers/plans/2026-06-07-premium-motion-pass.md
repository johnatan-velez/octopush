# Premium Motion Pass + Safeguard — Plan 12

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Give every abrupt show/hide across the app the same premium motion as the rail/ModeSwitcher/pills, via a small set of **reusable motion primitives** (CSS classes), and add a **safeguard** (design tokens/classes + CLAUDE.md/AGENTS.md rule + checklist) so new features must respect it.

**Architecture:** Three canonical enter-animation classes in `styles.css` — `.octo-overlay-enter` (backdrop fade), `.octo-modal-enter` (fade + scale-in), `.octo-menu-enter` (fade + scale-in, quicker) — plus `.octo-fade-in` (content crossfade) and `.octo-pop-in` (tiny indicators), all built on the existing `--ease-octo` / `--dur-*` tokens, with a `prefers-reduced-motion` guard. Applied as a single additive className at each site (no behavior change). The safeguard makes these the documented, mandatory way to reveal overlays/menus/panels. (`tailwindcss-animate` already powers the toasts — left as-is.)

**Tech Stack:** React 19 + TS, Tailwind v4, Vitest. No new deps.

**Scope:** enter animations (mount) — the dominant visual win; exit animations stay as-is except where already always-mounted (rail grid-rows). Toasts already animate (untouched). Backdrop *colors* are not standardized here (motion only), to bound risk.

---

## Task 1: Motion primitives in styles.css + design-system doc

**Files:** Modify `src/styles.css`; modify `docs/design-system.md` (§6 Motion).

- [ ] **Step 1: add the keyframes + classes**

In `src/styles.css`, after the existing signature keyframes/utility classes (near `.animate-brass-grow` etc.), add:

```css
/* ── Motion · reusable entrance primitives ───────────────────────
   The canonical way to reveal overlays, dialogs, menus, and panels.
   Built on --ease-octo / --dur-* so everything reads as one family.
   See CLAUDE.md (Motion is mandatory) + docs/design-system.md §6. */
@keyframes octo-enter-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes octo-enter-pop {
  from { opacity: 0; transform: scale(0.97); }
  to   { opacity: 1; transform: none; }
}
@keyframes octo-enter-rise {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: none; }
}

/* Backdrop / scrim fade. */
.octo-overlay-enter { animation: octo-enter-fade var(--dur-quick) var(--ease-octo) both; }
/* Dialog / modal: fade + gentle scale from 0.97 (never > 1.05 per spec). */
.octo-modal-enter   { animation: octo-enter-pop var(--dur-standard) var(--ease-octo) both; }
/* Context menu / popover: same pop, quicker. */
.octo-menu-enter    { animation: octo-enter-pop var(--dur-quick) var(--ease-octo) both; }
/* Content crossfade (tab/mode panes). */
.octo-fade-in       { animation: octo-enter-fade var(--dur-quick) var(--ease-octo) both; }
/* Small indicator reveal (status dots, badges) — grows in, doesn't pop. */
.octo-pop-in        { animation: octo-enter-pop var(--dur-quick) var(--ease-octo) both; }
/* Row / list item reveal. */
.octo-rise-in       { animation: octo-enter-rise var(--dur-standard) var(--ease-octo) both; }

/* Accessibility: honor reduced-motion — render final state instantly. */
@media (prefers-reduced-motion: reduce) {
  .octo-overlay-enter,
  .octo-modal-enter,
  .octo-menu-enter,
  .octo-fade-in,
  .octo-pop-in,
  .octo-rise-in { animation: none !important; }
}
```

- [ ] **Step 2: document them in design-system.md §6 Motion**

In `docs/design-system.md`, in §6 Motion, add a subsection listing the canonical classes and when to use each:

```markdown
### Reusable entrance primitives (use these — don't hand-roll)

| Class | Use for | Built from |
|-------|---------|------------|
| `.octo-overlay-enter` | modal/dialog backdrops (scrim fade) | fade · --dur-quick |
| `.octo-modal-enter` | dialogs, popovers, sheets | fade+scale 0.97→1 · --dur-standard |
| `.octo-menu-enter` | context menus | fade+scale 0.97→1 · --dur-quick |
| `.octo-fade-in` | tab/mode content crossfade | fade · --dur-quick |
| `.octo-pop-in` | status dots / small badges appearing | fade+scale · --dur-quick |
| `.octo-rise-in` | list rows appearing | fade+rise 4px · --dur-standard |

Collapsible regions use the **grid-rows `0fr↔1fr`** idiom (see `WorkContextPanel`, the rail project collapse, the Recently-closed drawer). All entrance/collapse motion respects `prefers-reduced-motion`.
```

- [ ] **Step 3: verify + commit**

`npm run build` (or `npm run typecheck` — CSS isn't typechecked, so just confirm the app still builds: `npm run typecheck` for TS + a quick `npm test`). 
```bash
git add src/styles.css docs/design-system.md
git commit -m "feat(motion): reusable entrance primitives + reduced-motion guard; document"
```

---

## Task 2: Safeguard — CLAUDE.md + AGENTS.md rule + checklist

**Files:** Modify `CLAUDE.md`; mirror to `AGENTS.md` (CLAUDE.md states it's mirrored there).

- [ ] **Step 1: extend the motion non-negotiable**

In `CLAUDE.md`, under "Non‑negotiable design rules", rule 6 is about calm motion. Extend it (or add rule 9) with the mandatory-primitive requirement:

```markdown
6. **No bouncing, no spring, no glitter.** Motion is calm. 220–320ms, `cubic‑bezier(0.2, 0.8, 0.3, 1)`. Brass rules *grow*; they don't *appear*. **Nothing appears or disappears abruptly:** overlays/dialogs use `.octo-overlay-enter` + `.octo-modal-enter`, context menus use `.octo-menu-enter`, collapsible regions use the grid-rows `0fr↔1fr` idiom, tab/mode content crossfades with `.octo-fade-in`, status indicators reveal with `.octo-pop-in`. Don't hand-roll one-off animations — reuse the primitives in `src/styles.css` (documented in `docs/design-system.md` §6). All motion respects `prefers-reduced-motion`.
```

- [ ] **Step 2: add a checklist item**

In the "Before you submit a frontend change — checklist" section of `CLAUDE.md`, add:

```markdown
- [ ] No abrupt mount/unmount of overlays, menus, or panels — used the motion primitives (`.octo-modal-enter`/`.octo-menu-enter`/`.octo-fade-in`/grid-rows). Respects `prefers-reduced-motion`.
```

- [ ] **Step 3: mirror to AGENTS.md**

Apply the SAME two edits to `AGENTS.md` (it mirrors CLAUDE.md). If `AGENTS.md` is a verbatim copy or a symlink, keep them in sync; read it first and make the identical changes.

- [ ] **Step 4: commit**

```bash
git add CLAUDE.md AGENTS.md
git commit -m "docs(motion): mandate the motion primitives for new surfaces (safeguard)"
```

---

## Task 3: Context menus — `.octo-menu-enter` (Batch B)

**Files:** `src/components/ProjectContextMenu.tsx`, `src/components/WorkspaceContextMenu.tsx`, `src/components/BacklogRowContextMenu.tsx`.

- [ ] **Step 1:** In each, the root menu `<div>` has `className="absolute z-50 ... shadow-2xl"` (uses `useMenuChrome`). Append `octo-menu-enter` to that className. Set `transform-origin` near the top-left so it grows from the cursor — add `style={{ ..., transformOrigin: "top left" }}` (merge with the existing `style={{ left, top }}` from `useMenuChrome`). Keep everything else.

- [ ] **Step 2: verify + commit**

`npm run typecheck` → clean. `npm test` → green. (Menu tests render the menu; the added class/animation doesn't affect queries.)
```bash
git add src/components/ProjectContextMenu.tsx src/components/WorkspaceContextMenu.tsx src/components/BacklogRowContextMenu.tsx
git commit -m "feat(motion): context menus materialize with octo-menu-enter (Batch B)"
```

---

## Task 4: App.tsx-rendered overlays (Batch A · part 1)

**Files:** `src/App.tsx`.

The App renders several modals as `{state && (<div className="...backdrop...">{onClick dismiss}<div onClick=stop><Dialog/></div></div>)}`. For EACH, add `octo-overlay-enter` to the backdrop div's className and `octo-modal-enter` to the inner content wrapper (the `onClick stopPropagation` div). Do NOT change behavior/structure — only append the two classes.

- [ ] **Step 1:** Find and update these overlays in App.tsx (grep `bg-black/` and the modal state vars): the **rename workspace** dialog (`renamingWorkspace`), the **archived workspaces** modal (`archivedForProject`), the **project customizer** (`showProjectCustomizer`), the **workspace customizer** (`customizingWorkspaceId`), the **workspace creator** (`showCreator` — full-screen: use `octo-fade-in` on its overlay instead of scale, since it's a full-screen surface not a small dialog), and any **delete/confirm** overlay rendered inline. For each: backdrop → `octo-overlay-enter`; dialog content wrapper → `octo-modal-enter`. (Read each block; if a modal is a self-contained component with its OWN backdrop, leave it for Task 5 and note it.)

- [ ] **Step 2: verify + commit**

`npm run typecheck` → clean. `npm test` → green. `git diff -- src | grep -nE "#[0-9a-fA-F]{3,8}"` → empty.
```bash
git add src/App.tsx
git commit -m "feat(motion): App overlays fade/scale in (Batch A pt1)"
```

---

## Task 5: Self-contained modal components (Batch A · part 2)

**Files:** the modal components that render their OWN `fixed/absolute inset-0` backdrop. Confirm by grepping `inset-0 z-50` / `bg-octo-onyx/` / `bg-black/` / `bg-octo-bg/` in `src/components/`. Candidates: `ConfirmDialog.tsx`, `JiraTicketPickerModal.tsx`, `JiraProjectKeyModal.tsx`, `ElsewhereModal.tsx`, `NewSessionDialog.tsx`, `ProjectPickerModal.tsx`, `ExistingWorkspaceAlertModal.tsx`, `CommandPalette.tsx`, `WorkspaceSearchPalette.tsx`.

- [ ] **Step 1:** For each component: add `octo-overlay-enter` to the outermost backdrop element's className, and `octo-modal-enter` to the dialog/panel element (the inner card). For the top-anchored palettes (CommandPalette / WorkspaceSearchPalette — `items-start pt-[18vh]`), use `octo-modal-enter` on the panel (fade+scale reads fine). Only append classes; no structural/behavior change. Verify each is actually conditionally rendered (so the class animates on mount); if a component is always-mounted and toggled via a prop, gate the class or skip and note it.

- [ ] **Step 2: verify + commit**

`npm run typecheck` → clean. `npm test` → green (report count; if any modal test asserts on classes, the additions are additive — confirm).
```bash
git add src/components/*.tsx
git commit -m "feat(motion): self-contained modals/palettes fade/scale in (Batch A pt2)"
```

---

## Task 6: Crossfades — Companion content + Settings panes (Batch C)

**Files:** `src/components/Companion.tsx`, `src/components/Settings.tsx`.

- [ ] **Step 1: Companion mode content**

In `Companion.tsx` (~110-121), the Talk/Run/Review content is conditionally rendered per `mode`. Wrap each conditionally-rendered pane so it carries `octo-fade-in` AND a `key` that changes with `mode` (so React replays the animation on switch):
```tsx
        <div key={mode} className="octo-fade-in ...existing wrapper classes...">
          {mode === "talk" && <CompanionHistory .../>}
          {mode === "run" && <CompanionTerminals .../>}
          {mode === "review" && <CompanionFileTree .../>}
        </div>
```
(Read the actual structure; if each pane has its own wrapper, add `octo-fade-in` + a per-pane `key`/the mode as key to each. The goal: content fades in to follow the ModeSwitcher glide. Ensure keying by mode doesn't drop important state — the panes already mount per-mode, so a mode-keyed wrapper is equivalent.)

- [ ] **Step 2: Settings panes**

In `Settings.tsx` (~94-100), each pane is `{tab === "general" && <GeneralPane/>}` etc. Wrap the pane area with `key={tab}` + `octo-fade-in` so switching tabs crossfades:
```tsx
        <div key={tab} className="octo-fade-in ...existing...">
          {tab === "general" && <GeneralPane/>}
          {tab === "models" && <ModelsPane/>}
          ...
        </div>
```

- [ ] **Step 3: verify + commit**

`npm run typecheck` → clean. `npm test` → green.
```bash
git add src/components/Companion.tsx src/components/Settings.tsx
git commit -m "feat(motion): crossfade Companion content + Settings panes (Batch C)"
```

---

## Task 7: Rail leftovers — row reveal + status dots (Batch D)

**Files:** `src/components/WorkspaceRail.tsx`.

- [ ] **Step 1: status indicators pop in**

In `WorkspaceRow`'s expanded trailing cluster, the ticket key / `↑N` / `↓N` / dirty dot / PR square spans appear instantly. Add `octo-pop-in` to each of those small indicator elements so they grow in when git/PR status loads. (Append the class to each indicator's className; keep everything else.)

- [ ] **Step 2: rows rise in**

Add `octo-rise-in` to the `WorkspaceRow` root element (both the expanded row container and the collapsed monogram button) so workspaces gently reveal when they mount (create) — matching the chat-message reveal feel. (This replays on project switch/expand; keep it subtle — `octo-rise-in` is a 4px rise + fade. If it reads as too busy on switch, downgrade to `octo-fade-in`. Use judgment and note which you chose.)

- [ ] **Step 3: verify + commit**

`npm run typecheck` → clean. `npm test` → green (the WorkspaceRail button-count tests are unaffected by added classes — confirm). `git diff -- src | grep -nE "#[0-9a-fA-F]{3,8}"` → empty.
```bash
git add src/components/WorkspaceRail.tsx
git commit -m "feat(motion): rail rows rise-in + status dots pop-in (Batch D)"
```

---

## Task 8: WelcomeScreen polish (Batch E)

**Files:** `src/components/WelcomeScreen.tsx`.

- [ ] **Step 1:** Add `octo-fade-in` to: the path-input row when `showPathInput` is true (it currently swaps instantly with the "open from disk" text — add the class to the input container), and the `{error && ...}` block. Optionally add `octo-rise-in` to the Recent/Recently-closed list containers so they reveal on load. Append classes only.

- [ ] **Step 2: verify + commit**

`npm run typecheck` → clean. `npm test` → green.
```bash
git add src/components/WelcomeScreen.tsx
git commit -m "feat(motion): WelcomeScreen path input/error/list reveals (Batch E)"
```

---

## Task 9: Full verification + rebuild

- [ ] `npm run typecheck && npm test` — green.
- [ ] `git diff main -- src | grep -nE "#[0-9a-fA-F]{3,8}" || echo clean`.
- [ ] Manual: open each modal/menu/palette → they fade+scale in (no pop); switch Companion modes + Settings tabs → content crossfades; status dots grow in; toasts still slide (unchanged). Toggle macOS "Reduce motion" → animations are instant (no motion), app fully usable.
- [ ] Rebuild the `.app` (wipe `bundle/`+`dist/`, touch `lib.rs`, `npm run tauri:build`).

---

## Self-Review (during planning)

- **DRY + safeguard:** one source of truth (the `.octo-*-enter` classes), documented in design-system.md §6 and mandated in CLAUDE.md/AGENTS.md + the submit checklist — so new features inherit the language.
- **On-brand:** scale ≤ 1 (0.97→1, never > 1.05 per the spec's forbidden list), 220–320ms, `--ease-octo`, no spring/bounce. Crossfades and grid-rows match existing patterns.
- **A11y:** `prefers-reduced-motion` guard neutralizes all primitives.
- **Low risk:** every apply step is an additive className (no structural/behavior change); toasts (already animated) untouched; backdrop colors unchanged. Each batch is independently shippable + reviewed.
- **Coverage:** Batch A (T4/T5 overlays+modals+palettes), B (T3 menus), C (T6 crossfades), D (T7 rail), E (T8 welcome). Exit animations and a `<ModalShell>` DRY refactor are noted as optional future work (this pass is enter-motion + the primitive/safeguard foundation).
```
