use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read, Write};
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};
use tokio::sync::Mutex as AsyncMutex;
use tauri::State;
use sqlx::{Row, Column};

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
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ColumnMetadata {
    pub name: String,
    pub data_type: String,
    pub is_primary_key: bool,
    pub is_foreign_key: bool,
    pub references_table: Option<String>,
    pub references_column: Option<String>,
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

#[tauri::command]
async fn save_er_file(path: String, data: ErDiagramData) -> Result<(), String> {
    let json = serde_json::to_string(&data).map_err(|e| e.to_string())?;
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    let compressed_data = encoder.finish().map_err(|e| e.to_string())?;
    let mut file = File::create(path).map_err(|e| e.to_string())?;
    file.write_all(&compressed_data).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn save_sql_file(path: String, content: String) -> Result<(), String> {
    let mut file = File::create(path).map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn load_er_file(path: String) -> Result<ErDiagramData, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut compressed_data = Vec::new();
    file.read_to_end(&mut compressed_data).map_err(|e| e.to_string())?;
    let mut decoder = GzDecoder::new(&compressed_data[..]);
    let mut json = String::new();
    decoder.read_to_string(&mut json).map_err(|e| e.to_string())?;
    let data: ErDiagramData = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    Ok(data)
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

async fn get_db_pool(state: &State<'_, AppState>, config: &DbConfig) -> Result<DbPool, String> {
    let key = format!("{}://{}:{}@{}:{}/{}", config.db_type, config.user, config.pass, config.host, config.port, config.db_name);
    
    let mut pools = state.pools.lock().await;
    if let Some(pool) = pools.get(&key) {
        return Ok(pool.clone());
    }

    let new_pool = match config.db_type.as_str() {
        "mysql" => {
            use sqlx::mysql::MySqlPoolOptions;
            let url = format!("mysql://{}:{}@{}:{}/{}", config.user, config.pass, config.host, config.port, config.db_name);
            let pool = MySqlPoolOptions::new().max_connections(1).connect(&url).await.map_err(|e| e.to_string())?;
            DbPool::MySql(pool)
        },
        "postgres" => {
            use sqlx::postgres::PgPoolOptions;
            let url = format!("postgres://{}:{}@{}:{}/{}", config.user, config.pass, config.host, config.port, config.db_name);
            let pool = PgPoolOptions::new().max_connections(1).connect(&url).await.map_err(|e| e.to_string())?;
            DbPool::Postgres(pool)
        },
        "oracle" => {
            let conn_str = format!("//{}:{}/{}", config.host, config.port, config.db_name);
            let user = config.user.clone();
            let pass = config.pass.clone();
            let conn = tokio::task::spawn_blocking(move || {
                oracle::Connection::connect(&user, &pass, &conn_str)
            }).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
            DbPool::Oracle(Arc::new(StdMutex::new(conn)))
        },
        _ => return Err("Unsupported database type".to_string()),
    };

    pools.insert(key, new_pool.clone());
    Ok(new_pool)
}

fn format_oracle_error(e: oracle::Error) -> String {
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

#[tauri::command]
async fn fetch_db_metadata(
    config: DbConfig,
    state: State<'_, AppState>,
) -> Result<Vec<TableMetadata>, String> {
    let pool = get_db_pool(&state, &config).await?;
    match pool {
        DbPool::MySql(p) => fetch_mysql_metadata(p, config.db_name).await,
        DbPool::Postgres(p) => fetch_postgres_metadata(p).await,
        DbPool::Oracle(p) => fetch_oracle_metadata(p).await,
    }
}

async fn fetch_mysql_metadata(pool: sqlx::MySqlPool, db_name: String) -> Result<Vec<TableMetadata>, String> {
    let rows: Vec<(String, String, String, String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT 
            CAST(c.table_name AS CHAR), 
            CAST(c.column_name AS CHAR), 
            CAST(c.data_type AS CHAR), 
            CAST(c.column_key AS CHAR),
            CAST(k.referenced_table_name AS CHAR),
            CAST(k.referenced_column_name AS CHAR)
         FROM information_schema.columns c
         LEFT JOIN information_schema.key_column_usage k 
            ON c.table_name = k.table_name 
            AND c.column_name = k.column_name 
            AND k.table_schema = c.table_schema
         WHERE c.table_schema = ?"
    )
    .bind(&db_name)
    .fetch_all(&pool).await.map_err(|e| e.to_string())?;

    let mut tables_map: HashMap<String, Vec<ColumnMetadata>> = HashMap::new();
    for (t_name, c_name, d_type, c_key, ref_t, ref_c) in rows {
        tables_map.entry(t_name).or_insert_with(Vec::new).push(ColumnMetadata {
            name: c_name,
            data_type: d_type,
            is_primary_key: c_key == "PRI",
            is_foreign_key: ref_t.is_some(),
            references_table: ref_t,
            references_column: ref_c,
            extra: HashMap::new(),
        });
    }

    Ok(tables_map.into_iter().map(|(name, columns)| TableMetadata { 
        name, columns, indices: Vec::new(), category_id: None, x: 0.0, y: 0.0, extra: HashMap::new()
    }).collect())
}

async fn fetch_postgres_metadata(pool: sqlx::PgPool) -> Result<Vec<TableMetadata>, String> {
    let rows: Vec<(String, String, String, String, Option<String>, Option<String>)> = sqlx::query_as(
        r#"
        SELECT 
            c.table_name, 
            c.column_name, 
            c.data_type, 
            c.is_nullable,
            obj_description(t.oid) as table_comment,
            col_description(t.oid, a.attnum) as column_comment
        FROM information_schema.columns c
        JOIN pg_class t ON c.table_name = t.relname
        JOIN pg_namespace n ON t.relnamespace = n.oid AND c.table_schema = n.nspname
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = c.column_name
        WHERE c.table_schema = 'public'
        "#
    )
    .fetch_all(&pool).await.map_err(|e| e.to_string())?;

    let mut tables_map: HashMap<String, (Vec<ColumnMetadata>, Option<String>)> = HashMap::new();
    for (t_name, c_name, d_type, _is_null, t_comment, c_comment) in rows {
        let mut extra = HashMap::new();
        if let Some(comment) = c_comment {
             extra.insert("comment".to_string(), serde_json::Value::String(comment));
        }

        let entry = tables_map.entry(t_name.clone()).or_insert_with(|| (Vec::new(), t_comment));
        
        entry.0.push(ColumnMetadata {
            name: c_name,
            data_type: d_type,
            is_primary_key: false, // Simplification for now
            is_foreign_key: false,
            references_table: None,
            references_column: None,
            extra,
        });
    }

    Ok(tables_map.into_iter().map(|(name, (columns, t_comment))| {
        let mut extra = HashMap::new();
        if let Some(comment) = t_comment {
            extra.insert("comment".to_string(), serde_json::Value::String(comment));
        }
        TableMetadata { 
            name, columns, indices: Vec::new(), category_id: None, x: 0.0, y: 0.0, extra 
        }
    }).collect())
}

async fn fetch_oracle_metadata(pool: Arc<StdMutex<oracle::Connection>>) -> Result<Vec<TableMetadata>, String> {
    // oracle crate is synchronous, so run it in a blocking task
    tokio::task::spawn_blocking(move || {
        let conn = pool.lock().map_err(|_| "Failed to lock oracle connection")?;

        let sql = r#"
            SELECT 
                TABLE_NAME, 
                COLUMN_NAME, 
                DATA_TYPE, 
                NULLABLE
            FROM USER_TAB_COLUMNS
            ORDER BY TABLE_NAME, COLUMN_ID
        "#;

        let mut stmt = conn.statement(sql).build().map_err(|e| e.to_string())?;
        let rows = stmt.query(&[]).map_err(|e| e.to_string())?;

        let mut tables_map: HashMap<String, Vec<ColumnMetadata>> = HashMap::new();
        for row_result in rows {
            let row = row_result.map_err(|e| e.to_string())?;
            let t_name: String = row.get("TABLE_NAME").map_err(|e| e.to_string())?;
            let c_name: String = row.get("COLUMN_NAME").map_err(|e| e.to_string())?;
            let d_type: String = row.get("DATA_TYPE").map_err(|e| e.to_string())?;
            
            tables_map.entry(t_name).or_insert_with(Vec::new).push(ColumnMetadata {
                name: c_name,
                data_type: d_type,
                is_primary_key: false, // Simplification for now
                is_foreign_key: false,
                references_table: None,
                references_column: None,
                extra: HashMap::new(),
            });
        }

        Ok(tables_map.into_iter().map(|(name, columns)| TableMetadata { 
            name, columns, indices: Vec::new(), category_id: None, x: 0.0, y: 0.0, extra: HashMap::new()
        }).collect())
    }).await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
fn get_cmd_args() -> Vec<String> {
    std::env::args().collect()
}

#[tauri::command]
async fn import_csv_metadata(
    path: String,
    config: CsvConfig,
) -> Result<Vec<TableMetadata>, String> {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(config.has_header)
        .from_path(path)
        .map_err(|e| e.to_string())?;

    let mut tables_map: HashMap<String, Vec<ColumnMetadata>> = HashMap::new();

    for result in rdr.records() {
        let record = result.map_err(|e| e.to_string())?;
        let table_name = record.get(config.table_col).unwrap_or("").to_string();
        let col_name = record.get(config.column_col).unwrap_or("").to_string();
        let data_type = record.get(config.type_col).unwrap_or("").to_string();

        let is_pk = if let Some(idx) = config.pk_col {
            let val = record.get(idx).unwrap_or("").to_lowercase();
            val == "pri" || val == "pk" || val == "true" || val == "y"
        } else {
            false
        };

        let ref_table = config.fk_table_col.and_then(|idx| {
            record.get(idx).filter(|s| !s.trim().is_empty()).map(|s| s.to_string())
        });
        let ref_col = config.fk_column_col.and_then(|idx| {
            record.get(idx).filter(|s| !s.trim().is_empty()).map(|s| s.to_string())
        });

        let mut extra = HashMap::new();
        
        if let Some(map) = &config.custom_string_cols {
            for (key, &idx) in map {
                if let Some(val) = record.get(idx).filter(|s| !s.trim().is_empty()) {
                    extra.insert(key.clone(), serde_json::Value::String(val.to_string()));
                }
            }
        }
        if let Some(map) = &config.custom_bool_cols {
            for (key, &idx) in map {
                if let Some(val) = record.get(idx) {
                    let b = val.to_lowercase() == "true" || val.to_lowercase() == "y" || val == "1" || val.to_lowercase() == "yes";
                    extra.insert(key.clone(), serde_json::Value::Bool(b));
                }
            }
        }
        if let Some(map) = &config.custom_num_cols {
            for (key, &idx) in map {
                if let Some(val) = record.get(idx).filter(|s| !s.trim().is_empty()) {
                    if let Ok(n) = val.parse::<f64>() {
                        if let Some(num) = serde_json::Number::from_f64(n) {
                            extra.insert(key.clone(), serde_json::Value::Number(num));
                        }
                    }
                }
            }
        }

        let col = ColumnMetadata {
            name: col_name,
            data_type,
            is_primary_key: is_pk,
            is_foreign_key: ref_table.is_some(),
            references_table: ref_table,
            references_column: ref_col,
            extra,
        };

        tables_map.entry(table_name).or_insert_with(Vec::new).push(col);
    }

    Ok(tables_map.into_iter().map(|(name, columns)| TableMetadata {
        name,
        columns,
        indices: Vec::new(),
        category_id: None,
        x: 0.0,
        y: 0.0,
        extra: HashMap::new(),
    }).collect())
}

#[derive(serde::Serialize)]
struct QueryResult {
    columns: Vec<String>,
    rows: Vec<Vec<String>>,
    has_more: bool,
    total_count: Option<i64>,
    pub has_uncommitted_changes: bool,
}

#[tauri::command]
async fn fetch_table_columns(
    config: DbConfig,
    table_name: String,
    state: State<'_, AppState>,
) -> Result<TableMetadata, String> {
    let pool = get_db_pool(&state, &config).await?;
    match pool {
        DbPool::MySql(p) => fetch_mysql_table_columns(p, config.db_name, table_name).await,
        DbPool::Postgres(p) => fetch_postgres_table_columns(p, table_name).await,
        DbPool::Oracle(p) => fetch_oracle_table_columns(p, table_name).await,
    }
}

async fn fetch_mysql_table_columns(pool: sqlx::MySqlPool, db_name: String, table_name: String) -> Result<TableMetadata, String> {
    let rows: Vec<(String, String, String, String, Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT 
            CAST(c.table_name AS CHAR), 
            CAST(c.column_name AS CHAR), 
            CAST(c.data_type AS CHAR), 
            CAST(c.column_key AS CHAR),
            CAST(k.referenced_table_name AS CHAR),
            CAST(k.referenced_column_name AS CHAR),
            CAST(c.column_comment AS CHAR)
         FROM information_schema.columns c
         LEFT JOIN information_schema.key_column_usage k 
            ON c.table_name = k.table_name 
            AND c.column_name = k.column_name 
            AND k.table_schema = c.table_schema
         WHERE c.table_schema = ? AND c.table_name = ?"
    )
    .bind(&db_name)
    .bind(&table_name)
    .fetch_all(&pool).await.map_err(|e| e.to_string())?;

    let mut columns = Vec::new();
    for (_t_name, c_name, d_type, c_key, ref_t, ref_c, c_comment) in rows {
        let mut extra = HashMap::new();
        if let Some(comment) = c_comment {
            if !comment.is_empty() {
                extra.insert("comment".to_string(), serde_json::Value::String(comment));
            }
        }
        columns.push(ColumnMetadata {
            name: c_name,
            data_type: d_type,
            is_primary_key: c_key == "PRI",
            is_foreign_key: ref_t.is_some(),
            references_table: ref_t,
            references_column: ref_c,
            extra,
        });
    }

    let idx_rows: Vec<(String, String, i64, String, Option<String>)> = sqlx::query_as(
        "SELECT 
            CAST(INDEX_NAME AS CHAR), 
            CAST(COLUMN_NAME AS CHAR), 
            NON_UNIQUE, 
            CAST(INDEX_TYPE AS CHAR), 
            CAST(INDEX_COMMENT AS CHAR) 
         FROM information_schema.statistics 
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY INDEX_NAME, SEQ_IN_INDEX"
    )
    .bind(&db_name)
    .bind(&table_name)
    .fetch_all(&pool).await.map_err(|e| e.to_string())?;

    let mut indices_map: HashMap<String, IndexMetadata> = HashMap::new();
    for (i_name, c_name, non_unique, i_type, i_comment) in idx_rows {
        let entry = indices_map.entry(i_name.clone()).or_insert_with(|| IndexMetadata {
            name: i_name,
            columns: Vec::new(),
            is_unique: non_unique == 0,
            r#type: Some(i_type),
            comment: i_comment,
            extra: HashMap::new(),
        });
        entry.columns.push(c_name);
    }
    let indices: Vec<IndexMetadata> = indices_map.into_values().collect();

    Ok(TableMetadata { 
        name: table_name, columns, indices, category_id: None, x: 0.0, y: 0.0, extra: HashMap::new()
    })
}

async fn fetch_postgres_table_columns(pool: sqlx::PgPool, table_name: String) -> Result<TableMetadata, String> {
    use sqlx::Row;

    // 1. Fetch Columns
    let col_query = r#"
        SELECT 
            c.column_name, 
            c.data_type, 
            c.is_nullable,
            obj_description(t.oid) as table_comment,
            col_description(t.oid, a.attnum) as column_comment
        FROM information_schema.columns c
        JOIN pg_class t ON c.table_name = t.relname
        JOIN pg_namespace n ON t.relnamespace = n.oid AND c.table_schema = n.nspname
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = c.column_name
        WHERE c.table_schema = 'public' AND c.table_name = $1
        ORDER BY c.ordinal_position
    "#;
    
    let col_rows = sqlx::query(col_query)
        .bind(&table_name)
        .fetch_all(&pool).await.map_err(|e| e.to_string())?;

    let mut columns = Vec::new();
    let mut table_comment = None;
    for row in col_rows {
        let name: String = row.get("column_name");
        let data_type: String = row.get("data_type");
        table_comment = row.get("table_comment");
        let c_comment: Option<String> = row.get("column_comment");

        let mut extra = HashMap::new();
        if let Some(comment) = c_comment {
             extra.insert("comment".to_string(), serde_json::Value::String(comment));
        }
        
        columns.push(ColumnMetadata {
            name,
            data_type,
            is_primary_key: false,
            is_foreign_key: false,
            references_table: None,
            references_column: None,
            extra,
        });
    }

    // 2. Fetch Constraints (PK, FK)
    let con_query = r#"
        SELECT
            conname as constraint_name,
            contype::text as constraint_type,
            ARRAY(SELECT attname FROM pg_attribute WHERE attrelid = conrelid AND attnum = ANY(conkey) ORDER BY array_position(conkey, attnum)) as column_names,
            confrelid::regclass::text as ref_table,
            ARRAY(SELECT attname FROM pg_attribute WHERE attrelid = confrelid AND attnum = ANY(confkey) ORDER BY array_position(confkey, attnum)) as ref_columns
        FROM pg_constraint
        WHERE conrelid = $1::regclass
    "#;
    
    let con_rows = sqlx::query(con_query)
        .bind(&table_name)
        .fetch_all(&pool).await.map_err(|e| e.to_string())?;

    let mut indices: Vec<IndexMetadata> = Vec::new();
    for row in con_rows {
        let c_name: String = row.get("constraint_name");
        let c_type: String = row.get("constraint_type");
        let cols: Vec<String> = row.get("column_names");
        let ref_t: Option<String> = if c_type == "f" { Some(row.get("ref_table")) } else { None };
        let ref_cs: Option<Vec<String>> = if c_type == "f" { Some(row.get("ref_columns")) } else { None };

        let display_type = match c_type.as_str() {
            "p" => "PK",
            "f" => "FK",
            "u" => "UNIQUE",
            _ => "CONSTR",
        };

        indices.push(IndexMetadata {
            name: c_name.clone(),
            columns: cols.clone(),
            is_unique: c_type == "p" || c_type == "u",
            r#type: Some(display_type.to_string()),
            comment: None,
            extra: HashMap::new(),
        });

        for col in &mut columns {
            if let Some(idx) = cols.iter().position(|c| c == &col.name) {
                if c_type == "p" {
                    col.is_primary_key = true;
                } else if c_type == "f" {
                    col.is_foreign_key = true;
                    col.references_table = ref_t.clone();
                    if let Some(rcs) = &ref_cs {
                        col.references_column = rcs.get(idx).cloned();
                    }
                }
            }
        }
    }

    // 3. Fetch independent Indices
    let idx_query = r#"
        SELECT
            i.relname as index_name,
            ARRAY(
                SELECT attname 
                FROM pg_attribute 
                WHERE attrelid = t.oid AND attnum = ANY(ix.indkey) 
                ORDER BY array_position(ix.indkey, attnum)
            ) as column_names,
            ix.indisunique as is_unique
        FROM
            pg_class t,
            pg_class i,
            pg_index ix
        WHERE
            t.oid = ix.indrelid
            AND i.oid = ix.indexrelid
            AND t.relkind = 'r'
            AND t.relname = $1
            AND ix.indisprimary = false
    "#;

    let idx_rows = sqlx::query(idx_query)
        .bind(&table_name)
        .fetch_all(&pool).await.map_err(|e| e.to_string())?;

    for row in idx_rows {
        let i_name: String = row.get("index_name");
        if indices.iter().any(|idx| idx.name == i_name) {
            continue;
        }

        let cols: Vec<String> = row.get("column_names");
        let is_unique: bool = row.get("is_unique");

        indices.push(IndexMetadata {
            name: i_name,
            columns: cols,
            is_unique,
            r#type: Some("INDEX".to_string()),
            comment: None,
            extra: HashMap::new(),
        });
    }

    let mut extra = HashMap::new();
    if let Some(c) = table_comment {
        extra.insert("comment".to_string(), serde_json::Value::String(c));
    }

    Ok(TableMetadata { 
        name: table_name, columns, indices, category_id: None, x: 0.0, y: 0.0, extra 
    })
}

async fn fetch_oracle_table_columns(pool: Arc<StdMutex<oracle::Connection>>, table_name: String) -> Result<TableMetadata, String> {
    tokio::task::spawn_blocking(move || {
        let conn = pool.lock().map_err(|_| "Failed to lock oracle connection")?;

        let sql = r#"
            SELECT 
                COLUMN_NAME, 
                DATA_TYPE, 
                NULLABLE
            FROM USER_TAB_COLUMNS
            WHERE TABLE_NAME = :1
            ORDER BY COLUMN_ID
        "#;

        let mut stmt = conn.statement(sql).build().map_err(|e| e.to_string())?;
        let rows = stmt.query(&[&table_name]).map_err(|e| e.to_string())?;

        let mut columns = Vec::new();
        for row_result in rows {
            let row = row_result.map_err(|e| e.to_string())?;
            let c_name: String = row.get("COLUMN_NAME").map_err(|e| e.to_string())?;
            let d_type: String = row.get("DATA_TYPE").map_err(|e| e.to_string())?;
            
            columns.push(ColumnMetadata {
                name: c_name,
                data_type: d_type,
                is_primary_key: false,
                is_foreign_key: false,
                references_table: None,
                references_column: None,
                extra: HashMap::new(),
            });
        }

        let idx_sql = r#"
            SELECT 
                i.index_name, 
                c.column_name, 
                i.uniqueness
            FROM user_indexes i
            JOIN user_ind_columns c ON i.index_name = c.index_name
            WHERE i.table_name = :1
            ORDER BY i.index_name, c.column_position
        "#;
        let mut idx_stmt = conn.statement(idx_sql).build().map_err(|e| e.to_string())?;
        let idx_rows = idx_stmt.query(&[&table_name]).map_err(|e| e.to_string())?;

        let mut indices_map: HashMap<String, IndexMetadata> = HashMap::new();
        for row_result in idx_rows {
            let row = row_result.map_err(|e| e.to_string())?;
            let i_name: String = row.get("INDEX_NAME").unwrap_or_default();
            let c_name: String = row.get("COLUMN_NAME").unwrap_or_default();
            let uni: String = row.get("UNIQUENESS").unwrap_or_default();

            let entry = indices_map.entry(i_name.clone()).or_insert_with(|| IndexMetadata {
                name: i_name,
                columns: Vec::new(),
                is_unique: uni == "UNIQUE",
                r#type: None,
                comment: None,
                extra: HashMap::new(),
            });
            entry.columns.push(c_name);
        }
        let indices: Vec<IndexMetadata> = indices_map.into_values().collect();

        Ok(TableMetadata { 
            name: table_name, columns, indices, category_id: None, x: 0.0, y: 0.0, extra: HashMap::new()
        })
    }).await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
async fn fetch_db_catalog(config: DbConfig, state: State<'_, AppState>) -> Result<Vec<DbObject>, String> {
    let pool = get_db_pool(&state, &config).await?;
    match pool {
        DbPool::MySql(pool) => {
            use sqlx::Row;
            let mut results: Vec<DbObject> = Vec::new();
            
            let q1 = "SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()";
            let rows1 = sqlx::query(q1).fetch_all(&pool).await.map_err(|e| e.to_string())?;
            for row in rows1 {
                let name: String = row.try_get(0).unwrap_or_default();
                let table_type: String = row.try_get(1).unwrap_or_default();
                let type_mapped = if table_type.contains("VIEW") { "VIEW".to_string() } else { "TABLE".to_string() };
                results.push(DbObject { name, object_type: type_mapped });
            }

            let q2 = "SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.routines WHERE ROUTINE_SCHEMA = DATABASE()";
            let rows2 = sqlx::query(q2).fetch_all(&pool).await.map_err(|e| e.to_string())?;
            for row in rows2 {
                let name: String = row.try_get(0).unwrap_or_default();
                let r_type: String = row.try_get(1).unwrap_or_default();
                results.push(DbObject { name, object_type: r_type.to_uppercase() });
            }

            Ok(results)
        },
        DbPool::Postgres(pool) => {
            use sqlx::Row;
            let mut results: Vec<DbObject> = Vec::new();
            
            let query = "
                SELECT tablename as name, 'TABLE' as type FROM pg_tables WHERE schemaname = current_schema()
                UNION ALL
                SELECT viewname as name, 'VIEW' as type FROM pg_views WHERE schemaname = current_schema()
                UNION ALL
                SELECT p.proname as name, 'FUNCTION' as type 
                FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid 
                WHERE n.nspname = current_schema()";
            
            let rows = sqlx::query(query).fetch_all(&pool).await.map_err(|e| e.to_string())?;
            for row in rows {
                let name: String = row.try_get(0).unwrap_or_default();
                let o_type: String = row.try_get(1).unwrap_or_default();
                results.push(DbObject { name, object_type: o_type });
            }
            Ok(results)
        },
        DbPool::Oracle(pool) => {
            tokio::task::spawn_blocking(move || {
                let conn = pool.lock().map_err(|_| "Failed to lock oracle connection")?;

                let query = "SELECT OBJECT_NAME, OBJECT_TYPE FROM USER_OBJECTS WHERE OBJECT_TYPE IN ('TABLE', 'VIEW', 'SYNONYM', 'PROCEDURE', 'FUNCTION', 'PACKAGE') ORDER BY OBJECT_TYPE, OBJECT_NAME";
                let mut stmt = conn.statement(query).build().map_err(|e| e.to_string())?;
                let rows = stmt.query(&[]).map_err(|e| e.to_string())?;
                
                let mut results: Vec<DbObject> = Vec::new();
                for row_result in rows {
                    let row = row_result.map_err(|e| e.to_string())?;
                    let name: String = row.get("OBJECT_NAME").unwrap_or_default();
                    let o_type: String = row.get("OBJECT_TYPE").unwrap_or_default();
                    results.push(DbObject { name, object_type: o_type });
                }
                Ok(results)
            }).await.map_err(|e| e.to_string())?
        }
    }
}

#[tauri::command]
async fn execute_db_query(
    config: DbConfig,
    sql: String,
    offset: i64,
    _tab_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<QueryResult, String> {
    let statements: Vec<&str> = sql.split(';').filter(|s| !s.trim().is_empty()).collect();
    if statements.is_empty() {
        return Err("No SQL statements found".to_string());
    }

    let shared_key = "shared_sql_session".to_string();
    let mut retry_count = 0;
    'retry: loop {
        let session_entry_arc = {
            let mut sessions = state.sessions.lock().await;
            let mut reset_needed = false;
            
            if let Some(entry_mutex) = sessions.get(&shared_key) {
                let entry = entry_mutex.lock().await;
                let existing_config = match &entry.session {
                    DbSession::MySql(_, cfg) => cfg,
                    DbSession::Postgres(_, cfg) => cfg,
                    DbSession::Oracle(_, cfg) => cfg,
                };
                if existing_config != &config {
                    reset_needed = true;
                }
            }

            if !sessions.contains_key(&shared_key) || reset_needed {
                let session = match config.db_type.as_str() {
                    "mysql" => {
                        use sqlx::Connection;
                        let url = format!("mysql://{}:{}@{}:{}/{}", config.user, config.pass, config.host, config.port, config.db_name);
                        let mut conn = sqlx::MySqlConnection::connect(&url).await.map_err(|e| e.to_string())?;
                        let _ = sqlx::query("SET autocommit=0").execute(&mut conn).await;
                        DbSession::MySql(Arc::new(AsyncMutex::new(conn)), config.clone())
                    },
                    "postgres" => {
                        use sqlx::Connection;
                        let url = format!("postgres://{}:{}@{}:{}/{}", config.user, config.pass, config.host, config.port, config.db_name);
                        let mut conn = sqlx::PgConnection::connect(&url).await.map_err(|e| e.to_string())?;
                        let _ = sqlx::query("BEGIN").execute(&mut conn).await;
                        DbSession::Postgres(Arc::new(AsyncMutex::new(conn)), config.clone())
                    },
                    "oracle" => {
                        let conn_str = format!("//{}:{}/{}", config.host, config.port, config.db_name);
                        let config_clone = config.clone();
                        let conn = tokio::task::spawn_blocking(move || {
                            let mut c = oracle::Connection::connect(&config_clone.user, &config_clone.pass, &conn_str)?;
                            c.set_autocommit(false);
                            Ok::<_, oracle::Error>(c)
                        }).await.map_err(|e| e.to_string())?.map_err(|e| format_oracle_error(e))?;
                        DbSession::Oracle(Arc::new(StdMutex::new(conn)), config.clone())
                    },
                    _ => return Err("Unsupported database type".to_string()),
                };
                let entry = Arc::new(AsyncMutex::new(SessionEntry {
                    session,
                    has_uncommitted_changes: false,
                }));
                sessions.insert(shared_key.clone(), entry);
            }
            sessions.get(&shared_key).unwrap().clone()
        };

        let last_idx = statements.len() - 1;
        let mut final_result = None;
        let mut total_affected = 0;

        for (i, stmt_str) in statements.iter().enumerate() {
            let stmt = stmt_str.trim().to_string();
            let is_last = i == last_idx;
            let s_lower = stmt.to_lowercase();
            let is_select_stmt = s_lower.starts_with("select") || s_lower.starts_with("show") || s_lower.starts_with("describe") || s_lower.starts_with("explain");
            let is_transaction_control = s_lower.starts_with("commit") || s_lower.starts_with("rollback");
            let is_dml = s_lower.starts_with("insert") || s_lower.starts_with("update") || s_lower.starts_with("delete") || s_lower.starts_with("merge") || s_lower.starts_with("create") || s_lower.starts_with("drop") || s_lower.starts_with("alter") || s_lower.starts_with("truncate");

            let res = {
                let mut entry = session_entry_arc.lock().await;
                let res = match &entry.session {
                    DbSession::MySql(conn_arc, _) => {
                        let mut conn = conn_arc.lock().await;
                        execute_mysql_query(&mut *conn, stmt.clone(), offset, is_select_stmt && is_last).await
                    },
                    DbSession::Postgres(conn_arc, _) => {
                        let mut conn = conn_arc.lock().await;
                        let r = execute_postgres_query(&mut *conn, stmt.clone(), offset, is_select_stmt && is_last).await;
                        if is_transaction_control && r.is_ok() {
                             let _ = sqlx::query("BEGIN").execute(&mut *conn).await;
                        }
                        r
                    },
                    DbSession::Oracle(conn_arc, _) => {
                        let stmt_clone = stmt.clone();
                        let conn_arc_clone = Arc::clone(conn_arc);
                        tokio::task::spawn_blocking(move || {
                            let conn = conn_arc_clone.lock().unwrap();
                            execute_oracle_query_sync(&conn, stmt_clone, offset, is_select_stmt && is_last)
                        }).await.map_err(|e| e.to_string())?
                    }
                };

                if res.is_ok() {
                    if is_dml {
                        entry.has_uncommitted_changes = true;
                    } else if is_transaction_control {
                        entry.has_uncommitted_changes = false;
                    }
                }
                res
            };

            match res {
                Ok(qr) => {
                    total_affected += qr.total_count.unwrap_or(0);
                    if is_last {
                        let mut final_qr = qr;
                        let entry = session_entry_arc.lock().await;
                        final_qr.has_uncommitted_changes = entry.has_uncommitted_changes;
                        final_result = Some(final_qr);
                    }
                },
                Err(e) => {
                    if e.contains("DPI-1010") && retry_count < 1 {
                        let mut sessions = state.sessions.lock().await;
                        sessions.remove(&shared_key);
                        retry_count += 1;
                        continue 'retry; 
                    }
                    return Err(format!("Error in statement [{}]: {}", stmt, e));
                }
            }
        }

        if let Some(mut r) = final_result {
            if r.total_count.is_some() && total_affected > r.total_count.unwrap() {
                r.total_count = Some(total_affected);
            }
            let entry = session_entry_arc.lock().await;
            r.has_uncommitted_changes = entry.has_uncommitted_changes;
            return Ok(r);
        }
        return Err("Execution failed to produce a result".to_string());
    }
}
async fn execute_mysql_query(conn: &mut sqlx::MySqlConnection, sql: String, offset: i64, is_select: bool) -> Result<QueryResult, String> {
    use sqlx::{Column, Row};

    if is_select {
        // Count check
        let count_query = format!("SELECT COUNT(*) FROM ({}) as t", sql.trim().trim_end_matches(';'));
        let total: i64 = sqlx::query_scalar(&count_query).fetch_one(&mut *conn).await.map_err(|e| e.to_string())?;
        
        if total > 5000 {
            return Err(format!("Query aborted: Result set too large ({} rows). Maximum allowed is 5000.", total));
        }

        let paged_sql = format!("{} LIMIT 500 OFFSET {}", sql.trim().trim_end_matches(';'), offset);
        let rows = sqlx::query(&paged_sql).fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;
        
        let mut result_rows = Vec::new();
        let mut columns = Vec::new();
        
        if !rows.is_empty() {
            columns = rows[0].columns().iter().map(|c| c.name().to_string()).collect();
            for row in rows {
                let mut values = Vec::new();
                for i in 0..row.columns().len() {
                    let val = mysql_row_value_to_string(&row, i);
                    values.push(val);
                }
                result_rows.push(values);
            }
        }

        Ok(QueryResult {
            columns,
            rows: result_rows,
            has_more: total > offset + 500,
            total_count: Some(total),
            has_uncommitted_changes: false, // Will be overridden by caller
        })
    } else {
        // Support multi-statement DML
        let mut total_affected = 0;
        let statements: Vec<&str> = sql.split(';').filter(|s| !s.trim().is_empty()).collect();
        for stmt in statements {
            let res = sqlx::query(stmt).execute(&mut *conn).await.map_err(|e| {
                let err_msg = e.to_string();
                if err_msg.contains("current transaction is aborted") {
                    // Try to auto-recovery if requested? 
                    // Actually we'll handle this in the execute_postgres_query level for the specific statement failure.
                    format!("Transaction aborted. Please click 'Rollback' to reset the transaction state. Original Error in [{}]: {}", stmt, err_msg)
                } else {
                    format!("Error in statement [{}]: {}", stmt, err_msg)
                }
            })?;
            total_affected += res.rows_affected();
        }
        Ok(QueryResult { columns: vec![], rows: vec![], has_more: false, total_count: Some(total_affected as i64), has_uncommitted_changes: true })
    }
}

async fn execute_postgres_query(conn: &mut sqlx::PgConnection, sql: String, offset: i64, is_select: bool) -> Result<QueryResult, String> {

    if is_select {
        let count_query = format!("SELECT COUNT(*) FROM ({}) as t", sql.trim().trim_end_matches(';'));
        let total: i64 = sqlx::query_scalar(&count_query).fetch_one(&mut *conn).await.map_err(|e| e.to_string())?;
        
        if total > 5000 {
            return Err(format!("Query aborted: Result set too large ({} rows). Maximum allowed is 5000.", total));
        }

        let paged_sql = format!("{} LIMIT 500 OFFSET {}", sql.trim().trim_end_matches(';'), offset);
        let rows = sqlx::query(&paged_sql).fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;
        
        let mut result_rows = Vec::new();
        let mut columns = Vec::new();
        
        if !rows.is_empty() {
            columns = rows[0].columns().iter().map(|c| c.name().to_string()).collect();
            for row in rows {
                let mut values = Vec::new();
                for i in 0..row.columns().len() {
                    let val = pg_row_value_to_string(&row, i);
                    values.push(val);
                }
                result_rows.push(values);
            }
        }

        Ok(QueryResult {
            columns,
            rows: result_rows,
            has_more: total > offset + 500,
            total_count: Some(total),
            has_uncommitted_changes: false,
        })
    } else {
        let mut total_affected = 0;
        let statements: Vec<&str> = sql.split(';').filter(|s| !s.trim().is_empty()).collect();
        for stmt in statements {
            let res_result = sqlx::query(stmt).execute(&mut *conn).await;
            let res = match res_result {
                Ok(r) => r,
                Err(e) => {
                    // AUTO-ROLLBACK on error for Postgres!
                    // This prevents the connection from being stuck in "Aborted Transaction" state.
                    let _ = sqlx::query("ROLLBACK").execute(&mut *conn).await;
                    let _ = sqlx::query("BEGIN").execute(&mut *conn).await;
                    return Err(format!("Error in statement [{}]: {}. (Connection auto-reset via ROLLBACK)", stmt, e));
                }
            };
            total_affected += res.rows_affected();
        }
        Ok(QueryResult { columns: vec![], rows: vec![], has_more: false, total_count: Some(total_affected as i64), has_uncommitted_changes: true })
    }
}

fn execute_oracle_query_sync(conn: &oracle::Connection, sql: String, offset: i64, is_select: bool) -> Result<QueryResult, String> {
    if is_select {
        let count_query = format!("SELECT COUNT(*) FROM ({})", sql.trim().trim_end_matches(';'));
        let total: i64 = conn.query_row_as(&count_query, &[]).map_err(|e| e.to_string())?;

        if total > 5000 {
            return Err(format!("Query aborted: Result set too large ({} rows). Maximum allowed is 5000.", total));
        }

        // Oracle 12c+ paging
        let paged_sql = format!("{} OFFSET {} ROWS FETCH NEXT 500 ROWS ONLY", sql.trim().trim_end_matches(';'), offset);
        let mut stmt = conn.statement(&paged_sql).build().map_err(|e| e.to_string())?;
        let rows = stmt.query(&[]).map_err(|e| e.to_string())?;
        
        let mut result_rows = Vec::new();
        let mut columns = Vec::new();

        for col in rows.column_info() {
            columns.push(col.name().to_string());
        }

        for row_result in rows {
            let row = row_result.map_err(|e| e.to_string())?;
            let mut values = Vec::new();
            for i in 0..columns.len() {
                let val = oracle_row_value_to_string(&row, i);
                values.push(val);
            }
            result_rows.push(values);
        }

        Ok(QueryResult {
            columns,
            rows: result_rows,
            has_more: total > offset + 500,
            total_count: Some(total),
            has_uncommitted_changes: false,
        })
    } else {
        let statements: Vec<&str> = sql.split(';').filter(|s| !s.trim().is_empty()).collect();
        for stmt in statements {
            conn.execute(stmt, &[]).map_err(|e| format!("Error in statement [{}]: {}", stmt, e))?;
        }
        Ok(QueryResult { columns: vec![], rows: vec![], has_more: false, total_count: None, has_uncommitted_changes: false })
    }
}

#[tauri::command]
async fn commit_transaction(state: State<'_, AppState>) -> Result<(), String> {
    let shared_key = "shared_sql_session".to_string();
    let sessions = state.sessions.lock().await;
    if let Some(entry_mutex) = sessions.get(&shared_key) {
        let mut entry = entry_mutex.lock().await;
        match &entry.session {
            DbSession::MySql(conn_arc, _) => {
                let mut conn = conn_arc.lock().await;
                sqlx::query("COMMIT").execute(&mut *conn).await.map_err(|e| e.to_string())?;
                sqlx::query("SET autocommit=0").execute(&mut *conn).await.map_err(|e| e.to_string())?;
            },
            DbSession::Postgres(conn_arc, _) => {
                let mut conn = conn_arc.lock().await;
                sqlx::query("COMMIT").execute(&mut *conn).await.map_err(|e| e.to_string())?;
                let _ = sqlx::query("BEGIN").execute(&mut *conn).await;
            },
            DbSession::Oracle(conn_arc, _) => {
                let conn = conn_arc.lock().unwrap();
                conn.commit().map_err(|e| e.to_string())?;
            }
        }
        entry.has_uncommitted_changes = false;
    }
    Ok(())
}

#[tauri::command]
async fn rollback_transaction(state: State<'_, AppState>) -> Result<(), String> {
    let shared_key = "shared_sql_session".to_string();
    let sessions = state.sessions.lock().await;
    if let Some(entry_mutex) = sessions.get(&shared_key) {
        let mut entry = entry_mutex.lock().await;
        match &entry.session {
            DbSession::MySql(conn_arc, _) => {
                let mut conn = conn_arc.lock().await;
                sqlx::query("ROLLBACK").execute(&mut *conn).await.map_err(|e| e.to_string())?;
                sqlx::query("SET autocommit=0").execute(&mut *conn).await.map_err(|e| e.to_string())?;
            },
            DbSession::Postgres(conn_arc, _) => {
                let mut conn = conn_arc.lock().await;
                sqlx::query("ROLLBACK").execute(&mut *conn).await.map_err(|e| e.to_string())?;
                let _ = sqlx::query("BEGIN").execute(&mut *conn).await;
            },
            DbSession::Oracle(conn_arc, _) => {
                let conn = conn_arc.lock().unwrap();
                conn.rollback().map_err(|e| e.to_string())?;
            }
        }
        entry.has_uncommitted_changes = false;
    }
    Ok(())
}

#[tauri::command]
async fn fetch_explain_plan(state: State<'_, AppState>, _config: DbConfig, sql: String) -> Result<String, String> {
    // We'll use a temporary connection for Explain to avoid messing with the session transaction if possible
    // Or we can use the existing session if one exists.
    let shared_key = "shared_sql_session".to_string();
    let sessions = state.sessions.lock().await;
    
    if let Some(entry_mutex) = sessions.get(&shared_key) {
        let mut entry = entry_mutex.lock().await;
        match &mut entry.session {
            DbSession::Postgres(conn_arc, _) => {
                let mut conn = conn_arc.lock().await;
                // For Postgres, we use EXPLAIN (FORMAT TEXT)
                let explain_sql = format!("EXPLAIN {}", sql.trim().trim_end_matches(';'));
                let rows = sqlx::query(&explain_sql).fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;
                let plan: Vec<String> = rows.iter().map(|r| r.get::<String, _>(0)).collect();
                return Ok(plan.join("\n"));
            },
            DbSession::MySql(conn_arc, _) => {
                let mut conn = conn_arc.lock().await;
                let explain_sql = format!("EXPLAIN {}", sql.trim().trim_end_matches(';'));
                let rows = sqlx::query(&explain_sql).fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;
                // MySQL Explain typically has multiple columns. We'll join them simplified.
                let mut lines = Vec::new();
                for row in rows {
                    let mut vals = Vec::new();
                    for i in 0..row.columns().len() {
                        let val: Option<String> = row.try_get(i).ok();
                        vals.push(val.unwrap_or_else(|| "NULL".to_string()));
                    }
                    lines.push(vals.join(" | "));
                }
                return Ok(lines.join("\n"));
            },
            DbSession::Oracle(conn_arc, _) => {
                let conn = conn_arc.lock().unwrap();
                let explain_sql = format!("EXPLAIN PLAN FOR {}", sql.trim().trim_end_matches(';'));
                conn.execute(&explain_sql, &[]).map_err(|e| e.to_string())?;
                
                let rows = conn.query("SELECT plan_table_output FROM table(dbms_xplan.display())", &[]).map_err(|e| e.to_string())?;
                let mut plan_lines = Vec::new();
                for row_res in rows {
                    let row = row_res.map_err(|e| e.to_string())?;
                    let line: String = row.get(0).map_err(|e| e.to_string())?;
                    plan_lines.push(line);
                }
                return Ok(plan_lines.join("\n"));
            }
        }
    }
    
    Err("No active session found. Please connect to a database first.".to_string())
}

#[tauri::command]
async fn close_db_session(state: State<'_, AppState>) -> Result<(), String> {
    let mut sessions = state.sessions.lock().await;
    sessions.remove("shared_sql_session");
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]

fn mysql_row_value_to_string(row: &sqlx::mysql::MySqlRow, i: usize) -> String {
    use sqlx::Row;
    // Try common types
    if let Ok(v) = row.try_get::<String, _>(i) { return v; }
    if let Ok(v) = row.try_get::<i64, _>(i) { return v.to_string(); }
    if let Ok(v) = row.try_get::<u64, _>(i) { return v.to_string(); }
    if let Ok(v) = row.try_get::<i32, _>(i) { return v.to_string(); }
    if let Ok(v) = row.try_get::<u32, _>(i) { return v.to_string(); }
    if let Ok(v) = row.try_get::<f64, _>(i) { return v.to_string(); }
    if let Ok(v) = row.try_get::<bool, _>(i) { return v.to_string(); }
    if let Ok(v) = row.try_get::<chrono::NaiveDateTime, _>(i) { return v.to_string(); }
    if let Ok(v) = row.try_get::<chrono::NaiveDate, _>(i) { return v.to_string(); }
    if let Ok(v) = row.try_get::<chrono::DateTime<chrono::Utc>, _>(i) { return v.to_string(); }
    if let Ok(v) = row.try_get::<chrono::DateTime<chrono::Local>, _>(i) { return v.to_string(); }
    "NULL".to_string()
}

fn pg_row_value_to_string(row: &sqlx::postgres::PgRow, i: usize) -> String {
    use sqlx::Row;
    if let Ok(v) = row.try_get::<String, _>(i) { return v; }
    if let Ok(v) = row.try_get::<i64, _>(i) { return v.to_string(); }
    if let Ok(v) = row.try_get::<i32, _>(i) { return v.to_string(); }
    if let Ok(v) = row.try_get::<f64, _>(i) { return v.to_string(); }
    if let Ok(v) = row.try_get::<bool, _>(i) { return v.to_string(); }
    if let Ok(v) = row.try_get::<uuid::Uuid, _>(i) { return v.to_string(); }
    if let Ok(v) = row.try_get::<chrono::NaiveDateTime, _>(i) { return v.to_string(); }
    if let Ok(v) = row.try_get::<chrono::NaiveDate, _>(i) { return v.to_string(); }
    if let Ok(v) = row.try_get::<chrono::DateTime<chrono::Utc>, _>(i) { return v.to_string(); }
    if let Ok(v) = row.try_get::<chrono::DateTime<chrono::Local>, _>(i) { return v.to_string(); }
    "NULL".to_string()
}

fn oracle_row_value_to_string(row: &oracle::Row, i: usize) -> String {
    if let Ok(v) = row.get::<_, String>(i) { return v; }
    if let Ok(v) = row.get::<_, i64>(i) { return v.to_string(); }
    if let Ok(v) = row.get::<_, f64>(i) { return v.to_string(); }
    if let Ok(v) = row.get::<_, oracle::sql_type::Timestamp>(i) { return v.to_string(); }
    "NULL".to_string()
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            sessions: Arc::new(AsyncMutex::new(HashMap::new())),
            pools: Arc::new(AsyncMutex::new(HashMap::new())),
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            save_er_file,
            save_sql_file,
            load_er_file,
            fetch_db_metadata,
            fetch_db_catalog,
            fetch_table_columns,
            import_csv_metadata,
            get_cmd_args,
            execute_db_query,
            commit_transaction,
            rollback_transaction,
            close_db_session,
            fetch_explain_plan
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
