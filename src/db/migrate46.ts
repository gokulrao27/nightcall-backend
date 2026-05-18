import fs from 'fs';
import path from 'path';
import { pool } from './pool';

async function migrate(): Promise<void> {
  const sql = fs.readFileSync(
    path.join(process.cwd(), 'src', 'db', 'migrations', '002_sprint46.sql'),
    'utf-8',
  );
  await pool.query(sql);
  console.log('Migration done');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed', err);
  process.exit(1);
});
