export interface ColumnMetadata {
    name: string;
    data_type: string;
    length?: number;
    precision?: number;
    scale?: number;
    is_primary_key: boolean;
    is_foreign_key: boolean;
    is_nullable: boolean;
    is_autoincrement?: boolean;
    is_unique?: boolean;
    is_unsigned?: boolean;
    is_zerofill?: boolean;
    is_binary?: boolean;
    is_virtual?: boolean;
    virtual_expression?: string;
    check_constraint?: string;
    default_value?: string;
    on_update?: string;
    comment?: string;
    charset?: string;
    collation?: string;
    sequence_name?: string;
    references_table?: string;
    references_column?: string;
    version: number;
    last_modified: number;
}

export interface IndexMetadata {
    name: string;
    columns: string[];
    is_unique: boolean;
    type?: string; // e.g., BTREE, HASH
    comment?: string;
    version: number;
    last_modified: number;
}

export interface TableMetadata {
    name: string;
    comment?: string;
    columns: ColumnMetadata[];
    indices: IndexMetadata[];
    category_ids?: string[];
    x: number;
    y: number;
    // New Fields
    has_partition?: boolean;
    partition_strategy?: string;
    has_subpartition?: boolean;
    subpartition_strategy?: string;
    tablespace?: string;
    mysql_engine?: string;
    isHighlighted?: boolean;
    isDimmed?: boolean;
    relationType?: 'self' | 'parent' | 'child' | 'to-parent' | 'from-child' | 'selected-edge' | 'none';
}

export interface CategoryMetadata {
    id: string;
    name: string;
    parent_id?: string | null;
    related_category_ids?: string[];
    x: number;
    y: number;
}

export type AppMode = 'welcome' | 'design' | 'db';
export type AppView = 'diagram' | 'metadata' | 'history' | 'settings' | 'sql';
export type TableDisplayMode = 'compact' | 'full';

export interface SchemaChange {
    type: 'create_table' | 'alter_table' | 'drop_table' | 'create_index' | 'drop_index' | 'other';
    targetName: string;
    description: string;
}

export interface SchemaSnapshot {
    id: string;
    timestamp: number;
    versionName: string;
    author: string;
    description: string;
    changes: SchemaChange[];
    tables: TableMetadata[];
    categories: CategoryMetadata[];
}

export interface MetadataSettings {
    // Table
    showTableComment: boolean;
    showEngine: boolean;
    showPartition: boolean;
    showTablespace: boolean;

    // Column - Common
    showColumnComment: boolean;
    showDefaultValue: boolean;
    showLength: boolean;
    showPrecision: boolean;
    showScale: boolean;
    showAutoIncrement: boolean;
    showUnique: boolean;
    showCheckConstraint: boolean;

    // Column - MySQL Specific
    showUnsigned: boolean;
    showZerofill: boolean;
    showBinary: boolean;
    showCharset: boolean;
    showCollation: boolean;
    showOnUpdate: boolean;

    // Column - Oracle/Postgres/General Virtual
    showSequence: boolean;
    showVirtual: boolean;
    showVirtualExpr: boolean;

    // Custom Types
    availableDataTypes?: string[];
    availableDataTypesConfigs?: DataTypeConfig[];
    activeDatabase?: 'all' | 'mysql' | 'postgres' | 'oracle';

    // Performance
    highPerformanceMode?: boolean;
    disableAnimations?: boolean;
}

export interface DataTypeConfig {
    name: string;
    mysql: boolean;
    postgres: boolean;
    oracle: boolean;
}

export const DEFAULT_DATA_TYPES_CONFIG: DataTypeConfig[] = [
    { name: 'int', mysql: true, postgres: true, oracle: true },
    { name: 'bigint', mysql: true, postgres: true, oracle: true },
    { name: 'tinyint', mysql: true, postgres: true, oracle: true },
    { name: 'smallint', mysql: true, postgres: true, oracle: true },
    { name: 'varchar(255)', mysql: true, postgres: true, oracle: true },
    { name: 'varchar(50)', mysql: true, postgres: true, oracle: true },
    { name: 'varchar2(255)', mysql: false, postgres: false, oracle: true },
    { name: 'char(1)', mysql: true, postgres: true, oracle: true },
    { name: 'text', mysql: true, postgres: true, oracle: false },
    { name: 'longtext', mysql: true, postgres: false, oracle: false },
    { name: 'decimal(10,2)', mysql: true, postgres: true, oracle: true },
    { name: 'numeric', mysql: true, postgres: true, oracle: true },
    { name: 'number', mysql: false, postgres: false, oracle: true },
    { name: 'float', mysql: true, postgres: true, oracle: true },
    { name: 'double', mysql: true, postgres: true, oracle: true },
    { name: 'datetime', mysql: true, postgres: true, oracle: false },
    { name: 'timestamp', mysql: true, postgres: true, oracle: true },
    { name: 'date', mysql: true, postgres: true, oracle: true },
    { name: 'time', mysql: true, postgres: true, oracle: false },
    { name: 'boolean', mysql: true, postgres: true, oracle: false },
    { name: 'json', mysql: true, postgres: true, oracle: false },
    { name: 'blob', mysql: true, postgres: true, oracle: true }
];

export interface ErDiagramData {
    tables: TableMetadata[];
    categories: CategoryMetadata[];
    history?: SchemaSnapshot[];
    settings?: MetadataSettings;
}

export interface CsvConfig {
    table_col: number;
    column_col: number;
    type_col: number;
    pk_col?: number;
    fk_table_col?: number;
    fk_column_col?: number;
    has_header: boolean;
    custom_string_cols?: Record<string, number>;
    custom_bool_cols?: Record<string, number>;
    custom_num_cols?: Record<string, number>;
}

export interface DbConfig {
    db_type: 'mysql' | 'postgres' | 'oracle';
    name?: string; // Optional alias for the connection
    host: string;
    port: number;
    user: string;
    pass: string;
    db_name: string;
}
