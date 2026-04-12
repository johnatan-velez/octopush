//! Session recap — a summary generated when a session is completed/killed.

use crate::db::Db;
use crate::error::AppResult;
use chrono::{DateTime, Utc};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecap {
    pub session_id: String,
    pub session_name: String,
    pub tokens_input: u64,
    pub tokens_output: u64,
    pub tokens_total: u64,
    pub cost_usd: f64,
    pub duration_secs: u64,
    pub model: String,
    pub project_root: String,
    pub created_at: String,
    pub ended_at: String,
}

pub fn generate_recap(db: &Arc<Mutex<Db>>, session_id: &str) -> AppResult<SessionRecap> {
    let db = db.lock();
    let session = db
        .get_session(session_id)?
        .ok_or_else(|| crate::error::AppError::SessionNotFound(session_id.to_string()))?;

    let report = db.token_report(Some(session_id))?;
    let now = Utc::now();
    let created: DateTime<Utc> = session.created_at;
    let duration = (now - created).num_seconds().max(0) as u64;

    Ok(SessionRecap {
        session_id: session.id,
        session_name: session.name,
        tokens_input: report.total_input,
        tokens_output: report.total_output,
        tokens_total: report.total_input + report.total_output,
        cost_usd: report.total_cost_usd,
        duration_secs: duration,
        model: session.agent.model,
        project_root: session.project_root,
        created_at: session.created_at.to_rfc3339(),
        ended_at: now.to_rfc3339(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::{CreateSessionArgs, Session};
    use tempfile::NamedTempFile;

    #[test]
    fn generate_recap_basic() {
        let tmp = NamedTempFile::new().unwrap();
        let db = Arc::new(Mutex::new(crate::db::Db::open(tmp.path()).unwrap()));

        let s = Session::from_args(
            "recap-test".into(),
            CreateSessionArgs {
                name: "recap-session".into(),
                project_root: "/tmp".into(),
                color: None,
                icon: None,
                agent: None,
                token_budget: None,
                tags: vec![],
                context_files: vec![],
            },
        );
        db.lock().upsert_session(&s).unwrap();

        let recap = generate_recap(&db, "recap-test").unwrap();
        assert_eq!(recap.session_name, "recap-session");
        assert_eq!(recap.tokens_total, 0);
        assert!(recap.duration_secs < 5); // Just created.
    }
}
