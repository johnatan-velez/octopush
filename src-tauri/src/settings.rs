//! App settings persisted to ~/.octopus-sh/settings.json

use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub anthropic_api_key: Option<String>,
    #[serde(default)]
    pub openai_api_key: Option<String>,
}

fn settings_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".octopus-sh")
        .join("settings.json")
}

pub fn load_settings() -> AppResult<AppSettings> {
    let path = settings_path();
    if path.exists() {
        let content = std::fs::read_to_string(&path)?;
        Ok(serde_json::from_str(&content).unwrap_or_default())
    } else {
        Ok(AppSettings::default())
    }
}

pub fn save_settings(settings: &AppSettings) -> AppResult<()> {
    let path = settings_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, serde_json::to_string_pretty(settings)?)?;
    Ok(())
}

/// Get the Anthropic API key: settings file first, then env var fallback.
pub fn get_anthropic_key() -> Option<String> {
    if let Ok(settings) = load_settings() {
        if let Some(key) = settings.anthropic_api_key {
            if !key.is_empty() {
                return Some(key);
            }
        }
    }
    std::env::var("ANTHROPIC_API_KEY").ok()
}
