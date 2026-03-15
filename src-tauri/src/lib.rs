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

#[derive(Clone)]
pub enum DbSession {
    MySql(Arc<AsyncMutex<sqlx::MySqlConnection>>, DbConfig),
    Postgres(Arc<AsyncMutex<sqlx::PgConnection>>, DbConfig),
    Oracle(Arc<StdMutex<oracle::Connection>>, DbConfig),
}

pub struct AppState {
    pub sessions: Arc<AsyncMutex<HashMap<String, DbSession>>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TableMetadata {
    pub name: String,
    pub columns: Vec<ColumnMetadata>,
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
) -> Result<Vec<TableMetadata>, String> {
    match config.db_type.as_str() {
        "mysql" => fetch_mysql_metadata(config).await,
        "postgres" => fetch_postgres_metadata(config).await,
        "oracle" => fetch_oracle_metadata(config).await,
        _ => Err("Unsupported database type".to_string()),
    }
}

async fn fetch_mysql_metadata(config: DbConfig) -> Result<Vec<TableMetadata>, String> {
    use sqlx::mysql::MySqlPoolOptions;
    let url = format!("mysql://{}:{}@{}:{}/{}", config.user, config.pass, config.host, config.port, config.db_name);
    let pool = MySqlPoolOptions::new()
        .max_connections(1)
        .connect(&url).await.map_err(|e| e.to_string())?;

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
    .bind(&config.db_name)
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
        name, columns, category_id: None, x: 0.0, y: 0.0, extra: HashMap::new()
    }).collect())
}

async fn fetch_postgres_metadata(config: DbConfig) -> Result<Vec<TableMetadata>, String> {
    use sqlx::postgres::PgPoolOptions;
    let url = format!("postgres://{}:{}@{}:{}/{}", config.user, config.pass, config.host, config.port, config.db_name);
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&url).await.map_err(|e| e.to_string())?;

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
            name, columns, category_id: None, x: 0.0, y: 0.0, extra 
        }
    }).collect())
}

async fn fetch_oracle_metadata(config: DbConfig) -> Result<Vec<TableMetadata>, String> {
    // oracle crate is synchronous, so run it in a blocking task
    tokio::task::spawn_blocking(move || {
        let conn_str = format!("//{}:{}/{}", config.host, config.port, config.db_name);
        let conn = oracle::Connection::connect(&config.user, &config.pass, &conn_str)
            .map_err(|e| format!("Failed to connect to Oracle: {}", format_oracle_error(e)))?;

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
            name, columns, category_id: None, x: 0.0, y: 0.0, extra: HashMap::new()
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
}

#[tauri::command]
async fn fetch_db_catalog(config: DbConfig) -> Result<Vec<DbObject>, String> {
    match config.db_type.as_str() {
        "mysql" => {
            use sqlx::{mysql::MySqlPoolOptions, Row};
            let url = format!("mysql://{}:{}@{}:{}/{}", config.user, config.pass, config.host, config.port, config.db_name);
            let pool = MySqlPoolOptions::new().max_connections(1).connect(&url).await.map_err(|e| e.to_string())?;
            let mut results = Vec::new();
            
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
        "postgres" => {
            use sqlx::{postgres::PgPoolOptions, Row};
            let url = format!("postgres://{}:{}@{}:{}/{}", config.user, config.pass, config.host, config.port, config.db_name);
            let pool = PgPoolOptions::new().max_connections(1).connect(&url).await.map_err(|e| e.to_string())?;
            let mut results = Vec::new();
            
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
        "oracle" => {
            tokio::task::spawn_blocking(move || {
                let conn_str = format!("//{}:{}/{}", config.host, config.port, config.db_name);
                let conn = oracle::Connection::connect(&config.user, &config.pass, &conn_str)
                    .map_err(|e| format_oracle_error(e))?;

                let query = "SELECT OBJECT_NAME, OBJECT_TYPE FROM USER_OBJECTS WHERE OBJECT_TYPE IN ('TABLE', 'VIEW', 'SYNONYM', 'PROCEDURE', 'FUNCTION', 'PACKAGE') ORDER BY OBJECT_TYPE, OBJECT_NAME";
                let mut stmt = conn.statement(query).build().map_err(|e| e.to_string())?;
                let rows = stmt.query(&[]).map_err(|e| e.to_string())?;
                
                let mut results = Vec::new();
                for row_result in rows {
                    let row = row_result.map_err(|e| e.to_string())?;
                    let name: String = row.get("OBJECT_NAME").unwrap_or_default();
                    let o_type: String = row.get("OBJECT_TYPE").unwrap_or_default();
                    results.push(DbObject { name, object_type: o_type });
                }
                Ok(results)
            }).await.map_err(|e| e.to_string())?
        },
        _ => Err("Unsupported database type for catalog fetch".to_string())
    }
}

#[tauri::command]
async fn execute_db_query(
    config: DbConfig,
    sql: String,
    offset: i64,
    tab_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<QueryResult, String> {
    let sql_trimmed = sql.trim();
    let is_select = sql_trimmed.to_lowercase().starts_with("select");

    let mut retry_count = 0;
    loop {
        let session_arc = {
            let mut sessions = state.sessions.lock().await;
            let mut reset_needed = false;
            
            if let Some(existing) = sessions.get(&tab_id) {
                let existing_config = match existing {
                    DbSession::MySql(_, cfg) => cfg,
                    DbSession::Postgres(_, cfg) => cfg,
                    DbSession::Oracle(_, cfg) => cfg,
                };
                if existing_config != &config {
                    reset_needed = true;
                }
            }

            if !sessions.contains_key(&tab_id) || reset_needed {
                let new_session = match config.db_type.as_str() {
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
                        let conn = sqlx::PgConnection::connect(&url).await.map_err(|e| e.to_string())?;
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
                sessions.insert(tab_id.clone(), new_session);
            }
            sessions.get(&tab_id).unwrap().clone()
        };

        let result = match session_arc {
            DbSession::MySql(conn_arc, _) => {
                let mut conn = conn_arc.lock().await;
                execute_mysql_query(&mut *conn, sql.clone(), offset, is_select).await
            },
            DbSession::Postgres(conn_arc, _) => {
                let mut conn = conn_arc.lock().await;
                execute_postgres_query(&mut *conn, sql.clone(), offset, is_select).await
            },
            DbSession::Oracle(conn_arc, _) => {
                let sql_clone = sql.clone();
                tokio::task::spawn_blocking(move || {
                    let conn = conn_arc.lock().unwrap();
                    execute_oracle_query_sync(&conn, sql_clone, offset, is_select)
                }).await.map_err(|e| e.to_string())?
            }
        };

        match result {
            Err(e) if e.contains("DPI-1010") && retry_count < 1 => {
                // Invalidate session and retry once
                let mut sessions = state.sessions.lock().await;
                sessions.remove(&tab_id);
                retry_count += 1;
                continue;
            },
            _ => return result,
        }
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
        })
    } else {
        // Support multi-statement DML
        let mut total_affected = 0;
        let statements: Vec<&str> = sql.split(';').filter(|s| !s.trim().is_empty()).collect();
        for stmt in statements {
            let res = sqlx::query(stmt).execute(&mut *conn).await.map_err(|e| format!("Error in statement [{}]: {}", stmt, e))?;
            total_affected += res.rows_affected();
        }
        Ok(QueryResult { columns: vec![], rows: vec![], has_more: false, total_count: Some(total_affected as i64) })
    }
}

async fn execute_postgres_query(conn: &mut sqlx::PgConnection, sql: String, offset: i64, is_select: bool) -> Result<QueryResult, String> {
    use sqlx::{Column, Row};

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
        })
    } else {
        let mut total_affected = 0;
        let statements: Vec<&str> = sql.split(';').filter(|s| !s.trim().is_empty()).collect();
        for stmt in statements {
            let res = sqlx::query(stmt).execute(&mut *conn).await.map_err(|e| format!("Error in statement [{}]: {}", stmt, e))?;
            total_affected += res.rows_affected();
        }
        Ok(QueryResult { columns: vec![], rows: vec![], has_more: false, total_count: Some(total_affected as i64) })
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
        })
    } else {
        let statements: Vec<&str> = sql.split(';').filter(|s| !s.trim().is_empty()).collect();
        for stmt in statements {
            conn.execute(stmt, &[]).map_err(|e| format!("Error in statement [{}]: {}", stmt, e))?;
        }
        Ok(QueryResult { columns: vec![], rows: vec![], has_more: false, total_count: None })
    }
}

#[tauri::command]
async fn commit_transaction(tab_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let sessions = state.sessions.lock().await;
    if let Some(session) = sessions.get(&tab_id) {
        match session {
            DbSession::MySql(conn_arc, _) => {
                let mut conn = conn_arc.lock().await;
                sqlx::query("COMMIT").execute(&mut *conn).await.map_err(|e| e.to_string())?;
                sqlx::query("SET autocommit=0").execute(&mut *conn).await.map_err(|e| e.to_string())?;
            },
            DbSession::Postgres(conn_arc, _) => {
                let mut conn = conn_arc.lock().await;
                sqlx::query("COMMIT").execute(&mut *conn).await.map_err(|e| e.to_string())?;
            },
            DbSession::Oracle(conn_arc, _) => {
                let conn = conn_arc.lock().unwrap();
                conn.commit().map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn rollback_transaction(tab_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let sessions = state.sessions.lock().await;
    if let Some(session) = sessions.get(&tab_id) {
        match session {
            DbSession::MySql(conn_arc, _) => {
                let mut conn = conn_arc.lock().await;
                sqlx::query("ROLLBACK").execute(&mut *conn).await.map_err(|e| e.to_string())?;
                sqlx::query("SET autocommit=0").execute(&mut *conn).await.map_err(|e| e.to_string())?;
            },
            DbSession::Postgres(conn_arc, _) => {
                let mut conn = conn_arc.lock().await;
                sqlx::query("ROLLBACK").execute(&mut *conn).await.map_err(|e| e.to_string())?;
            },
            DbSession::Oracle(conn_arc, _) => {
                let conn = conn_arc.lock().unwrap();
                conn.rollback().map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn close_db_session(tab_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut sessions = state.sessions.lock().await;
    sessions.remove(&tab_id);
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
    "NULL".to_string()
}

fn pg_row_value_to_string(row: &sqlx::postgres::PgRow, i: usize) -> String {
    use sqlx::Row;
    if let Ok(v) = row.try_get::<String, _>(i) { return v; }
    if let Ok(v) = row.try_get::<i64, _>(i) { return v.to_string(); }
    if let Ok(v) = row.try_get::<i32, _>(i) { return v.to_string(); }
    if let Ok(v) = row.try_get::<f64, _>(i) { return v.to_string(); }
    if let Ok(v) = row.try_get::<bool, _>(i) { return v.to_string(); }
    if let Ok(v) = row.try_get::<chrono::NaiveDateTime, _>(i) { return v.to_string(); }
    if let Ok(v) = row.try_get::<chrono::NaiveDate, _>(i) { return v.to_string(); }
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
            import_csv_metadata,
            get_cmd_args,
            execute_db_query,
            commit_transaction,
            rollback_transaction,
            close_db_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
