//! Shared application state — held by Tauri as a managed `State<AppState>`.

use crate::chat_engine::ChatEngine;
use crate::db::Db;
use crate::error::AppResult;
use crate::provider_router::ProviderRouter;
use crate::pty_manager::PtyManager;
use crate::token_engine::TokenEngine;
use parking_lot::Mutex;
use std::sync::Arc;

pub struct AppState {
    pub db: Arc<Mutex<Db>>,
    pub pty: Mutex<PtyManager>,
    pub tokens: Arc<TokenEngine>,
    pub router: Mutex<ProviderRouter>,
    pub chat: ChatEngine,
}

impl AppState {
    pub fn init() -> AppResult<Self> {
        let db = Arc::new(Mutex::new(Db::open(&Db::default_path())?));
        let tokens = Arc::new(TokenEngine::new(Arc::clone(&db)));
        let chat = ChatEngine::new(Arc::clone(&db));
        let router = ProviderRouter::load()?;
        Ok(Self {
            db,
            pty: Mutex::new(PtyManager::new()),
            tokens,
            router: Mutex::new(router),
            chat,
        })
    }
}
