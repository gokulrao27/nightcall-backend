import { Router } from 'express';
import { pool } from '../db/pool';

export const statsRouter = Router();

// GET /stats/last-night
statsRouter.get('/last-night', async (_req, res, next) => {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    const cached = await pool.query(
      `SELECT * FROM nightly_stats WHERE stat_date = $1`, [dateStr],
    );
    if (cached.rows[0]) return res.json(cached.rows[0]);

    const [callCount, topWord, topConnection] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM calls WHERE started_at::date = $1`, [dateStr]),
      pool.query(`SELECT word, COUNT(*) as c FROM words WHERE created_at::date = $1 GROUP BY word ORDER BY c DESC LIMIT 1`, [dateStr]),
      pool.query(`SELECT country_a, country_b, COUNT(*) as c FROM calls WHERE started_at::date = $1 AND country_a IS NOT NULL GROUP BY country_a, country_b ORDER BY c DESC LIMIT 1`, [dateStr]),
    ]);

    const stats = {
      stat_date:        dateStr,
      total_calls:      parseInt(callCount.rows[0].count),
      most_common_word: topWord.rows[0]?.word ?? null,
      city_a:           topConnection.rows[0]?.country_a ?? null,
      city_b:           topConnection.rows[0]?.country_b ?? null,
    };

    await pool.query(
      `INSERT INTO nightly_stats (stat_date, total_calls, most_common_word, city_a, city_b)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (stat_date) DO NOTHING`,
      [stats.stat_date, stats.total_calls, stats.most_common_word, stats.city_a, stats.city_b],
    );

    res.json(stats);
  } catch (err) { next(err); }
});
