export class SExpressionParseError extends Error {
  constructor(message, sourcePath) {
    super(message);
    this.name = 'SExpressionParseError';
    this.code = 'ANALYZER_PARSE_ERROR';
    this.sourcePath = sourcePath;
  }
}

export function parseSExpression(source, { sourcePath } = {}) {
  if (typeof source !== 'string') throw new SExpressionParseError('S-expression source must be a string', sourcePath);
  let index = 0;
  const length = source.length;
  const error = (message) => { throw new SExpressionParseError(`${message} at character ${index}`, sourcePath); };
  const skipSpace = () => {
    while (index < length) {
      if (/\s/.test(source[index])) { index++; continue; }
      if (source[index] === ';') {
        while (index < length && source[index] !== '\n' && source[index] !== '\r') index++;
        continue;
      }
      break;
    }
  };
  const readQuoted = () => {
    index++;
    let value = '';
    while (index < length) {
      const character = source[index++];
      if (character === '"') return value;
      if (character === '\\') {
        if (index >= length) error('unterminated string');
        const escaped = source[index++];
        value += escaped === '\\' || escaped === '"' ? escaped : `\\${escaped}`;
      } else value += character;
    }
    error('unterminated string');
  };
  const readList = () => {
    if (source[index] !== '(') error('expected list');
    index++;
    const list = [];
    while (true) {
      skipSpace();
      if (index >= length) error('unbalanced list');
      if (source[index] === ')') { index++; return list; }
      if (source[index] === '(') list.push(readList());
      else if (source[index] === '"') list.push(readQuoted());
      else {
        const start = index;
        while (index < length && !/[\s();]/.test(source[index])) index++;
        if (start === index) error('unexpected character');
        list.push(source.slice(start, index));
      }
    }
  };
  skipSpace();
  if (index >= length) error('expected root list');
  if (source[index] !== '(') error('expected root list');
  const tree = readList();
  skipSpace();
  if (index < length) error('trailing content after root list');
  return tree;
}
