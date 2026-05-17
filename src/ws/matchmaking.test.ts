import { describe, it, expect } from 'vitest';

// Test the time-window logic in isolation via a copy of the pure function
function isWindowOpen(timezone: string, fakeNow?: Date): boolean {
  const now = fakeNow ?? new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const hourPart = parts.find((p) => p.type === 'hour');
  const minutePart = parts.find((p) => p.type === 'minute');
  if (!hourPart || !minutePart) return false;
  const h = parseInt(hourPart.value, 10);
  const m = parseInt(minutePart.value, 10);
  return h === 2 && m < 50;
}

describe('isWindowOpen', () => {
  it('returns true at 2:00 AM', () => {
    // 2025-05-17 02:10 UTC ≈ 2025-05-17 07:40 IST — not 2 AM IST
    // Build a date that is exactly 2:15 AM in Asia/Kolkata (IST = UTC+5:30)
    // 2:15 AM IST = 20:45 UTC previous day
    const date = new Date('2025-05-16T20:45:00Z');
    expect(isWindowOpen('Asia/Kolkata', date)).toBe(true);
  });

  it('returns false at 3:00 AM', () => {
    // 3:00 AM IST = 21:30 UTC previous day
    const date = new Date('2025-05-16T21:30:00Z');
    expect(isWindowOpen('Asia/Kolkata', date)).toBe(false);
  });

  it('returns false at 2:50 AM', () => {
    // 2:50 AM IST = 21:20 UTC previous day
    const date = new Date('2025-05-16T21:20:00Z');
    expect(isWindowOpen('Asia/Kolkata', date)).toBe(false);
  });

  it('returns true at 2:49 AM', () => {
    // 2:49 AM IST = 21:19 UTC previous day
    const date = new Date('2025-05-16T21:19:00Z');
    expect(isWindowOpen('Asia/Kolkata', date)).toBe(true);
  });
});
