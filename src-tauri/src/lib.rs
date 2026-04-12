//! Octopus sh — native core.

mod commands;
pub mod context_guard;
mod db;
mod error;
mod pty_manager;
mod session;
mod state;
pub mod template;
pub mod token_engine;

#[cfg(test)]
mod tests;

use state::AppState;
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
