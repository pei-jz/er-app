import { ErDiagramData } from '../types/er';

export const generateTableDdl = (table: import('../types/er').TableMetadata): string => {
    let ddl = `CREATE TABLE ${table.name} (\n`;

    const columnDefs = table.columns.map(col => {
        let def = `  ${col.name} ${col.data_type.toUpperCase()}`;
        if (!col.is_nullable) def += ' NOT NULL';
        if (col.default_value) def += ` DEFAULT ${col.default_value}`;
        if (col.is_primary_key) def += ' PRIMARY KEY';
        if (col.comment) def += ` COMMENT '${col.comment}'`;
        return def;
    });

    ddl += columnDefs.join(',\n');

    // Indices
    (table.indices || []).forEach(idx => {
        ddl += `,\n  ${idx.is_unique ? 'UNIQUE ' : ''}INDEX ${idx.name} (${idx.columns.join(', ')})`;
    });

    ddl += `\n)${table.comment ? ` COMMENT='${table.comment}'` : ''};\n\n`;
    return ddl;
};

export const generateFullDdl = (data: ErDiagramData): string => {
    let ddl = `-- Full Schema DDL Generated on ${new Date().toLocaleString()}\n\n`;

    data.tables.forEach(table => {
        ddl += generateTableDdl(table);
    });

    return ddl;
};

export const generateDiffDdl = (data: ErDiagramData, lastVersionTimestamp?: number): string => {
    let ddl = `-- Differential DDL Generated on ${new Date().toLocaleString()}\n`;
    if (lastVersionTimestamp) {
        ddl += `-- Changes since ${new Date(lastVersionTimestamp).toLocaleString()}\n\n`;
    } else {
        ddl += `-- Comparing all version > 1\n\n`;
    }

    data.tables.forEach(table => {
        const changedColumns = table.columns.filter(col =>
            lastVersionTimestamp ? col.last_modified > lastVersionTimestamp : col.version > 1
        );

        if (changedColumns.length > 0) {
            ddl += `-- Updates for table ${table.name}\n`;
            changedColumns.forEach(col => {
                if (col.version === 1 && !lastVersionTimestamp) {
                    // New column? (Actually version > 1 logic handles updates)
                    // If version is 1, it's new. If it's new and we have no timestamp, we don't know if it's new-new.
                }

                // If version > 1, it was modified.
                ddl += `ALTER TABLE ${table.name} MODIFY COLUMN ${col.name} ${col.data_type.toUpperCase()}`;
                if (!col.is_nullable) ddl += ' NOT NULL';
                if (col.default_value) ddl += ` DEFAULT ${col.default_value}`;
                if (col.comment) ddl += ` COMMENT '${col.comment}'`;
                ddl += ';\n';
            });
            ddl += '\n';
        }

        // Handle new columns (version == 1 but last_modified is recent)
        const newColumns = table.columns.filter(col =>
            lastVersionTimestamp ? (col.version === 1 && col.last_modified > lastVersionTimestamp) : false
        );

        if (newColumns.length > 0) {
            newColumns.forEach(col => {
                ddl += `ALTER TABLE ${table.name} ADD COLUMN ${col.name} ${col.data_type.toUpperCase()}`;
                if (!col.is_nullable) ddl += ' NOT NULL';
                if (col.default_value) ddl += ` DEFAULT ${col.default_value}`;
                if (col.comment) ddl += ` COMMENT '${col.comment}'`;
                ddl += ';\n';
            });
            ddl += '\n';
        }
    });

    return ddl;
};
