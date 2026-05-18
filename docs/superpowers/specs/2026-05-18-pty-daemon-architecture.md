# PTY Daemon — Architectural Spec

> Goal: Terminal sessions survive Octopush restarts (including auto-updates).

## Problem

PTYs are owned by the process that spawned them. When Octopush exits, every
file descriptor it held closes, and every child shell receives SIGHUP.
Users of Claude Code running long-lived sessions (multi-day debugging,
agentic workflows) lose state on every IDE relaunch — a sharp regression
from JetBrains/VS Code which solve this via background daemons.

## Solution at a glance

Split the responsibility:

- **`octopush`** — the Tauri app. Owns the UI, the DB, project/workspace
  state. Holds no PTYs directly.
- **`octopush-pty-server`** — a separate Rust binary. Owns all PTYs. Stays
  alive across `octopush` restarts. Speaks a simple JSON-RPC protocol over a
  Unix domain socket.

On startup the Tauri app checks for a running daemon. If absent, spawns it
as a fully detached child (fork → setsid → close stdio) so the daemon is
adopted by `launchd` and survives the parent's death. The UI then uses the
socket for every PTY operation: spawn, attach, write, resize, kill, list.

When `octopush` exits, the socket connection closes but the daemon keeps
the PTYs running. On the next launch, the UI reconnects, calls
`list_terminals`, replays scrollback for the active terminal, and the user
resumes work as if nothing happened.

## Components

### 1. Daemon binary (`octopush-pty-server`)

A new `[[bin]]` in `src-tauri/Cargo.toml`. Shares the same Cargo workspace
(reuses dependencies like `portable-pty`, `tracing`, `serde_json`).

Responsibilities:
- Listen on Unix socket `~/.octopush/pty-server.sock`.
- Maintain `HashMap<TerminalId, PtyInstance>` of live PTYs.
- For each PTY, run a reader thread that buffers all output into:
  - In-memory ring buffer (last 64 KiB, used for live attach).
  - Disk-backed append-only log `~/.octopush/pty-state/<id>.log` capped at
    1 MiB (rotated when exceeded).
- Track at most one attached client per terminal id. Refuse a second
  attach unless the previous client disconnected.
- Auto-exit policy: when zero PTYs are alive AND no client has been
  connected for 1 hour, daemon writes a clean shutdown message and exits.
- Crash safety: on startup, scan `~/.octopush/pty-state/` for orphan logs
  and clean them up.
- Write PID to `~/.octopush/pty-server.pid` at startup. Validate on second
  startup that the PID is the daemon's process (defends against PID reuse).

### 2. Protocol (JSON-RPC over Unix socket)

Each message is a single JSON object on a line (newline-delimited JSON):

**Requests (UI → daemon):**

| Method | Params | Returns |
|---|---|---|
| `list_terminals` | none | `[{ id, label, running, cwd, started_at }]` |
| `spawn` | `{ id, cwd, env, shell?, rows, cols }` | `{ id, pid }` |
| `attach` | `{ id, since_seq? }` | streams `data` events for that id |
| `detach` | `{ id }` | `{}` |
| `write` | `{ id, data }` (data base64) | `{}` |
| `resize` | `{ id, cols, rows }` | `{}` |
| `kill` | `{ id, signal? }` | `{}` |
| `shutdown` | none | `{}` (graceful daemon stop) |

**Events (daemon → UI, streaming on the same socket):**

```
{ "event": "data", "id": "...", "seq": 1234, "bytes": "base64..." }
{ "event": "exit", "id": "...", "code": 0 }
{ "event": "error", "id": "...", "message": "..." }
```

`seq` is monotonic per terminal so a re-attaching client can request
`since_seq: N` to receive only the bytes it missed (replayed from the
disk-backed log).

### 3. Octopush as client

`src-tauri/src/pty_manager.rs` is rewritten as a thin client of the daemon
socket. On `AppState::init()`:

1. Read PID file. If absent or process not alive, spawn the daemon:
   ```rust
   Command::new(daemon_binary_path())
       .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
       .pre_exec(|| { libc::setsid(); Ok(()) })  // detach from group
       .spawn()?;
   ```
2. Wait up to 2s for the socket to appear, then connect.
3. Hold a single connection for the app lifetime. All `pty_manager`
   methods enqueue requests; a background tokio task reads responses +
   events and dispatches them.

Existing `pty://data` / `pty://exit` Tauri events still emit to the
frontend so the rest of the codebase is unchanged. Only the source flips
from in-process PTY → socket-relayed PTY.

### 4. Reattach UX

`terminalsStore.loadTerminals` already reads the terminals table from the
DB. Add a parallel call to daemon's `list_terminals` to mark each entry as
`running: true` (PTY exists in daemon) or `running: false` (DB row but no
PTY).

On `TerminalPane` mount:
- Call daemon `attach { id, since_seq: 0 }` to stream the full scrollback
  from the daemon's log file, then live data.
- If no live PTY for that id, daemon returns `error: "not running"`. The
  user clicks the terminal to revive it → spawns a fresh PTY in the
  worktree cwd.

A small `Restored` brass label appears below the terminal name in the
Companion list for 5 seconds after a successful reattach, to acknowledge
the persistence.

### 5. Bundling

`src-tauri/tauri.conf.json` `bundle.externalBin` lists the daemon binary
so Tauri packs it under `Octopush.app/Contents/MacOS/octopush-pty`. The
client resolves the path via Tauri's resource API or by sibling-lookup
relative to its own executable.

In dev (`npm run tauri:dev`) the daemon is compiled as part of the cargo
workspace, found at `target/debug/octopush-pty-server`.

## Lifecycle scenarios

1. **Cold start.** Octopush runs first time. PID file absent → spawn
   daemon → connect. No PTYs yet.
2. **Octopush restart while daemon healthy.** UI disconnects, daemon
   stays. New UI process re-connects, calls `list_terminals`, sees all
   PTYs alive. Attaches to active one, replays scrollback.
3. **Daemon crash.** UI gets `EOF` on socket. Frontend shows
   `Terminal disconnected — reconnecting…` toast. UI respawns daemon (no
   PTYs survive a daemon crash; data loss is the trade-off for not also
   building a watchdog process).
4. **App update.** New `Octopush.app` is installed (different binary). Old
   daemon is still running from the previous version. New UI reconnects to
   old daemon. **Version compatibility:** include a protocol version in
   the daemon's first handshake message. On mismatch, UI gracefully kills
   the old daemon and spawns the new one (terminals lost, but the user is
   notified before).
5. **System reboot.** Daemon dies with the OS. No persistence across
   reboot. (Future: launchd integration for that.)

## Open questions deferred

- **Multi-window Octopush.** If the user opens two Octopush windows
  simultaneously, both try to claim PTYs. Phase 3+ adds a lock per
  terminal id. For v1, second window sees same terminals as the first
  with read-only behavior on already-attached ones.
- **Encryption / authentication.** The socket lives in `~/.octopush/` and
  has 0700 perms. Other users on the machine can't access it. We don't
  authenticate clients beyond that — fine for v1.
- **launchd integration.** Daemon would survive logout/reboot. Defer to
  v1.1.

## Implementation phases

- **Phase 1 (this branch):** new binary, socket protocol, portable-pty
  integration, scrollback persistence, auto-exit policy. Octopush itself
  still uses in-process PTYs. Standalone tested.
- **Phase 2:** rewrite `pty_manager.rs` as daemon client. Octopush spawns
  + connects on startup. Existing terminal features keep working through
  the socket.
- **Phase 3:** reattach UX, `Restored` indicator, scrollback replay on
  cold attach, error states for "PTY not running".

After Phase 3, the user can quit and relaunch Octopush mid-Claude-Code
session and pick up exactly where they left off.
