# Disk & Cache Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the bottom performance monitor with free disk space (polled) and the active workspace's build/cache directory sizes (on-demand), read-only.

**Architecture:** Fold a cheap `disk` field into the polled `get_perf_stats`; add a separate on-demand `get_workspace_cache_sizes(path)` command (directory walk, run off the UI thread) invoked when the popover opens. Pure helpers (`dir_size`, `scan_caches`, `pick_disk_for_path`) are unit-tested; sysinfo provides disk free.

**Tech Stack:** Rust (Tauri 2, `sysinfo`, serde), React 19 + TS, Zustand, Tailwind v4, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-28-disk-cache-monitor-design.md`

**Design-system:** Extend the existing monitor surface (no new chrome) — tokens only, mono, brass for the free-space value, calm, read-only. See the spec's "Design-system alignment" section.

> ⚠️ **Shared-file note:** Task B1 edits `src-tauri/src/commands.rs` (extends `get_perf_stats`, adds `get_workspace_cache_sizes`) and `src-tauri/src/lib.rs` (handler), and B2/B3 edit `src/lib/types.ts` + `src/lib/ipc.ts`. The provider sub-project (A) also edits these files. If A and B run in parallel, expect small additive merge conflicts in `commands.rs`, `lib.rs`, `types.ts`, `ipc.ts` (each adds its own items) — resolve by keeping both additions.

---

## File Structure

**Backend:**
- Modify `src-tauri/src/perf.rs` — `DiskInfo`, add `disk` to `PerfStats`, `dir_size`, `scan_caches`, `pick_disk_for_path`, `CacheEntry`/`WorkspaceCacheSizes`; update `compute_stats` signature + its tests; add new pure tests.
- Modify `src-tauri/src/commands.rs` — extend `get_perf_stats` with disk; add `get_workspace_cache_sizes`.
- Modify `src-tauri/src/lib.rs` — register `get_workspace_cache_sizes`.

**Frontend:**
- Modify `src/lib/types.ts` — `disk` on `PerfStats`; `WorkspaceCacheSizes`.
- Modify `src/lib/ipc.ts` — `getWorkspaceCacheSizes`.
- Modify `src/components/PerfMonitorBar.tsx` — disk in bar + caches popover section + `workspacePath` prop.
- Modify `src/components/PerfMonitorBar.test.tsx` — add `disk` to fixtures; cover the caches section.
- Modify `src/App.tsx` — pass `workspacePath` to `<PerfMonitorBar />`.

---

## Task B1: Backend — disk + cache pure helpers, command, wiring

**Files:**
- Modify: `src-tauri/src/perf.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add types + pure helpers to `src-tauri/src/perf.rs`**

```rust
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub free_bytes: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CacheEntry {
    pub name: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCacheSizes {
    pub entries: Vec<CacheEntry>,
    pub total_bytes: u64,
}

/// Common build/cache directory names scanned at a workspace root.
pub const CACHE_DIR_NAMES: &[&str] = &[
    "target", "node_modules", "dist", "build", ".next", ".nuxt",
    ".gradle", "__pycache__", ".venv", "venv", ".turbo", "out",
];

/// Recursively sum the byte sizes of regular files under `path`. Skips
/// symlinks; ignores per-entry errors (permission, races). Never panics.
pub fn dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    let Ok(entries) = std::fs::read_dir(path) else { return 0 };
    for entry in entries.flatten() {
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_symlink() {
            continue;
        }
        if ft.is_dir() {
            total = total.saturating_add(dir_size(&entry.path()));
        } else if let Ok(md) = entry.metadata() {
            total = total.saturating_add(md.len());
        }
    }
    total
}

/// For each known cache dir name present (as a directory) directly under
/// `workspace_root`, return (name, size). Absent names are omitted.
pub fn scan_caches(workspace_root: &Path) -> Vec<(String, u64)> {
    let mut out = Vec::new();
    for name in CACHE_DIR_NAMES {
        let p = workspace_root.join(name);
        if p.is_dir() {
            out.push((name.to_string(), dir_size(&p)));
        }
    }
    out
}

/// Given `(mount_point, total, free)` tuples, pick the disk whose mount point
/// is the longest prefix of `target`; fall back to the `/` mount, else the
/// first, else zeros. Pure — unit-testable without sysinfo.
pub fn pick_disk_for_path(mounts: &[(PathBuf, u64, u64)], target: &Path) -> DiskInfo {
    let best = mounts
        .iter()
        .filter(|(mp, _, _)| target.starts_with(mp))
        .max_by_key(|(mp, _, _)| mp.as_os_str().len())
        .or_else(|| mounts.iter().find(|(mp, _, _)| mp == Path::new("/")))
        .or_else(|| mounts.first());
    match best {
        Some((_, total, free)) => DiskInfo { free_bytes: *free, total_bytes: *total },
        None => DiskInfo { free_bytes: 0, total_bytes: 0 },
    }
}

/// Read the free/total bytes of the volume that `$HOME` lives on.
pub fn home_disk() -> DiskInfo {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let mounts: Vec<(PathBuf, u64, u64)> = disks
        .list()
        .iter()
        .map(|d| (d.mount_point().to_path_buf(), d.total_space(), d.available_space()))
        .collect();
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    pick_disk_for_path(&mounts, &home)
}
```

- [ ] **Step 2: Add `disk` to `PerfStats` and thread it through `compute_stats`**

Edit the existing `PerfStats` struct to add `pub disk: DiskInfo,` and change `compute_stats` to accept it:
```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfStats {
    pub app: ProcGroup,
    pub daemon: ProcGroup,
    pub total: ProcGroup,
    pub disk: DiskInfo,
    pub ts: i64,
}

pub fn compute_stats(
    samples: &[ProcSample],
    app_pids: &std::collections::HashSet<u32>,
    daemon_pid: Option<u32>,
    disk: DiskInfo,
    ts: i64,
) -> PerfStats {
    let by_pid = samples_by_pid(samples);
    let app = sum_group(app_pids, &by_pid);
    let daemon = match daemon_pid {
        Some(p) => sum_group(&std::collections::HashSet::from([p]), &by_pid),
        None => ProcGroup::zero(),
    };
    let total = app.plus(&daemon);
    PerfStats { app, daemon, total, disk, ts }
}
```

- [ ] **Step 3: Update the two existing `compute_stats` tests + add new pure tests** (in `perf.rs`'s `#[cfg(test)] mod tests`)

Update the existing `compute_stats_sums_groups_with_precomputed_app_set` and `compute_stats_daemon_absent_is_zero` calls to pass a disk arg and assert it flows through:
```rust
    // in compute_stats_sums_groups_with_precomputed_app_set:
    let disk = DiskInfo { free_bytes: 100, total_bytes: 500 };
    let stats = compute_stats(&samples, &app_pids, Some(200), disk.clone(), 7);
    assert_eq!(stats.disk, disk);
    // ...existing app/daemon/total/ts asserts unchanged...

    // in compute_stats_daemon_absent_is_zero:
    let stats = compute_stats(&samples, &HashSet::from([100u32]), None, DiskInfo { free_bytes: 0, total_bytes: 0 }, 0);
    // ...existing asserts...
```
Add new tests:
```rust
    #[test]
    fn dir_size_sums_files_recursively() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join("a.txt"), vec![0u8; 100]).unwrap();
        let sub = tmp.path().join("sub");
        std::fs::create_dir(&sub).unwrap();
        std::fs::write(sub.join("b.txt"), vec![0u8; 50]).unwrap();
        assert_eq!(dir_size(tmp.path()), 150);
    }

    #[test]
    fn scan_caches_returns_only_present_known_dirs() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::create_dir(tmp.path().join("target")).unwrap();
        std::fs::write(tmp.path().join("target").join("x"), vec![0u8; 10]).unwrap();
        std::fs::create_dir(tmp.path().join("node_modules")).unwrap();
        std::fs::write(tmp.path().join("node_modules").join("y"), vec![0u8; 20]).unwrap();
        std::fs::create_dir(tmp.path().join("src")).unwrap(); // not a cache name
        let mut got = scan_caches(tmp.path());
        got.sort();
        assert_eq!(got, vec![("node_modules".to_string(), 20), ("target".to_string(), 10)]);
    }

    #[test]
    fn pick_disk_chooses_longest_prefix_mount() {
        let mounts = vec![
            (PathBuf::from("/"), 1000u64, 100u64),
            (PathBuf::from("/Users"), 2000u64, 200u64),
        ];
        let d = pick_disk_for_path(&mounts, Path::new("/Users/jonathan"));
        assert_eq!(d, DiskInfo { free_bytes: 200, total_bytes: 2000 });
        let root = pick_disk_for_path(&mounts, Path::new("/opt/x"));
        assert_eq!(root, DiskInfo { free_bytes: 100, total_bytes: 1000 });
    }
```

- [ ] **Step 4: Run perf tests** — `cd src-tauri && cargo test perf::tests` — expect all pass (kept + updated + 3 new).

- [ ] **Step 5: Wire disk into `get_perf_stats` + add `get_workspace_cache_sizes` (`commands.rs`)**

Update `get_perf_stats` to compute disk and pass it to `compute_stats`:
```rust
    let disk = crate::perf::home_disk();
    Ok(crate::perf::compute_stats(&samples, &app_pids, daemon_pid, disk, ts))
```
Add:
```rust
/// On-demand sizes of common build/cache dirs in a workspace. Async so the
/// directory walk runs off the UI thread.
#[tauri::command]
pub async fn get_workspace_cache_sizes(workspace_path: String) -> crate::perf::WorkspaceCacheSizes {
    let root = std::path::PathBuf::from(&workspace_path);
    let scanned = crate::perf::scan_caches(&root);
    let total_bytes = scanned.iter().map(|(_, b)| *b).sum();
    crate::perf::WorkspaceCacheSizes {
        entries: scanned.into_iter().map(|(name, bytes)| crate::perf::CacheEntry { name, bytes }).collect(),
        total_bytes,
    }
}
```

- [ ] **Step 6: Register `get_workspace_cache_sizes` in `lib.rs`** (add `commands::get_workspace_cache_sizes,` to the handler).

- [ ] **Step 7: Build + test** — `cd src-tauri && cargo build` then `cargo test perf::tests`. Expect clean + pass.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/perf.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(perf): disk free in stats + on-demand workspace cache sizes"
```

---

## Task B2: Frontend — types + ipc

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/ipc.ts`

- [ ] **Step 1: Extend `PerfStats` + add `WorkspaceCacheSizes` in `src/lib/types.ts`**

```ts
export interface PerfStats {
  app: ProcGroup;
  daemon: ProcGroup;
  total: ProcGroup;
  disk: { freeBytes: number; totalBytes: number };
  ts: number;
}

export interface WorkspaceCacheSizes {
  entries: { name: string; bytes: number }[];
  totalBytes: number;
}
```
(Add `disk` to the existing `PerfStats` interface; do not duplicate it.)

- [ ] **Step 2: Add ipc binding in `src/lib/ipc.ts`**

```ts
  getWorkspaceCacheSizes: (workspacePath: string) =>
    invoke<WorkspaceCacheSizes>("get_workspace_cache_sizes", { workspacePath }),
```
(Import `WorkspaceCacheSizes` from `./types`.)

- [ ] **Step 3: Typecheck** — `npm run typecheck`. NOTE: this will surface that `PerfMonitorBar.test.tsx` fixtures lack `disk`; that's fixed in B3. If you want a green typecheck now, also do B3 Step 1's fixture update. Commit after B3 to keep types + usages consistent — OR commit types/ipc now and accept a transient red test until B3. Recommended: proceed to B3 before committing.

---

## Task B3: Frontend — disk in bar + caches popover + App wiring

**Files:**
- Modify: `src/components/PerfMonitorBar.tsx`
- Modify: `src/components/PerfMonitorBar.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Update existing test fixtures + add caches test** in `PerfMonitorBar.test.tsx`

Every `usePerfStore.setState({ stats: {...} })` fixture must now include `disk`:
```ts
disk: { freeBytes: 18 * 1024 * 1024 * 1024, totalBytes: 460 * 1024 * 1024 * 1024 },
```
Add a test for the bar showing free space (e.g. expect `getByText("18 GB")` given the fixture) and for the caches section:
```tsx
it("fetches and lists workspace caches when the popover opens", async () => {
  mockIpc.getWorkspaceCacheSizes.mockResolvedValue({
    entries: [{ name: "target", bytes: 34 * 1024 * 1024 * 1024 }], totalBytes: 34 * 1024 * 1024 * 1024,
  });
  usePerfStore.setState({ stats: /* fixture incl. disk */ });
  render(<PerfMonitorBar workspacePath="/repo/ws" />);
  fireEvent.click(screen.getByRole("button", { name: /performance/i }));
  expect(await screen.findByText("target")).toBeInTheDocument();
  expect(screen.getByText("34 GB")).toBeInTheDocument();
  expect(mockIpc.getWorkspaceCacheSizes).toHaveBeenCalledWith("/repo/ws");
});
```
Add a `vi.mock("../lib/ipc")` exposing `getWorkspaceCacheSizes: vi.fn()` (mirror the perfStore test's mock pattern). Use `formatBytes` expectations consistent with its rounding (e.g. exactly `18 GB` for 18 GiB).

- [ ] **Step 2: Run — verify failures** (`npx vitest run src/components/PerfMonitorBar.test.tsx`).

- [ ] **Step 3: Implement `PerfMonitorBar.tsx`**

Add a `workspacePath?: string` prop. Add disk-free to the bar line and a caches section to the popover (fetched on open). Key additions:
```tsx
import { ipc } from "../lib/ipc";
import type { ProcGroup, WorkspaceCacheSizes } from "../lib/types";
import { useEffect, useState } from "react";

export function PerfMonitorBar({ workspacePath }: { workspacePath?: string }) {
  const stats = usePerfStore((s) => s.stats);
  const [open, setOpen] = useState(false);
  const [caches, setCaches] = useState<WorkspaceCacheSizes | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    if (!open || !workspacePath) return;
    let cancelled = false;
    setScanning(true);
    setCaches(null);
    ipc.getWorkspaceCacheSizes(workspacePath)
      .then((c) => { if (!cancelled) setCaches(c); })
      .catch(() => { if (!cancelled) setCaches(null); })
      .finally(() => { if (!cancelled) setScanning(false); });
    return () => { cancelled = true; };
  }, [open, workspacePath]);
  // ...bar line: append `· <free> free` using formatBytes(stats.total ? stats.disk.freeBytes : 0) in brass...
  // ...popover: after App/Daemon rows, a "WORKSPACE CACHES" eyebrow + rows from caches.entries (name + formatBytes(bytes)),
  //    a total row, a quiet "scanning…" while `scanning`, and "no build caches" / "—" when empty or no workspacePath.
}
```
Bar free-space span (matches existing style): `<span className="text-octo-brass">{formatBytes(stats.disk.freeBytes)}</span><span> free</span>`. Cache rows reuse the `PerfRow`-style layout: `name` in `text-octo-sage`, size in `font-mono text-octo-ivory`. Eyebrow: `font-mono text-[9px] uppercase tracking-[0.25em] text-octo-mute`. No italics; tokens only.

- [ ] **Step 4: Pass `workspacePath` from `App.tsx`**

Find `<PerfMonitorBar />` and change to:
```tsx
<PerfMonitorBar workspacePath={activeWorkspace?.worktreePath ?? project?.path} />
```
(`activeWorkspace` and `project` are already in scope in `App`.)

- [ ] **Step 5: Run tests — verify pass** (`npx vitest run src/components/PerfMonitorBar.test.tsx`), then `npm run typecheck`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/ipc.ts src/components/PerfMonitorBar.tsx src/components/PerfMonitorBar.test.tsx src/App.tsx
git commit -m "feat(perf): show disk free + workspace cache sizes in the monitor"
```

---

## Verification (after all tasks)

- [ ] `cd src-tauri && cargo test` — all pass (incl. dir_size/scan_caches/pick_disk + updated compute_stats).
- [ ] `npm run typecheck` — clean.
- [ ] `npx vitest run` — all pass.
- [ ] Manual (built .app): bar shows free disk; opening the popover lists the active workspace's caches (e.g. `target` size) and a total; no workspace → quiet empty state.
