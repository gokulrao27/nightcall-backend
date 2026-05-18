import fs from 'fs';
import path from 'path';
import { pool } from './pool';

async function migrate(): Promise<void> {
  const dbDir = path.join(process.cwd(), 'src', 'db');

  // 1. Base schema (all IF NOT EXISTS / ON CONFLICT DO NOTHING — safe to re-run)
  const schema = fs.readFileSync(path.join(dbDir, 'schema.sql'), 'utf-8');
  await pool.query(schema);
  console.log('Base schema applied');

  // 2. Sprint migrations in filename order (all use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
  const migrationsDir = path.join(dbDir, 'migrations');
  if (fs.existsSync(migrationsDir)) {
    const files = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      await pool.query(sql);
      console.log(`Migration ${file} applied`);
    }
  }

  console.log('All migrations complete');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed', err);
  process.exit(1);
});
