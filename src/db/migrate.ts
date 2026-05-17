import fs from 'fs';
import path from 'path';
import { pool } from './pool';

async function migrate(): Promise<void> {
  // Use process.cwd() so this works both from dist/ (prod) and src/ (dev)
  const sql = fs.readFileSync(path.join(process.cwd(), 'src', 'db', 'schema.sql'), 'utf-8');
  await pool.query(sql);
  console.log('Migration complete');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed', err);
  process.exit(1);
});
