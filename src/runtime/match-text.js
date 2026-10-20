// Shared text for role, target, and value matching. Cf is stripped before
// NFKC so a format character cannot hide a word. These dashes become ASCII
// '-' before NFKC, because NFKC does not fold U+2010–U+2015 or U+2212.
// U+FE58/U+FE63/U+FF0D are listed too, so the fold does not depend on NFKC.
// Any other Pd dash still folds after NFKC. Whitespace collapses to one space.
// The result is idempotent.
const EXPLICIT_DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g;

export function normalizeMatchText(text) {
  return String(text ?? '')
    .replace(/\p{Cf}/gu, '')
    .replace(EXPLICIT_DASHES, '-')
    .normalize('NFKC')
    .replace(/\p{Pd}|\u2212/gu, '-')
    .replace(/\s+/gu, ' ');
}
