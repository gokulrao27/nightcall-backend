import { describe, it, expect } from 'vitest';
import { moderateText } from './moderation';

describe('moderateText', () => {
  it('passes clean text', () => {
    const result = moderateText('I told a stranger something I had never said out loud.');
    expect(result.passed).toBe(true);
  });

  it('rejects phone numbers', () => {
    const result = moderateText('Call me at 9876543210 tonight');
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('phone_number');
  });

  it('rejects email addresses', () => {
    const result = moderateText('Reach me at hello@example.com');
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('email_address');
  });

  it('rejects social handles', () => {
    const result = moderateText('Find me @username on instagram');
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('social_handle');
  });

  it('passes text that has an @ in an email-like context already caught', () => {
    const result = moderateText('I felt @ease for once.');
    expect(result.passed).toBe(false); // @ease matches social handle pattern
  });
});
