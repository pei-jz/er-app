import fs from 'fs';
import path from 'path';

const NUM_TABLES = 1000;

// Groupware domains to make tables look somewhat realistic
const DOMAINS = ['core', 'auth', 'hr', 'crm', 'mail', 'chat', 'drive', 'calendar', 'tasks', 'workflow', 'portal', 'finance', 'assets', 'support', 'analytics'];
const TYPES = ['user', 'group', 'role', 'rule', 'item', 'status', 'event', 'record', 'file', 'tag', 'config', 'log', 'history', 'relation', 'master', 'detail', 'summary', 'archive', 'temp', 'backup'];

const tables = [];
const categories = [];

// Create categories for each domain
DOMAINS.forEach((domain, index) => {
    categories.push({
        id: `cat-${domain}`,
        name: domain.toUpperCase(),
        x: (index % 5) * 500,
        y: Math.floor(index / 5) * 500
    });
});

console.log(`Generating ${NUM_TABLES} tables...`);

for (let i = 0; i < NUM_TABLES; i++) {
    const domain = DOMAINS[i % DOMAINS.length];
    const type = TYPES[Math.floor(Math.random() * TYPES.length)];
    const tableName = `gw_${domain}_${type}_${i}`;
    
    // Every table gets an ID and standard timestamps
    const columns = [
        {
            name: 'id',
            data_type: 'bigint',
            is_primary_key: true,
            is_foreign_key: false,
            is_nullable: false,
            is_autoincrement: true,
            version: 1,
            last_modified: Date.now()
        },
        {
            name: 'created_at',
            data_type: 'timestamp',
            is_primary_key: false,
            is_foreign_key: false,
            is_nullable: false,
            version: 1,
            last_modified: Date.now()
        },
        {
            name: 'updated_at',
            data_type: 'timestamp',
            is_primary_key: false,
            is_foreign_key: false,
            is_nullable: false,
            version: 1,
            last_modified: Date.now()
        },
        {
            name: 'status_code',
            data_type: 'varchar(50)',
            is_primary_key: false,
            is_foreign_key: false,
            is_nullable: true,
            version: 1,
            last_modified: Date.now()
        }
    ];

    // Add some random data columns
    const numDataCols = Math.floor(Math.random() * 5) + 1; // 1 to 5 extra columns
    for (let j = 0; j < numDataCols; j++) {
        columns.push({
            name: `data_col_${j}`,
            data_type: ['varchar(255)', 'int', 'text', 'boolean', 'json'][Math.floor(Math.random() * 5)],
            is_primary_key: false,
            is_foreign_key: false,
            is_nullable: true,
            version: 1,
            last_modified: Date.now()
        });
    }

    // Add connections (foreign keys) to previous tables to create a network
    // We only connect to tables with a lower index to avoid circular dependencies for Dagre initially,
    // though real DBs have them, it makes it easier to generate. Let's add 0 to 3 FKs per table.
    if (i > 0) {
        const numFKs = Math.floor(Math.random() * 3); // 0, 1, or 2 FKs
        for (let k = 0; k < numFKs; k++) {
            // Pick a random previous table within the same domain mostly, or occasionally outside
            const sameDomainLimit = Math.max(1, i - 20); // try to pick recent tables
            const targetIndex = Math.floor(Math.random() * sameDomainLimit);
            const targetTable = tables[targetIndex];

            if (targetTable) {
                const fkColName = `${targetTable.name.replace('gw_', '')}_id`;
                // Avoid duplicate FK column names
                if (!columns.some(c => c.name === fkColName)) {
                    columns.push({
                        name: fkColName,
                        data_type: 'bigint',
                        is_primary_key: false,
                        is_foreign_key: true,
                        references_table: targetTable.name,
                        references_column: 'id',
                        is_nullable: true,
                        version: 1,
                        last_modified: Date.now()
                    });
                }
            }
        }
    }

    tables.push({
        name: tableName,
        comment: `Groupware ${domain} ${type} table ${i}`,
        columns: columns,
        indices: [],
        category_ids: [`cat-${domain}`],
        x: 0,
        y: 0 
    });
}

const erData = {
    tables: tables,
    categories: categories,
    settings: {
        activeDatabase: 'mysql',
        showTableComment: true,
        showColumnComment: true
    }
};

const outputFilePath = path.join(process.cwd(), 'groupware-1000-tables.json');
fs.writeFileSync(outputFilePath, JSON.stringify(erData, null, 2));

console.log(`Successfully generated 1000 tables to ${outputFilePath}`);
