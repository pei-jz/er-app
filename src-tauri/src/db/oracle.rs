use async_trait::async_trait;
use std::sync::{Arc, Mutex as StdMutex};
use std::collections::HashMap;
use crate::models::{TableMetadata, ColumnMetadata, DbObject, QueryResult, IndexMetadata};
use crate::db::DatabaseManager;

pub struct OracleManager {
    pub conn: Arc<StdMutex<oracle::Connection>>,
}

#[async_trait]
impl DatabaseManager for OracleManager {
    async fn fetch_metadata(&self, _db_name: &str) -> Result<Vec<TableMetadata>, String> {
        let conn_arc = Arc::clone(&self.conn);
        tokio::task::spawn_blocking(move || {
            let conn = conn_arc.lock().map_err(|_| "Failed to lock oracle connection")?;
            let mut stmt = conn.statement(ORACLE_METADATA_SQL).build().map_err(|e| e.to_string())?;
            let rows = stmt.query(&[]).map_err(|e| e.to_string())?;

            let mut tables_map: HashMap<String, (Option<String>, Vec<ColumnMetadata>)> = HashMap::new();
            for row_result in rows {
                let row = row_result.map_err(|e| e.to_string())?;
                let t_name: String = row.get("TABLE_NAME").map_err(|e| e.to_string())?;
                let c_name: String = row.get("COLUMN_NAME").map_err(|e| e.to_string())?;
                let d_type: String = row.get("DATA_TYPE").map_err(|e| e.to_string())?;
                let t_comment: Option<String> = row.get("TABLE_COMMENT").ok();
                let c_comment: Option<String> = row.get("COLUMN_COMMENT").ok();
                
                let entry = tables_map.entry(t_name).or_insert_with(|| (t_comment, Vec::new()));
                entry.1.push(ColumnMetadata {
                    name: c_name, data_type: d_type, is_primary_key: false, is_foreign_key: false, references_table: None, references_column: None, comment: c_comment, extra: HashMap::new(),
                });
            }
            Ok(tables_map.into_iter().map(|(name, (comment, columns))| TableMetadata { name, comment, columns, indices: Vec::new(), category_id: None, x: 0.0, y: 0.0, extra: HashMap::new() }).collect())
        }).await.map_err(|e| format!("Task failed: {}", e))?
    }

    async fn fetch_table_columns(&self, _db_name: &str, table_name: &str) -> Result<TableMetadata, String> {
        let conn_arc = Arc::clone(&self.conn);
        let table_name = table_name.to_string();
        tokio::task::spawn_blocking(move || {
            let conn = conn_arc.lock().map_err(|_| "Failed to lock oracle connection")?;
            let mut stmt = conn.statement(ORACLE_COLUMNS_SQL).build().map_err(|e| e.to_string())?;
            let rows = stmt.query(&[&table_name]).map_err(|e| e.to_string())?;

            let mut columns = Vec::new();
            for row_result in rows {
                let row = row_result.map_err(|e| e.to_string())?;
                let c_name: String = row.get("COLUMN_NAME").map_err(|e| e.to_string())?;
                let d_type: String = row.get("DATA_TYPE").map_err(|e| e.to_string())?;
                let c_comment: Option<String> = row.get("COMMENTS").ok();
                columns.push(ColumnMetadata { name: c_name, data_type: d_type, is_primary_key: false, is_foreign_key: false, references_table: None, references_column: None, comment: c_comment, extra: HashMap::new() });
            }

            let mut tab_stmt = conn.statement("SELECT COMMENTS FROM USER_TAB_COMMENTS WHERE TABLE_NAME = :1").build().map_err(|e| e.to_string())?;
            let tab_comment: Option<String> = tab_stmt.query_row(&[&table_name]).and_then(|row| row.get(0)).ok();

            let mut idx_stmt = conn.statement(ORACLE_INDEXES_SQL).build().map_err(|e| e.to_string())?;
            let idx_rows = idx_stmt.query(&[&table_name]).map_err(|e| e.to_string())?;
            let mut indices_map: HashMap<String, IndexMetadata> = HashMap::new();
            for row_result in idx_rows {
                let row = row_result.map_err(|e| e.to_string())?;
                let i_name: String = row.get("INDEX_NAME").unwrap_or_default();
                let c_name: String = row.get("COLUMN_NAME").unwrap_or_default();
                let uni: String = row.get("UNIQUENESS").unwrap_or_default();
                let entry = indices_map.entry(i_name.clone()).or_insert_with(|| IndexMetadata { name: i_name, columns: Vec::new(), is_unique: uni == "UNIQUE", r#type: None, comment: None, extra: HashMap::new() });
                entry.columns.push(c_name);
            }
            Ok(TableMetadata { name: table_name, comment: tab_comment, columns, indices: indices_map.into_values().collect(), category_id: None, x: 0.0, y: 0.0, extra: HashMap::new() })
        }).await.map_err(|e| format!("Task failed: {}", e))?
    }

    async fn fetch_catalog(&self) -> Result<Vec<DbObject>, String> {
        let conn_arc = Arc::clone(&self.conn);
        tokio::task::spawn_blocking(move || {
            let conn = conn_arc.lock().map_err(|_| "Failed to lock oracle connection")?;
            let mut stmt = conn.statement(ORACLE_CATALOG_SQL).build().map_err(|e| e.to_string())?;
            let rows = stmt.query(&[]).map_err(|e| e.to_string())?;
            let mut results: Vec<DbObject> = Vec::new();
            for row_result in rows {
                let row = row_result.map_err(|e| e.to_string())?;
                results.push(DbObject { 
                    name: row.get("OBJECT_NAME").unwrap_or_default(), 
                    object_type: row.get("OBJECT_TYPE").unwrap_or_default(),
                    comment: row.get("COMMENTS").ok()
                });
            }
            Ok(results)
        }).await.map_err(|e| e.to_string())?
    }

    async fn execute_query(&self, sql: String, offset: i64, is_select: bool) -> Result<QueryResult, String> {
        let conn_arc = Arc::clone(&self.conn);
        tokio::task::spawn_blocking(move || {
            let conn = conn_arc.lock().map_err(|_| "Failed to lock oracle connection")?;
            if is_select {
                let count_query = format!("SELECT COUNT(*) FROM ({})", sql.trim().trim_end_matches(';'));
                let total: i64 = conn.query_row_as(&count_query, &[]).map_err(|e| e.to_string())?;
                if total > 5000 { return Err(format!("Query aborted: Result set too large ({} rows). Maximum allowed is 5000.", total)); }

                let paged_sql = format!("{} OFFSET {} ROWS FETCH NEXT 500 ROWS ONLY", sql.trim().trim_end_matches(';'), offset);
                let mut stmt = conn.statement(&paged_sql).build().map_err(|e| e.to_string())?;
                let rows = stmt.query(&[]).map_err(|e| e.to_string())?;
                let mut result_rows = Vec::new();
                let mut columns = Vec::new();
                for col in rows.column_info() { columns.push(col.name().to_string()); }
                for row_result in rows {
                    let row = row_result.map_err(|e| e.to_string())?;
                    let mut values = Vec::new();
                    for i in 0..columns.len() { values.push(row_value_to_string(&row, i)); }
                    result_rows.push(values);
                }
                Ok(QueryResult { columns, rows: result_rows, has_more: total > offset + 500, total_count: Some(total), has_uncommitted_changes: false, errors: None })
            } else {
                let statements: Vec<&str> = sql.split(';').filter(|s| !s.trim().is_empty()).collect();
                for stmt in statements { conn.execute(stmt, &[]).map_err(|e| format!("Error in statement [{}]: {}", stmt, e))?; }
                Ok(QueryResult { columns: vec![], rows: vec![], has_more: false, total_count: None, has_uncommitted_changes: false, errors: None })
            }
        }).await.map_err(|e| e.to_string())?
    }

    async fn explain_plan(&self, sql: String) -> Result<String, String> {
        let conn_arc = Arc::clone(&self.conn);
        tokio::task::spawn_blocking(move || {
            let conn = conn_arc.lock().map_err(|_| "Failed to lock oracle connection")?;
            let explain_sql = format!("EXPLAIN PLAN FOR {}", sql.trim().trim_end_matches(';'));
            conn.execute(&explain_sql, &[]).map_err(|e| e.to_string())?;
            let rows = conn.query("SELECT plan_table_output FROM table(dbms_xplan.display())", &[]).map_err(|e| e.to_string())?;
            let mut plan_lines = Vec::new();
            for row_res in rows {
                let row = row_res.map_err(|e| e.to_string())?;
                plan_lines.push(row.get::<_, String>(0).unwrap_or_default());
            }
            Ok(plan_lines.join("\n"))
        }).await.map_err(|e| e.to_string())?
    }

    async fn commit(&self) -> Result<(), String> {
        let conn_arc = Arc::clone(&self.conn);
        tokio::task::spawn_blocking(move || {
            let conn = conn_arc.lock().map_err(|_| "Failed to lock oracle connection")?;
            conn.commit().map_err(|e| e.to_string())
        }).await.map_err(|e| e.to_string())?
    }

    async fn rollback(&self) -> Result<(), String> {
        let conn_arc = Arc::clone(&self.conn);
        tokio::task::spawn_blocking(move || {
            let conn = conn_arc.lock().map_err(|_| "Failed to lock oracle connection")?;
            conn.rollback().map_err(|e| e.to_string())
        }).await.map_err(|e| e.to_string())?
    }
}

// SQL Constants
const ORACLE_METADATA_SQL: &str = "SELECT t.TABLE_NAME, t.COLUMN_NAME, t.DATA_TYPE, t.NULLABLE, c.COMMENTS as COLUMN_COMMENT, tc.COMMENTS as TABLE_COMMENT FROM USER_TAB_COLUMNS t LEFT JOIN USER_COL_COMMENTS c ON t.TABLE_NAME = c.TABLE_NAME AND t.COLUMN_NAME = c.COLUMN_NAME LEFT JOIN USER_TAB_COMMENTS tc ON t.TABLE_NAME = tc.TABLE_NAME ORDER BY t.TABLE_NAME, t.COLUMN_ID";
const ORACLE_COLUMNS_SQL: &str = "SELECT t.COLUMN_NAME, t.DATA_TYPE, t.NULLABLE, c.COMMENTS FROM USER_TAB_COLUMNS t LEFT JOIN USER_COL_COMMENTS c ON t.TABLE_NAME = c.TABLE_NAME AND t.COLUMN_NAME = c.COLUMN_NAME WHERE t.TABLE_NAME = :1 ORDER BY t.COLUMN_ID";
const ORACLE_INDEXES_SQL: &str = "SELECT i.index_name, c.column_name, i.uniqueness FROM user_indexes i JOIN user_ind_columns c ON i.index_name = c.index_name WHERE i.table_name = :1 ORDER BY i.index_name, c.column_position";
const ORACLE_CATALOG_SQL: &str = "SELECT o.OBJECT_NAME, o.OBJECT_TYPE, c.COMMENTS FROM USER_OBJECTS o LEFT JOIN USER_TAB_COMMENTS c ON o.OBJECT_NAME = c.TABLE_NAME WHERE o.OBJECT_TYPE IN ('TABLE', 'VIEW', 'SYNONYM') ORDER BY o.OBJECT_TYPE, o.OBJECT_NAME";

fn row_value_to_string(row: &oracle::Row, i: usize) -> String {
    if let Ok(v) = row.get::<_, String>(i) { return v; }
    if let Ok(v) = row.get::<_, i64>(i) { return v.to_string(); }
    if let Ok(v) = row.get::<_, f64>(i) { return v.to_string(); }
    if let Ok(v) = row.get::<_, oracle::sql_type::Timestamp>(i) { return v.to_string(); }
    "NULL".to_string()
}
