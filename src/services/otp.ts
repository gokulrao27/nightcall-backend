import crypto from 'crypto';
import twilio from 'twilio';
import nodemailer from 'nodemailer';
import { pool } from '../db/pool';
import { config } from '../config';

function generateCode(): string {
  return crypto.randomInt(100000, 999999).toString();
}

const twilioClient = config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN
  ? twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN)
  : null;

const mailer = config.SMTP_HOST ? nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: parseInt(config.SMTP_PORT ?? '587'),
  auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
}) : null;

export async function sendOTP(
  userId: string,
  contact: string,
  type: 'phone' | 'email',
): Promise<void> {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await pool.query(
    `DELETE FROM verifications WHERE contact = $1 AND type = $2 AND verified = FALSE`,
    [contact, type],
  );

  await pool.query(
    `INSERT INTO verifications (user_id, contact, type, code, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, contact, type, code, expiresAt],
  );

  if (type === 'phone' && twilioClient) {
    await twilioClient.messages.create({
      body: `Your NightCall code is ${code}. Expires in 10 minutes.`,
      from: config.TWILIO_PHONE_NUMBER!,
      to: contact,
    });
  } else if (type === 'email' && mailer) {
    await mailer.sendMail({
      from: config.SMTP_FROM,
      to: contact,
      subject: 'Your NightCall verification code',
      html: `
        <div style="background:#09090f;color:#fff;padding:40px;font-family:sans-serif;text-align:center">
          <h2 style="color:#7c6cfa;font-size:28px;margin-bottom:8px">NightCall</h2>
          <p style="color:#8b8ba0;margin-bottom:24px">Your verification code</p>
          <div style="background:#1a1a2e;border:1px solid #3d2f6a;border-radius:14px;padding:24px;font-size:40px;letter-spacing:12px;color:#c4b8f0;font-weight:bold">${code}</div>
          <p style="color:#4a4a60;font-size:12px;margin-top:16px">Expires in 10 minutes. Don't share this.</p>
        </div>`,
    });
  } else {
    console.info(`[OTP DEV] ${type} ${contact} → ${code}`);
  }
}

export async function verifyOTP(
  contact: string,
  type: 'phone' | 'email',
  code: string,
): Promise<{ valid: boolean; userId?: string; reason?: string }> {
  const result = await pool.query(
    `SELECT id, user_id, code, expires_at, attempts
     FROM verifications
     WHERE contact = $1 AND type = $2 AND verified = FALSE
     ORDER BY created_at DESC LIMIT 1`,
    [contact, type],
  );

  if (!result.rows[0]) return { valid: false, reason: 'no_code' };

  const row = result.rows[0];

  if (row.attempts >= 5) return { valid: false, reason: 'too_many_attempts' };
  if (new Date(row.expires_at) < new Date()) return { valid: false, reason: 'expired' };

  await pool.query(
    `UPDATE verifications SET attempts = attempts + 1 WHERE id = $1`,
    [row.id],
  );

  if (row.code !== code) return { valid: false, reason: 'wrong_code' };

  await pool.query(
    `UPDATE verifications SET verified = TRUE WHERE id = $1`,
    [row.id],
  );

  const col = type === 'phone' ? 'phone_verified' : 'email_verified';
  const contactCol = type === 'phone' ? 'phone' : 'email';
  await pool.query(
    `UPDATE users SET ${col} = TRUE, ${contactCol} = $1 WHERE id = $2`,
    [contact, row.user_id],
  );

  return { valid: true, userId: row.user_id };
}
