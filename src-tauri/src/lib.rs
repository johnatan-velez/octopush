//! Octopus sh — native core.

pub mod agent_adapter;
mod commands;
pub mod context_guard;
mod db;
mod error;
pub mod provider_router;
mod pty_manager;
mod session;
pub mod session_recap;
mod state;
pub mod template;
pub mod theme;
pub mod token_engine;

#[cfg(test)]
mod tests;

use state::AppState;
use tauri::Manager;
use tracing_subscriber::EnvFilter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .try_init();

    let app_state = AppState::init().expect("failed to initialize app state");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            // Sessions
            commands::create_session,
            commands::list_sessions,
            commands::write_to_session,
            commands::write_text_to_session,
            commands::resize_session,
            commands::kill_session,
            commands::delete_session,
            // Tokens
            commands::get_token_report,
            commands::record_token_event,
            commands::get_budget_status,
            commands::set_token_budget,
            // Templates
            commands::list_templates,
            commands::save_template,
            commands::delete_template,
            // Providers / Agents
            commands::list_providers,
            commands::list_models,
            commands::suggest_model,
            commands::list_adapters,
            commands::switch_agent,
            // Recap / Export
            commands::get_session_recap,
            commands::export_session_json,
            commands::export_session_csv,
            // Theme
            commands::get_theme,
            commands::set_theme,
            commands::list_themes,
        ])
        .setup(|app| {
            // Restore sessions that were active when the app last closed.
            let state = app.state::<AppState>();
            restore_active_sessions(app.handle().clone(), &state);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Re-spawn PTYs for sessions that were `active` or `idle` on last shutdown.
fn restore_active_sessions(app: tauri::AppHandle, state: &AppState) {
    let sessions = match state.db.lock().list_sessions() {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(error = %e, "failed to load sessions for restore");
            return;
        }
    };

    for session in sessions {
        use crate::session::SessionStatus;
        if session.status != SessionStatus::Active && session.status != SessionStatus::Idle {
            continue;
        }

        let guard =
            crate::context_guard::ContextGuard::auto_configure(&session.id, std::path::Path::new(&session.project_root));
        let mut env = std::collections::HashMap::new();
        guard.apply_env(&mut env);

        let db_for_hook = std::sync::Arc::clone(&state.db);
        let scanner_hook: crate::pty_manager::OutputHook = Box::new(move |sid, bytes| {
            if let Some(ev) = crate::token_engine::scan_pty_output(sid, bytes) {
                let engine =
                    crate::token_engine::TokenEngine::new(std::sync::Arc::clone(&db_for_hook));
                let _ = engine.record(ev);
            }
        });

        if let Err(e) = state.pty.lock().spawn(
            app.clone(),
            crate::pty_manager::SpawnOptions {
                id: session.id.clone(),
                session_name: session.name.clone(),
                cwd: session.project_root.clone(),
                env,
                rows: 24,
                cols: 80,
                shell: None,
                on_output: Some(scanner_hook),
            },
        ) {
            tracing::warn!(session = %session.name, error = %e, "failed to restore session PTY");
            let _ = state
                .db
                .lock()
                .update_status(&session.id, SessionStatus::Error);
        } else {
            tracing::info!(session = %session.name, "restored session PTY");
        }
    }
}
