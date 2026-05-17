// bad-words v3 uses CommonJS export = pattern; import via require interop
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Filter = require('bad-words') as new () => { isProfane: (t: string) => boolean };

const filter = new Filter();

export function moderateText(text: string): { passed: boolean; reason?: string } {
  try {
    if (filter.isProfane(text)) {
      return { passed: false, reason: 'profanity' };
    }
  } catch {
    // bad-words throws on some edge-case inputs — treat as passing
  }

  if (/\b\d{10,}\b/.test(text)) {
    return { passed: false, reason: 'phone_number' };
  }
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text)) {
    return { passed: false, reason: 'email_address' };
  }
  if (/@[a-z0-9_]{3,}/i.test(text)) {
    return { passed: false, reason: 'social_handle' };
  }
  return { passed: true };
}
