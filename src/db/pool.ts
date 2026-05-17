import { Pool } from 'pg';
import { config } from '../config';

export const pool = new Pool({ connectionString: config.DATABASE_URL });

pool.on('error', (err) => {
  console.error('Unexpected pg pool error', err);
});
