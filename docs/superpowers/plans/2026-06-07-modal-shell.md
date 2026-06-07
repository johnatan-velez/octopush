# `<ModalShell>` — DRY backdrop/chrome for dialogs — Plan 14

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Consolidate the ~11 modals' hand-rolled backdrop + Escape + click-outside + motion into one `<ModalShell>` component, standardizing the backdrop look (today there are 4 different colors) and giving every dialog consistent Escape-to-close — while preserving each modal's intended close-on-backdrop behavior.

**Architecture:** A reusable `<ModalShell onClose align? closeOnBackdrop? panelClassName? topOffset?>` renders the standardized backdrop (`bg-octo-onyx/80` + `octo-overlay-enter`), centers (or top-anchors) the panel, wires Escape + optional click-outside dismissal, and wraps children in a panel with `octo-modal-enter`. Each modal drops its own backdrop/Escape and renders just its content inside ModalShell. Inner per-field handlers (e.g. an input's own Escape) are preserved.

**Canonical backdrop:** `bg-octo-onyx/80` (most common today; on-token vs `bg-black/*`). Escape always closes. `closeOnBackdrop` default **true** (standard modal UX); set **false** for destructive/confirm dialogs to prevent accidental dismissal.

**Tech Stack:** React 19 + TS, Tailwind tokens, Vitest. No new deps. (Motion classes from Plan 12 already exist.)

---

## Task 1: Create `<ModalShell>`

**Files:** Create `src/components/ModalShell.tsx`.

- [ ] **Step 1: the component**

```tsx
import { useEffect, useRef } from "react";

interface Props {
  /** Close handler (Escape, and backdrop click when closeOnBackdrop). */
  onClose: () => void;
  children: React.ReactNode;
  /** Vertical placement. "top" anchors near the top (command palettes). */
  align?: "center" | "top";
  /** Dismiss on backdrop click. Default true; set false for confirm dialogs. */
  closeOnBackdrop?: boolean;
  /** Extra classes for the panel wrapper (sizing/layout lives on the child;
   *  this is only the animated wrapper). */
  panelClassName?: string;
  /** Tailwind top padding for align="top" (e.g. "pt-[18vh]"). */
  topOffset?: string;
  /** Accessible label for the dialog. */
  ariaLabel?: string;
}

/**
 * Standard modal chrome: a tokenized backdrop + centered/top panel with the
 * app's entrance motion, Escape-to-close, and optional click-outside. The
 * canonical way to present a dialog (see CLAUDE.md motion rule / design-system).
 */
export function ModalShell({
  onClose,
  children,
  align = "center",
  closeOnBackdrop = true,
  panelClassName = "",
  topOffset = "pt-[18vh]",
  ariaLabel,
}: Props) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const justify = align === "top" ? `items-start ${topOffset}` : "items-center";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      className={`fixed inset-0 z-50 flex justify-center ${justify} bg-octo-onyx/80 p-6 octo-overlay-enter`}
      onClick={closeOnBackdrop ? () => onClose() : undefined}
    >
      <div
        className={`octo-modal-enter ${panelClassName}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: verify + commit**

`npm run typecheck` → clean. `npm test` → green.
```bash
git add src/components/ModalShell.tsx
git commit -m "feat(ui): ModalShell — standardized dialog backdrop + motion + dismissal"
```

---

## Task 2: Migrate self-contained modals (batch 1)

**Files:** `ConfirmDialog.tsx`, `JiraTicketPickerModal.tsx`, `JiraProjectKeyModal.tsx`, `ElsewhereModal.tsx`, `NewSessionDialog.tsx`, `ProjectPickerModal.tsx`, `ExistingWorkspaceAlertModal.tsx`.

For EACH: replace the hand-rolled backdrop `<div className="fixed/absolute inset-0 ... bg-* ... octo-overlay-enter">` + its own Escape `useEffect`/`onKeyDown` + the inner panel wrapper with `<ModalShell>`. The panel's sizing/border/bg classes move to `panelClassName` (or stay on the child's own root — keep the existing card div as the child, drop only the OUTER backdrop wrapper).

- [ ] **Step 1: migrate, preserving behavior per modal**

Pattern (illustrative for JiraTicketPickerModal):
```tsx
// before:
//   <div className="fixed inset-0 z-50 flex items-center justify-center bg-octo-onyx/80 p-6 octo-overlay-enter">
//     <div className="flex max-h-[80vh] w-[560px] ... bg-octo-panel octo-modal-enter"> ...content... </div>
//   </div>
// after:
//   <ModalShell onClose={onClose} ariaLabel="...">
//     <div className="flex max-h-[80vh] w-[560px] ... bg-octo-panel"> ...content... </div>
//   </ModalShell>
```
Remove each modal's own `octo-overlay-enter`/`octo-modal-enter` (ModalShell adds them) and its own Escape handler `useEffect`/`onKeyDown` on the backdrop (ModalShell handles Escape). KEEP inner-field handlers (e.g. a search input's own keydown for arrow-nav). 

**closeOnBackdrop per modal (preserve/standardize):**
- `ConfirmDialog` → **`closeOnBackdrop={false}`** (it's a confirm; today it DOES close on backdrop via `onClick={onCancel}` — but a confirm shouldn't dismiss accidentally; set false. NOTE: this is a deliberate behavior tightening; if you'd rather preserve exactly, set true — but false is the safer confirm UX. Use false.)
- `ExistingWorkspaceAlertModal` → **`closeOnBackdrop={false}`** (alert/confirm; today no click-outside — keep that).
- `JiraTicketPickerModal`, `JiraProjectKeyModal`, `ProjectPickerModal`, `ElsewhereModal` → today NO click-outside (backdrop had no onClick). Set **`closeOnBackdrop={true}`** to standardize (adds the standard dismiss; a picker dismissing on outside-click is expected UX). If any of these has unsaved-input risk, use false — use judgment and note it.
- `NewSessionDialog` → today closes on backdrop → **`closeOnBackdrop={true}`**.

Pass `onClose`/`onCancel` as the modal's existing close callback to `onClose`. For modals gated by `if (!open) return null`, keep that guard (ModalShell only renders when the modal renders).

- [ ] **Step 2: verify + commit**

`npm run typecheck` → clean. `npm test` → green (report count; several have tests — confirm they pass; if a test asserted the old backdrop class/structure, update minimally + note it). `git diff -- src | grep -nE "#[0-9a-fA-F]{3,8}"` → empty.
```bash
git add src/components/ConfirmDialog.tsx src/components/JiraTicketPickerModal.tsx src/components/JiraProjectKeyModal.tsx src/components/ElsewhereModal.tsx src/components/NewSessionDialog.tsx src/components/ProjectPickerModal.tsx src/components/ExistingWorkspaceAlertModal.tsx
git commit -m "refactor(ui): migrate dialogs to ModalShell (standardized chrome)"
```

---

## Task 3: Migrate the command/search palettes (top-anchored)

**Files:** `CommandPalette.tsx`, `WorkspaceSearchPalette.tsx`.

- [ ] **Step 1:** Replace their backdrop (`fixed inset-0 ... items-start pt-[18vh]/pt-[14vh] ... octo-overlay-enter`, onClick=onClose, inner stopPropagation) with `<ModalShell onClose={onClose} align="top" topOffset="pt-[18vh]" /* or pt-[14vh] */>`. KEEP the inner panel content + the palette's OWN keydown handler for arrow-key list navigation (that lives on the inner element, not the backdrop — ModalShell's Escape covers Escape; if the palette's keydown also handles Escape, that's now redundant but harmless, or remove the Escape branch from the inner handler). `closeOnBackdrop` default true (both currently close on backdrop). Note the topOffset each uses (CommandPalette 18vh, Search 14vh).

- [ ] **Step 2: verify + commit**

`npm run typecheck` → clean. `npm test` → green.
```bash
git add src/components/CommandPalette.tsx src/components/WorkspaceSearchPalette.tsx
git commit -m "refactor(ui): command + search palettes use ModalShell (top-anchored)"
```

---

## Task 4: Migrate the App.tsx inline overlays

**Files:** `src/App.tsx`.

The App renders some modals as inline overlays: `{state && (<div className="...bg-black/30... octo-overlay-enter" onClick=dismiss><div className="octo-modal-enter" onClick=stop><Content/></div></div>)}`. Replace each with `<ModalShell>`.

- [ ] **Step 1:** For the inline overlays around `renamingWorkspace` (RenameDialog), `archivedForProject` (ArchivedWorkspacesModal), `showProjectCustomizer` (ProjectCustomizeMenu), `customizingWorkspace` (WorkspaceCustomizeMenu): replace the `<div backdrop><div content>...</div></div>` wrapper with `<ModalShell onClose={() => setX(null)}>...the dialog component...</ModalShell>`. The dialog components (RenameDialog/ArchivedWorkspacesModal/etc.) already have their own card styling, so they go directly as ModalShell children. Drop the inline `bg-black/30` overlay + the octo-* classes (ModalShell provides them). `closeOnBackdrop` true (they currently dismiss on backdrop). Keep the dialogs' own onCancel/onClose props wired to the same state setters.
NOTE: the full-screen surfaces (`showCreator`, the empty-project layer, `showAddProject`, `creatorForTicket`) are NOT dialogs — LEAVE them as-is (they use `octo-fade-in` full-screen; ModalShell is for centered dialogs only).

- [ ] **Step 2: verify + commit**

`npm run typecheck` → clean. `npm test` → green (report count). `git diff -- src | grep -nE "#[0-9a-fA-F]{3,8}"` → empty.
```bash
git add src/App.tsx
git commit -m "refactor(ui): App inline dialog overlays use ModalShell"
```

---

## Task 5: Verification + rebuild

- [ ] `npm run typecheck && npm test` — green.
- [ ] `git diff main -- src | grep -nE "#[0-9a-fA-F]{3,8}" || echo clean`.
- [ ] Manual: every dialog now has the SAME backdrop look + fade/scale entrance + Escape closes; pickers/palettes dismiss on outside click; confirm/alert dialogs do NOT dismiss on outside click (only their buttons / Escape). No dialog regressed (content, submit, focus).
- [ ] Rebuild the `.app` (wipe `bundle/`+`dist/`, touch `lib.rs`, `npm run tauri:build`).

---

## Self-Review (during planning)

- **DRY + consistency:** one backdrop look (`bg-octo-onyx/80`), one entrance motion, uniform Escape; ~11 modals lose their boilerplate. `closeOnBackdrop` preserves confirm-dialog safety (false) while standardizing pickers (true).
- **Safeguard:** ModalShell becomes the documented way to present a dialog (the CLAUDE.md motion rule already mandates the classes; ModalShell bundles them + chrome). Consider a follow-up doc line pointing new dialogs at ModalShell.
- **Risk:** behavior-preserving migration (each modal keeps its close callback + inner handlers); the only intentional changes are backdrop color unification, adding Escape where missing, and `closeOnBackdrop` per modal (documented). Tests + per-batch review guard it. Full-screen surfaces excluded.
- **A11y:** ModalShell sets `role="dialog"`/`aria-modal`; Escape always works; reduced-motion already neutralizes the entrance.
```
