# G1 · Editor Engine — Slice I Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add find/replace, go-to-line, full multi-cursor, soft-wrap, persisted editor preferences, a signature Atelier editor status bar, and per-tab state preservation to Octopush's in-app CodeMirror 6 editor.

**Architecture:** A new persisted `editorPrefsStore` holds editor-wide prefs; `EditorPane` is refactored from destroy-on-file-switch to a single long-lived `EditorView` that swaps per-tab `EditorState`s and reconfigures prefs live via CodeMirror `Compartment`s; a presentational `EditorStatusBar` surfaces position + clickable prefs; `@codemirror/search` provides find/go-to-line/multi-cursor; a pure occurrence-matcher backs a custom select-all-occurrences command.

**Tech Stack:** React 19 + TypeScript, Zustand (+persist), CodeMirror 6 (`@codemirror/{view,state,search,commands,language}`), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-08-review-g1-editor-engine-design.md`

**Branch:** `feat/review-g1-editor` (worktree `octopus-sh-review`, off `main`).

---

## File structure

| File | Responsibility | Task |
|------|----------------|------|
| `src/stores/editorPrefsStore.ts` *(new)* | Persisted editor-wide prefs (wrap/fontSize/tabWidth/lineNumbers) + setters | 1 |
| `src/stores/editorPrefsStore.test.ts` *(new)* | Unit tests for the store | 1 |
| `src/components/EditorTabs.tsx` *(modify)* | Tier-0: token + tab a11y roles + focus rings | 2 |
| `src/components/EditorTabs.test.tsx` *(modify)* | Assert roles/aria/no-rgba | 2 |
| `src/components/editor/multiCursor.ts` *(new)* | Pure occurrence matcher + `selectAllOccurrences` command | 3 |
| `src/components/editor/multiCursor.test.ts` *(new)* | Unit tests for the matcher | 3 |
| `src/components/EditorStatusBar.tsx` *(new)* | Signature status bar (position + clickable prefs) | 4 |
| `src/components/EditorStatusBar.test.tsx` *(new)* | Render + interaction tests | 4 |
| `src/components/editor/atelierTheme.ts` *(modify)* | Atelier styling for the search/go-to-line panel | 5 |
| `src/components/EditorPane.tsx` *(modify)* | Persistent view, compartments, search/multicursor, per-tab state, status bar, cursor publish | 6 |
| `src/components/EditorPane.test.tsx` *(modify)* | Update mocks; smoke tests stay green | 6 |

`package.json` gains `@codemirror/search` (Task 6, step 1).

> **Note on `--brass-faint`:** the token **already exists** in `src/styles.css:47`
> (`--brass-faint: rgba(212, 165, 116, 0.04)`). No token addition is needed — Task 2
> just references `var(--brass-faint)`.

> **Testing reality:** `EditorPane.test.tsx` fully mocks CodeMirror (jsdom can't lay
> out a real `EditorView`). Deep CM behavior (compartment reconfigure, search) is
> therefore verified by typecheck + `npm run build` + the pure-unit tests in Tasks 1/3/4,
> not by driving a live view. Keep that boundary — do not try to un-mock CM in Task 6.

---

## Task 1: editorPrefsStore (persisted prefs)

**Files:**
- Create: `src/stores/editorPrefsStore.ts`
- Test: `src/stores/editorPrefsStore.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/stores/editorPrefsStore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useEditorPrefs, FONT_MIN, FONT_MAX, TAB_WIDTHS } from "./editorPrefsStore";

function reset() {
  // Reset to defaults between tests (store is a singleton).
  useEditorPrefs.setState({ wrap: false, fontSize: 13, tabWidth: 2, lineNumbers: true });
}

describe("editorPrefsStore", () => {
  beforeEach(reset);

  it("has sensible defaults", () => {
    const s = useEditorPrefs.getState();
    expect(s.wrap).toBe(false);
    expect(s.fontSize).toBe(13);
    expect(s.tabWidth).toBe(2);
    expect(s.lineNumbers).toBe(true);
  });

  it("toggleWrap flips wrap", () => {
    useEditorPrefs.getState().toggleWrap();
    expect(useEditorPrefs.getState().wrap).toBe(true);
    useEditorPrefs.getState().toggleWrap();
    expect(useEditorPrefs.getState().wrap).toBe(false);
  });

  it("toggleLineNumbers flips lineNumbers", () => {
    useEditorPrefs.getState().toggleLineNumbers();
    expect(useEditorPrefs.getState().lineNumbers).toBe(false);
  });

  it("bumpFontSize clamps to [FONT_MIN, FONT_MAX]", () => {
    useEditorPrefs.setState({ fontSize: FONT_MAX });
    useEditorPrefs.getState().bumpFontSize(5);
    expect(useEditorPrefs.getState().fontSize).toBe(FONT_MAX);
    useEditorPrefs.setState({ fontSize: FONT_MIN });
    useEditorPrefs.getState().bumpFontSize(-5);
    expect(useEditorPrefs.getState().fontSize).toBe(FONT_MIN);
    useEditorPrefs.setState({ fontSize: 13 });
    useEditorPrefs.getState().bumpFontSize(1);
    expect(useEditorPrefs.getState().fontSize).toBe(14);
  });

  it("setFontSize clamps out-of-range values", () => {
    useEditorPrefs.getState().setFontSize(999);
    expect(useEditorPrefs.getState().fontSize).toBe(FONT_MAX);
    useEditorPrefs.getState().setFontSize(1);
    expect(useEditorPrefs.getState().fontSize).toBe(FONT_MIN);
  });

  it("setTabWidth ignores values not in TAB_WIDTHS", () => {
    useEditorPrefs.getState().setTabWidth(4);
    expect(useEditorPrefs.getState().tabWidth).toBe(4);
    useEditorPrefs.getState().setTabWidth(3 as unknown as number);
    expect(useEditorPrefs.getState().tabWidth).toBe(4); // unchanged
  });

  it("cycleTabWidth walks 2 → 4 → 8 → 2", () => {
    useEditorPrefs.setState({ tabWidth: 2 });
    useEditorPrefs.getState().cycleTabWidth();
    expect(useEditorPrefs.getState().tabWidth).toBe(4);
    useEditorPrefs.getState().cycleTabWidth();
    expect(useEditorPrefs.getState().tabWidth).toBe(8);
    useEditorPrefs.getState().cycleTabWidth();
    expect(useEditorPrefs.getState().tabWidth).toBe(2);
  });

  it("TAB_WIDTHS is [2,4,8]", () => {
    expect(TAB_WIDTHS).toEqual([2, 4, 8]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/jonathan/TYPEFY/octopus/octopus-sh-review && npx vitest run src/stores/editorPrefsStore.test.ts`
Expected: FAIL — `Cannot find module './editorPrefsStore'`.

- [ ] **Step 3: Implement the store**

```ts
// src/stores/editorPrefsStore.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const FONT_MIN = 10;
export const FONT_MAX = 22;
export const TAB_WIDTHS = [2, 4, 8] as const;

const clampFont = (n: number) => Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(n)));

export interface EditorPrefs {
  wrap: boolean;
  fontSize: number;
  tabWidth: number;
  lineNumbers: boolean;
}

interface EditorPrefsStore extends EditorPrefs {
  setWrap: (v: boolean) => void;
  toggleWrap: () => void;
  setFontSize: (px: number) => void;
  bumpFontSize: (delta: number) => void;
  setTabWidth: (n: number) => void;
  cycleTabWidth: () => void;
  setLineNumbers: (v: boolean) => void;
  toggleLineNumbers: () => void;
}

export const useEditorPrefs = create<EditorPrefsStore>()(
  persist(
    (set, get) => ({
      wrap: false,
      fontSize: 13,
      tabWidth: 2,
      lineNumbers: true,

      setWrap: (v) => set({ wrap: v }),
      toggleWrap: () => set((s) => ({ wrap: !s.wrap })),

      setFontSize: (px) => set({ fontSize: clampFont(px) }),
      bumpFontSize: (delta) => set((s) => ({ fontSize: clampFont(s.fontSize + delta) })),

      setTabWidth: (n) => {
        if ((TAB_WIDTHS as readonly number[]).includes(n)) set({ tabWidth: n });
      },
      cycleTabWidth: () =>
        set((s) => {
          const i = (TAB_WIDTHS as readonly number[]).indexOf(s.tabWidth);
          const next = TAB_WIDTHS[(i + 1) % TAB_WIDTHS.length];
          return { tabWidth: next };
        }),

      setLineNumbers: (v) => set({ lineNumbers: v }),
      toggleLineNumbers: () => set((s) => ({ lineNumbers: !s.lineNumbers })),
    }),
    {
      name: "octo-editor-prefs",
      partialize: (s) => ({
        wrap: s.wrap,
        fontSize: s.fontSize,
        tabWidth: s.tabWidth,
        lineNumbers: s.lineNumbers,
      }),
    },
  ),
);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/stores/editorPrefsStore.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stores/editorPrefsStore.ts src/stores/editorPrefsStore.test.ts
git commit -m "feat(g1): editorPrefsStore — persisted editor-wide prefs"
```

---

## Task 2: Tier-0 — EditorTabs token + tab a11y

**Files:**
- Modify: `src/components/EditorTabs.tsx`
- Test: `src/components/EditorTabs.test.tsx`

- [ ] **Step 1: Add the failing a11y/token tests**

Append these tests inside the existing `describe("EditorTabs", ...)` block in `src/components/EditorTabs.test.tsx`:

```ts
  it("exposes the tablist/tab roles with aria-selected on the active tab", () => {
    render(<EditorTabs workspaceId="ws-1" />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    // foo.ts is active in the mock
    const active = tabs.find((t) => t.getAttribute("aria-selected") === "true");
    expect(active).toBeTruthy();
    expect(active).toHaveTextContent("foo.ts");
  });

  it("has no hardcoded rgba color literal", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./EditorTabs.tsx", import.meta.url), "utf8"),
    );
    expect(src).not.toMatch(/rgba\(/);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/EditorTabs.test.tsx`
Expected: FAIL — no `tablist` role found; and the rgba-literal assertion fails (the file still contains `rgba(212, 165, 116, 0.04)`).

- [ ] **Step 3: Update EditorTabs.tsx**

Replace the outer container `<div ...>` opening tag (current lines 17-20) with a `role="tablist"` version:

```tsx
    <div
      role="tablist"
      aria-label="Open files"
      className="flex overflow-x-auto border-b border-octo-hairline bg-octo-panel"
      style={{ scrollbarWidth: "none" }}
    >
```

Replace the per-tab `<div ...>` (current lines 27-39) so it is a tab with role, selection state, focus ring, and the token instead of the rgba literal:

```tsx
          <div
            key={file.path}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            data-testid={`tab-${file.path}`}
            className="group relative flex shrink-0 cursor-pointer items-center gap-1.5 px-3 py-2 transition-colors duration-[220ms] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-octo-brass"
            style={{
              borderBottom: isActive
                ? "2px solid var(--color-octo-brass)"
                : "2px solid transparent",
              background: isActive ? "var(--brass-faint)" : "transparent",
            }}
            onClick={() => setActive(workspaceId, file.path)}
          >
```

> Leave the rest of the tab (filename span, dirty dot, close button) unchanged.
> Keyboard arrow-navigation between tabs, truncation tooltips, and drag-reorder are
> **Slice II** — do not add them here.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/components/EditorTabs.test.tsx`
Expected: PASS (all original tests + the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/components/EditorTabs.tsx src/components/EditorTabs.test.tsx
git commit -m "fix(g1): EditorTabs Tier-0 — brass-faint token + tab roles/aria/focus ring"
```

---

## Task 3: Multi-cursor — occurrence matcher + selectAllOccurrences command

**Files:**
- Create: `src/components/editor/multiCursor.ts`
- Test: `src/components/editor/multiCursor.test.ts`

- [ ] **Step 1: Write the failing tests for the pure matcher**

```ts
// src/components/editor/multiCursor.test.ts
import { describe, it, expect } from "vitest";
import { computeOccurrenceRanges } from "./multiCursor";

describe("computeOccurrenceRanges", () => {
  it("finds every non-overlapping occurrence", () => {
    const doc = "key key key";
    expect(computeOccurrenceRanges(doc, "key")).toEqual([
      { from: 0, to: 3 },
      { from: 4, to: 7 },
      { from: 8, to: 11 },
    ]);
  });

  it("does not overlap matches", () => {
    // "aa" in "aaaa" → positions 0 and 2, not 0,1,2
    expect(computeOccurrenceRanges("aaaa", "aa")).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ]);
  });

  it("returns [] for an empty query", () => {
    expect(computeOccurrenceRanges("abc", "")).toEqual([]);
  });

  it("returns [] when there is no match", () => {
    expect(computeOccurrenceRanges("abc", "xyz")).toEqual([]);
  });

  it("is case-sensitive", () => {
    expect(computeOccurrenceRanges("Key key", "key")).toEqual([{ from: 4, to: 7 }]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/editor/multiCursor.test.ts`
Expected: FAIL — `Cannot find module './multiCursor'`.

- [ ] **Step 3: Implement the matcher and the command**

```ts
// src/components/editor/multiCursor.ts
import { EditorSelection } from "@codemirror/state";
import type { Command } from "@codemirror/view";

export interface MatchRange {
  from: number;
  to: number;
}

/** All non-overlapping occurrences of `query` in `doc`, left to right. */
export function computeOccurrenceRanges(doc: string, query: string): MatchRange[] {
  if (!query) return [];
  const out: MatchRange[] = [];
  let i = doc.indexOf(query);
  while (i !== -1) {
    out.push({ from: i, to: i + query.length });
    i = doc.indexOf(query, i + query.length); // non-overlapping
  }
  return out;
}

/**
 * Select every occurrence of the main selection's text (or the word under the
 * caret if the selection is empty). Places one cursor/selection per match.
 * Returns false (no-op) when there is nothing to expand to.
 */
export const selectAllOccurrences: Command = (view) => {
  const state = view.state;
  const main = state.selection.main;

  let query: string;
  let anchorFrom: number;
  if (main.empty) {
    const word = state.wordAt(main.head);
    if (!word) return false;
    query = state.sliceDoc(word.from, word.to);
    anchorFrom = word.from;
  } else {
    query = state.sliceDoc(main.from, main.to);
    anchorFrom = main.from;
  }

  const ranges = computeOccurrenceRanges(state.doc.toString(), query);
  if (ranges.length < 2) return false;

  const selRanges = ranges.map((r) => EditorSelection.range(r.from, r.to));
  // Keep the originally-selected occurrence as the main range.
  const mainIndex = Math.max(0, ranges.findIndex((r) => r.from === anchorFrom));

  view.dispatch({
    selection: EditorSelection.create(selRanges, mainIndex),
    scrollIntoView: true,
  });
  return true;
};
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/components/editor/multiCursor.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/multiCursor.ts src/components/editor/multiCursor.test.ts
git commit -m "feat(g1): multi-cursor occurrence matcher + selectAllOccurrences command"
```

---

## Task 4: EditorStatusBar (signature surface)

**Files:**
- Create: `src/components/EditorStatusBar.tsx`
- Test: `src/components/EditorStatusBar.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/EditorStatusBar.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const toggleWrap = vi.fn();
const toggleLineNumbers = vi.fn();
const cycleTabWidth = vi.fn();
const bumpFontSize = vi.fn();

vi.mock("../stores/editorPrefsStore", () => ({
  useEditorPrefs: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      wrap: false,
      lineNumbers: true,
      tabWidth: 2,
      fontSize: 13,
      toggleWrap,
      toggleLineNumbers,
      cycleTabWidth,
      bumpFontSize,
    }),
  ),
}));

import { EditorStatusBar } from "./EditorStatusBar";

beforeEach(() => vi.clearAllMocks());

describe("EditorStatusBar", () => {
  it("shows the caret position", () => {
    render(<EditorStatusBar line={41} col={18} selectionCount={1} lang="rust" />);
    expect(screen.getByText(/Ln 41, Col 18/)).toBeInTheDocument();
    expect(screen.getByText("rust")).toBeInTheDocument();
  });

  it("shows selection count only when more than one selection", () => {
    const { rerender } = render(
      <EditorStatusBar line={1} col={1} selectionCount={1} lang="rust" />,
    );
    expect(screen.queryByText(/selections/)).not.toBeInTheDocument();
    rerender(<EditorStatusBar line={1} col={1} selectionCount={3} lang="rust" />);
    expect(screen.getByText("3 selections")).toBeInTheDocument();
  });

  it("clicking the wrap segment toggles wrap", async () => {
    render(<EditorStatusBar line={1} col={1} selectionCount={1} lang="rust" />);
    await userEvent.click(screen.getByTestId("statusbar-wrap"));
    expect(toggleWrap).toHaveBeenCalledOnce();
  });

  it("clicking the line-numbers segment toggles line numbers", async () => {
    render(<EditorStatusBar line={1} col={1} selectionCount={1} lang="rust" />);
    await userEvent.click(screen.getByTestId("statusbar-linenumbers"));
    expect(toggleLineNumbers).toHaveBeenCalledOnce();
  });

  it("clicking the indent segment cycles tab width", async () => {
    render(<EditorStatusBar line={1} col={1} selectionCount={1} lang="rust" />);
    await userEvent.click(screen.getByTestId("statusbar-indent"));
    expect(cycleTabWidth).toHaveBeenCalledOnce();
  });

  it("font steppers bump the size up and down", async () => {
    render(<EditorStatusBar line={1} col={1} selectionCount={1} lang="rust" />);
    await userEvent.click(screen.getByTestId("statusbar-font-inc"));
    await userEvent.click(screen.getByTestId("statusbar-font-dec"));
    expect(bumpFontSize).toHaveBeenNthCalledWith(1, 1);
    expect(bumpFontSize).toHaveBeenNthCalledWith(2, -1);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/EditorStatusBar.test.tsx`
Expected: FAIL — `Cannot find module './EditorStatusBar'`.

- [ ] **Step 3: Implement the component**

```tsx
// src/components/EditorStatusBar.tsx
import { useEditorPrefs } from "../stores/editorPrefsStore";

interface Props {
  line: number;
  col: number;
  selectionCount: number;
  lang: string;
}

const SEG =
  "flex h-full items-center gap-1.5 px-2.5 font-mono text-[10.5px] text-octo-mute";
const CLICK =
  "transition-colors hover:bg-octo-panel hover:text-octo-sage focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-octo-brass";

export function EditorStatusBar({ line, col, selectionCount, lang }: Props) {
  const wrap = useEditorPrefs((s) => s.wrap);
  const lineNumbers = useEditorPrefs((s) => s.lineNumbers);
  const tabWidth = useEditorPrefs((s) => s.tabWidth);
  const fontSize = useEditorPrefs((s) => s.fontSize);
  const toggleWrap = useEditorPrefs((s) => s.toggleWrap);
  const toggleLineNumbers = useEditorPrefs((s) => s.toggleLineNumbers);
  const cycleTabWidth = useEditorPrefs((s) => s.cycleTabWidth);
  const bumpFontSize = useEditorPrefs((s) => s.bumpFontSize);

  return (
    <div className="flex h-[26px] shrink-0 items-stretch border-t border-octo-hairline bg-octo-onyx">
      {/* Language */}
      <div className={SEG}>
        <span className="h-[5px] w-[5px] rounded-full bg-octo-brass" />
        <span className="text-octo-brass">{lang}</span>
      </div>

      {/* Caret position */}
      <div className={SEG}>
        Ln <span className="text-octo-sage">{line}</span>, Col{" "}
        <span className="text-octo-sage">{col}</span>
      </div>

      {/* Multi-cursor count */}
      {selectionCount > 1 && (
        <div className={`${SEG} text-octo-brass`}>{selectionCount} selections</div>
      )}

      {/* Right group */}
      <div className="ml-auto flex items-stretch">
        <button type="button" data-testid="statusbar-indent" onClick={cycleTabWidth} className={`${SEG} ${CLICK}`}>
          Spaces: <span className="text-octo-sage">{tabWidth}</span>
        </button>
        <button type="button" data-testid="statusbar-wrap" onClick={toggleWrap} className={`${SEG} ${CLICK}`}>
          Wrap <span className={wrap ? "text-octo-brass" : "text-octo-mute"}>{wrap ? "on" : "off"}</span>
        </button>
        <button type="button" data-testid="statusbar-linenumbers" onClick={toggleLineNumbers} className={`${SEG} ${CLICK}`}>
          Ln# <span className={lineNumbers ? "text-octo-brass" : "text-octo-mute"}>{lineNumbers ? "on" : "off"}</span>
        </button>
        <div className={SEG}>
          <button type="button" data-testid="statusbar-font-dec" onClick={() => bumpFontSize(-1)} className={`px-1 ${CLICK}`} aria-label="Decrease font size">−</button>
          <span>Aa <span className="text-octo-sage">{fontSize}</span></span>
          <button type="button" data-testid="statusbar-font-inc" onClick={() => bumpFontSize(1)} className={`px-1 ${CLICK}`} aria-label="Increase font size">＋</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/components/EditorStatusBar.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/EditorStatusBar.tsx src/components/EditorStatusBar.test.tsx
git commit -m "feat(g1): EditorStatusBar — Atelier editor status bar with live prefs"
```

---

## Task 5: Atelier theming for the search/go-to-line panel

**Files:**
- Modify: `src/components/editor/atelierTheme.ts`
- Test: `src/components/editor/atelierTheme.test.ts` *(new)*

- [ ] **Step 1: Write a failing test asserting the theme styles the search panel**

```ts
// src/components/editor/atelierTheme.test.ts
import { describe, it, expect } from "vitest";
import { atelierTheme } from "./atelierTheme";

describe("atelierTheme", () => {
  it("is a non-empty extension array", () => {
    expect(Array.isArray(atelierTheme)).toBe(true);
    expect((atelierTheme as unknown[]).length).toBeGreaterThanOrEqual(2);
  });

  it("source defines panel + search selectors so the find UI is themed", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./atelierTheme.ts", import.meta.url), "utf8"),
    );
    expect(src).toContain(".cm-panels");
    expect(src).toContain(".cm-search");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/editor/atelierTheme.test.ts`
Expected: FAIL — source contains neither `.cm-panels` nor `.cm-search` yet.

- [ ] **Step 3: Add the panel styling to `atelierEditorTheme`**

Inside the `EditorView.theme({ ... }, { dark: true })` object in `src/components/editor/atelierTheme.ts`, add these selectors just before the closing `".cm-scroller"` entry (reuse the existing `PANEL`, `HAIRLINE`, `ONYX`, `IVORY`, `MUTE`, `BRASS`, `BRASS_GHOST` consts):

```ts
    // ── Search / go-to-line panel (Atelier) ─────────────────────────
    ".cm-panels": {
      backgroundColor: PANEL,
      color: IVORY,
      borderTop: `1px solid ${HAIRLINE}`,
    },
    ".cm-panels.cm-panels-top": {
      borderBottom: `1px solid ${HAIRLINE}`,
      borderTop: "none",
    },
    ".cm-panel.cm-search": {
      padding: "6px 8px",
      fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, Consolas, monospace',
      fontSize: "11px",
    },
    ".cm-panel.cm-search input, .cm-panel.cm-search input[type=text]": {
      backgroundColor: ONYX,
      color: IVORY,
      border: `1px solid ${HAIRLINE}`,
      borderRadius: "4px",
      padding: "2px 6px",
      outline: "none",
    },
    ".cm-panel.cm-search input:focus": {
      borderColor: BRASS,
    },
    ".cm-panel.cm-search .cm-button": {
      backgroundColor: "transparent",
      backgroundImage: "none",
      color: SAGE,
      border: `1px solid ${HAIRLINE}`,
      borderRadius: "4px",
      padding: "2px 8px",
    },
    ".cm-panel.cm-search .cm-button:hover": {
      color: IVORY,
      borderColor: BRASS,
    },
    ".cm-panel.cm-search label": {
      color: MUTE,
      fontSize: "11px",
    },
    ".cm-panel.cm-search .cm-textfield:focus": {
      borderColor: BRASS,
    },
    ".cm-searchMatch": {
      backgroundColor: BRASS_GHOST,
      outline: `1px solid ${HAIRLINE}`,
    },
    ".cm-searchMatch-selected": {
      backgroundColor: "rgba(212, 165, 116, 0.22)",
    },
    ".cm-panel button[name=close]": {
      color: MUTE,
    },
    ".cm-panel button[name=close]:hover": {
      color: IVORY,
    },
```

> These hex/rgba literals are inside `atelierTheme.ts`, which the design system
> explicitly exempts (CodeMirror's `theme()` takes JS objects, not CSS vars). Do not
> introduce hardcoded colors anywhere else.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/editor/atelierTheme.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/atelierTheme.ts src/components/editor/atelierTheme.test.ts
git commit -m "feat(g1): Atelier styling for the CodeMirror search/go-to-line panel"
```

---

## Task 6: EditorPane integration — persistent view, compartments, search, multi-cursor, per-tab state, status bar

**Files:**
- Modify: `package.json` (add `@codemirror/search`)
- Modify: `src/components/EditorPane.tsx`
- Modify: `src/components/EditorPane.test.tsx`

- [ ] **Step 1: Install the search package**

Run: `cd /Users/jonathan/TYPEFY/octopus/octopus-sh-review && npm install @codemirror/search@^6`
Expected: `package.json` + `package-lock.json` updated; no errors.

- [ ] **Step 2: Update the test mocks so the existing smoke tests still run**

In `src/components/EditorPane.test.tsx`, the `@codemirror/view` mock must gain `setState`, `lineWrapping`, `rectangularSelection`, `crosshairCursor`, and `Decoration`/`highlightActiveLine`-style stubs used by the new imports; the `@codemirror/state` mock must gain `Compartment` and `EditorSelection`; add a `@codemirror/search` mock; add an `@codemirror/lang-*` set already present. Replace the top mock blocks with:

```ts
vi.mock("@codemirror/view", () => {
  class EditorViewMock {
    dom = document.createElement("div");
    state = { doc: { toString: () => "" }, selection: { main: { head: 0 } } };
    destroy = vi.fn();
    dispatch = vi.fn();
    setState = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(_config: any) {}
    static updateListener = { of: vi.fn(() => ({})) };
    static theme = vi.fn(() => ({}));
    static lineWrapping = {};
  }
  return {
    EditorView: EditorViewMock,
    lineNumbers: vi.fn(() => ({})),
    highlightActiveLineGutter: vi.fn(() => ({})),
    highlightActiveLine: vi.fn(() => ({})),
    drawSelection: vi.fn(() => ({})),
    rectangularSelection: vi.fn(() => ({})),
    crosshairCursor: vi.fn(() => ({})),
    keymap: { of: vi.fn(() => ({})) },
  };
});

vi.mock("@codemirror/state", () => {
  class CompartmentMock {
    of = vi.fn(() => ({}));
    reconfigure = vi.fn(() => ({}));
  }
  return {
    EditorState: {
      create: vi.fn().mockReturnValue({ doc: { toString: () => "" } }),
      tabSize: { of: vi.fn(() => ({})) },
    },
    Compartment: CompartmentMock,
    EditorSelection: { range: vi.fn(() => ({})), create: vi.fn(() => ({})) },
  };
});

vi.mock("@codemirror/search", () => ({
  search: vi.fn(() => ({})),
  searchKeymap: [],
  gotoLine: vi.fn(() => true),
}));

vi.mock("@codemirror/language", () => ({
  indentOnInput: vi.fn(() => ({})),
  bracketMatching: vi.fn(() => ({})),
  foldGutter: vi.fn(() => ({})),
  indentUnit: { of: vi.fn(() => ({})) },
}));
```

Also add a mock for the new multi-cursor module so EditorPane's import resolves:

```ts
vi.mock("./editor/multiCursor", () => ({
  selectAllOccurrences: vi.fn(() => true),
}));
```

And mock the prefs store and status bar so the smoke tests stay isolated:

```ts
vi.mock("../stores/editorPrefsStore", () => ({
  useEditorPrefs: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ wrap: false, fontSize: 13, tabWidth: 2, lineNumbers: true }),
  ),
}));
vi.mock("./EditorStatusBar", () => ({
  EditorStatusBar: () => <div data-testid="status-bar" />,
}));
```

> Keep the two existing tests (`shows empty state…`, `renders editor-host div…`)
> unchanged — they must still pass after the refactor.

- [ ] **Step 3: Run the tests to verify they still fail/compile-error against the old EditorPane**

Run: `npx vitest run src/components/EditorPane.test.tsx`
Expected: the two smoke tests still pass (the new mocks are harmless), but this step exists to confirm the mock additions don't break before the refactor. If both pass, proceed.

- [ ] **Step 4: Rewrite `EditorPane.tsx`**

Replace the entire file with the integrated version below. Key changes: module-level `Compartment`s; a `buildExtensions` helper seeded from prefs; a persistent `EditorView` created once; per-tab `EditorState` cache in a ref; a `setState` swap on `activePath` change that also reconfigures compartments to current prefs; a prefs effect that reconfigures the live view; cursor/selection lifted to React state; `EditorStatusBar` mounted below the host.

```tsx
import { useEffect, useRef, useState } from "react";
import {
  EditorView, lineNumbers, highlightActiveLineGutter, drawSelection, keymap,
  highlightActiveLine, rectangularSelection, crosshairCursor,
} from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, indentWithTab, history, historyKeymap } from "@codemirror/commands";
import { indentOnInput, bracketMatching, foldGutter, indentUnit } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { javascript } from "@codemirror/lang-javascript";
import { rust } from "@codemirror/lang-rust";
import { python } from "@codemirror/lang-python";
import { java } from "@codemirror/lang-java";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { atelierTheme } from "./editor/atelierTheme";
import { diffGutter } from "./editor/diffGutter";
import { selectAllOccurrences } from "./editor/multiCursor";
import { parseDiffForFile } from "../lib/diffParser";
import { useEditorStore } from "../stores/editorStore";
import { useEditorPrefs } from "../stores/editorPrefsStore";
import { EditorStatusBar } from "./EditorStatusBar";

interface Props {
  workspaceId: string;
  workspacePath: string;
  diffText: string;
}

function langExtension(lang: string) {
  switch (lang) {
    case "javascript": return javascript({ typescript: true, jsx: true });
    case "rust":       return rust();
    case "python":     return python();
    case "java":       return java();
    case "json":       return json();
    case "markdown":   return markdown();
    case "html":       return html();
    case "css":        return css();
    case "xml":        return xml();
    case "yaml":       return yaml();
    default:           return [];
  }
}

// ── Live-reconfigurable preference compartments (module-level, stable) ──
const wrapComp = new Compartment();
const lineNumComp = new Compartment();
const tabComp = new Compartment();
const fontComp = new Compartment();

interface Prefs { wrap: boolean; fontSize: number; tabWidth: number; lineNumbers: boolean; }

const wrapValue = (p: Prefs) => (p.wrap ? EditorView.lineWrapping : []);
const lineNumValue = (p: Prefs) =>
  p.lineNumbers ? [lineNumbers(), foldGutter(), highlightActiveLineGutter()] : [];
const tabValue = (p: Prefs) => [EditorState.tabSize.of(p.tabWidth), indentUnit.of(" ".repeat(p.tabWidth))];
const fontValue = (p: Prefs) =>
  EditorView.theme({ "&": { fontSize: `${p.fontSize}px` }, ".cm-content": { fontSize: `${p.fontSize}px` } });

function buildState(opts: {
  doc: string; lang: string; markers: ReturnType<typeof parseDiffForFile>;
  prefs: Prefs; onSave: () => void;
  onUpdate: (u: { docChanged: boolean; doc: string; line: number; col: number; selections: number }) => void;
}) {
  const { doc, lang, markers, prefs, onSave, onUpdate } = opts;
  return EditorState.create({
    doc,
    extensions: [
      lineNumComp.of(lineNumValue(prefs)),
      highlightActiveLine(),
      drawSelection(),
      rectangularSelection(),
      crosshairCursor(),
      history(),
      indentOnInput(),
      bracketMatching(),
      tabComp.of(tabValue(prefs)),
      wrapComp.of(wrapValue(prefs)),
      fontComp.of(fontValue(prefs)),
      search({ top: true }),
      keymap.of([
        { key: "Mod-s", run: () => { onSave(); return true; } },
        { key: "Mod-Shift-l", run: selectAllOccurrences },
        indentWithTab,
        ...searchKeymap,
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      langExtension(lang),
      atelierTheme,
      diffGutter(markers),
      EditorView.updateListener.of((update) => {
        const head = update.state.selection.main.head;
        const lineObj = update.state.doc.lineAt(head);
        onUpdate({
          docChanged: update.docChanged,
          doc: update.state.doc.toString(),
          line: lineObj.number,
          col: head - lineObj.from + 1,
          selections: update.state.selection.ranges.length,
        });
      }),
    ],
  });
}

export function EditorPane({ workspaceId, workspacePath, diffText }: Props) {
  const activePath = useEditorStore((s) => s.getActivePath(workspaceId));
  const files = useEditorStore((s) => s.getFiles(workspaceId));
  const setContent = useEditorStore((s) => s.setContent);
  const saveActive = useEditorStore((s) => s.saveActive);

  const wrap = useEditorPrefs((s) => s.wrap);
  const fontSize = useEditorPrefs((s) => s.fontSize);
  const tabWidth = useEditorPrefs((s) => s.tabWidth);
  const lineNumbersPref = useEditorPrefs((s) => s.lineNumbers);
  const prefs: Prefs = { wrap, fontSize, tabWidth, lineNumbers: lineNumbersPref };

  const activeFile = activePath ? files.find((f) => f.path === activePath) ?? null : null;

  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const stateCache = useRef<Map<string, EditorState>>(new Map());
  const lastPathRef = useRef<string | null>(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const [pos, setPos] = useState({ line: 1, col: 1, selections: 1 });

  // Helper that builds a fresh state for a file using current prefs.
  const freshState = (file: { path: string; content: string; lang: string }) => {
    const relPath = file.path.startsWith(workspacePath + "/")
      ? file.path.slice(workspacePath.length + 1) : file.path;
    const markers = parseDiffForFile(diffText, relPath);
    return buildState({
      doc: file.content, lang: file.lang, markers, prefs: prefsRef.current,
      onSave: () => saveActive(workspaceId).catch(console.error),
      onUpdate: (u) => {
        if (u.docChanged) setContent(workspaceId, file.path, u.doc);
        setPos({ line: u.line, col: u.col, selections: u.selections });
      },
    });
  };

  // Create the view once; destroy on unmount.
  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;
    const view = new EditorView({ parent: hostRef.current });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; stateCache.current.clear(); lastPathRef.current = null; };
  }, []);

  // Swap the document state when the active file changes; preserve per-tab state.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !activeFile) return;

    // Save the outgoing tab's live state.
    const prevPath = lastPathRef.current;
    if (prevPath && prevPath !== activeFile.path) {
      stateCache.current.set(prevPath, view.state);
    }

    const cached = stateCache.current.get(activeFile.path);
    const next = cached ?? freshState(activeFile);
    view.setState(next);
    // Always realign prefs to current (a cached state may predate a pref change).
    view.dispatch({ effects: [
      wrapComp.reconfigure(wrapValue(prefsRef.current)),
      lineNumComp.reconfigure(lineNumValue(prefsRef.current)),
      tabComp.reconfigure(tabValue(prefsRef.current)),
      fontComp.reconfigure(fontValue(prefsRef.current)),
    ]});
    lastPathRef.current = activeFile.path;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath, workspaceId]);

  // Evict cache entries for files that are no longer open.
  useEffect(() => {
    const open = new Set(files.map((f) => f.path));
    for (const p of stateCache.current.keys()) if (!open.has(p)) stateCache.current.delete(p);
  }, [files]);

  // Reconfigure compartments live when prefs change.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: [
      wrapComp.reconfigure(wrapValue(prefs)),
      lineNumComp.reconfigure(lineNumValue(prefs)),
      tabComp.reconfigure(tabValue(prefs)),
      fontComp.reconfigure(fontValue(prefs)),
    ]});
  }, [wrap, fontSize, tabWidth, lineNumbersPref]);

  // IMPORTANT: the host is mounted UNCONDITIONALLY so the view-once effect (deps
  // `[]`) always finds `hostRef.current`. The empty-state message is an overlay,
  // not an early return — an early return would unmount the host on the
  // null→active transition and the `[]` effect would never create the view.
  return (
    <div className="chat-selectable flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="relative min-h-0 flex-1">
        <div
          ref={hostRef}
          data-testid="editor-host"
          className="absolute inset-0 overflow-auto"
          style={{ background: "var(--color-octo-onyx)" }}
        />
        {!activeFile && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-serif text-[15px] text-octo-mute">
              Select a file from the tree to begin.
            </span>
          </div>
        )}
      </div>
      {activeFile && (
        <EditorStatusBar
          line={pos.line}
          col={pos.col}
          selectionCount={pos.selections}
          lang={activeFile.lang}
        />
      )}
    </div>
  );
}
```

> **Why this is safe in the test:** the host (`editor-host`) is always rendered, so
> the view-once effect constructs the `EditorViewMock` on mount in both tests. The
> `shows empty state` test still finds its message text (now an overlay); the
> `renders editor-host div…` test still finds the host. The swap effect guards on
> `activeFile`, so it no-ops when no file is active.

- [ ] **Step 5: Run the EditorPane tests**

Run: `npx vitest run src/components/EditorPane.test.tsx`
Expected: PASS — both smoke tests (`shows empty state when no file is active`, `renders editor-host div when a file is active`).

- [ ] **Step 6: Typecheck + full build + full test suite**

Run: `npm run typecheck`
Expected: clean (no errors).

Run: `npm run build`
Expected: Vite build succeeds.

Run: `npx vitest run`
Expected: all tests pass (the new Task 1/3/4/5 suites + existing). The pre-existing 4 unhandled `runsStore` "errors" in jsdom are unrelated and acceptable; all *tests* pass.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/components/EditorPane.tsx src/components/EditorPane.test.tsx
git commit -m "feat(g1): EditorPane — persistent view, prefs compartments, search, multi-cursor, status bar"
```

---

## Task 7: Wire the editor command-palette entries + keyboard prefs shortcuts

**Files:**
- Modify: `src/components/EditorPane.tsx` (add the `Alt-z` / `Mod-=` / `Mod--` keymap entries)

> The find (`Mod-f`), go-to-line (`Mod-Alt-g`), and select-next-occurrence (`Mod-d`)
> bindings already come from `searchKeymap` wired in Task 6. This task adds the
> preference shortcuts and is intentionally small. (Adding entries to the global
> `cmdk` palette is **Slice II**, where the palette/command surface is owned — keep
> Slice I to in-editor keybindings to respect the stream boundary.)

- [ ] **Step 1: Add the preference keybindings**

In `buildState`'s `keymap.of([...])` array in `src/components/EditorPane.tsx`, add three bindings that call the prefs store directly. The `useEditorPrefs` import already exists from Task 6 — do not add it again. Insert these entries into the keymap array, right after the `Mod-Shift-l` entry:

```ts
        { key: "Alt-z", run: () => { useEditorPrefs.getState().toggleWrap(); return true; } },
        { key: "Mod-=", run: () => { useEditorPrefs.getState().bumpFontSize(1); return true; } },
        { key: "Mod--", run: () => { useEditorPrefs.getState().bumpFontSize(-1); return true; } },
```

> `useEditorPrefs.getState()` reads the store imperatively from inside the CodeMirror
> command — no React hook rules apply here, and the prefs effect (Task 6) reconfigures
> the live view when the store changes.

- [ ] **Step 2: Typecheck + tests**

Run: `npm run typecheck`
Expected: clean.

Run: `npx vitest run src/components/EditorPane.test.tsx`
Expected: PASS (smoke tests unaffected; the mock keymap ignores entries).

- [ ] **Step 3: Commit**

```bash
git add src/components/EditorPane.tsx
git commit -m "feat(g1): in-editor keybindings for wrap (Alt-Z) and font size (Mod ±)"
```

---

## Final verification (after all tasks)

- [ ] `npm run typecheck` — clean
- [ ] `npx vitest run` — all tests pass (new suites: editorPrefsStore, multiCursor, EditorStatusBar, atelierTheme + extended EditorTabs/EditorPane)
- [ ] `npm run build` — succeeds
- [ ] `git diff main...HEAD | grep -nE '#[0-9a-fA-F]{3,8}|rgba\('` — only matches inside `src/components/editor/atelierTheme.ts` (the documented exemption); none in `EditorTabs.tsx`, `EditorStatusBar.tsx`, or elsewhere
- [ ] Manual smoke (optional, via `npm run tauri:dev`): open a file → `⌘F` find panel is Atelier-styled; `⌘D` adds a cursor; `⌘⇧L` selects all occurrences; status bar shows Ln/Col and toggles wrap/line-numbers/indent/font live; switch tabs and back → cursor/scroll/undo preserved.

---

## Spec coverage check

| Spec requirement | Task |
|---|---|
| Find / find-and-replace (`@codemirror/search`) | 6 (search + searchKeymap) |
| Go-to-line | 6 (searchKeymap `gotoLine`) |
| Multi-cursor: select-next (`⌘D`) | 6 (searchKeymap) |
| Multi-cursor: column/rectangular | 6 (`rectangularSelection`+`crosshairCursor`) |
| Multi-cursor: select-all-occurrences (`⌘⇧L`) | 3 + 6 (`selectAllOccurrences`) |
| Soft-wrap toggle | 1 (store) + 6 (`wrapComp`) |
| Persisted prefs (wrap/font/tab/lineNumbers) | 1 |
| Live reconfiguration via Compartments | 6 |
| Persistent view + per-tab state | 6 |
| EditorStatusBar (position + clickable prefs) | 4 + 6 (mount) |
| Atelier search-panel theming | 5 |
| Keybindings (`⌥Z`, `⌘±`) | 7 |
| Tier-0: `EditorTabs` rgba → token | 2 |
| Tier-0: tab roles/aria/focus rings | 2 |

Deferred to Slice II (correctly absent here): settings-tab UI, tab keyboard-nav/tooltip/drag, `cmdk` palette entries; Slice III: autocomplete, minimap, AI garnish, LSP.
