# Direct — Main View as a Dashboard

**Date:** 2026-06-13
**Status:** Approved (author-delegated; the user asked me to proceed autonomously, as with the builder)
**Mode:** Direct
**Surface:** the launcher / no-run landing of Direct mode.

---

## 1. Why

The node pipeline builder is now a premium, distinctive surface. The **main view
of Direct** — what you see on entering the mode with no active run — is still a
plain vertical **form** (`PipelineSetup`): a ceremony header, a brief textarea, a
pipeline gallery, a crew table, and a cost/budget/begin bar. Worse, your **runs
live only in a cramped sidebar list** (`CompanionRuns`); there is no real
landing that shows what you've done and lets you pick up where you left off.

We turn the landing into a **dashboard**: a ceremonial header with an at-a-glance
**overview** (savings to date, run count, runs in flight), a **recent-runs
gallery** brought onto the main canvas, and the **launch composer** beside it.

This is a presentation redesign of the landing. The run view (`RunTrack`,
`StageFocus`, `RunLedger`, `CheckpointBar`), the builder, and the sidebar
`CompanionRuns` are out of scope and unchanged.

---

## 2. Architecture

New folder `src/components/direct/`:

- **`DirectDashboard.tsx`** — the landing. Owns the page: ceremony header +
  `DirectOverview` + a container-query two-column layout (`@container`): the
  **launch composer** (left/primary) and **`RecentRuns`** (right). Stacks to one
  column on a narrow canvas. Owns the page scroll + padding. This is what
  `DirectCanvas` renders for the launcher state (replacing the bare
  `PipelineSetup`).
- **`DirectOverview.tsx`** — a calm stat strip computed from the run list:
  total **saved** vs baseline, **runs** count, and **in flight** (running/paused)
  count. Tabular numerals, mono eyebrows, brass for the live count. Renders
  nothing until at least one run exists.
- **`RecentRuns.tsx`** — the runs column: a section eyebrow, a vertical list of
  `RunCard`s (newest first, capped to a sensible recent window with a quiet
  "+N earlier in the rail" note pointing at the sidebar), and the empty state
  ("No runs yet — direct your first."). A "Begin a fresh run" affordance scrolls
  focus to the composer (or, when a run is *viewed*, this is the new-run entry).
- **`RunCard.tsx`** — one run as a card: status glyph + word (`runStatusMeta`) +
  relative time (`formatRelTime`), the task (serif, clamped), and a meta line
  with the pipeline name + cost vs baseline (`$X` and, when it saved, `· saved
  $Y (Z%)`). Selected/viewed → brass ring; paused → a brass "decide" hint;
  running → the `octo-stage-pulse` dot. Click → `selectRun(workspaceId, run.id)`.

**`PipelineSetup.tsx` (refactored into the composer):** keep its props and all
logic (brief, pipeline gallery, crew, estimate, budget, begin, prefill,
executing-run gate) **unchanged**; only drop its own page-level ceremony header
and outer scroll/padding (the dashboard provides those) so it sits cleanly in a
column. Its visible copy that tests rely on (Begin, budget, estimating…,
skeletons, mini-map) is preserved.

Data comes entirely from existing stores: `useRunsStore` (`getRuns`,
`loadRuns`, `getViewedRunId`, `selectRun`, `hasExecutingRun`) and
`usePipelineStore` (to resolve a run's pipeline **name** from its `pipelineId`;
a deleted pipeline falls back to a neutral label). No new IPC, no backend
changes.

---

## 3. Layout

```
DIRECT
Direct the work                                    ⟁ overview: saved $X · N runs · M in flight
────(brass rule grows)
┌───────────────────────────────────┬─────────────────────────────┐
│ COMPOSE                           │ RECENT RUNS                  │
│  I · the brief                    │  [RunCard] paused · decide   │
│  II · the pipeline (gallery)      │  [RunCard] done · saved      │
│  III · the team                   │  [RunCard] running ●         │
│  [ estimate · budget · Begin ]    │  …                           │
└───────────────────────────────────┴─────────────────────────────┘
```

Two columns when the dashboard container is wide (`@container` → `@4xl:`),
single column stacked otherwise. The runs column has a sensible max width; the
composer takes the rest. Motion: cards `octo-rise-in`, sections `octo-fade-in`;
the brass rule keeps its `animate-brass-grow`. Reduced-motion respected.

---

## 4. Design rules (unchanged commitments)

Tokens only (no hex/font literals); brass surgical (active run, selected card,
the rule, eyebrows); three type voices; icons + tooltips for non-obvious
affordances (status glyph, "decide", overview terms); calm 220–320ms motion;
fixed geometry + tabular numerals so cost/time never reflow; all copy English.
CTAs as italic-serif phrases where they are moments ("Begin the run",
"Direct the work"). No new top-level chrome — this lives inside the existing
Direct canvas surface.

---

## 5. Testing

- `DirectDashboard.test.tsx`: header renders; overview appears only with runs
  and states saved/count; `RecentRuns` lists cards and shows the empty state;
  clicking a card calls `selectRun`; the composer (Begin) is present.
- `RunCard.test.tsx`: status/word/time/cost-vs-baseline render; saved line only
  when it actually saved; paused shows the decide hint; click fires `onClick`.
- `PipelineSetup.test.tsx`: updated — ceremony-header assertions move to the
  dashboard; the composer's begin/budget/estimate/mini-map assertions stay.
- `npm run typecheck`, `npm test`, `npm run build` green; `/code-review` (max),
  fix findings, then PR → review → merge → release.
```
