// Shared text for role, target, and value matching. Cf is stripped before
// NFKC so a format character cannot hide a word. Every dash (\p{Pd}) becomes
// ASCII '-'. U+2212 is a math symbol, not Pd, and folds the same way so
// '−10Ω' stays a signed value. Whitespace collapses to one space.
// The result is idempotent.
export function normalizeMatchText(text) {
  return String(text ?? '')
    .replace(/\p{Cf}/gu, '')
    .normalize('NFKC')
    .replace(/\p{Pd}|\u2212/gu, '-')
    .replace(/\s+/gu, ' ');
}
