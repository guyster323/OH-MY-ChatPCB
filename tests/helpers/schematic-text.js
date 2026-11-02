// One parser for KiCad schematic (text ...) and (label ...) items, shared by the schematic tests.
const TEXT_ITEM = /\((text|label) "((?:[^"\\]|\\.)*)"\s+\(at ([\d.]+) ([\d.]+)[^)]*\)\s+(\(effects [^\n]*)/g;

export function schematicTextItems(schematic, kinds = ['text']) {
  return [...schematic.matchAll(TEXT_ITEM)]
    .filter((match) => kinds.includes(match[1]))
    .map((match) => ({
      kind: match[1],
      text: match[2].replace(/\\(["\\])/g, '$1'),
      x: Number(match[3]),
      y: Number(match[4]),
      effects: match[5]
    }));
}

// Long schematic notes wrap onto several (text ...) lines; rejoin them to read each note as one sentence.
export function sheetNoteText(schematic) {
  return schematicTextItems(schematic).map((item) => item.text).join(' ');
}
