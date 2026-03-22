import fs from 'fs';
import path from 'path';

const NUM_TABLES = 1000;

// Domains
const DOMAINS = ['core', 'auth', 'hr', 'crm', 'mail', 'chat', 'drive', 'calendar', 'tasks', 'workflow', 'portal', 'finance', 'assets', 'support', 'analytics'];
const TYPES = ['user', 'group', 'role', 'rule', 'item', 'status', 'event', 'record', 'file', 'tag', 'config', 'log', 'history', 'relation', 'master', 'detail', 'summary', 'archive', 'temp', 'backup'];

console.log(`Generating CSV with ${NUM_TABLES} tables...`);

const dataRows = [];
// Header
// Table Name, Column Name, Data Type, PK, FK Table, FK Column, Comment
dataRows.push(['Table Name', 'Column Name', 'Data Type', 'PK', 'FK Table', 'FK Column', 'Comment'].join(','));

const tablesInfo = [];

for (let i = 0; i < NUM_TABLES; i++) {
    const domain = DOMAINS[i % DOMAINS.length];
    const type = TYPES[Math.floor(Math.random() * TYPES.length)];
    const tableName = `gw_${domain}_${type}_${i}`;
    tablesInfo.push(tableName);
    
    // ID column
    dataRows.push([tableName, 'id', 'bigint', 'Y', '', '', 'Primary Key'].join(','));
    // Timestamps
    dataRows.push([tableName, 'created_at', 'timestamp', '', '', '', 'Creation Date'].join(','));
    dataRows.push([tableName, 'updated_at', 'timestamp', '', '', '', 'Modification Date'].join(','));
    dataRows.push([tableName, 'status_code', 'varchar(50)', '', '', '', 'Status Code'].join(','));

    // Random columns
    const numDataCols = Math.floor(Math.random() * 5) + 1; // 1 to 5 extra cols
    for (let j = 0; j < numDataCols; j++) {
        const dType = ['varchar(255)', 'int', 'text', 'boolean', 'json'][Math.floor(Math.random() * 5)];
        dataRows.push([tableName, `data_col_${j}`, dType, '', '', '', `Random data column ${j}`].join(','));
    }

    // FK columns
    if (i > 0) {
        const numFKs = Math.floor(Math.random() * 3); // 0, 1, or 2 FKs
        for (let k = 0; k < numFKs; k++) {
            const sameDomainLimit = Math.max(1, i - 20); // try to pick recent tables
            const targetIndex = Math.floor(Math.random() * sameDomainLimit);
            const targetTable = tablesInfo[targetIndex];

            if (targetTable) {
                const fkColName = `${targetTable.replace('gw_', '')}_id`;
                dataRows.push([tableName, fkColName, 'bigint', '', targetTable, 'id', `Foreign Key to ${targetTable}`].join(','));
            }
        }
    }
}

const outputFilePath = path.join(process.cwd(), 'groupware-1000-tables.csv');
fs.writeFileSync(outputFilePath, dataRows.join('\n'), 'utf8');

console.log(`Successfully generated CSV to ${outputFilePath}`);
