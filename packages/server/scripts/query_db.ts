import { databaseService } from '../src/services/database.js';
import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

async function run() {
    const dbPath = path.resolve(process.cwd(), '.qilin-claw/claw.db');
    console.log('db path', dbPath);
    const SQL = await initSqlJs();
    const dbData = fs.readFileSync(dbPath);
    const db = new SQL.Database(dbData);
    const result = db.exec("SELECT id, name, provider, model, api_key FROM llm_configs");

    if (result.length > 0) {
        const columns = result[0].columns;
        const values = result[0].values;
        const rows = values.map(val => {
            let row: any = {};
            columns.forEach((col, idx) => { row[col] = val[idx]; });
            return row;
        });
        console.log(JSON.stringify(rows, null, 2));
    } else {
        console.log('No llm configs found.');
    }
}

run().catch(console.error);
