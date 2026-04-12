//! Unit tests for the Octopus sh core.
//!
//! Run with `cargo test` from `src-tauri/`.

#[cfg(test)]
mod db_tests {
    use crate::db::Db;
    use crate::session::{AgentConfig, CreateSessionArgs, Session, SessionStatus};
    use crate::token_engine::{compute_cost, TokenEvent, TokenEngine};
    use parking_lot::Mutex;
    use std::sync::Arc;
    use tempfile::NamedTempFile;

    fn test_db() -> Db {
        let tmp = NamedTempFile::new().unwrap();
        Db::open(tmp.path()).unwrap()
    }

    fn test_session(name: &str) -> Session {
        Session::from_args(
            uuid::Uuid::new_v4().to_string(),
            CreateSessionArgs {
                name: name.to_string(),
                project_root: "/tmp".to_string(),
                color: None,
                icon: None,
                agent: None,
                token_budget: None,
                tags: vec!["test".into()],
                context_files: vec![],
            },
        )
    }

    #[test]
    fn session_crud() {
        let db = test_db();
        let s = test_session("crud-test");

        // Insert
        db.upsert_session(&s).unwrap();
        let got = db.get_session(&s.id).unwrap().expect("session not found");
        assert_eq!(got.name, "crud-test");
        assert_eq!(got.tags, vec!["test"]);

        // Update status
        db.update_status(&s.id, SessionStatus::Active).unwrap();
        let got = db.get_session(&s.id).unwrap().unwrap();
        assert_eq!(got.status, SessionStatus::Active);

        // List
        let all = db.list_sessions().unwrap();
        assert_eq!(all.len(), 1);

        // Delete
        db.delete_session(&s.id).unwrap();
        assert!(db.get_session(&s.id).unwrap().is_none());
    }

    #[test]
    fn session_serde_roundtrip() {
        let s = test_session("roundtrip");
        let json = serde_json::to_string(&s).unwrap();
        let back: Session = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, s.id);
        assert_eq!(back.name, "roundtrip");
    }

    #[test]
    fn agent_config_defaults() {
        let cfg = AgentConfig::default();
        assert_eq!(cfg.model, "claude-opus-4-6");
        assert_eq!(cfg.temperature, 1.0);
        assert_eq!(cfg.max_tokens, 8192);
    }

    #[test]
    fn token_event_insert_and_report() {
        let db = Arc::new(Mutex::new(test_db()));
        let engine = TokenEngine::new(Arc::clone(&db));

        // Must have a session first (FK constraint).
        let s = test_session("token-test");
        db.lock().upsert_session(&s).unwrap();

        let ev = TokenEvent {
            id: None,
            session_id: s.id.clone(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            input_tokens: 1000,
            output_tokens: 500,
            cache_read_tokens: 200,
            cache_creation_tokens: 0,
            model: "claude-sonnet-4-6".to_string(),
            cost_usd: 0.0, // will be computed
        };
        engine.record(ev).unwrap();

        let report = engine.report(Some(&s.id)).unwrap();
        assert_eq!(report.total_input, 1000);
        assert_eq!(report.total_output, 500);
        assert!(report.total_cost_usd > 0.0);

        // Session aggregates should be updated too.
        let updated = db.lock().get_session(&s.id).unwrap().unwrap();
        assert_eq!(updated.tokens_input, 1000);
        assert_eq!(updated.tokens_output, 500);
    }

    #[test]
    fn budget_set_and_check() {
        let db = Arc::new(Mutex::new(test_db()));
        let engine = TokenEngine::new(Arc::clone(&db));

        let s = test_session("budget-test");
        db.lock().upsert_session(&s).unwrap();

        engine.set_budget(&s.id, Some(10_000)).unwrap();
        let status = engine.budget_status(&s.id).unwrap();
        assert_eq!(status.budget, Some(10_000));
        assert_eq!(status.used, 0);
        assert_eq!(status.remaining, Some(10_000));
    }

    #[test]
    fn pricing_known_models() {
        let cost = compute_cost("claude-opus-4-6", 1_000_000, 100_000, 0, 0);
        // $15 input + $7.50 output = $22.50
        assert!((cost - 22.5).abs() < 0.01);

        let free = compute_cost("llama-3-local", 1_000_000, 1_000_000, 0, 0);
        assert_eq!(free, 0.0);
    }

    #[test]
    fn session_budget_increment() {
        let db = test_db();
        let s = test_session("incr-test");
        db.upsert_session(&s).unwrap();

        db.increment_session_tokens(&s.id, 500, 300).unwrap();
        db.increment_session_tokens(&s.id, 200, 100).unwrap();

        let updated = db.get_session(&s.id).unwrap().unwrap();
        assert_eq!(updated.tokens_input, 700);
        assert_eq!(updated.tokens_output, 400);
        assert_eq!(updated.tokens_used, 1100);
    }
}

#[cfg(test)]
mod scanner_tests {
    use crate::token_engine::scan_pty_output;

    #[test]
    fn parse_api_usage_json() {
        let payload = r#"some prefix {"model":"claude-sonnet-4-6","usage":{"input_tokens":1500,"output_tokens":800,"cache_read_input_tokens":100}} some suffix"#;
        let ev = scan_pty_output("sess-1", payload.as_bytes()).unwrap();
        assert_eq!(ev.input_tokens, 1500);
        assert_eq!(ev.output_tokens, 800);
        assert_eq!(ev.cache_read_tokens, 100);
        assert_eq!(ev.model, "claude-sonnet-4-6");
        assert!(ev.cost_usd > 0.0);
    }

    #[test]
    fn parse_claude_code_summary() {
        let line = "Total cost: $1.23 | Input: 45.2K | Output: 12.1K";
        let ev = scan_pty_output("sess-2", line.as_bytes()).unwrap();
        assert!((ev.cost_usd - 1.23).abs() < 0.001);
        assert_eq!(ev.input_tokens, 45200);
        assert_eq!(ev.output_tokens, 12100);
    }

    #[test]
    fn no_match_returns_none() {
        assert!(scan_pty_output("x", b"hello world").is_none());
        assert!(scan_pty_output("x", b"").is_none());
    }
}
