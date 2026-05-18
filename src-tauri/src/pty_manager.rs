//! PTY lifecycle management — thin wrapper over [`DaemonClient`].
//!
//! `PtyManager` no longer owns PTYs in-process.  Every operation is proxied
//! to the `octopush-pty-server` daemon via the Unix socket.
//!
//! The public API is preserved so the rest of the codebase (commands.rs,
//! lib.rs) requires minimal changes.  The `pty://data` and `pty://exit` Tauri
//! events continue to fire with the same `{ sessionId, bytes }` /
//! `{ sessionId, code }` payloads the frontend already consumes.

use crate::error::{AppError, AppResult};
use crate::pty_client::{DaemonClient, TermEvent};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

// ---------------------------------------------------------------------------
// Tauri event payloads (unchanged — frontend depends on this shape)
// ---------------------------------------------------------------------------

/// Event payload for `pty://data`
#[derive(Serialize, Clone)]
struct PtyDataEvent {
    #[serde(rename = "sessionId")]
    session_id: String,
    /// Raw bytes read from the PTY.
    bytes: Vec<u8>,
}

/// Event payload for `pty://exit`
#[derive(Serialize, Clone)]
struct PtyExitEvent {
    #[serde(rename = "sessionId")]
    session_id: String,
    code: Option<i32>,
}

// ---------------------------------------------------------------------------
// OutputHook type alias (preserved for scanner integration)
// ---------------------------------------------------------------------------

/// Optional callback invoked on each PTY read chunk (for token scanning).
pub type OutputHook = Box<dyn Fn(&str, &[u8]) + Send + 'static>;

// ---------------------------------------------------------------------------
// SpawnOptions (public API unchanged)
// ---------------------------------------------------------------------------

pub struct SpawnOptions {
    pub id: String,
    pub session_name: String,
    pub cwd: String,
    pub env: HashMap<String, String>,
    pub rows: u16,
    pub cols: u16,
    pub shell: Option<String>,
    /// If set, called with `(session_id, bytes)` on each PTY data chunk.
    pub on_output: Option<OutputHook>,
}

// ---------------------------------------------------------------------------
// PtyManager
// ---------------------------------------------------------------------------

pub struct PtyManager {
    /// Shared connection to the daemon.
    client: Arc<DaemonClient>,
    /// Track which session ids this manager has spawned.
    active: HashMap<String, ()>,
}

impl PtyManager {
    /// Create a new manager.  The `client` is shared so that the spawner and
    /// the attach threads all use the same underlying socket.
    pub fn new(client: Arc<DaemonClient>) -> Self {
        Self {
            client,
            active: HashMap::new(),
        }
    }

    /// Spawn a new PTY session via the daemon and start an attach thread that
    /// forwards events to the frontend.
    pub fn spawn(&mut self, app: AppHandle, opts: SpawnOptions) -> AppResult<()> {
        let client = Arc::clone(&self.client);
        let id = opts.id.clone();

        // Ask the daemon to start the shell.
        client.spawn(
            &id,
            &opts.cwd,
            &opts.env,
            opts.shell.as_deref(),
            opts.rows,
            opts.cols,
        )?;

        // Attach: get an event receiver for live output.
        let rx = client.attach(&id, 0)?;

        // Reader / event-forwarder thread.
        let reader_id = id.clone();
        let reader_app = app.clone();
        let on_output = opts.on_output;
        std::thread::Builder::new()
            .name(format!("pty-attach-{}", opts.id))
            .spawn(move || {
                loop {
                    match rx.recv() {
                        Ok(TermEvent::Data { bytes, .. }) => {
                            let _ = reader_app.emit(
                                "pty://data",
                                PtyDataEvent {
                                    session_id: reader_id.clone(),
                                    bytes: bytes.clone(),
                                },
                            );
                            if let Some(ref hook) = on_output {
                                hook(&reader_id, &bytes);
                            }
                        }
                        Ok(TermEvent::Exit { code }) => {
                            let _ = reader_app.emit(
                                "pty://exit",
                                PtyExitEvent {
                                    session_id: reader_id.clone(),
                                    code,
                                },
                            );
                            break;
                        }
                        Ok(TermEvent::Error { message }) => {
                            tracing::warn!(
                                session_id = %reader_id,
                                error = %message,
                                "pty daemon event error"
                            );
                            // Treat as terminal disconnect.
                            let _ = reader_app.emit(
                                "pty://exit",
                                PtyExitEvent {
                                    session_id: reader_id.clone(),
                                    code: None,
                                },
                            );
                            break;
                        }
                        Err(_) => {
                            // Channel closed — daemon disconnected or session ended.
                            let _ = reader_app.emit(
                                "pty://exit",
                                PtyExitEvent {
                                    session_id: reader_id.clone(),
                                    code: None,
                                },
                            );
                            break;
                        }
                    }
                }
            })
            .map_err(|e| AppError::Pty(format!("spawn attach thread: {e}")))?;

        self.active.insert(id, ());
        Ok(())
    }

    pub fn write(&self, id: &str, data: &[u8]) -> AppResult<()> {
        self.client.write(id, data)
    }

    pub fn resize(&self, id: &str, rows: u16, cols: u16) -> AppResult<()> {
        self.client.resize(id, cols, rows)
    }

    pub fn kill(&mut self, id: &str) -> AppResult<()> {
        self.active.remove(id);
        self.client.kill(id, "TERM")
    }

    pub fn has(&self, id: &str) -> bool {
        self.active.contains_key(id)
    }

    pub fn ids(&self) -> Vec<String> {
        self.active.keys().cloned().collect()
    }
}
