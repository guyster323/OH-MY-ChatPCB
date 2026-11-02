// Single source for the short stderr excerpt shown in ERC reasons and in the
// ERC_BLOCKED response: one line, absolute paths masked, at most
// STDERR_EXCERPT_CHARS characters.
export const STDERR_EXCERPT_CHARS = 200;

const WINDOWS_ABSOLUTE_PATH = /[A-Za-z]:\\[^\s"']+/g;
const POSIX_ABSOLUTE_PATH = /(?<![\w.])\/[^\s"']+/g;

export function stderrExcerpt(stderr) {
  if (typeof stderr !== 'string') return '';
  const line = stderr
    .replace(WINDOWS_ABSOLUTE_PATH, '<path>')
    .replace(POSIX_ABSOLUTE_PATH, '<path>')
    .replace(/\s+/g, ' ')
    .trim();
  return line.length > STDERR_EXCERPT_CHARS ? `${line.slice(0, STDERR_EXCERPT_CHARS - 3)}...` : line;
}
