//! Accounts (P1) — desktop sign-in via Clerk using the OAuth 2.0 Authorization
//! Code flow with **PKCE (S256)** as a **public client** (no client secret).
//!
//! Why this shape (vs. embedding Clerk's web SDK): Octopush is a native Tauri
//! app, and Clerk has no official desktop SDK. The robust, standard pattern for
//! native apps (RFC 8252) is to do the OAuth dance in the user's **real system
//! browser** and capture the redirect on a **loopback** server — which sidesteps
//! the webview cookie/origin friction entirely and keeps identity in Rust where
//! the entitlement gates live. Clerk's discovery advertises
//! `token_endpoint_auth_methods_supported: ["none", ...]`, so a public client
//! (PKCE, no secret) is supported — nothing secret ever ships in the binary.
//!
//! Flow: gen PKCE verifier+challenge → open the browser to `/oauth/authorize`
//! → user signs in on Clerk's hosted page → Clerk redirects to
//! `http://127.0.0.1:8976/callback?code&state` → we exchange the code at
//! `/oauth/token` (with the verifier, no secret) → fetch `/oauth/userinfo` →
//! store the session in the OS keychain. See
//! `docs/premium/accounts-and-subscriptions-implementation-plan.md` (P1).

use crate::error::{AppError, AppResult};
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;

/// Loopback port the OAuth redirect lands on. Must match a Redirect URL
/// registered on the Clerk OAuth application.
const LOOPBACK_PORT: u16 = 8976;
/// How long we wait for the user to finish signing in before giving up.
const SIGN_IN_TIMEOUT_SECS: u64 = 300;
/// Keychain service/account under which the session blob is stored.
const KEYRING_SERVICE: &str = "octopush";
const KEYRING_ACCOUNT: &str = "clerk-oauth-session";

/// Resolved Clerk OAuth configuration. The `client_id` and instance are PUBLIC
/// values (safe to ship); the secret is never used (public-client PKCE). For now
/// these are built-in defaults for the project's Clerk instance; a later phase
/// makes them configurable for a production instance.
#[derive(Debug, Clone)]
pub struct ClerkConfig {
    pub instance: String,
    pub client_id: String,
    pub redirect_uri: String,
    pub scopes: String,
}

impl ClerkConfig {
    pub fn current() -> Self {
        ClerkConfig {
            instance: "smooth-ringtail-82.clerk.accounts.dev".into(),
            client_id: "M3OMbpMlh1vzUnO4".into(),
            redirect_uri: format!("http://127.0.0.1:{LOOPBACK_PORT}/callback"),
            // `offline_access` yields a refresh token for silent re-auth.
            scopes: "openid email profile offline_access".into(),
        }
    }
    pub fn authorize_url(&self) -> String {
        format!("https://{}/oauth/authorize", self.instance)
    }
    pub fn token_url(&self) -> String {
        format!("https://{}/oauth/token", self.instance)
    }
    pub fn userinfo_url(&self) -> String {
        format!("https://{}/oauth/userinfo", self.instance)
    }
    /// Clerk's hosted account portal — opened in the browser for sign-up and
    /// profile/MFA management (a clean native pattern; we don't rebuild it).
    pub fn account_portal_url(&self) -> String {
        format!("https://{}/user", self.instance)
    }
}

/// What the frontend shows: are we signed in, and as whom.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub signed_in: bool,
    pub email: Option<String>,
    pub name: Option<String>,
}

/// Persisted session (kept in the OS keychain, never in the DB or settings.json).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredSession {
    sub: String,
    email: Option<String>,
    name: Option<String>,
    access_token: String,
    refresh_token: Option<String>,
    obtained_at: String,
}

// ─── PKCE + state (pure, unit-tested) ──────────────────────────────────────

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// A high-entropy code verifier: 32 random bytes → 43-char base64url string
/// (within the RFC 7636 43–128 range, all unreserved chars).
fn gen_verifier() -> String {
    let mut bytes = [0u8; 32];
    bytes[..16].copy_from_slice(uuid::Uuid::new_v4().as_bytes());
    bytes[16..].copy_from_slice(uuid::Uuid::new_v4().as_bytes());
    b64url(&bytes)
}

/// `code_challenge = BASE64URL(SHA256(verifier))` — the S256 method (the only
/// one Clerk advertises).
fn challenge_s256(verifier: &str) -> String {
    b64url(&Sha256::digest(verifier.as_bytes()))
}

fn random_state() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// Build the `/oauth/authorize` URL for the Authorization Code + PKCE flow.
fn build_authorize_url(cfg: &ClerkConfig, challenge: &str, state: &str) -> String {
    let q = |k: &str, v: &str| format!("{}={}", k, urlencoding::encode(v));
    format!(
        "{}?{}&{}&{}&{}&{}&{}&{}",
        cfg.authorize_url(),
        q("response_type", "code"),
        q("client_id", &cfg.client_id),
        q("redirect_uri", &cfg.redirect_uri),
        q("scope", &cfg.scopes),
        q("state", state),
        q("code_challenge", challenge),
        q("code_challenge_method", "S256"),
    )
}

// ─── Loopback redirect capture ─────────────────────────────────────────────

/// Parse `code`/`state`/`error` out of a redirect request's target path
/// (e.g. `/callback?code=abc&state=xyz`).
fn parse_callback_query(target: &str) -> (Option<String>, Option<String>, Option<String>) {
    let query = target.split_once('?').map(|(_, q)| q).unwrap_or("");
    let mut code = None;
    let mut state = None;
    let mut error = None;
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            let val = urlencoding::decode(v).map(|c| c.into_owned()).unwrap_or_default();
            match k {
                "code" => code = Some(val),
                "state" => state = Some(val),
                "error" => error = Some(val),
                _ => {}
            }
        }
    }
    (code, state, error)
}

/// Block on the loopback listener until the OAuth redirect arrives, validate the
/// `state`, send the browser a friendly "you can close this tab" page, and
/// return the authorization `code`. Ignores stray requests (e.g. favicon).
fn wait_for_callback(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    loop {
        let (mut stream, _) = listener.accept().map_err(|e| e.to_string())?;
        let mut buf = [0u8; 4096];
        let n = stream.read(&mut buf).unwrap_or(0);
        let req = String::from_utf8_lossy(&buf[..n]);
        // First line: `GET /callback?code=... HTTP/1.1`
        let target = req
            .lines()
            .next()
            .and_then(|l| l.split_whitespace().nth(1))
            .unwrap_or("");
        if !target.starts_with("/callback") {
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
            continue;
        }
        let (code, state, error) = parse_callback_query(target);
        let (status, title, body) = if let Some(err) = error {
            ("400 Bad Request", "Sign-in cancelled", format!("Clerk reported: {err}"))
        } else if state.as_deref() != Some(expected_state) {
            ("400 Bad Request", "Sign-in failed", "State mismatch — please try again.".into())
        } else if code.is_some() {
            ("200 OK", "Signed in", "You can close this tab and return to Octopush.".into())
        } else {
            ("400 Bad Request", "Sign-in failed", "No authorization code returned.".into())
        };
        let html = format!(
            "<!doctype html><html><head><meta charset=\"utf-8\"><title>{title}</title>\
             <style>body{{font-family:-apple-system,system-ui,sans-serif;background:#0c0a08;color:#f4ecdb;\
             display:flex;align-items:center;justify-content:center;height:100vh;margin:0}}\
             .c{{text-align:center}}h1{{color:#d4a574;font-weight:500}}</style></head>\
             <body><div class=\"c\"><h1>{title}</h1><p>{body}</p></div></body></html>"
        );
        let _ = stream.write_all(
            format!(
                "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{html}",
                html.len()
            )
            .as_bytes(),
        );
        if status.starts_with("200") {
            return Ok(code.unwrap());
        }
        return Err(body);
    }
}

fn open_in_browser(url: &str) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    let prog = "open";
    #[cfg(target_os = "linux")]
    let prog = "xdg-open";
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let prog = "open";
    std::process::Command::new(prog)
        .arg(url)
        .spawn()
        .map_err(|e| AppError::Other(format!("could not open the browser for sign-in: {e}")))?;
    Ok(())
}

// ─── Token exchange + userinfo ─────────────────────────────────────────────

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct UserInfo {
    sub: String,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    name: Option<String>,
}

async fn exchange_code(
    cfg: &ClerkConfig,
    code: &str,
    verifier: &str,
) -> AppResult<TokenResponse> {
    let client = reqwest::Client::new();
    let resp = client
        .post(cfg.token_url())
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", &cfg.redirect_uri),
            ("client_id", &cfg.client_id),
            ("code_verifier", verifier),
        ])
        .send()
        .await
        .map_err(|e| AppError::Other(format!("token exchange request failed: {e}")))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Other(format!("token exchange failed ({status}): {body}")));
    }
    resp.json::<TokenResponse>()
        .await
        .map_err(|e| AppError::Other(format!("could not parse token response: {e}")))
}

async fn fetch_userinfo(cfg: &ClerkConfig, access_token: &str) -> AppResult<UserInfo> {
    let client = reqwest::Client::new();
    let resp = client
        .get(cfg.userinfo_url())
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("userinfo request failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Other(format!("userinfo failed: {}", resp.status())));
    }
    resp.json::<UserInfo>()
        .await
        .map_err(|e| AppError::Other(format!("could not parse userinfo: {e}")))
}

// ─── Keychain persistence ──────────────────────────────────────────────────

fn keyring_entry() -> AppResult<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| AppError::Other(format!("keychain unavailable: {e}")))
}

fn store_session(session: &StoredSession) -> AppResult<()> {
    let blob = serde_json::to_string(session)?;
    keyring_entry()?
        .set_password(&blob)
        .map_err(|e| AppError::Other(format!("could not save the session to the keychain: {e}")))
}

fn load_session() -> Option<StoredSession> {
    let entry = keyring_entry().ok()?;
    match entry.get_password() {
        Ok(blob) => serde_json::from_str(&blob).ok(),
        Err(_) => None, // NoEntry or other → treat as signed out
    }
}

fn clear_session() -> AppResult<()> {
    let entry = keyring_entry()?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Other(format!("could not clear the session: {e}"))),
    }
}

// ─── Public API (driven by Tauri commands) ─────────────────────────────────

/// Run the full interactive sign-in. Opens the browser, captures the redirect,
/// exchanges the code, fetches identity, and persists the session.
pub async fn begin_sign_in() -> AppResult<AuthStatus> {
    let cfg = ClerkConfig::current();
    let verifier = gen_verifier();
    let challenge = challenge_s256(&verifier);
    let state = random_state();

    // Bind the loopback listener up front so we fail fast if the port is taken.
    let listener = TcpListener::bind(("127.0.0.1", LOOPBACK_PORT)).map_err(|e| {
        AppError::Other(format!(
            "could not start the sign-in listener on 127.0.0.1:{LOOPBACK_PORT} ({e}). Close whatever is using that port and try again."
        ))
    })?;

    open_in_browser(&build_authorize_url(&cfg, &challenge, &state))?;

    let expected = state.clone();
    let code = tokio::time::timeout(
        Duration::from_secs(SIGN_IN_TIMEOUT_SECS),
        tokio::task::spawn_blocking(move || wait_for_callback(listener, &expected)),
    )
    .await
    .map_err(|_| AppError::Other("sign-in timed out — the browser never returned.".into()))?
    .map_err(|e| AppError::Other(format!("sign-in listener crashed: {e}")))?
    .map_err(AppError::Other)?;

    let tokens = exchange_code(&cfg, &code, &verifier).await?;
    let user = fetch_userinfo(&cfg, &tokens.access_token).await?;

    store_session(&StoredSession {
        sub: user.sub,
        email: user.email.clone(),
        name: user.name.clone(),
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        obtained_at: chrono::Utc::now().to_rfc3339(),
    })?;

    Ok(AuthStatus { signed_in: true, email: user.email, name: user.name })
}

pub fn sign_out() -> AppResult<()> {
    clear_session()
}

pub fn status() -> AuthStatus {
    match load_session() {
        Some(s) => AuthStatus { signed_in: true, email: s.email, name: s.name },
        None => AuthStatus::default(),
    }
}

pub fn account_portal_url() -> String {
    ClerkConfig::current().account_portal_url()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn s256_matches_rfc7636_vector() {
        // RFC 7636 Appendix B.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(challenge_s256(verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn verifier_is_valid_pkce_length_and_charset() {
        let v = gen_verifier();
        assert_eq!(v.len(), 43, "32 bytes base64url-nopad = 43 chars");
        assert!(v.len() >= 43 && v.len() <= 128);
        assert!(
            v.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
            "verifier must be unreserved chars only: {v}"
        );
        assert_ne!(gen_verifier(), gen_verifier(), "verifiers must be random");
    }

    #[test]
    fn authorize_url_has_all_required_params() {
        let cfg = ClerkConfig::current();
        let url = build_authorize_url(&cfg, "CHAL", "STATE");
        assert!(url.starts_with(&cfg.authorize_url()));
        assert!(url.contains("response_type=code"));
        assert!(url.contains(&format!("client_id={}", cfg.client_id)));
        assert!(url.contains("code_challenge=CHAL"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("state=STATE"));
        // redirect_uri + scopes are URL-encoded.
        assert!(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A8976%2Fcallback"));
        assert!(url.contains("scope=openid%20email%20profile%20offline_access"));
    }

    #[test]
    fn parses_callback_code_and_state() {
        let (code, state, error) = parse_callback_query("/callback?code=abc123&state=xyz");
        assert_eq!(code.as_deref(), Some("abc123"));
        assert_eq!(state.as_deref(), Some("xyz"));
        assert!(error.is_none());

        let (_, _, error) = parse_callback_query("/callback?error=access_denied");
        assert_eq!(error.as_deref(), Some("access_denied"));
    }
}
