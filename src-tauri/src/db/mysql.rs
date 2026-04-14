use async_trait::async_trait;
use sqlx::{Row, Column};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex as AsyncMutex;
use crate::models::{TableMetadata, ColumnMetadata, DbObject, QueryResult, IndexMetadata};
use crate::db::DatabaseManager;

pub enum MySqlSource {
    Pool(sqlx::MySqlPool),
    Connection(Arc<AsyncMutex<sqlx::MySqlConnection>>),
}

pub struct MySqlManager {
    pub source: MySqlSource,
}

#[async_trait]
impl DatabaseManager for MySqlManager {
    async fn fetch_metadata(&self, db_name: &str) -> Result<Vec<TableMetadata>, String> {
        let rows: Vec<(String, String, String, String, Option<String>, Option<String>)> = match &self.source {
            MySqlSource::Pool(p) => sqlx::query_as(MYSQL_METADATA_SQL).bind(db_name).fetch_all(p).await,
            MySqlSource::Connection(c) => sqlx::query_as(MYSQL_METADATA_SQL).bind(db_name).fetch_all(&mut *c.lock().await).await,
        }.map_err(|e| e.to_string())?;

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

    async fn fetch_table_columns(&self, db_name: &str, table_name: &str) -> Result<TableMetadata, String> {
        let rows: Vec<(String, String, String, String, Option<String>, Option<String>, Option<String>)> = match &self.source {
            MySqlSource::Pool(p) => sqlx::query_as(MYSQL_COLUMNS_SQL).bind(db_name).bind(table_name).fetch_all(p).await,
            MySqlSource::Connection(c) => sqlx::query_as(MYSQL_COLUMNS_SQL).bind(db_name).bind(table_name).fetch_all(&mut *c.lock().await).await,
        }.map_err(|e| e.to_string())?;

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

        let idx_rows: Vec<(String, String, i64, String, Option<String>)> = match &self.source {
            MySqlSource::Pool(p) => sqlx::query_as(MYSQL_INDEXES_SQL).bind(db_name).bind(table_name).fetch_all(p).await,
            MySqlSource::Connection(c) => sqlx::query_as(MYSQL_INDEXES_SQL).bind(db_name).bind(table_name).fetch_all(&mut *c.lock().await).await,
        }.map_err(|e| e.to_string())?;

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

        Ok(TableMetadata { 
            name: table_name.to_string(), columns, indices: indices_map.into_values().collect(), category_id: None, x: 0.0, y: 0.0, extra: HashMap::new()
        })
    }

    async fn fetch_catalog(&self) -> Result<Vec<DbObject>, String> {
        let mut results: Vec<DbObject> = Vec::new();
        
        let rows1 = match &self.source {
            MySqlSource::Pool(p) => sqlx::query(MYSQL_CATALOG_TABLES_SQL).fetch_all(p).await,
            MySqlSource::Connection(c) => sqlx::query(MYSQL_CATALOG_TABLES_SQL).fetch_all(&mut *c.lock().await).await,
        }.map_err(|e| e.to_string())?;

        for row in rows1 {
            let name: String = row.try_get(0).unwrap_or_default();
            let table_type: String = row.try_get(1).unwrap_or_default();
            let type_mapped = if table_type.contains("VIEW") { "VIEW".to_string() } else { "TABLE".to_string() };
            results.push(DbObject { name, object_type: type_mapped });
        }

        let rows2 = match &self.source {
            MySqlSource::Pool(p) => sqlx::query(MYSQL_CATALOG_ROUTINES_SQL).fetch_all(p).await,
            MySqlSource::Connection(c) => sqlx::query(MYSQL_CATALOG_ROUTINES_SQL).fetch_all(&mut *c.lock().await).await,
        }.map_err(|e| e.to_string())?;

        for row in rows2 {
            let name: String = row.try_get(0).unwrap_or_default();
            let r_type: String = row.try_get(1).unwrap_or_default();
            results.push(DbObject { name, object_type: r_type.to_uppercase() });
        }

        Ok(results)
    }

    async fn execute_query(&self, sql: String, offset: i64, is_select: bool) -> Result<QueryResult, String> {
        if is_select {
            let count_query = format!("SELECT COUNT(*) FROM ({}) as t", sql.trim().trim_end_matches(';'));
            let total: i64 = match &self.source {
                MySqlSource::Pool(p) => sqlx::query_scalar(&count_query).fetch_one(p).await,
                MySqlSource::Connection(c) => sqlx::query_scalar(&count_query).fetch_one(&mut *c.lock().await).await,
            }.map_err(|e| e.to_string())?;
            
            if total > 5000 {
                return Err(format!("Query aborted: Result set too large ({} rows). Maximum allowed is 5000.", total));
            }

            let paged_sql = format!("{} LIMIT 500 OFFSET {}", sql.trim().trim_end_matches(';'), offset);
            let rows = match &self.source {
                MySqlSource::Pool(p) => sqlx::query(&paged_sql).fetch_all(p).await,
                MySqlSource::Connection(c) => sqlx::query(&paged_sql).fetch_all(&mut *c.lock().await).await,
            }.map_err(|e| e.to_string())?;
            
            let mut result_rows = Vec::new();
            let mut columns = Vec::new();
            
            if !rows.is_empty() {
                columns = rows[0].columns().iter().map(|c| c.name().to_string()).collect();
                for row in rows {
                    let mut values = Vec::new();
                    for i in 0..row.columns().len() {
                        values.push(row_value_to_string(&row, i));
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
                let res = match &self.source {
                    MySqlSource::Pool(p) => sqlx::query(stmt).execute(p).await,
                    MySqlSource::Connection(c) => sqlx::query(stmt).execute(&mut *c.lock().await).await,
                }.map_err(|e| format!("Error in statement [{}]: {}", stmt, e))?;
                total_affected += res.rows_affected();
            }
            Ok(QueryResult { 
                columns: vec![], 
                rows: vec![], 
                has_more: false, 
                total_count: Some(total_affected as i64), 
                has_uncommitted_changes: true 
            })
        }
    }

    async fn explain_plan(&self, sql: String) -> Result<String, String> {
        let explain_sql = format!("EXPLAIN {}", sql.trim().trim_end_matches(';'));
        let rows = match &self.source {
            MySqlSource::Pool(p) => sqlx::query(&explain_sql).fetch_all(p).await,
            MySqlSource::Connection(c) => sqlx::query(&explain_sql).fetch_all(&mut *c.lock().await).await,
        }.map_err(|e| e.to_string())?;
        
        let mut lines = Vec::new();
        for row in rows {
            let mut vals = Vec::new();
            for i in 0..row.columns().len() {
                let val: Option<String> = row.try_get(i).ok();
                vals.push(val.unwrap_or_else(|| "NULL".to_string()));
            }
            lines.push(vals.join(" | "));
        }
        Ok(lines.join("\n"))
    }

    async fn commit(&self) -> Result<(), String> {
        match &self.source {
            MySqlSource::Pool(p) => {
                let _ = sqlx::query("COMMIT").execute(p).await;
                let _ = sqlx::query("SET autocommit=0").execute(p).await;
            },
            MySqlSource::Connection(c) => {
                let mut conn = c.lock().await;
                sqlx::query("COMMIT").execute(&mut *conn).await.map_err(|e| e.to_string())?;
                sqlx::query("SET autocommit=0").execute(&mut *conn).await.map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    async fn rollback(&self) -> Result<(), String> {
        match &self.source {
            MySqlSource::Pool(p) => {
                let _ = sqlx::query("ROLLBACK").execute(p).await;
                let _ = sqlx::query("SET autocommit=0").execute(p).await;
            },
            MySqlSource::Connection(c) => {
                let mut conn = c.lock().await;
                sqlx::query("ROLLBACK").execute(&mut *conn).await.map_err(|e| e.to_string())?;
                sqlx::query("SET autocommit=0").execute(&mut *conn).await.map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
}

// SQL Constants
const MYSQL_METADATA_SQL: &str = "SELECT CAST(c.table_name AS CHAR), CAST(c.column_name AS CHAR), CAST(c.data_type AS CHAR), CAST(c.column_key AS CHAR), CAST(k.referenced_table_name AS CHAR), CAST(k.referenced_column_name AS CHAR) FROM information_schema.columns c LEFT JOIN information_schema.key_column_usage k ON c.table_name = k.table_name AND c.column_name = k.column_name AND k.table_schema = c.table_schema WHERE c.table_schema = ?";
const MYSQL_COLUMNS_SQL: &str = "SELECT CAST(c.table_name AS CHAR), CAST(c.column_name AS CHAR), CAST(c.data_type AS CHAR), CAST(c.column_key AS CHAR), CAST(k.referenced_table_name AS CHAR), CAST(k.referenced_column_name AS CHAR), CAST(c.column_comment AS CHAR) FROM information_schema.columns c LEFT JOIN information_schema.key_column_usage k ON c.table_name = k.table_name AND c.column_name = k.column_name AND k.table_schema = c.table_schema WHERE c.table_schema = ? AND c.table_name = ?";
const MYSQL_INDEXES_SQL: &str = "SELECT CAST(INDEX_NAME AS CHAR), CAST(COLUMN_NAME AS CHAR), NON_UNIQUE, CAST(INDEX_TYPE AS CHAR), CAST(INDEX_COMMENT AS CHAR) FROM information_schema.statistics WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX";
const MYSQL_CATALOG_TABLES_SQL: &str = "SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()";
const MYSQL_CATALOG_ROUTINES_SQL: &str = "SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.routines WHERE ROUTINE_SCHEMA = DATABASE()";

fn row_value_to_string(row: &sqlx::mysql::MySqlRow, i: usize) -> String {
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
