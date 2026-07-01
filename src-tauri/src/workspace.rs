//! Workspace creation, shared by the Tauri command layer and the
//! `octopush-mcp` binary so both create workspaces through exactly one
//! code path.
//!
//! A workspace is a row in the `workspaces` table backed by a git worktree.
//! Creating one means: make sure the repo can branch, resolve the base,
//! create-or-reuse the branch, create the worktree, and record the row. The
//! flow is idempotent on `(project, branch)` — re-running it returns the
//! existing workspace (restoring it first if it was archived) instead of
//! creating a duplicate — which is what makes "create a workspace for a branch
//! that already exists" safe.
//!
//! The DB handle is passed as `&Mutex<Db>` rather than `&Db` on purpose: the
//! git checkout can take seconds on a large repo, so we hold the lock only for
//! the brief DB reads/writes and never across the worktree materialisation.

use std::path::{Path, PathBuf};

use parking_lot::Mutex;

use crate::db::{Db, WorkspaceRow};
use crate::error::{AppError, AppResult};

/// Turn free text into a git-branch-safe slug, byte-for-byte matching the
/// frontend's `slugify` in `WorkspaceCreator.tsx` so a workspace created from
/// the MCP gets the exact branch name the UI would have produced. The frontend
/// is: lowercase → drop everything except ASCII word chars, whitespace and
/// `-` → collapse runs of whitespace/`_` (NOT `-`) to a single `-` → trim
/// leading/trailing `-`. Note literal hyphens are preserved, never collapsed.
pub fn slugify(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut sep_run = false; // inside a run of whitespace/underscore
    for ch in text.to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            if sep_run {
                out.push('-');
                sep_run = false;
            }
            out.push(ch);
        } else if ch.is_whitespace() || ch == '_' {
            sep_run = true; // becomes a single '-' before the next kept char
        } else if ch == '-' {
            // A literal hyphen is kept verbatim (frontend's char class allows
            // '-' and its collapse step only targets [\s_]). Flush a pending
            // separator run first so spacing around it is preserved.
            if sep_run {
                out.push('-');
                sep_run = false;
            }
            out.push('-');
        }
        // Any other character (punctuation, non-ASCII) is dropped.
    }
    out.trim_matches('-').to_string()
}

/// What `create` did, so callers can tell the user (and the MCP can report it).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CreateOutcome {
    /// A workspace for this branch already existed; returned unchanged.
    Existed,
    /// An archived workspace was un-archived (and its worktree rebuilt).
    Restored,
    /// An existing on-disk checkout of the branch was adopted (no new worktree).
    Adopted,
    /// A fresh worktree-backed workspace was created.
    Created,
}

/// Ensure a workspace for `branch` exists in `project`, and return it.
///
/// `project_path` must be an absolute, tilde-expanded path to the project's git
/// repository (the main worktree). This always succeeds at *giving you a place
/// to work on the branch* rather than failing when the branch is in use:
///
///  1. If a workspace already tracks the branch → return it (un-archiving and
///     rebuilding its worktree if needed).
///  2. If the branch is already checked out somewhere (the main worktree or an
///     untracked one) → **adopt** that checkout — git only allows a branch in
///     one worktree, so we register a workspace over the existing one instead
///     of trying (and failing) to make a second.
///  3. Otherwise → create a fresh worktree under `.octopus-worktrees/`.
#[allow(clippy::too_many_arguments)]
pub fn create(
    db: &Mutex<Db>,
    project_id: &str,
    project_path: &Path,
    name: &str,
    task: &str,
    branch: &str,
    from_branch: &str,
    setup_script: &str,
) -> AppResult<(WorkspaceRow, CreateOutcome)> {
    let branch = branch.trim();
    if branch.is_empty() {
        return Err(AppError::Other("a workspace needs a branch name".into()));
    }
    // Validate here (shared by the app creator AND octopush-mcp): the branch is
    // used verbatim, so an illegal ref (spaces, `:`, control bytes) must fail with
    // a clear message rather than a cryptic git error at create_branch time.
    if !crate::git_ops::is_valid_branch_name(branch) {
        return Err(AppError::Other(format!(
            "'{branch}' is not a valid git branch name"
        )));
    }

    // 1. A tracked workspace already exists for this branch (any status).
    // Bind to a local first so the lock guard is released before
    // reuse_or_restore re-locks — `parking_lot::Mutex` isn't re-entrant, and an
    // `if let` scrutinee's temporary would otherwise live through the body.
    let existing = db.lock().find_workspace_by_branch(project_id, branch)?;
    if let Some(existing) = existing {
        return reuse_or_restore(db, project_path, existing);
    }

    // 2. The branch may already be checked out in a worktree (the main one or an
    //    untracked one). A branch can't be checked out twice, so adopt it.
    let checked_out_at = {
        let repo = crate::git_ops::open_repo(project_path)?;
        crate::git_ops::live_worktree_on_branch(&repo, branch)
    };
    if let Some(path) = checked_out_at {
        // Don't duplicate: if a row already points at that checkout (the main
        // workspace, or a row whose branch was switched), return it — restoring
        // it if it happens to be archived (never hand back a hidden row).
        if let Some(at_path) = workspace_at_path(db, project_id, &path)? {
            return reuse_or_restore(db, project_path, at_path);
        }
        let id = uuid::Uuid::new_v4().to_string();
        let d = db.lock();
        // Re-check under the lock to close the check-then-adopt race (a concurrent
        // caller may have created/adopted it while we were opening the repo).
        if let Some(existing) = d.find_workspace_by_branch(project_id, branch)? {
            return Ok((existing, CreateOutcome::Existed));
        }
        // Adopted, not created: born managed=false (atomically) so delete/archive
        // never rm -rf this external checkout or delete its branch.
        d.insert_workspace_managed(
            &id,
            project_id,
            name,
            task,
            branch,
            Some(&path.to_string_lossy()),
            setup_script,
            None, // we didn't branch from anything — the branch already existed
            false,
        )?;
        let ws = d
            .get_workspace(&id)?
            .ok_or_else(|| AppError::Other("workspace adopted but could not be reloaded".into()))?;
        return Ok((ws, CreateOutcome::Adopted));
    }

    // 3. Not checked out anywhere → materialise a fresh worktree (no DB lock held
    //    across the git checkout).
    let (base, worktree_path) = provision_worktree(project_path, branch, from_branch)?;

    let id = uuid::Uuid::new_v4().to_string();
    let d = db.lock();
    // Re-check under the lock to close the check-then-create race within this
    // process (a concurrent caller may have created it while we provisioned).
    if let Some(existing) = d.find_workspace_by_branch(project_id, branch)? {
        return Ok((existing, CreateOutcome::Existed));
    }
    d.insert_workspace(
        &id,
        project_id,
        name,
        task,
        branch,
        Some(&worktree_path.to_string_lossy()),
        setup_script,
        Some(&base), // the RESOLVED base, not the raw (possibly blank) request
    )?;
    let ws = d
        .get_workspace(&id)?
        .ok_or_else(|| AppError::Other("workspace created but could not be reloaded".into()))?;
    Ok((ws, CreateOutcome::Created))
}

/// Find a workspace (any status) in `project` whose worktree path resolves to
/// `path`, so adoption never registers a second row over a checkout that's
/// already tracked (e.g. the main worktree, or a workspace whose branch was
/// switched).
fn workspace_at_path(
    db: &Mutex<Db>,
    project_id: &str,
    path: &Path,
) -> AppResult<Option<WorkspaceRow>> {
    let target = canonical_or(path);
    let d = db.lock();
    let mut rows = d.list_workspaces(project_id)?;
    rows.extend(d.list_archived_workspaces(project_id)?);
    Ok(rows.into_iter().find(|w| {
        w.worktree_path
            .as_deref()
            .is_some_and(|p| canonical_or(Path::new(p)) == target)
    }))
}

/// Run the git side of creation: ensure the repo can branch, resolve the base,
/// create-or-reuse the branch, and create the worktree. Returns the resolved
/// base and the worktree path. Touches git only — no DB — so the caller can
/// run it without holding the DB lock.
fn provision_worktree(
    project_path: &Path,
    branch: &str,
    from_branch: &str,
) -> AppResult<(String, PathBuf)> {
    // Ensure the repo has at least one commit (empty repos can't branch).
    crate::git_ops::ensure_initial_commit(project_path)?;

    // Explicit base branch wins; blank falls back to the repo's default.
    let base = crate::git_ops::resolve_base(
        from_branch,
        crate::git_ops::default_branch(project_path)?,
    )?;

    // create_branch is idempotent — it reuses an existing branch of this name.
    crate::git_ops::create_branch(project_path, branch, &base)?;

    // Flatten the directory basename the same way the slot name is flattened:
    // a slashed branch like `feat/foo` must NOT nest as `.octopus-worktrees/feat/foo`
    // (that both breaks and lets a later `feat` workspace rm -rf the nested one).
    let dir_name = crate::git_ops::slot_name_for(branch);
    let desired = project_path
        .parent()
        .unwrap_or(project_path)
        .join(".octopus-worktrees")
        .join(&dir_name);
    // create_worktree returns where the worktree ACTUALLY landed — it may differ
    // from `desired` if that path/slot was occupied by another live worktree.
    let actual = crate::git_ops::create_worktree(project_path, branch, &desired)?;

    Ok((base, actual))
}

/// Hand back the existing workspace for this branch, making sure it's usable.
/// Its worktree is rebuilt if missing — archiving removes it, and an active
/// workspace's worktree can also vanish out-of-band (rm -rf, an unmounted
/// drive) — and an archived row is flipped back to active. A healthy worktree
/// is never touched (it may hold uncommitted work), and the "main" workspace
/// (whose worktree is the project root) is never rebuilt.
fn reuse_or_restore(
    db: &Mutex<Db>,
    project_path: &Path,
    ws: WorkspaceRow,
) -> AppResult<(WorkspaceRow, CreateOutcome)> {
    let mut ws = ws;
    let was_archived = ws.status == "archived";
    let managed = db.lock().is_workspace_managed(&ws.id).unwrap_or(true);
    if let Some(wt) = ws.worktree_path.as_deref() {
        let wt_path = Path::new(wt);
        // Rebuild ONLY a MANAGED, non-main worktree whose directory is actually
        // GONE (no `.git` entry). We deliberately never rebuild a present dir —
        // a present-but-broken worktree may still hold uncommitted work, so
        // preserving it (even unusable) beats rm -rf'ing it. An ADOPTED
        // workspace's checkout is the user's own (never recreate), and the main
        // workspace is the project root.
        let is_main = same_path(wt_path, project_path);
        let missing = !wt_path.join(".git").exists();
        if managed && !is_main && missing {
            // create_worktree may land it at a different path if the original is
            // now occupied; persist wherever it actually landed.
            let actual = crate::git_ops::create_worktree(project_path, &ws.branch, wt_path)?;
            if canonical_or(&actual) != canonical_or(wt_path) {
                let actual_str = actual.to_string_lossy().to_string();
                db.lock().set_workspace_worktree_path(&ws.id, &actual_str)?;
                ws.worktree_path = Some(actual_str);
            }
        }
    }

    if was_archived {
        let d = db.lock();
        d.restore_workspace(&ws.id)?;
        let restored = d.get_workspace(&ws.id)?.ok_or_else(|| {
            AppError::Other("workspace restored but could not be reloaded".into())
        })?;
        return Ok((restored, CreateOutcome::Restored));
    }

    Ok((ws, CreateOutcome::Existed))
}

fn canonical_or(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

/// Path equality with the same raw-string fallback the archive/restore commands
/// use: a `canonicalize` failure (broken symlink, restricted parent) must not
/// be read as "different path" — that's how an archived main workspace could be
/// mistaken for a normal one and its project root clobbered.
fn same_path(a: &Path, b: &Path) -> bool {
    canonical_or(a) == canonical_or(b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use parking_lot::Mutex;
    use tempfile::{tempdir, NamedTempFile};

    fn test_db() -> Mutex<Db> {
        let tmp = NamedTempFile::new().unwrap();
        Mutex::new(Db::open(tmp.path()).unwrap())
    }

    /// A repo nested one level inside its own tempdir, so the worktrees
    /// `create()` derives at `project_path.parent()/.octopus-worktrees/<branch>`
    /// land *inside* this tempdir — isolated from other (parallel) tests and
    /// cleaned up when the dir drops, instead of leaking into the shared temp
    /// root.
    fn test_repo() -> tempfile::TempDir {
        let root = tempdir().unwrap();
        let repo = root.path().join("proj");
        std::fs::create_dir_all(&repo).unwrap();
        crate::git_ops::init_repo(&repo).unwrap();
        crate::git_ops::ensure_initial_commit(&repo).unwrap();
        root
    }

    #[test]
    fn slugify_matches_frontend_rules() {
        assert_eq!(slugify("Scan AGP Docker image"), "scan-agp-docker-image");
        assert_eq!(slugify("feat: do the thing"), "feat-do-the-thing");
        assert_eq!(slugify("  trailing  and __mixed-- "), "trailing-and-mixed");
        assert_eq!(slugify("GUIDE-2887"), "guide-2887");
        assert_eq!(slugify("***"), "");
        // Literal hyphens are preserved, never collapsed — must match the
        // frontend exactly so the same task yields the same branch.
        assert_eq!(slugify("Add login - logout flow"), "add-login---logout-flow");
    }

    #[test]
    fn create_then_recreate_same_branch_is_idempotent() {
        let root = test_repo();
        let repo = root.path().join("proj");
        let db = test_db();
        db.lock()
            .insert_project("p1", "Proj", &repo.to_string_lossy())
            .unwrap();

        let (ws, outcome) =
            create(&db, "p1", &repo, "scan", "Scan task", "idem-branch", "", "").unwrap();
        assert_eq!(outcome, CreateOutcome::Created);
        assert!(db.lock().is_workspace_managed(&ws.id).unwrap(), "created worktree is managed");
        assert_eq!(ws.branch, "idem-branch");
        let wt = ws.worktree_path.clone().unwrap();
        assert!(std::path::Path::new(&wt).join(".git").exists(), "worktree exists");

        // Re-running for the same branch returns the SAME row, no duplicate.
        let (again, outcome2) =
            create(&db, "p1", &repo, "scan", "Scan task", "idem-branch", "", "").unwrap();
        assert_eq!(again.id, ws.id, "idempotent on (project, branch)");
        assert_eq!(outcome2, CreateOutcome::Existed);
        assert_eq!(db.lock().list_workspaces("p1").unwrap().len(), 1, "no duplicate row");
    }

    #[test]
    fn create_for_archived_branch_restores_it() {
        let root = test_repo();
        let repo = root.path().join("proj");
        let db = test_db();
        db.lock()
            .insert_project("p1", "Proj", &repo.to_string_lossy())
            .unwrap();

        let (ws, _) = create(&db, "p1", &repo, "scan", "Scan task", "arch-branch", "", "").unwrap();
        // Archive it (drop the worktree dir + mark the row archived), as the
        // archive command does.
        let wt = ws.worktree_path.clone().unwrap();
        crate::git_ops::delete_worktree(&repo, std::path::Path::new(&wt)).unwrap();
        std::fs::remove_dir_all(&wt).ok();
        db.lock().archive_workspace(&ws.id).unwrap();
        assert!(db.lock().list_workspaces("p1").unwrap().is_empty(), "hidden once archived");

        // Creating it again restores the SAME row and rebuilds its worktree.
        let (restored, outcome) =
            create(&db, "p1", &repo, "scan", "Scan task", "arch-branch", "", "").unwrap();
        assert_eq!(restored.id, ws.id, "restored, not duplicated");
        assert_eq!(outcome, CreateOutcome::Restored);
        assert_eq!(restored.status, "active");
        assert!(std::path::Path::new(&wt).join(".git").exists(), "worktree rebuilt");
        assert_eq!(db.lock().list_workspaces("p1").unwrap().len(), 1, "single row");
    }

    #[test]
    fn create_adopts_an_untracked_checkout_without_touching_it() {
        let root = test_repo();
        let repo = root.path().join("proj");
        let db = test_db();
        db.lock()
            .insert_project("p1", "Proj", &repo.to_string_lossy())
            .unwrap();
        let base = crate::git_ops::default_branch(&repo).unwrap().unwrap();
        crate::git_ops::create_branch(&repo, "feat-x", &base).unwrap();

        // An untracked worktree for feat-x (exists on disk, no DB row).
        let wt_dir = tempdir().unwrap();
        let wt = wt_dir.path().join("feat-x");
        let landed = crate::git_ops::create_worktree(&repo, "feat-x", &wt).unwrap();
        std::fs::write(landed.join("mine.txt"), "keep\n").unwrap();

        let (ws, outcome) = create(&db, "p1", &repo, "x", "x", "feat-x", "", "").unwrap();
        assert_eq!(outcome, CreateOutcome::Adopted);
        assert!(
            !db.lock().is_workspace_managed(&ws.id).unwrap(),
            "adopted checkout is NOT managed — delete/archive must never rm it"
        );
        assert_eq!(
            canonical_or(Path::new(ws.worktree_path.as_deref().unwrap())),
            canonical_or(&landed),
            "row points at the existing checkout"
        );
        assert!(landed.join("mine.txt").exists(), "adopted checkout untouched");

        // Re-running is idempotent now that it's tracked.
        let (again, outcome2) = create(&db, "p1", &repo, "x", "x", "feat-x", "", "").unwrap();
        assert_eq!(again.id, ws.id);
        assert_eq!(outcome2, CreateOutcome::Existed);
        assert_eq!(db.lock().list_workspaces("p1").unwrap().len(), 1);
    }

    #[test]
    fn create_for_root_checkout_returns_main_workspace_not_a_duplicate() {
        let root = test_repo();
        let repo = root.path().join("proj");
        let db = test_db();
        db.lock()
            .insert_project("p1", "Proj", &repo.to_string_lossy())
            .unwrap();
        let base = crate::git_ops::default_branch(&repo).unwrap().unwrap();
        // The main workspace: its worktree IS the project root.
        db.lock()
            .insert_workspace("main-ws", "p1", &base, "", &base, Some(&repo.to_string_lossy()), "", None)
            .unwrap();
        // Switch the root checkout to a new branch.
        crate::git_ops::create_branch(&repo, "rootx", &base).unwrap();
        crate::git_ops::open_repo(&repo)
            .unwrap()
            .set_head("refs/heads/rootx")
            .unwrap();

        let (ws, outcome) = create(&db, "p1", &repo, "x", "x", "rootx", "", "").unwrap();
        assert_eq!(ws.id, "main-ws", "returned the main workspace, not a duplicate root row");
        assert_eq!(outcome, CreateOutcome::Existed);
        assert_eq!(db.lock().list_workspaces("p1").unwrap().len(), 1, "no second row for root");
    }

    #[test]
    fn create_rejects_blank_branch() {
        let root = test_repo();
        let repo = root.path().join("proj");
        let db = test_db();
        db.lock()
            .insert_project("p1", "Proj", &repo.to_string_lossy())
            .unwrap();
        assert!(create(&db, "p1", &repo, "x", "x", "  ", "", "").is_err());
    }
}
