import fs from 'fs';
import zlib from 'zlib';

const TABLE_COUNT = 1000;
const COL_COUNT = 10;

const tables = [];
for (let i = 0; i < TABLE_COUNT; i++) {
    const columns = [];
    for (let j = 0; j < COL_COUNT; j++) {
        columns.push({
            name: `col_${j}`,
            data_type: 'varchar(255)',
            is_primary_key: j === 0,
            is_foreign_key: j === 1 && i > 0,
            references_table: j === 1 && i > 0 ? `table_${i - 1}` : null,
            references_column: j === 1 && i > 0 ? 'col_0' : null,
            version: 1,
            last_modified: Date.now()
        });
    }
    tables.push({
        name: `table_${i}`,
        columns,
        x: 0,
        y: 0,
        version: 1,
        last_modified: Date.now()
    });
}

const data = {
    tables,
    categories: [],
    settings: {
        availableDataTypesConfigs: [
            { name: 'varchar(255)', mysql: true, postgres: true, oracle: true }
        ]
    }
};

const json = JSON.stringify(data);
const compressed = zlib.gzipSync(json);
fs.writeFileSync('performance_test_1000.er', compressed);
console.log('Generated performance_test_1000.er');
