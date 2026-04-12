//! SQLite persistence for sessions and token events.

use crate::error::AppResult;
use crate::session::{Session, SessionStatus};
use crate::token_engine::{CostEntry, TokenEvent, TokenReport, TrendPoint};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Path, PathBuf};

pub struct Db {
    conn: Connection,
}

impl Db {
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let db = Db { conn };
        db.migrate()?;
        Ok(db)
    }

    pub fn default_path() -> PathBuf {
        let base = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("octopus-sh");
        base.join("octopus.db")
    }

    fn migrate(&self) -> AppResult<()> {
        self.conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS sessions (
                id              TEXT PRIMARY KEY,
                name            TEXT NOT NULL,
                color           TEXT NOT NULL,
                icon            TEXT NOT NULL,
                project_root    TEXT NOT NULL,
                agent_config    TEXT NOT NULL,
                token_budget    INTEGER,
                tokens_used     INTEGER NOT NULL DEFAULT 0,
                tokens_input    INTEGER NOT NULL DEFAULT 0,
                tokens_output   INTEGER NOT NULL DEFAULT 0,
                status          TEXT NOT NULL,
                context_files   TEXT NOT NULL DEFAULT '[]',
                tags            TEXT NOT NULL DEFAULT '[]',
                created_at      TEXT NOT NULL,
                last_active     TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_last_active
                ON sessions(last_active DESC);

            CREATE TABLE IF NOT EXISTS token_events (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id      TEXT NOT NULL,
                timestamp       TEXT NOT NULL,
                input_tokens    INTEGER NOT NULL,
                output_tokens   INTEGER NOT NULL,
                cache_read      INTEGER NOT NULL DEFAULT 0,
                cache_create    INTEGER NOT NULL DEFAULT 0,
                model           TEXT NOT NULL,
                cost_usd        REAL NOT NULL DEFAULT 0,
                FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_token_events_session
                ON token_events(session_id, timestamp DESC);
            "#,
        )?;
        Ok(())
    }

    pub fn upsert_session(&self, s: &Session) -> AppResult<()> {
        let agent_json = serde_json::to_string(&s.agent)?;
        let ctx_json = serde_json::to_string(&s.context_files)?;
        let tags_json = serde_json::to_string(&s.tags)?;
        self.conn.execute(
            r#"INSERT INTO sessions (
                id, name, color, icon, project_root, agent_config,
                token_budget, tokens_used, tokens_input, tokens_output,
                status, context_files, tags, created_at, last_active
            ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                color=excluded.color,
                icon=excluded.icon,
                project_root=excluded.project_root,
                agent_config=excluded.agent_config,
                token_budget=excluded.token_budget,
                tokens_used=excluded.tokens_used,
                tokens_input=excluded.tokens_input,
                tokens_output=excluded.tokens_output,
                status=excluded.status,
                context_files=excluded.context_files,
                tags=excluded.tags,
                last_active=excluded.last_active
            "#,
            params![
                s.id,
                s.name,
                s.color,
                s.icon,
                s.project_root,
                agent_json,
                s.token_budget,
                s.tokens_used as i64,
                s.tokens_input as i64,
                s.tokens_output as i64,
                s.status.as_str(),
                ctx_json,
                tags_json,
                s.created_at.to_rfc3339(),
                s.last_active.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn get_session(&self, id: &str) -> AppResult<Option<Session>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, color, icon, project_root, agent_config, token_budget,
                    tokens_used, tokens_input, tokens_output, status, context_files,
                    tags, created_at, last_active
             FROM sessions WHERE id = ?1",
        )?;
        let row = stmt
            .query_row(params![id], |row| Ok(row_to_session(row)))
            .optional()?;
        match row {
            Some(Ok(s)) => Ok(Some(s)),
            Some(Err(e)) => Err(e),
            None => Ok(None),
        }
    }

    pub fn list_sessions(&self) -> AppResult<Vec<Session>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, color, icon, project_root, agent_config, token_budget,
                    tokens_used, tokens_input, tokens_output, status, context_files,
                    tags, created_at, last_active
             FROM sessions ORDER BY last_active DESC",
        )?;
        let rows = stmt.query_map([], |row| Ok(row_to_session(row)))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r??);
        }
        Ok(out)
    }

    pub fn delete_session(&self, id: &str) -> AppResult<()> {
        self.conn
            .execute("DELETE FROM sessions WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn update_status(&self, id: &str, status: SessionStatus) -> AppResult<()> {
        self.conn.execute(
            "UPDATE sessions SET status = ?1, last_active = ?2 WHERE id = ?3",
            params![status.as_str(), Utc::now().to_rfc3339(), id],
        )?;
        Ok(())
    }

    pub fn set_session_budget(&self, id: &str, budget: Option<u64>) -> AppResult<()> {
        self.conn.execute(
            "UPDATE sessions SET token_budget = ?1, last_active = ?2 WHERE id = ?3",
            params![budget.map(|b| b as i64), Utc::now().to_rfc3339(), id],
        )?;
        Ok(())
    }

    pub fn increment_session_tokens(
        &self,
        id: &str,
        input: u64,
        output: u64,
    ) -> AppResult<()> {
        self.conn.execute(
            "UPDATE sessions SET tokens_input = tokens_input + ?1,
                                 tokens_output = tokens_output + ?2,
                                 tokens_used = tokens_used + ?3,
                                 last_active = ?4
             WHERE id = ?5",
            params![
                input as i64,
                output as i64,
                (input + output) as i64,
                Utc::now().to_rfc3339(),
                id,
            ],
        )?;
        Ok(())
    }

    // ─── Token events ─────────────────────────────────────────────

    pub fn insert_token_event(&self, ev: &TokenEvent) -> AppResult<()> {
        self.conn.execute(
            "INSERT INTO token_events (session_id, timestamp, input_tokens, output_tokens,
                                       cache_read, cache_create, model, cost_usd)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                ev.session_id,
                ev.timestamp,
                ev.input_tokens as i64,
                ev.output_tokens as i64,
                ev.cache_read_tokens as i64,
                ev.cache_creation_tokens as i64,
                ev.model,
                ev.cost_usd,
            ],
        )?;
        Ok(())
    }

    pub fn token_report(&self, session_id: Option<&str>) -> AppResult<TokenReport> {
        let (where_clause, filter_val) = match session_id {
            Some(id) => ("WHERE session_id = ?1", id.to_string()),
            None => ("", String::new()),
        };

        // Totals
        let (total_input, total_output, total_cached, total_cost): (i64, i64, i64, f64) = {
            let sql = format!(
                "SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0),
                        COALESCE(SUM(cache_read),0), COALESCE(SUM(cost_usd),0)
                 FROM token_events {where_clause}"
            );
            let mut stmt = self.conn.prepare(&sql)?;
            if session_id.is_some() {
                stmt.query_row(params![filter_val], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
                })?
            } else {
                stmt.query_row([], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
                })?
            }
        };

        // Cost by session
        let cost_by_session = {
            let sql = format!(
                "SELECT s.name, COALESCE(SUM(e.cost_usd),0), COALESCE(SUM(e.input_tokens+e.output_tokens),0)
                 FROM token_events e JOIN sessions s ON s.id = e.session_id
                 {where_clause} GROUP BY e.session_id ORDER BY 2 DESC LIMIT 20"
            );
            let cost_entry_mapper = |r: &rusqlite::Row| -> rusqlite::Result<CostEntry> {
                Ok(CostEntry {
                    label: r.get(0)?,
                    cost_usd: r.get(1)?,
                    tokens: r.get::<_, i64>(2)? as u64,
                })
            };
            let mut stmt = self.conn.prepare(&sql)?;
            if session_id.is_some() {
                stmt.query_map(params![filter_val], cost_entry_mapper)?
                    .collect::<Result<Vec<_>, _>>()?
            } else {
                stmt.query_map([], cost_entry_mapper)?
                    .collect::<Result<Vec<_>, _>>()?
            }
        };

        // Cost by model
        let cost_by_model = {
            let sql = format!(
                "SELECT model, COALESCE(SUM(cost_usd),0), COALESCE(SUM(input_tokens+output_tokens),0)
                 FROM token_events {where_clause} GROUP BY model ORDER BY 2 DESC LIMIT 20"
            );
            let cost_entry_mapper = |r: &rusqlite::Row| -> rusqlite::Result<CostEntry> {
                Ok(CostEntry {
                    label: r.get(0)?,
                    cost_usd: r.get(1)?,
                    tokens: r.get::<_, i64>(2)? as u64,
                })
            };
            let mut stmt = self.conn.prepare(&sql)?;
            if session_id.is_some() {
                stmt.query_map(params![filter_val], cost_entry_mapper)?
                    .collect::<Result<Vec<_>, _>>()?
            } else {
                stmt.query_map([], cost_entry_mapper)?
                    .collect::<Result<Vec<_>, _>>()?
            }
        };

        // Hourly trend (last 24h)
        let hourly_trend = {
            let sql = format!(
                "SELECT strftime('%Y-%m-%dT%H:00:00Z', timestamp) AS hour,
                        SUM(input_tokens+output_tokens), SUM(cost_usd)
                 FROM token_events
                 WHERE timestamp >= datetime('now', '-24 hours')
                 {extra_and}
                 GROUP BY hour ORDER BY hour",
                extra_and = if session_id.is_some() {
                    "AND session_id = ?1"
                } else {
                    ""
                }
            );
            let trend_mapper = |r: &rusqlite::Row| -> rusqlite::Result<TrendPoint> {
                Ok(TrendPoint {
                    hour: r.get(0)?,
                    tokens: r.get::<_, i64>(1)? as u64,
                    cost_usd: r.get(2)?,
                })
            };
            let mut stmt = self.conn.prepare(&sql)?;
            if session_id.is_some() {
                stmt.query_map(params![filter_val], trend_mapper)?
                    .collect::<Result<Vec<_>, _>>()?
            } else {
                stmt.query_map([], trend_mapper)?
                    .collect::<Result<Vec<_>, _>>()?
            }
        };

        // Budget remaining (only if single session)
        let budget_remaining = if let Some(sid) = session_id {
            self.get_session(sid)?
                .and_then(|s| {
                    s.token_budget
                        .map(|b| b.saturating_sub(s.tokens_input + s.tokens_output))
                })
        } else {
            None
        };

        // Projected daily cost: extrapolate from last hour of activity.
        let projected = {
            let sql = format!(
                "SELECT COALESCE(SUM(cost_usd),0)
                 FROM token_events
                 WHERE timestamp >= datetime('now', '-1 hour')
                 {extra_and}",
                extra_and = if session_id.is_some() {
                    "AND session_id = ?1"
                } else {
                    ""
                }
            );
            let mut stmt = self.conn.prepare(&sql)?;
            let last_hour: f64 = if session_id.is_some() {
                stmt.query_row(params![filter_val], |r| r.get(0))?
            } else {
                stmt.query_row([], |r| r.get(0))?
            };
            last_hour * 24.0
        };

        Ok(TokenReport {
            total_input: total_input as u64,
            total_output: total_output as u64,
            total_cached: total_cached as u64,
            total_cost_usd: total_cost,
            cost_by_session,
            cost_by_model,
            hourly_trend,
            budget_remaining,
            projected_daily_cost: projected,
        })
    }
}

fn row_to_session(row: &rusqlite::Row) -> AppResult<Session> {
    let agent_json: String = row.get("agent_config")?;
    let ctx_json: String = row.get("context_files")?;
    let tags_json: String = row.get("tags")?;
    let created: String = row.get("created_at")?;
    let active: String = row.get("last_active")?;
    let status_str: String = row.get("status")?;
    let tokens_used: i64 = row.get("tokens_used")?;
    let tokens_input: i64 = row.get("tokens_input")?;
    let tokens_output: i64 = row.get("tokens_output")?;
    Ok(Session {
        id: row.get("id")?,
        name: row.get("name")?,
        color: row.get("color")?,
        icon: row.get("icon")?,
        project_root: row.get("project_root")?,
        agent: serde_json::from_str(&agent_json)?,
        token_budget: row.get("token_budget")?,
        tokens_used: tokens_used as u64,
        tokens_input: tokens_input as u64,
        tokens_output: tokens_output as u64,
        status: SessionStatus::from_str(&status_str),
        context_files: serde_json::from_str(&ctx_json)?,
        tags: serde_json::from_str(&tags_json)?,
        created_at: DateTime::parse_from_rfc3339(&created)
            .map_err(|e| crate::error::AppError::Other(e.to_string()))?
            .with_timezone(&Utc),
        last_active: DateTime::parse_from_rfc3339(&active)
            .map_err(|e| crate::error::AppError::Other(e.to_string()))?
            .with_timezone(&Utc),
    })
}
