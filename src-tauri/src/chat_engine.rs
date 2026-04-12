//! Chat engine — streams responses from the Anthropic Messages API,
//! persists messages to SQLite, and emits real-time Tauri events.

use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::token_engine;
use futures_util::StreamExt;
use parking_lot::Mutex;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

// ─── Public types ─────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChatMsg {
    pub role: String,
    pub content: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub workspace_id: String,
    pub model: String,
    pub messages: Vec<ChatMsg>,
    pub system: Option<String>,
    pub max_tokens: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamEvent {
    pub workspace_id: String,
    pub delta: String,
    pub done: bool,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

// ─── Engine ───────────────────────────────────────────────────────────

pub struct ChatEngine {
    client: Client,
    db: Arc<Mutex<Db>>,
}

impl ChatEngine {
    pub fn new(db: Arc<Mutex<Db>>) -> Self {
        Self {
            client: Client::new(),
            db,
        }
    }

    /// Send a streaming chat request to Anthropic, emit events via Tauri,
    /// and persist both the user message and the assistant response to the DB.
    pub async fn send_streaming(
        &self,
        app: AppHandle,
        request: ChatRequest,
    ) -> AppResult<()> {
        // 1. Read API key from settings file, then env var fallback.
        let api_key = crate::settings::get_anthropic_key().ok_or_else(|| {
            AppError::Other(
                "Anthropic API key not configured. Go to Settings to add your key.".to_string(),
            )
        })?;

        // 2. Persist the last user message to the DB.
        if let Some(user_msg) = request.messages.last().filter(|m| m.role == "user") {
            self.db.lock().insert_chat_message(
                &request.workspace_id,
                &user_msg.role,
                &user_msg.content,
                None,
                None,
                None,
                None,
            )?;
        }

        // 3. Build the API request body (snake_case for Anthropic).
        let body = build_request_body(&request);

        // 4. POST to the Anthropic Messages endpoint.
        let resp = self
            .client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Other(format!("Anthropic request failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(AppError::Other(format!(
                "Anthropic API error {status}: {text}"
            )));
        }

        // 5. Stream and parse SSE lines.
        let mut stream = resp.bytes_stream();
        let mut buf = String::new();
        let mut full_response = String::new();
        let mut input_tokens: Option<u64> = None;
        let mut output_tokens: Option<u64> = None;

        while let Some(chunk) = stream.next().await {
            let chunk =
                chunk.map_err(|e| AppError::Other(format!("stream read error: {e}")))?;
            let text = std::str::from_utf8(&chunk)
                .map_err(|e| AppError::Other(format!("utf-8 decode error: {e}")))?;
            buf.push_str(text);

            // Process all complete lines in the buffer.
            while let Some(newline_pos) = buf.find('\n') {
                let line = buf[..newline_pos].trim_end_matches('\r').to_string();
                buf.drain(..=newline_pos);

                if line.starts_with("data: ") {
                    let data = &line["data: ".len()..];

                    if data == "[DONE]" {
                        // Stream finished — emit done event and break.
                        let done_event = ChatStreamEvent {
                            workspace_id: request.workspace_id.clone(),
                            delta: String::new(),
                            done: true,
                            input_tokens,
                            output_tokens,
                        };
                        let _ = app.emit("chat://stream", &done_event);
                        break;
                    }

                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                        match v.get("type").and_then(|t| t.as_str()) {
                            Some("content_block_delta") => {
                                if let Some(delta_text) = v
                                    .pointer("/delta/text")
                                    .and_then(|t| t.as_str())
                                {
                                    full_response.push_str(delta_text);
                                    let event = ChatStreamEvent {
                                        workspace_id: request.workspace_id.clone(),
                                        delta: delta_text.to_string(),
                                        done: false,
                                        input_tokens: None,
                                        output_tokens: None,
                                    };
                                    let _ = app.emit("chat://stream", &event);
                                }
                            }
                            Some("message_start") => {
                                if let Some(tok) = v.pointer("/message/usage/input_tokens") {
                                    input_tokens = tok.as_u64();
                                }
                            }
                            Some("message_delta") => {
                                if let Some(tok) = v.pointer("/usage/output_tokens") {
                                    output_tokens = tok.as_u64();
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
        }

        // 6. Emit a final done event in case [DONE] was not received.
        let done_event = ChatStreamEvent {
            workspace_id: request.workspace_id.clone(),
            delta: String::new(),
            done: true,
            input_tokens,
            output_tokens,
        };
        let _ = app.emit("chat://stream", &done_event);

        // 7. Compute cost and persist assistant message.
        let inp = input_tokens.unwrap_or(0);
        let out = output_tokens.unwrap_or(0);
        let cost = token_engine::compute_cost(&request.model, inp, out, 0, 0);

        self.db.lock().insert_chat_message(
            &request.workspace_id,
            "assistant",
            &full_response,
            Some(&request.model),
            Some(inp as i64),
            Some(out as i64),
            Some(cost),
        )?;

        // Token tracking: chat_messages already stores tokens + cost per
        // message, so we don't need a separate token_events record (which
        // would fail anyway — token_events.session_id FK references
        // sessions, not workspaces).

        Ok(())
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────

/// Build the Anthropic API request body. The Anthropic API uses snake_case.
fn build_request_body(req: &ChatRequest) -> serde_json::Value {
    let messages: Vec<serde_json::Value> = req
        .messages
        .iter()
        .map(|m| {
            serde_json::json!({
                "role": m.role,
                "content": m.content,
            })
        })
        .collect();

    let mut body = serde_json::json!({
        "model": req.model,
        "max_tokens": req.max_tokens,
        "stream": true,
        "messages": messages,
    });

    if let Some(sys) = &req.system {
        body["system"] = serde_json::Value::String(sys.clone());
    }

    body
}
