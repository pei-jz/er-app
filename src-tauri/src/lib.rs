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
            comment: None,
            extra,
        };

        tables_map.entry(table_name).or_insert_with(Vec::new).push(col);
    }

    Ok(tables_map.into_iter().map(|(name, columns)| TableMetadata {
        name,
        comment: None,
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

        let db_type = config.db_type.clone();
        
        let (mut has_uncommitted, manager) = {
            let entry = session_entry_arc.lock().await;
            (entry.has_uncommitted_changes, crate::db::get_manager_from_session(&entry.session))
        };

        let result = process_statements(
            statements.iter().map(|s| s.to_string()).collect(),
            manager.as_ref(),
            &db_type,
            offset,
            &mut has_uncommitted,
        ).await;
        
        {
            let mut entry = session_entry_arc.lock().await;
            entry.has_uncommitted_changes = has_uncommitted;
        }

        match result {
            Ok(r) => return Ok(r),
            Err((e, is_fatal)) => {
                if is_fatal {
                    let mut sessions = state.sessions.lock().await;
                    sessions.remove(&shared_key);
                    if e.contains("DPI-1010") && retry_count < 1 {
                        retry_count += 1;
                        continue 'retry; 
                    }
                }
                return Err(e);
            }
        }
    }
}

async fn process_statements(
    statements: Vec<String>,
    manager: &dyn crate::db::DatabaseManager,
    db_type: &str,
    offset: i64,
    has_uncommitted_changes: &mut bool,
) -> Result<QueryResult, (String, bool)> {
    let last_idx = statements.len() - 1;
    let mut final_result = None;
    let mut total_affected = 0;
    let mut errors = Vec::new();

    for (i, stmt_str) in statements.iter().enumerate() {
        let stmt = stmt_str.trim().to_string();
        let is_last = i == last_idx;
        let s_lower = stmt.to_lowercase();
        let is_select_stmt = s_lower.starts_with("select") || s_lower.starts_with("show") || s_lower.starts_with("describe") || s_lower.starts_with("explain");
        let is_transaction_control = s_lower.starts_with("commit") || s_lower.starts_with("rollback");
        let is_dml = s_lower.starts_with("insert") || s_lower.starts_with("update") || s_lower.starts_with("delete") || s_lower.starts_with("merge") || s_lower.starts_with("create") || s_lower.starts_with("drop") || s_lower.starts_with("alter") || s_lower.starts_with("truncate");

        let res = {
            let res = manager.execute_query(stmt.clone(), offset, is_select_stmt && is_last).await;

            if res.is_ok() {
                if is_dml {
                    *has_uncommitted_changes = true;
                } else if is_transaction_control {
                    *has_uncommitted_changes = false;
                }
            }
            res
        };

        match res {
            Ok(qr) => {
                total_affected += qr.total_count.unwrap_or(0);
                if is_last || is_select_stmt {
                    let mut final_qr = qr;
                    final_qr.has_uncommitted_changes = *has_uncommitted_changes;
                    final_result = Some(final_qr);
                }
            },
            Err(e) => {
                let e_lower = e.to_lowercase();
                let is_fatal = e_lower.contains("dpi-1010") || 
                               e_lower.contains("connection refused") || 
                               e_lower.contains("broken pipe") || 
                               e_lower.contains("closed") ||
                               e_lower.contains("timeout") ||
                               e_lower.contains("not connected");

                if is_fatal {
                    return Err((format!("Fatal error in statement [{}]: {}", stmt, e), true));
                }

                errors.push(format!("Error in statement [{}]: {}", stmt, e));

                if db_type == "postgres" {
                    // Postgres cannot continue after an error in a transaction. Rollback and abort batch.
                    let _ = manager.rollback().await;
                    *has_uncommitted_changes = false;
                    break;
                }
            }
        }
    }

    let mut r = final_result.unwrap_or_else(|| QueryResult {
        columns: vec![],
        rows: vec![],
        has_more: false,
        total_count: Some(total_affected),
        has_uncommitted_changes: false,
        errors: None,
    });

    if r.total_count.is_some() && total_affected > r.total_count.unwrap() {
        r.total_count = Some(total_affected);
    }
    
    r.has_uncommitted_changes = *has_uncommitted_changes;
    
    if !errors.is_empty() {
        r.errors = Some(errors);
    }

    Ok(r)
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tokio::sync::Mutex as AsyncMutex;

    struct MockDbManager {
        pub execute_results: Arc<AsyncMutex<Vec<Result<QueryResult, String>>>>,
        pub rollback_called: Arc<AsyncMutex<bool>>,
    }

    #[async_trait::async_trait]
    impl crate::db::DatabaseManager for MockDbManager {
        async fn fetch_metadata(&self, _db_name: &str) -> Result<Vec<TableMetadata>, String> { Ok(vec![]) }
        async fn fetch_table_columns(&self, _db_name: &str, _table_name: &str) -> Result<TableMetadata, String> { Err("".to_string()) }
        async fn fetch_catalog(&self) -> Result<Vec<DbObject>, String> { Ok(vec![]) }
        async fn explain_plan(&self, _sql: String) -> Result<String, String> { Ok("".to_string()) }
        async fn commit(&self) -> Result<(), String> { Ok(()) }
        
        async fn execute_query(&self, _sql: String, _offset: i64, _is_select: bool) -> Result<QueryResult, String> {
            let mut results = self.execute_results.lock().await;
            if results.is_empty() {
                return Ok(QueryResult { columns: vec![], rows: vec![], has_more: false, total_count: Some(1), has_uncommitted_changes: true, errors: None });
            }
            results.remove(0)
        }
        
        async fn rollback(&self) -> Result<(), String> {
            *self.rollback_called.lock().await = true;
            Ok(())
        }
    }

    fn create_mock(results: Vec<Result<QueryResult, String>>) -> (MockDbManager, Arc<AsyncMutex<bool>>) {
        let rollback_called = Arc::new(AsyncMutex::new(false));
        (MockDbManager {
            execute_results: Arc::new(AsyncMutex::new(results)),
            rollback_called: rollback_called.clone(),
        }, rollback_called)
    }

    #[tokio::test]
    async fn test_process_statements_all_success() {
        let (mock, _) = create_mock(vec![
            Ok(QueryResult { columns: vec![], rows: vec![], has_more: false, total_count: Some(1), has_uncommitted_changes: false, errors: None }),
            Ok(QueryResult { columns: vec![], rows: vec![], has_more: false, total_count: Some(1), has_uncommitted_changes: false, errors: None }),
        ]);
        let mut has_uncommitted = false;
        let stmts = vec!["INSERT 1".to_string(), "INSERT 2".to_string()];
        
        let result = process_statements(stmts, &mock, "oracle", 0, &mut has_uncommitted).await;
        assert!(result.is_ok());
        let res = result.unwrap();
        assert_eq!(res.total_count, Some(2));
        assert!(res.errors.is_none());
        assert_eq!(has_uncommitted, true); // because INSERT is DML
    }

    #[tokio::test]
    async fn test_process_statements_oracle_continue() {
        let (mock, rollback_called) = create_mock(vec![
            Err("ORA-00001: unique constraint violated".to_string()),
            Ok(QueryResult { columns: vec![], rows: vec![], has_more: false, total_count: Some(1), has_uncommitted_changes: true, errors: None }),
        ]);
        let mut has_uncommitted = false;
        let stmts = vec!["INSERT 1".to_string(), "INSERT 2".to_string()];
        
        let result = process_statements(stmts, &mock, "oracle", 0, &mut has_uncommitted).await;
        assert!(result.is_ok());
        let res = result.unwrap();
        
        // Total count should be 1 because the first failed, the second succeeded
        assert_eq!(res.total_count, Some(1));
        
        // Errors should contain the ORA error
        assert!(res.errors.is_some());
        assert_eq!(res.errors.unwrap().len(), 1);
        
        // Oracle shouldn't rollback automatically on non-fatal error
        assert_eq!(*rollback_called.lock().await, false);
    }

    #[tokio::test]
    async fn test_process_statements_postgres_rollback() {
        let (mock, rollback_called) = create_mock(vec![
            Err("syntax error".to_string()),
            Ok(QueryResult { columns: vec![], rows: vec![], has_more: false, total_count: Some(1), has_uncommitted_changes: true, errors: None }),
        ]);
        let mut has_uncommitted = false;
        let stmts = vec!["INSERT 1".to_string(), "INSERT 2".to_string()];
        
        let result = process_statements(stmts, &mock, "postgres", 0, &mut has_uncommitted).await;
        assert!(result.is_ok());
        let res = result.unwrap();
        
        // Postgres should abort on first error, so total count is 0
        assert_eq!(res.total_count, Some(0));
        
        // Errors should contain the syntax error
        assert!(res.errors.is_some());
        assert_eq!(res.errors.unwrap().len(), 1);
        
        // Postgres SHOULD rollback automatically on non-fatal error
        assert_eq!(*rollback_called.lock().await, true);
        assert_eq!(has_uncommitted, false); // Rolled back, no uncommitted changes
    }

    #[tokio::test]
    async fn test_process_statements_fatal_error() {
        let (mock, _) = create_mock(vec![
            Err("DPI-1010: not connected".to_string()),
        ]);
        let mut has_uncommitted = false;
        let stmts = vec!["INSERT 1".to_string(), "INSERT 2".to_string()];
        
        let result = process_statements(stmts, &mock, "oracle", 0, &mut has_uncommitted).await;
        assert!(result.is_err());
        let (err_msg, is_fatal) = result.unwrap_err();
        assert!(is_fatal);
        assert!(err_msg.contains("DPI-1010"));
    }
}
