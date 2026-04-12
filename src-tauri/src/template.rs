//! Session templates — pre-configured session blueprints stored as JSON
//! files under `~/.octopus-sh/templates/`.

use crate::error::AppResult;
use crate::session::AgentConfig;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionTemplate {
    pub name: String,
    pub project_root: String,
    #[serde(default)]
    pub agent: Option<AgentConfig>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub context_files: Vec<String>,
    #[serde(default)]
    pub token_budget: Option<u64>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "default_icon")]
    pub icon: String,
    #[serde(default = "default_color")]
    pub color: String,
}

fn default_icon() -> String {
    "🐙".into()
}
fn default_color() -> String {
    "#a78bfa".into()
}

/// On-disk representation: a single JSON file can hold one template
/// (object) or many (object where each key is a template name and value
/// is the body). We normalise both forms into `Vec<SessionTemplate>`.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(untagged)]
enum TemplateFile {
    /// A map of `name → body` (the format shown in the plan).
    Map(HashMap<String, TemplateBody>),
    /// A single template with its name inlined.
    Single(SessionTemplate),
}

/// Body used inside the map variant — identical to `SessionTemplate` but
/// without the `name` field (the key of the map serves as the name).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct TemplateBody {
    pub project_root: String,
    #[serde(default)]
    pub agent: Option<AgentConfig>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub context_files: Vec<String>,
    #[serde(default)]
    pub token_budget: Option<u64>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "default_icon")]
    pub icon: String,
    #[serde(default = "default_color")]
    pub color: String,
}

impl TemplateBody {
    fn into_template(self, name: String) -> SessionTemplate {
        SessionTemplate {
            name,
            project_root: self.project_root,
            agent: self.agent,
            env: self.env,
            context_files: self.context_files,
            token_budget: self.token_budget,
            tags: self.tags,
            icon: self.icon,
            color: self.color,
        }
    }
}

fn templates_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".octopus-sh")
        .join("templates")
}

/// Load all templates from `~/.octopus-sh/templates/*.json`.
pub fn list_templates() -> AppResult<Vec<SessionTemplate>> {
    let dir = templates_dir();
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().map_or(false, |e| e == "json") {
            match load_file(&path) {
                Ok(mut templates) => out.append(&mut templates),
                Err(e) => {
                    tracing::warn!(path = %path.display(), error = %e, "skip bad template file");
                }
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

fn load_file(path: &Path) -> AppResult<Vec<SessionTemplate>> {
    let content = std::fs::read_to_string(path)?;
    let file: TemplateFile = serde_json::from_str(&content)?;
    match file {
        TemplateFile::Map(map) => Ok(map
            .into_iter()
            .map(|(name, body)| body.into_template(name))
            .collect()),
        TemplateFile::Single(t) => Ok(vec![t]),
    }
}

/// Save a single template as `~/.octopus-sh/templates/<name>.json`.
pub fn save_template(template: &SessionTemplate) -> AppResult<()> {
    let dir = templates_dir();
    std::fs::create_dir_all(&dir)?;
    let filename = slugify(&template.name);
    let path = dir.join(format!("{filename}.json"));
    let json = serde_json::to_string_pretty(template)?;
    std::fs::write(path, json)?;
    Ok(())
}

/// Delete a template file by name.
pub fn delete_template(name: &str) -> AppResult<()> {
    let dir = templates_dir();
    let filename = slugify(name);
    let path = dir.join(format!("{filename}.json"));
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

fn slugify(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn parse_map_format() {
        let json = r##"{
            "my-project": {
                "projectRoot": "~/projects/my-project",
                "tags": ["backend"],
                "icon": "🏦",
                "color": "#6366f1"
            }
        }"##;
        let file: TemplateFile = serde_json::from_str(json).unwrap();
        match file {
            TemplateFile::Map(map) => {
                assert_eq!(map.len(), 1);
                let body = map.get("my-project").unwrap();
                assert_eq!(body.project_root, "~/projects/my-project");
                assert_eq!(body.icon, "🏦");
            }
            _ => panic!("expected Map variant"),
        }
    }

    #[test]
    fn parse_single_format() {
        let json = r#"{
            "name": "standalone",
            "projectRoot": "/tmp/test"
        }"#;
        let file: TemplateFile = serde_json::from_str(json).unwrap();
        match file {
            TemplateFile::Single(t) => {
                assert_eq!(t.name, "standalone");
                assert_eq!(t.project_root, "/tmp/test");
            }
            _ => panic!("expected Single variant"),
        }
    }

    #[test]
    fn save_and_load_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let template = SessionTemplate {
            name: "test-template".into(),
            project_root: "/tmp/test".into(),
            agent: None,
            env: HashMap::new(),
            context_files: vec![],
            token_budget: Some(100_000),
            tags: vec!["test".into()],
            icon: "🔧".into(),
            color: "#f59e0b".into(),
        };

        let dir = tmp.path().join("templates");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test-template.json");
        let json = serde_json::to_string_pretty(&template).unwrap();
        std::fs::write(&path, &json).unwrap();

        let loaded = load_file(&path).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].name, "test-template");
        assert_eq!(loaded[0].token_budget, Some(100_000));
    }

    #[test]
    fn slugify_works() {
        assert_eq!(slugify("My Cool Project"), "my-cool-project");
        assert_eq!(slugify("backend_api"), "backend_api");
    }
}
