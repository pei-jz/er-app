use std::fs::File;
use std::io::{Read, Write};
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex as AsyncMutex;
use tauri::State;

pub mod models;
pub mod db;

use crate::models::*;
use crate::db::{get_manager_from_pool, get_manager_from_session, format_oracle_error};

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
            }).await.map_err(|e| e.to_string())?.map_err(|e| format_oracle_error(e))?;
            DbPool::Oracle(Arc::new(std::sync::Mutex::new(conn)))
        },
        _ => return Err("Unsupported database type".to_string()),
    };

    pools.insert(key, new_pool.clone());
    Ok(new_pool)
}

#[tauri::command]
async fn fetch_db_metadata(
    config: DbConfig,
    state: State<'_, AppState>,
) -> Result<Vec<TableMetadata>, String> {
    let pool = get_db_pool(&state, &config).await?;
    let manager = get_manager_from_pool(&pool);
    manager.fetch_metadata(&config.db_name).await
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

#[tauri::command]
async fn fetch_table_columns(
    config: DbConfig,
    table_name: String,
    state: State<'_, AppState>,
) -> Result<TableMetadata, String> {
    let pool = get_db_pool(&state, &config).await?;
    let manager = get_manager_from_pool(&pool);
    manager.fetch_table_columns(&config.db_name, &table_name).await
}

#[tauri::command]
async fn fetch_db_catalog(config: DbConfig, state: State<'_, AppState>) -> Result<Vec<DbObject>, String> {
    let pool = get_db_pool(&state, &config).await?;
    let manager = get_manager_from_pool(&pool);
    manager.fetch_catalog().await
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
                        DbSession::Oracle(Arc::new(std::sync::Mutex::new(conn)), config.clone())
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
                let manager = get_manager_from_session(&entry.session);
                let res = manager.execute_query(stmt.clone(), offset, is_select_stmt && is_last).await;

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

#[tauri::command]
async fn commit_transaction(state: State<'_, AppState>) -> Result<(), String> {
    let shared_key = "shared_sql_session".to_string();
    let sessions = state.sessions.lock().await;
    if let Some(entry_mutex) = sessions.get(&shared_key) {
        let mut entry = entry_mutex.lock().await;
        let manager = get_manager_from_session(&entry.session);
        manager.commit().await?;
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
        let manager = get_manager_from_session(&entry.session);
        manager.rollback().await?;
        entry.has_uncommitted_changes = false;
    }
    Ok(())
}

#[tauri::command]
async fn fetch_explain_plan(state: State<'_, AppState>, _config: DbConfig, sql: String) -> Result<String, String> {
    let shared_key = "shared_sql_session".to_string();
    let sessions = state.sessions.lock().await;
    if let Some(entry_mutex) = sessions.get(&shared_key) {
        let entry = entry_mutex.lock().await;
        let manager = get_manager_from_session(&entry.session);
        return manager.explain_plan(sql).await;
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
