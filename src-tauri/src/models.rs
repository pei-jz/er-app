use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};
use tokio::sync::Mutex as AsyncMutex;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct IndexMetadata {
    pub name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
    pub r#type: Option<String>,
    pub comment: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TableMetadata {
    pub name: String,
    pub comment: Option<String>,
    pub columns: Vec<ColumnMetadata>,
    pub indices: Vec<IndexMetadata>,
    pub category_id: Option<String>,
    pub x: f32,
    pub y: f32,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DbObject {
    pub name: String,
    pub object_type: String,
    pub comment: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ColumnMetadata {
    pub name: String,
    pub data_type: String,
    pub is_primary_key: bool,
    pub is_foreign_key: bool,
    pub references_table: Option<String>,
    pub references_column: Option<String>,
    pub comment: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CategoryMetadata {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub x: f32,
    pub y: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ErDiagramData {
    pub tables: Vec<TableMetadata>,
    pub categories: Vec<CategoryMetadata>,
}

#[derive(Deserialize)]
pub struct CsvConfig {
    pub table_col: usize,
    pub column_col: usize,
    pub type_col: usize,
    pub pk_col: Option<usize>,
    pub fk_table_col: Option<usize>,
    pub fk_column_col: Option<usize>,
    pub has_header: bool,
    pub custom_string_cols: Option<HashMap<String, usize>>,
    pub custom_bool_cols: Option<HashMap<String, usize>>,
    pub custom_num_cols: Option<HashMap<String, usize>>,
}

#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
pub struct DbConfig {
    pub db_type: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub pass: String,
    pub db_name: String,
}

#[derive(serde::Serialize, Debug, Clone)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub has_more: bool,
    pub total_count: Option<i64>,
    pub has_uncommitted_changes: bool,
    pub errors: Option<Vec<String>>,
}

#[derive(Clone)]
pub enum DbSession {
    MySql(Arc<AsyncMutex<sqlx::MySqlConnection>>, DbConfig),
    Postgres(Arc<AsyncMutex<sqlx::PgConnection>>, DbConfig),
    Oracle(Arc<StdMutex<oracle::Connection>>, DbConfig),
}

#[derive(Clone)]
pub enum DbPool {
    MySql(sqlx::mysql::MySqlPool),
    Postgres(sqlx::postgres::PgPool),
    Oracle(Arc<StdMutex<oracle::Connection>>),
}

#[derive(Clone)]
pub struct SessionEntry {
    pub session: DbSession,
    pub has_uncommitted_changes: bool,
}

pub struct AppState {
    pub sessions: Arc<AsyncMutex<HashMap<String, Arc<AsyncMutex<SessionEntry>>>>>,
    pub pools: Arc<AsyncMutex<HashMap<String, DbPool>>>,
}
