use async_trait::async_trait;
use sqlx::{Row, Column};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex as AsyncMutex;
use crate::models::{TableMetadata, ColumnMetadata, DbObject, QueryResult, IndexMetadata};
use crate::db::DatabaseManager;

pub enum PostgresSource {
    Pool(sqlx::PgPool),
    Connection(Arc<AsyncMutex<sqlx::PgConnection>>),
}

pub struct PostgresManager {
    pub source: PostgresSource,
}

#[async_trait]
impl DatabaseManager for PostgresManager {
    async fn fetch_metadata(&self, _db_name: &str) -> Result<Vec<TableMetadata>, String> {
        let rows: Vec<(String, String, String, String, Option<String>, Option<String>)> = match &self.source {
            PostgresSource::Pool(p) => sqlx::query_as(POSTGRES_METADATA_SQL).fetch_all(p).await,
            PostgresSource::Connection(c) => sqlx::query_as(POSTGRES_METADATA_SQL).fetch_all(&mut *c.lock().await).await,
        }.map_err(|e| e.to_string())?;

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
                is_primary_key: false, 
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
            TableMetadata { name, columns, indices: Vec::new(), category_id: None, x: 0.0, y: 0.0, extra }
        }).collect())
    }

    async fn fetch_table_columns(&self, _db_name: &str, table_name: &str) -> Result<TableMetadata, String> {
        let col_rows = match &self.source {
            PostgresSource::Pool(p) => sqlx::query(POSTGRES_COLUMNS_SQL).bind(table_name).fetch_all(p).await,
            PostgresSource::Connection(c) => sqlx::query(POSTGRES_COLUMNS_SQL).bind(table_name).fetch_all(&mut *c.lock().await).await,
        }.map_err(|e| e.to_string())?;

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
            columns.push(ColumnMetadata { name, data_type, is_primary_key: false, is_foreign_key: false, references_table: None, references_column: None, extra });
        }

        let con_rows = match &self.source {
            PostgresSource::Pool(p) => sqlx::query(POSTGRES_CONSTRAINTS_SQL).bind(table_name).fetch_all(p).await,
            PostgresSource::Connection(c) => sqlx::query(POSTGRES_CONSTRAINTS_SQL).bind(table_name).fetch_all(&mut *c.lock().await).await,
        }.map_err(|e| e.to_string())?;

        let mut indices: Vec<IndexMetadata> = Vec::new();
        for row in con_rows {
            let c_name: String = row.get("constraint_name");
            let c_type: String = row.get("constraint_type");
            let cols: Vec<String> = row.get("column_names");
            let ref_t: Option<String> = if c_type == "f" { Some(row.get("ref_table")) } else { None };
            let ref_cs: Option<Vec<String>> = if c_type == "f" { Some(row.get("ref_columns")) } else { None };

            indices.push(IndexMetadata {
                name: c_name.clone(),
                columns: cols.clone(),
                is_unique: c_type == "p" || c_type == "u",
                r#type: Some(match c_type.as_str() { "p" => "PK", "f" => "FK", "u" => "UNIQUE", _ => "CONSTR" }.to_string()),
                comment: None,
                extra: HashMap::new(),
            });

            for col in &mut columns {
                if let Some(idx) = cols.iter().position(|c| c == &col.name) {
                    if c_type == "p" { col.is_primary_key = true; }
                    else if c_type == "f" {
                        col.is_foreign_key = true;
                        col.references_table = ref_t.clone();
                        if let Some(rcs) = &ref_cs { col.references_column = rcs.get(idx).cloned(); }
                    }
                }
            }
        }

        let idx_rows = match &self.source {
            PostgresSource::Pool(p) => sqlx::query(POSTGRES_INDEXES_SQL).bind(table_name).fetch_all(p).await,
            PostgresSource::Connection(c) => sqlx::query(POSTGRES_INDEXES_SQL).bind(table_name).fetch_all(&mut *c.lock().await).await,
        }.map_err(|e| e.to_string())?;

        for row in idx_rows {
            let i_name: String = row.get("index_name");
            if indices.iter().any(|idx| idx.name == i_name) { continue; }
            let cols: Vec<String> = row.get("column_names");
            let is_unique: bool = row.get("is_unique");
            indices.push(IndexMetadata { name: i_name, columns: cols, is_unique, r#type: Some("INDEX".to_string()), comment: None, extra: HashMap::new() });
        }

        Ok(TableMetadata { name: table_name.to_string(), columns, indices, category_id: None, x: 0.0, y: 0.0, extra: {
            let mut e = HashMap::new();
            if let Some(c) = table_comment { e.insert("comment".to_string(), serde_json::Value::String(c)); }
            e
        }})
    }

    async fn fetch_catalog(&self) -> Result<Vec<DbObject>, String> {
        let rows = match &self.source {
            PostgresSource::Pool(p) => sqlx::query(POSTGRES_CATALOG_SQL).fetch_all(p).await,
            PostgresSource::Connection(c) => sqlx::query(POSTGRES_CATALOG_SQL).fetch_all(&mut *c.lock().await).await,
        }.map_err(|e| e.to_string())?;
        Ok(rows.iter().map(|row| DbObject { name: row.get(0), object_type: row.get(1) }).collect())
    }

    async fn execute_query(&self, sql: String, offset: i64, is_select: bool) -> Result<QueryResult, String> {
        if is_select {
            let count_query = format!("SELECT COUNT(*) FROM ({}) as t", sql.trim().trim_end_matches(';'));
            let total: i64 = match &self.source {
                PostgresSource::Pool(p) => sqlx::query_scalar(&count_query).fetch_one(p).await,
                PostgresSource::Connection(c) => sqlx::query_scalar(&count_query).fetch_one(&mut *c.lock().await).await,
            }.map_err(|e| e.to_string())?;
            if total > 5000 { return Err(format!("Query aborted: Result set too large ({} rows). Maximum allowed is 5000.", total)); }

            let paged_sql = format!("{} LIMIT 500 OFFSET {}", sql.trim().trim_end_matches(';'), offset);
            let rows = match &self.source {
                PostgresSource::Pool(p) => sqlx::query(&paged_sql).fetch_all(p).await,
                PostgresSource::Connection(c) => sqlx::query(&paged_sql).fetch_all(&mut *c.lock().await).await,
            }.map_err(|e| e.to_string())?;
            
            let mut result_rows = Vec::new();
            let mut columns = Vec::new();
            if !rows.is_empty() {
                columns = rows[0].columns().iter().map(|c| c.name().to_string()).collect();
                for row in rows {
                    let mut values = Vec::new();
                    for i in 0..row.columns().len() { values.push(row_value_to_string(&row, i)); }
                    result_rows.push(values);
                }
            }
            Ok(QueryResult { columns, rows: result_rows, has_more: total > offset + 500, total_count: Some(total), has_uncommitted_changes: false })
        } else {
            let mut total_affected = 0;
            let statements: Vec<&str> = sql.split(';').filter(|s| !s.trim().is_empty()).collect();
            for stmt in statements {
                let res_result = match &self.source {
                    PostgresSource::Pool(p) => sqlx::query(stmt).execute(p).await,
                    PostgresSource::Connection(c) => sqlx::query(stmt).execute(&mut *c.lock().await).await,
                };
                let res = match res_result {
                    Ok(r) => r,
                    Err(e) => {
                        let _ = self.rollback().await; // Auto rollback on error
                        let _ = self.commit().await; // Begin new transaction (trait impl of commit/rollback handles it)
                        return Err(format!("Error in statement [{}]: {}. (Connection auto-reset via ROLLBACK)", stmt, e));
                    }
                };
                total_affected += res.rows_affected();
            }
            Ok(QueryResult { columns: vec![], rows: vec![], has_more: false, total_count: Some(total_affected as i64), has_uncommitted_changes: true })
        }
    }

    async fn explain_plan(&self, sql: String) -> Result<String, String> {
        let explain_sql = format!("EXPLAIN {}", sql.trim().trim_end_matches(';'));
        let rows = match &self.source {
            PostgresSource::Pool(p) => sqlx::query(&explain_sql).fetch_all(p).await,
            PostgresSource::Connection(c) => sqlx::query(&explain_sql).fetch_all(&mut *c.lock().await).await,
        }.map_err(|e| e.to_string())?;
        Ok(rows.iter().map(|r| r.get::<String, _>(0)).collect::<Vec<_>>().join("\n"))
    }

    async fn commit(&self) -> Result<(), String> {
        match &self.source {
            PostgresSource::Pool(p) => { 
                let _ = sqlx::query("COMMIT").execute(p).await;
                let _ = sqlx::query("BEGIN").execute(p).await;
            },
            PostgresSource::Connection(c) => {
                let mut conn = c.lock().await;
                sqlx::query("COMMIT").execute(&mut *conn).await.map_err(|e| e.to_string())?;
                let _ = sqlx::query("BEGIN").execute(&mut *conn).await;
            }
        }
        Ok(())
    }

    async fn rollback(&self) -> Result<(), String> {
        match &self.source {
            PostgresSource::Pool(p) => {
                let _ = sqlx::query("ROLLBACK").execute(p).await;
                let _ = sqlx::query("BEGIN").execute(p).await;
            },
            PostgresSource::Connection(c) => {
                let mut conn = c.lock().await;
                sqlx::query("ROLLBACK").execute(&mut *conn).await.map_err(|e| e.to_string())?;
                let _ = sqlx::query("BEGIN").execute(&mut *conn).await;
            }
        }
        Ok(())
    }
}

// SQL Constants
const POSTGRES_METADATA_SQL: &str = "SELECT c.table_name, c.column_name, c.data_type, c.is_nullable, obj_description(t.oid) as table_comment, col_description(t.oid, a.attnum) as column_comment FROM information_schema.columns c JOIN pg_class t ON c.table_name = t.relname JOIN pg_namespace n ON t.relnamespace = n.oid AND c.table_schema = n.nspname JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = c.column_name WHERE c.table_schema = 'public'";
const POSTGRES_COLUMNS_SQL: &str = "SELECT c.column_name, c.data_type, c.is_nullable, obj_description(t.oid) as table_comment, col_description(t.oid, a.attnum) as column_comment FROM information_schema.columns c JOIN pg_class t ON c.table_name = t.relname JOIN pg_namespace n ON t.relnamespace = n.oid AND c.table_schema = n.nspname JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = c.column_name WHERE c.table_schema = 'public' AND c.table_name = $1 ORDER BY c.ordinal_position";
const POSTGRES_CONSTRAINTS_SQL: &str = "SELECT conname as constraint_name, contype::text as constraint_type, ARRAY(SELECT attname FROM pg_attribute WHERE attrelid = conrelid AND attnum = ANY(conkey) ORDER BY array_position(conkey, attnum)) as column_names, confrelid::regclass::text as ref_table, ARRAY(SELECT attname FROM pg_attribute WHERE attrelid = confrelid AND attnum = ANY(confkey) ORDER BY array_position(confkey, attnum)) as ref_columns FROM pg_constraint WHERE conrelid = $1::regclass";
const POSTGRES_INDEXES_SQL: &str = "SELECT i.relname as index_name, ARRAY(SELECT attname FROM pg_attribute WHERE attrelid = t.oid AND attnum = ANY(ix.indkey) ORDER BY array_position(ix.indkey, attnum)) as column_names, ix.indisunique as is_unique FROM pg_class t, pg_class i, pg_index ix WHERE t.oid = ix.indrelid AND i.oid = ix.indexrelid AND t.relkind = 'r' AND t.relname = $1 AND ix.indisprimary = false";
const POSTGRES_CATALOG_SQL: &str = "SELECT tablename as name, 'TABLE' as type FROM pg_tables WHERE schemaname = current_schema() UNION ALL SELECT viewname as name, 'VIEW' as type FROM pg_views WHERE schemaname = current_schema() UNION ALL SELECT p.proname as name, 'FUNCTION' as type FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = current_schema()";

fn row_value_to_string(row: &sqlx::postgres::PgRow, i: usize) -> String {
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
