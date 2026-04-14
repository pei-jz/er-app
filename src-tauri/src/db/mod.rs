use std::sync::Arc;
use crate::models::{TableMetadata, DbObject, QueryResult, DbPool, DbSession};
use crate::db::mysql::{MySqlManager, MySqlSource};
use crate::db::postgres::{PostgresManager, PostgresSource};
use crate::db::oracle::OracleManager;

pub mod mysql;
pub mod postgres;
pub mod oracle;

#[async_trait::async_trait]
pub trait DatabaseManager: Send + Sync {
    async fn fetch_metadata(&self, db_name: &str) -> Result<Vec<TableMetadata>, String>;
    async fn fetch_table_columns(&self, db_name: &str, table_name: &str) -> Result<TableMetadata, String>;
    async fn fetch_catalog(&self) -> Result<Vec<DbObject>, String>;
    async fn execute_query(
        &self, 
        sql: String, 
        offset: i64, 
        is_select: bool
    ) -> Result<QueryResult, String>;
    async fn explain_plan(&self, sql: String) -> Result<String, String>;
    async fn commit(&self) -> Result<(), String>;
    async fn rollback(&self) -> Result<(), String>;
}

pub fn get_manager_from_pool(pool: &DbPool) -> Box<dyn DatabaseManager> {
    match pool {
        DbPool::MySql(p) => Box::new(MySqlManager { source: MySqlSource::Pool(p.clone()) }),
        DbPool::Postgres(p) => Box::new(PostgresManager { source: PostgresSource::Pool(p.clone()) }),
        DbPool::Oracle(p) => Box::new(OracleManager { conn: Arc::clone(p) }),
    }
}

pub fn get_manager_from_session(session: &DbSession) -> Box<dyn DatabaseManager> {
    match session {
        DbSession::MySql(c, _) => Box::new(MySqlManager { source: MySqlSource::Connection(Arc::clone(c)) }),
        DbSession::Postgres(c, _) => Box::new(PostgresManager { source: PostgresSource::Connection(Arc::clone(c)) }),
        DbSession::Oracle(c, _) => Box::new(OracleManager { conn: Arc::clone(c) }),
    }
}

pub fn format_oracle_error(e: ::oracle::Error) -> String {
    let msg = e.to_string();
    if msg.contains("DPI-1047") {
        format!(
            "{}\n\n[対応方法]\nOracle Instant Clientが見つかりません。以下よりダウンロードして解凍後、ディレクトリのパスをシステムの環境変数 PATH に追加してください。\nhttps://www.oracle.com/database/technologies/instant-client/downloads.html\n\n※64-bit版アプリには64-bit版のClientが、32-bit版アプリには32-bit版のClientが必要です。",
            msg
        )
    } else {
        msg
    }
}
