//! Daemon spawner — ensures `octopush-pty-server` is running and returns the
//! path to its Unix socket.
//!
//! # Lookup order for the daemon binary
//!
//! 1. Sibling to the running Octopush executable:
//!    - Production: `Octopush.app/Contents/MacOS/octopush-pty-server`
//!    - Dev (`cargo run`): `target/debug/octopush-pty-server`
//!
//!    Both cases resolve via `std::env::current_exe()?.parent()?.join(...)`.
//!
//! 2. If the computed path doesn't exist, we fall back to `which`-style
//!    resolution through `$PATH` (useful during integration tests).

use crate::error::{AppError, AppResult};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::time::{Duration, Instant};

/// Maximum time to wait for the daemon socket to become ready.
const SOCKET_READY_TIMEOUT: Duration = Duration::from_millis(2500);
/// Polling interval while waiting.
const SOCKET_POLL_INTERVAL: Duration = Duration::from_millis(50);

/// Return the path to the PTY daemon's Unix socket, starting the daemon
/// first if it is not already running.
///
/// - If the socket file exists *and* a connection succeeds, returns immediately.
/// - Otherwise, locates the `octopush-pty-server` binary, spawns it fully
///   detached (new session via `setsid`), then polls until the socket is ready
///   or 2.5 seconds elapse.
pub fn ensure_daemon_running() -> AppResult<PathBuf> {
    let sock_path = socket_path()?;

    // Fast path: daemon already up.
    if is_socket_ready(&sock_path) {
        return Ok(sock_path);
    }

    // Locate the binary.
    let daemon_bin = resolve_daemon_binary()?;
    tracing::info!(binary = %daemon_bin.display(), "spawning PTY daemon");

    // Spawn fully detached.
    spawn_detached(&daemon_bin)?;

    // Poll until socket ready or timeout.
    let deadline = Instant::now() + SOCKET_READY_TIMEOUT;
    loop {
        std::thread::sleep(SOCKET_POLL_INTERVAL);
        if is_socket_ready(&sock_path) {
            tracing::info!(socket = %sock_path.display(), "PTY daemon ready");
            return Ok(sock_path);
        }
        if Instant::now() >= deadline {
            break;
        }
    }

    Err(AppError::Other(
        "PTY daemon failed to start within 2.5s".into(),
    ))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// `~/.octopush/pty-server.sock`
pub fn socket_path() -> AppResult<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| AppError::Other("cannot determine $HOME".into()))?;
    Ok(home.join(".octopush").join("pty-server.sock"))
}

/// Returns `true` if the socket file exists and a connection attempt succeeds.
fn is_socket_ready(sock_path: &PathBuf) -> bool {
    if !sock_path.exists() {
        return false;
    }
    UnixStream::connect(sock_path).is_ok()
}

/// Resolve the daemon binary path.
///
/// Primary: sibling of the current executable (works in production `.app` and
/// in `cargo run` / `cargo test`).
/// Fallback: search `$PATH` for `octopush-pty-server`.
fn resolve_daemon_binary() -> AppResult<PathBuf> {
    // Try sibling-of-exe first.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let candidate = parent.join("octopush-pty-server");
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    // Fallback: $PATH lookup (useful in `cargo test` where the daemon is
    // built into target/debug but our exe is the test runner somewhere else).
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in path_var.split(':') {
            let candidate = PathBuf::from(dir).join("octopush-pty-server");
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    // Last resort: current dir / target/debug (helpful in workspace tests).
    for relative in &[
        "target/debug/octopush-pty-server",
        "src-tauri/target/debug/octopush-pty-server",
    ] {
        if let Ok(cwd) = std::env::current_dir() {
            let candidate = cwd.join(relative);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    Err(AppError::Other(
        "octopush-pty-server binary not found next to executable or in $PATH".into(),
    ))
}

/// Spawn the daemon fully detached so it survives Octopush's exit.
///
/// On Unix we call `setsid()` in the child so it escapes the parent's process
/// group and is adopted by `launchd` when Octopush exits.
fn spawn_detached(binary: &PathBuf) -> AppResult<()> {
    use std::process::{Command, Stdio};

    let mut cmd = Command::new(binary);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // SAFETY: `setsid()` is async-signal-safe.  We're in a forked child
        // at this point and the only system call we make is setsid(2).
        unsafe {
            cmd.pre_exec(|| {
                libc::setsid();
                Ok(())
            });
        }
    }

    cmd.spawn()
        .map_err(|e| AppError::Other(format!("failed to spawn daemon: {e}")))?;
    Ok(())
}
