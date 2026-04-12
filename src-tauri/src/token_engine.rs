//! Token tracking, pricing, budgets, and reporting.
//!
//! The engine has two modes for recording token usage:
//!
//! 1. **Manual** — the frontend or an IPC command explicitly records a
//!    `TokenEvent`. Useful when the UI parses structured agent output.
//!
//! 2. **PTY interception** — a lightweight scanner looks for known
//!    token-usage patterns in the raw PTY output stream (e.g. Claude
//!    Code's cost summary, API JSON `usage` blocks). This runs on the
//!    reader thread and calls `record()` when it finds a match.
//!
//! The pricing table is in-process for now; Phase 3+ will load it from
//! a user-editable config file.

use crate::db::Db;
use crate::error::AppResult;
use chrono::Utc;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

// ─── Models ───────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TokenEvent {
    pub id: Option<i64>,
    pub session_id: String,
    pub timestamp: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_creation_tokens: u64,
    pub model: String,
    pub cost_usd: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TokenReport {
    pub total_input: u64,
    pub total_output: u64,
    pub total_cached: u64,
    pub total_cost_usd: f64,
    pub cost_by_session: Vec<CostEntry>,
    pub cost_by_model: Vec<CostEntry>,
    pub hourly_trend: Vec<TrendPoint>,
    pub budget_remaining: Option<u64>,
    pub projected_daily_cost: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CostEntry {
    pub label: String,
    pub cost_usd: f64,
    pub tokens: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrendPoint {
    pub hour: String,
    pub tokens: u64,
    pub cost_usd: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BudgetStatus {
    pub session_id: String,
    pub budget: Option<u64>,
    pub used: u64,
    pub remaining: Option<u64>,
    pub percent_used: Option<f64>,
}

// ─── Pricing ──────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug)]
pub enum TokenType {
    Input,
    Output,
    CacheRead,
    CacheCreation,
}

/// Per-million-token pricing. Returns $/token (i.e. already divided by 1M).
pub fn cost_per_token(model: &str, tt: TokenType) -> f64 {
    let per_m = match (model, tt) {
        // Claude Opus 4.6
        ("claude-opus-4-6", TokenType::Input) => 15.0,
        ("claude-opus-4-6", TokenType::Output) => 75.0,
        ("claude-opus-4-6", TokenType::CacheRead) => 1.5,
        ("claude-opus-4-6", TokenType::CacheCreation) => 18.75,
        // Claude Sonnet 4.6
        ("claude-sonnet-4-6", TokenType::Input) => 3.0,
        ("claude-sonnet-4-6", TokenType::Output) => 15.0,
        ("claude-sonnet-4-6", TokenType::CacheRead) => 0.3,
        ("claude-sonnet-4-6", TokenType::CacheCreation) => 3.75,
        // Claude Haiku 4.5
        ("claude-haiku-4-5", TokenType::Input) => 0.80,
        ("claude-haiku-4-5", TokenType::Output) => 4.0,
        ("claude-haiku-4-5", TokenType::CacheRead) => 0.08,
        ("claude-haiku-4-5", TokenType::CacheCreation) => 1.0,
        // GPT-4o
        ("gpt-4o", TokenType::Input) => 2.50,
        ("gpt-4o", TokenType::Output) => 10.0,
        ("gpt-4o", TokenType::CacheRead) => 1.25,
        ("gpt-4o", TokenType::CacheCreation) => 2.50,
        // GPT-4o-mini
        ("gpt-4o-mini", TokenType::Input) => 0.15,
        ("gpt-4o-mini", TokenType::Output) => 0.60,
        ("gpt-4o-mini", TokenType::CacheRead) => 0.075,
        ("gpt-4o-mini", TokenType::CacheCreation) => 0.15,
        // Unknown / local models — free
        (_, _) => 0.0,
    };
    per_m / 1_000_000.0
}

pub fn compute_cost(
    model: &str,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_creation: u64,
) -> f64 {
    input as f64 * cost_per_token(model, TokenType::Input)
        + output as f64 * cost_per_token(model, TokenType::Output)
        + cache_read as f64 * cost_per_token(model, TokenType::CacheRead)
        + cache_creation as f64 * cost_per_token(model, TokenType::CacheCreation)
}

// ─── Engine ───────────────────────────────────────────────────────────

pub struct TokenEngine {
    db: Arc<Mutex<Db>>,
}

impl TokenEngine {
    pub fn new(db: Arc<Mutex<Db>>) -> Self {
        Self { db }
    }

    /// Record a token usage event, compute cost, persist, and update
    /// the session's aggregate counters.
    pub fn record(&self, mut event: TokenEvent) -> AppResult<()> {
        if event.cost_usd == 0.0 {
            event.cost_usd = compute_cost(
                &event.model,
                event.input_tokens,
                event.output_tokens,
                event.cache_read_tokens,
                event.cache_creation_tokens,
            );
        }
        if event.timestamp.is_empty() {
            event.timestamp = Utc::now().to_rfc3339();
        }
        let db = self.db.lock();
        db.insert_token_event(&event)?;
        db.increment_session_tokens(
            &event.session_id,
            event.input_tokens,
            event.output_tokens,
        )?;
        Ok(())
    }

    /// Build an aggregate report, optionally filtered to a single session.
    pub fn report(&self, session_id: Option<&str>) -> AppResult<TokenReport> {
        self.db.lock().token_report(session_id)
    }

    /// Return the budget status for a session.
    pub fn budget_status(&self, session_id: &str) -> AppResult<BudgetStatus> {
        let db = self.db.lock();
        let session = db
            .get_session(session_id)?
            .ok_or_else(|| crate::error::AppError::SessionNotFound(session_id.to_string()))?;
        let used = session.tokens_input + session.tokens_output;
        let remaining = session.token_budget.map(|b| b.saturating_sub(used));
        let pct = session
            .token_budget
            .map(|b| if b == 0 { 100.0 } else { used as f64 / b as f64 * 100.0 });
        Ok(BudgetStatus {
            session_id: session_id.to_string(),
            budget: session.token_budget,
            used,
            remaining,
            percent_used: pct,
        })
    }

    /// Set (or clear) the token budget for a session.
    pub fn set_budget(&self, session_id: &str, budget: Option<u64>) -> AppResult<()> {
        self.db.lock().set_session_budget(session_id, budget)
    }
}

// ─── PTY Output Scanner ──────────────────────────────────────────────
//
// Scans raw PTY output for known token-usage patterns. This is best-effort;
// the patterns are fragile and will need updating as agent UIs evolve.

/// Try to extract a `TokenEvent` from a chunk of PTY output.
/// Returns `None` if no usage pattern is found.
pub fn scan_pty_output(session_id: &str, buf: &[u8]) -> Option<TokenEvent> {
    let text = std::str::from_utf8(buf).ok()?;

    // Pattern 1: JSON `"usage"` block from API response logging.
    // e.g. {"usage":{"input_tokens":1234,"output_tokens":567}}
    if let Some(ev) = try_parse_api_usage_json(session_id, text) {
        return Some(ev);
    }

    // Pattern 2: Claude Code cost summary line.
    // e.g. "Total cost: $1.23 | Input: 45.2K | Output: 12.1K"
    if let Some(ev) = try_parse_claude_code_summary(session_id, text) {
        return Some(ev);
    }

    None
}

fn try_parse_api_usage_json(session_id: &str, text: &str) -> Option<TokenEvent> {
    // Look for a JSON object containing "usage" with token counts.
    let usage_start = text.find("\"usage\"")?;
    // Walk back to find the enclosing {
    let block_start = text[..usage_start].rfind('{')?;
    // Find matching } — simple brace counting.
    let rest = &text[block_start..];
    let block = extract_json_object(rest)?;

    let v: serde_json::Value = serde_json::from_str(block).ok()?;
    let usage = v.get("usage")?;

    let input = usage.get("input_tokens")?.as_u64()?;
    let output = usage.get("output_tokens")?.as_u64()?;
    let cache_read = usage
        .get("cache_read_input_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let cache_create = usage
        .get("cache_creation_input_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let model = v
        .get("model")
        .and_then(|m| m.as_str())
        .unwrap_or("unknown")
        .to_string();

    Some(TokenEvent {
        id: None,
        session_id: session_id.to_string(),
        timestamp: Utc::now().to_rfc3339(),
        input_tokens: input,
        output_tokens: output,
        cache_read_tokens: cache_read,
        cache_creation_tokens: cache_create,
        model: model.clone(),
        cost_usd: compute_cost(&model, input, output, cache_read, cache_create),
    })
}

fn try_parse_claude_code_summary(session_id: &str, text: &str) -> Option<TokenEvent> {
    // Look for pattern like: "Total cost: $X.XX"
    // And optionally "Input: NNK" / "Output: NNK"
    let cost_idx = text.find("Total cost:")?;
    let line = text[cost_idx..].lines().next()?;

    let cost = parse_dollar_amount(line)?;

    let input_tokens = parse_k_value(line, "Input:").unwrap_or(0);
    let output_tokens = parse_k_value(line, "Output:").unwrap_or(0);

    Some(TokenEvent {
        id: None,
        session_id: session_id.to_string(),
        timestamp: Utc::now().to_rfc3339(),
        input_tokens,
        output_tokens,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        model: "unknown".to_string(),
        cost_usd: cost,
    })
}

fn extract_json_object(s: &str) -> Option<&str> {
    if !s.starts_with('{') {
        return None;
    }
    let mut depth = 0i32;
    let mut in_str = false;
    let mut escape = false;
    for (i, ch) in s.char_indices() {
        if escape {
            escape = false;
            continue;
        }
        if ch == '\\' && in_str {
            escape = true;
            continue;
        }
        if ch == '"' {
            in_str = !in_str;
            continue;
        }
        if in_str {
            continue;
        }
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&s[..=i]);
                }
            }
            _ => {}
        }
    }
    None
}

fn parse_dollar_amount(s: &str) -> Option<f64> {
    let dollar = s.find('$')?;
    let rest = &s[dollar + 1..];
    let end = rest
        .find(|c: char| !c.is_ascii_digit() && c != '.')
        .unwrap_or(rest.len());
    rest[..end].parse().ok()
}

fn parse_k_value(s: &str, prefix: &str) -> Option<u64> {
    let idx = s.find(prefix)?;
    let rest = s[idx + prefix.len()..].trim_start();
    let end = rest
        .find(|c: char| !c.is_ascii_digit() && c != '.' && c != 'K' && c != 'k')
        .unwrap_or(rest.len());
    let raw = &rest[..end];
    if raw.ends_with('K') || raw.ends_with('k') {
        let num: f64 = raw[..raw.len() - 1].parse().ok()?;
        Some((num * 1000.0) as u64)
    } else {
        raw.parse().ok()
    }
}
